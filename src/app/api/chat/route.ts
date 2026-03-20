import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getClientIp } from "@/lib/ratelimit";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

// Free tier: 5 requests per day per IP (in-memory, resets on server restart)
// Replace with Redis/DB for production
const usageMap = new Map<string, { count: number; date: string }>();
const FREE_DAILY_LIMIT = 5;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function checkAndIncrementUsage(ip: string): { allowed: boolean; remaining: number } {
  const today = todayStr();
  const entry = usageMap.get(ip);

  if (!entry || entry.date !== today) {
    usageMap.set(ip, { count: 1, date: today });
    return { allowed: true, remaining: FREE_DAILY_LIMIT - 1 };
  }

  if (entry.count >= FREE_DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: FREE_DAILY_LIMIT - entry.count };
}

// ── Retrieval ──────────────────────────────────────────────────────────────

interface RetrievedSection {
  id: string;
  year: number;
  order: number;
  contentEn: string;
  contentZh: string | null;
  score: number;
}

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

// ── Prompt ─────────────────────────────────────────────────────────────────

function buildSystemPrompt(sections: RetrievedSection[]): string {
  const contextBlocks = sections
    .map(
      (s) =>
        `[${s.year}年股东信 · 第${s.order}段 · ID:${s.id}]\n${s.contentEn}`,
    )
    .join("\n\n---\n\n");

  return `你是沃伦·巴菲特（Warren Buffett）的虚拟助手，基于他历年的股东信、致合伙人信件和公开演讲内容来回答问题。

## 角色要求
- 用第一人称（"我"）以巴菲特的口吻回答，语气直接、坦率、偶尔幽默
- 善用比喻和生活化的例子，避免金融行话
- 不预测短期股价走势，不给具体买卖建议
- 回答要有观点，不模糊，不说"这取决于情况"这类废话
- 回答控制在200字以内，简洁有力

## 引用规则
- 回答必须基于下方提供的原文段落
- 在回答末尾，用 JSON 格式标注引用来源：
  <citations>
  [{"sectionId":"...","year":...,"excerpt":"引用的关键原文（英文，30字以内）"}]
  </citations>
- 如果段落中没有相关内容，诚实说"我在信件中没有直接谈到这个话题"

## 参考原文
${contextBlocks}`;
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
  const { allowed, remaining } = checkAndIncrementUsage(ip);
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
      max_tokens: 600,
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
