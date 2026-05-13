import { PrismaClient } from "@prisma/client";

type TranslateInput = {
  englishName: string;
  ticker?: string | null;
};

const translationCache = new Map<string, string>();

function cacheKey(input: TranslateInput) {
  return `${input.englishName.trim().toUpperCase()}::${(input.ticker ?? "").trim().toUpperCase()}`;
}

function cleanZhName(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
}

export async function translateCompanyNameToZh(input: TranslateInput): Promise<string> {
  const key = cacheKey(input);
  const hit = translationCache.get(key);
  if (hit) return hit;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for zh translation.");
  }

  const model = process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-4.1-mini";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tickerHint = input.ticker ? `Ticker: ${input.ticker}` : "Ticker: (unknown)";
  const userPrompt =
    `Translate this public company or fund issuer name into a concise Chinese display name.\n` +
    `${tickerHint}\n` +
    `English name: ${input.englishName}\n\n` +
    "Rules:\n" +
    "1) Return only Chinese name text.\n" +
    "2) No explanation, no punctuation wrapper.\n" +
    "3) Prefer established financial Chinese naming.\n" +
    "4) Keep it short for UI display.\n";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You are a financial terminology translator.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Translation API failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const cleaned = cleanZhName(content);
  if (!cleaned) {
    throw new Error(`Translation API returned empty zh name for: ${input.englishName}`);
  }

  translationCache.set(key, cleaned);
  return cleaned;
}

export async function upsertNameMapEntries(params: {
  db: PrismaClient;
  issuerKey: string;
  ticker?: string | null;
  nameZh: string;
  nameEnShort: string;
  source: string;
}) {
  const { db, issuerKey, ticker, nameZh, nameEnShort, source } = params;

  if (ticker) {
    const tickerKey = ticker.toUpperCase();
    const existingTicker = await db.companyNameMap.findUnique({
      where: { keyType_key: { keyType: "ticker", key: tickerKey } },
      select: { source: true, nameZh: true },
    });
    if (!(existingTicker?.source === "manual" && existingTicker.nameZh)) {
      await db.companyNameMap.upsert({
        where: { keyType_key: { keyType: "ticker", key: tickerKey } },
        create: {
          keyType: "ticker",
          key: tickerKey,
          ticker: tickerKey,
          nameZh,
          nameEnShort,
          source,
        },
        update: {
          nameZh,
          nameEnShort,
          ticker: tickerKey,
          source,
        },
      });
    }
  }

  const existingIssuer = await db.companyNameMap.findUnique({
    where: { keyType_key: { keyType: "issuer", key: issuerKey } },
    select: { source: true, nameZh: true },
  });
  if (!(existingIssuer?.source === "manual" && existingIssuer.nameZh)) {
    await db.companyNameMap.upsert({
      where: { keyType_key: { keyType: "issuer", key: issuerKey } },
      create: {
        keyType: "issuer",
        key: issuerKey,
        ticker: ticker?.toUpperCase() ?? null,
        nameZh,
        nameEnShort,
        source,
      },
      update: {
        nameZh,
        nameEnShort,
        ticker: ticker?.toUpperCase() ?? null,
        source,
      },
    });
  }
}
