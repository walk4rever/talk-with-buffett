import fs from "node:fs";
import path from "node:path";

interface EvalQuestion {
  id: string;
  question: string;
  type: string;
}

interface SourceItem {
  year: number;
  title: string | null;
  sourceType: string;
  chunkId?: string;
}

async function callChat(question: string, baseUrl: string): Promise<SourceItem[]> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`chat api ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let sources: SourceItem[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEvent = "";
          continue;
        }
        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7);
          continue;
        }
        if (trimmed.startsWith("data: ") && currentEvent === "sources") {
          try {
            const payload = JSON.parse(trimmed.slice(6));
            sources = (payload.sources ?? []) as SourceItem[];
          } catch {
            sources = [];
          }
        }
      }
    }
    if (done) break;
  }

  return sources;
}

async function main() {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
  const file = path.resolve("tests/evals/retrieval_v2_questions.json");
  const raw = fs.readFileSync(file, "utf-8");
  const questions = JSON.parse(raw) as EvalQuestion[];

  const out: Array<Record<string, unknown>> = [];

  for (const q of questions) {
    const t0 = Date.now();
    let sources: SourceItem[] = [];
    let error: string | null = null;

    try {
      sources = await callChat(q.question, baseUrl);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const elapsedMs = Date.now() - t0;
    const years = [...new Set(sources.map((s) => s.year))].sort((a, b) => a - b);

    out.push({
      id: q.id,
      type: q.type,
      question: q.question,
      hits: sources.length,
      years,
      first: sources[0]
        ? {
            year: sources[0].year,
            sourceType: sources[0].sourceType,
            title: sources[0].title,
            chunkId: sources[0].chunkId,
          }
        : null,
      elapsedMs,
      error,
    });

    console.log(`${q.id} hits=${sources.length} ${elapsedMs}ms${error ? ` error=${error}` : ""}`);
  }

  const outputFile = path.resolve("tests/evals/retrieval_v2_results.json");
  fs.writeFileSync(outputFile, JSON.stringify(out, null, 2));
  console.log(`\nSaved: ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
