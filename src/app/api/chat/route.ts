import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getClientIp } from "@/lib/ratelimit";
import { buildSystemPrompt } from "@/lib/prompts/buffett";
import { searchChunks } from "@/lib/search";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_CHAT_LIMIT ?? "30", 10);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function checkAndIncrementUsage(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const date = todayStr();

  const entry = await prisma.chatUsage.upsert({
    where: { ip_date: { ip, date } },
    update: { count: { increment: 1 } },
    create: { ip, date, count: 1 },
  });

  const allowed = entry.count <= FREE_DAILY_LIMIT;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - entry.count);
  return { allowed, remaining };
}

// ── Route handler (SSE streaming) ─────────────────────────────────────────

export async function POST(req: Request) {
  const ip = getClientIp(req);

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const lastUserMsg = [...body.messages].reverse().find(
    (m: { role: string }) => m.role === "user",
  );
  if (!lastUserMsg) {
    return NextResponse.json({ error: "No user message" }, { status: 400 });
  }

  // Parallel: usage check + tool-use search
  const [usage, { chunks, order, distinctByYear }] = await Promise.all([
    checkAndIncrementUsage(ip),
    searchChunks(lastUserMsg.content),
  ]);
  console.log(`[search] query="${lastUserMsg.content.slice(0, 60)}" chunks=${chunks.length} order=${order} distinct=${distinctByYear}`);

  if (!usage.allowed) {
    return NextResponse.json(
      { error: `今日免费次数已用完（${FREE_DAILY_LIMIT}次/天），请明天再来或登录获取更多次数。` },
      { status: 429 },
    );
  }

  const systemPrompt = buildSystemPrompt(chunks, order, distinctByYear);

  // Build sources from search results (always shown, independent of AI output)
  const sources = chunks.map((c) => ({
    year: c.year,
    title: c.title,
    sourceType: c.sourceType,
    chunkId: c.id,
    excerpt: c.contentEn.slice(0, 150).trim() + (c.contentEn.length > 150 ? "…" : ""),
  }));

  const aiMessages = [
    { role: "system", content: systemPrompt },
    ...body.messages
      .filter((m: { role: string }) => m.role !== "system")
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
  ];

  // Call AI with streaming
  const aiRes = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: aiMessages,
      temperature: 0.7,
      max_tokens: 1000,
      stream: true,
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error("AI API error:", errText);
    return NextResponse.json(
      { error: "AI 服务暂时不可用，请稍后重试。" },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send sources immediately before AI streaming begins so it always arrives.
      controller.enqueue(
        encoder.encode(
          `event: sources\ndata: ${JSON.stringify({ sources, remaining: usage.remaining })}\n\n`,
        ),
      );

      const reader = aiRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;

            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(
                  encoder.encode(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`),
                );
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }

        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      } catch (err) {
        console.error("Stream processing error:", err);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
