import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getClientIp } from "@/lib/ratelimit";
import { buildSystemPrompt, type RetrievedSection } from "@/lib/prompts/buffett";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const FREE_DAILY_LIMIT = 5;

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

// ── Retrieval ──────────────────────────────────────────────────────────────

async function retrieveRelevantSections(query: string): Promise<RetrievedSection[]> {
  // Extract meaningful keywords (strip common stop words)
  const stopWords = new Set([
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "有",
    "和", "与", "或", "但", "如果", "什么", "怎么", "为什么", "how", "what", "why",
    "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "you",
    "i", "he", "she", "it", "we", "they", "and", "or", "but", "in", "on", "at",
  ]);

  const keywords = query
    .toLowerCase()
    .split(/[\s，。？！,?.!\-、]+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));

  if (keywords.length === 0) return [];

  // Score sections by how many keywords appear in them
  const sections = await prisma.section.findMany({
    where: {
      OR: keywords.flatMap((kw) => [
        { contentEn: { contains: kw } },
        { contentZh: { contains: kw } },
      ]),
    },
    include: { letter: { select: { year: true } } },
    take: 50,
  });

  // Score each section
  const scored: RetrievedSection[] = sections.map((s) => {
    const text = `${s.contentEn} ${s.contentZh ?? ""}`.toLowerCase();
    const score = keywords.reduce((acc, kw) => {
      // Count occurrences for better ranking
      const matches = (text.match(new RegExp(kw, "g")) ?? []).length;
      return acc + matches;
    }, 0);

    return {
      id: s.id,
      year: s.letter.year,
      order: s.order,
      contentEn: s.contentEn,
      contentZh: s.contentZh,
      score,
    };
  });

  // Sort by score desc, then by year desc (prefer recent letters for ties)
  scored.sort((a, b) => b.score - a.score || b.year - a.year);

  return scored.slice(0, 5);
}

// ── Parse citations from response ─────────────────────────────────────────

interface Citation {
  sectionId: string;
  year: number;
  excerpt: string;
}

function parseResponse(raw: string): { reply: string; citations: Citation[] } {
  const citationMatch = raw.match(/<citations>([\s\S]*?)<\/citations>/);
  const reply = raw.replace(/<citations>[\s\S]*?<\/citations>/, "").trim();

  let citations: Citation[] = [];
  if (citationMatch) {
    try {
      citations = JSON.parse(citationMatch[1].trim());
    } catch {
      // Malformed JSON — ignore citations rather than crash
    }
  }

  return { reply, citations };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip = getClientIp(req);

  // Usage limit check
  const { allowed, remaining } = await checkAndIncrementUsage(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "今日免费次数已用完（5次/天），请明天再来或登录获取更多次数。" },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Last user message is the query for retrieval
  const lastUserMsg = [...body.messages].reverse().find(
    (m: { role: string }) => m.role === "user",
  );
  if (!lastUserMsg) {
    return NextResponse.json({ error: "No user message" }, { status: 400 });
  }

  // Retrieve relevant sections
  const sections = await retrieveRelevantSections(lastUserMsg.content);

  // Build conversation for the AI
  const systemPrompt = buildSystemPrompt(sections);

  const aiMessages = [
    { role: "system", content: systemPrompt },
    // Include prior conversation turns (skip system messages from client)
    ...body.messages
      .filter((m: { role: string }) => m.role !== "system")
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
  ];

  // Call AI
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

  const aiData = await aiRes.json();
  const rawContent: string =
    aiData.choices?.[0]?.message?.content ?? "抱歉，我暂时无法回答这个问题。";

  const { reply, citations } = parseResponse(rawContent);

  return NextResponse.json(
    { reply, citations, remaining },
    { status: 200 },
  );
}
