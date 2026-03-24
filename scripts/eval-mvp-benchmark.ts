import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

interface EvalQuestion {
  id: string;
  question: string;
  type: "fact" | "method" | "chat";
}

interface SourceItem {
  year: number;
  title: string | null;
  sourceType: string;
  chunkId?: string;
}

interface EvalRow {
  id: string;
  type: EvalQuestion["type"];
  question: string;
  hits: number;
  years: number[];
  first: SourceItem | null;
  elapsedMs: number;
  error: string | null;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
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

function summarize(rows: EvalRow[]) {
  const byType: Record<EvalQuestion["type"], EvalRow[]> = {
    fact: rows.filter((r) => r.type === "fact"),
    method: rows.filter((r) => r.type === "method"),
    chat: rows.filter((r) => r.type === "chat"),
  };

  const typeSummary = Object.fromEntries(
    (Object.keys(byType) as EvalQuestion["type"][]).map((type) => {
      const arr = byType[type];
      const success = arr.filter((r) => !r.error).length;
      const hits = arr.map((r) => r.hits);
      const latency = arr.map((r) => r.elapsedMs);
      return [
        type,
        {
          total: arr.length,
          success,
          successRate: Number((success / Math.max(1, arr.length)).toFixed(4)),
          avgHits: Number(avg(hits).toFixed(4)),
          avgLatencyMs: Number(avg(latency).toFixed(2)),
          zeroHitCount: arr.filter((r) => r.hits === 0).length,
        },
      ];
    }),
  );

  const weightedAvgHits =
    typeSummary.fact.avgHits * 0.6 +
    typeSummary.method.avgHits * 0.3 +
    typeSummary.chat.avgHits * 0.1;

  return {
    total: rows.length,
    success: rows.filter((r) => !r.error).length,
    successRate: Number((rows.filter((r) => !r.error).length / Math.max(1, rows.length)).toFixed(4)),
    avgHitsAll: Number(avg(rows.map((r) => r.hits)).toFixed(4)),
    avgLatencyMsAll: Number(avg(rows.map((r) => r.elapsedMs)).toFixed(2)),
    weightedAvgHits: Number(weightedAvgHits.toFixed(4)),
    byType: typeSummary,
  };
}

async function main() {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://127.0.0.1:3000";
  const questionFile = path.resolve("tests/evals/mvp_benchmark_30_questions.json");
  const outputFile = path.resolve("tests/evals/mvp_benchmark_30_results.json");
  const summaryFile = path.resolve("tests/evals/mvp_benchmark_30_summary.json");

  const questions = JSON.parse(fs.readFileSync(questionFile, "utf-8")) as EvalQuestion[];
  const rows: EvalRow[] = [];

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

    rows.push({
      id: q.id,
      type: q.type,
      question: q.question,
      hits: sources.length,
      years,
      first: sources[0] ?? null,
      elapsedMs,
      error,
    });

    console.log(`${q.id} [${q.type}] hits=${sources.length} ${elapsedMs}ms${error ? ` error=${error}` : ""}`);
  }

  const summary = summarize(rows);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:]/g, "-");
  const historyDir = path.resolve("tests/evals/history");
  fs.mkdirSync(historyDir, { recursive: true });

  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // ignore
  }

  const meta = {
    generatedAt: now.toISOString(),
    baseUrl,
    questionFile,
    gitSha,
  };

  fs.writeFileSync(outputFile, JSON.stringify({ meta, rows }, null, 2));
  fs.writeFileSync(summaryFile, JSON.stringify({ meta, summary }, null, 2));
  fs.writeFileSync(path.join(historyDir, `mvp_benchmark_30_results_${stamp}.json`), JSON.stringify({ meta, rows }, null, 2));
  fs.writeFileSync(path.join(historyDir, `mvp_benchmark_30_summary_${stamp}.json`), JSON.stringify({ meta, summary }, null, 2));

  console.log(`\nSaved results: ${outputFile}`);
  console.log(`Saved summary: ${summaryFile}`);
  console.log(`Weighted avg hits: ${summary.weightedAvgHits}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
