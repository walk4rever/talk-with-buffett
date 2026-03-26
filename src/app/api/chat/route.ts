import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getClientIp } from "@/lib/ratelimit";
import { buildSystemPrompt } from "@/lib/prompts/buffett";
import type { EvidencePlan, RetrievedChunk } from "@/lib/prompts/buffett";
import { searchChunks } from "@/lib/search";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_CHAT_LIMIT ?? "30", 10);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 3);
}

function pickEvidenceExcerpt(queryEn: string, contentEn: string): string {
  const text = contentEn.trim();
  if (!text) return "";

  const queryTokens = new Set(tokenize(queryEn));
  if (queryTokens.size === 0) {
    return text.slice(0, 180).trim() + (text.length > 180 ? "…" : "");
  }

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (sentences.length === 0) {
    return text.slice(0, 180).trim() + (text.length > 180 ? "…" : "");
  }

  let best = sentences[0];
  let bestScore = -1;

  for (const s of sentences) {
    const tokens = tokenize(s);
    if (tokens.length === 0) continue;
    let overlap = 0;
    for (const t of tokens) {
      if (queryTokens.has(t)) overlap++;
    }
    const score = overlap / Math.sqrt(tokens.length);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  const clipped = best.length > 220 ? `${best.slice(0, 220).trim()}…` : best;
  return clipped;
}

function pickEvidenceExcerptZh(contentZh: string | null): string {
  const text = (contentZh ?? "").trim();
  if (!text) return "";
  const lines = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  const best = lines[0] ?? text;
  return best.length > 140 ? `${best.slice(0, 140).trim()}…` : best;
}

function buildEvidencePlan(params: {
  query: string;
  intent: string;
  answerMode: string;
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
  chunks: RetrievedChunk[];
}): EvidencePlan {
  const yearsCovered = [...new Set(params.chunks.map((c) => c.year))].sort((a, b) => a - b);
  const hasYearConstraint = params.yearFrom !== null || params.yearTo !== null;
  const sufficient = params.chunks.length > 0;

  let insufficiencyReason: string | undefined;
  if (!sufficient) {
    const rangeHint = hasYearConstraint
      ? `（时间约束：${params.yearFrom ?? "不限"}-${params.yearTo ?? "不限"}）`
      : "";
    insufficiencyReason = `检索范围内未命中相关段落${rangeHint}`;
  }

  return {
    query: params.query,
    intent: params.intent,
    answerMode: params.answerMode,
    entities: params.entities,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    yearsCovered,
    evidenceCount: params.chunks.length,
    sufficient,
    insufficiencyReason,
  };
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
  const [usage, searchResult] = await Promise.all([
    checkAndIncrementUsage(ip),
    searchChunks(lastUserMsg.content),
  ]);
  const {
    chunks,
    order,
    distinctByYear,
    evidenceQuery,
    taskType,
    intent,
    answerMode,
    entities,
    yearFrom,
    yearTo,
    needsRetrieval,
  } = searchResult;
  console.log(`[search] query="${lastUserMsg.content.slice(0, 60)}" chunks=${chunks.length} order=${order} distinct=${distinctByYear}`);

  if (!usage.allowed) {
    return NextResponse.json(
      { error: `今日免费次数已用完（${FREE_DAILY_LIMIT}次/天），请明天再来或登录获取更多次数。` },
      { status: 429 },
    );
  }

  const evidencePlan = needsRetrieval
    ? buildEvidencePlan({
        query: evidenceQuery,
        intent,
        answerMode,
        entities,
        yearFrom,
        yearTo,
        chunks,
      })
    : null;

  const systemPrompt = buildSystemPrompt(chunks, order, distinctByYear, evidencePlan);

  // Build sources from search results (always shown, independent of AI output)
  const sources = chunks.map((c) => ({
    year: c.year,
    title: c.title,
    sourceType: c.sourceType,
    chunkId: c.id,
    excerpt: pickEvidenceExcerpt(evidenceQuery, c.contentEn),
    excerptZh: pickEvidenceExcerptZh(c.contentZh),
    retrieval: c.retrieval,
    semanticScore: c.semanticScore,
    keywordScore: c.keywordScore,
  }));

  // Create ChatMessage record (answer filled in after streaming completes)
  const chatRecord = await prisma.chatMessage.create({
    data: {
      ip,
      question: lastUserMsg.content,
      sourceIds: chunks.map((c) => c.id),
      taskType,
      needsRetrieval,
    },
  });

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
      // Send sources + chatMessageId immediately before AI streaming begins.
      controller.enqueue(
        encoder.encode(
          `event: sources\ndata: ${JSON.stringify({ sources, remaining: usage.remaining, chatMessageId: chatRecord.id })}\n\n`,
        ),
      );

      const reader = aiRes.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let answerBuffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;

            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                answerBuffer += delta;
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

        // Persist the completed answer (fire-and-forget, don't block the stream)
        prisma.chatMessage.update({
          where: { id: chatRecord.id },
          data: { answer: answerBuffer },
        }).catch((err) => console.error("[chat] failed to save answer:", err));
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
