import fs from "node:fs";
import path from "node:path";

interface TypeMetrics {
  total: number;
  success: number;
  successRate: number;
  avgHits: number;
  avgLatencyMs: number;
  zeroHitCount: number;
}

interface Summary {
  total: number;
  success: number;
  successRate: number;
  avgHitsAll: number;
  avgLatencyMsAll: number;
  weightedAvgHits: number;
  byType: {
    fact: TypeMetrics;
    method: TypeMetrics;
    chat: TypeMetrics;
  };
}

interface SummaryFile {
  meta: Record<string, unknown>;
  summary: Summary;
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function loadSummary(filePath: string): SummaryFile {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf-8")) as SummaryFile;
}

function delta(current: number, base: number): number {
  return Number((current - base).toFixed(4));
}

function pct(current: number, base: number): number {
  if (base === 0) return current === 0 ? 0 : 999;
  return Number((((current - base) / base) * 100).toFixed(2));
}

function compareType(current: TypeMetrics, base: TypeMetrics) {
  return {
    avgHits: {
      base: base.avgHits,
      current: current.avgHits,
      delta: delta(current.avgHits, base.avgHits),
      pct: pct(current.avgHits, base.avgHits),
    },
    avgLatencyMs: {
      base: base.avgLatencyMs,
      current: current.avgLatencyMs,
      delta: delta(current.avgLatencyMs, base.avgLatencyMs),
      pct: pct(current.avgLatencyMs, base.avgLatencyMs),
    },
    zeroHitCount: {
      base: base.zeroHitCount,
      current: current.zeroHitCount,
      delta: current.zeroHitCount - base.zeroHitCount,
    },
    successRate: {
      base: base.successRate,
      current: current.successRate,
      delta: delta(current.successRate, base.successRate),
    },
  };
}

function main() {
  const basePath = arg("--base");
  const candidatePath = arg("--candidate") ?? "tests/evals/mvp_benchmark_30_summary.json";
  const outPath = arg("--out") ?? "tests/evals/mvp_benchmark_30_compare.json";

  if (!basePath) {
    console.error("Usage: npm run eval:mvp:compare -- --base <baseline_summary.json> [--candidate <candidate_summary.json>] [--out <output.json>]");
    process.exit(1);
  }

  const base = loadSummary(basePath);
  const current = loadSummary(candidatePath);

  const comparison = {
    base: { path: path.resolve(basePath), meta: base.meta },
    candidate: { path: path.resolve(candidatePath), meta: current.meta },
    overall: {
      weightedAvgHits: {
        base: base.summary.weightedAvgHits,
        current: current.summary.weightedAvgHits,
        delta: delta(current.summary.weightedAvgHits, base.summary.weightedAvgHits),
        pct: pct(current.summary.weightedAvgHits, base.summary.weightedAvgHits),
      },
      avgHitsAll: {
        base: base.summary.avgHitsAll,
        current: current.summary.avgHitsAll,
        delta: delta(current.summary.avgHitsAll, base.summary.avgHitsAll),
        pct: pct(current.summary.avgHitsAll, base.summary.avgHitsAll),
      },
      avgLatencyMsAll: {
        base: base.summary.avgLatencyMsAll,
        current: current.summary.avgLatencyMsAll,
        delta: delta(current.summary.avgLatencyMsAll, base.summary.avgLatencyMsAll),
        pct: pct(current.summary.avgLatencyMsAll, base.summary.avgLatencyMsAll),
      },
      successRate: {
        base: base.summary.successRate,
        current: current.summary.successRate,
        delta: delta(current.summary.successRate, base.summary.successRate),
      },
    },
    byType: {
      fact: compareType(current.summary.byType.fact, base.summary.byType.fact),
      method: compareType(current.summary.byType.method, base.summary.byType.method),
      chat: compareType(current.summary.byType.chat, base.summary.byType.chat),
    },
    gates: {
      fact_non_regress: current.summary.byType.fact.avgHits >= base.summary.byType.fact.avgHits,
      latency_within_20pct: current.summary.avgLatencyMsAll <= base.summary.avgLatencyMsAll * 1.2,
      manual_no_fabrication_check_required: true,
    },
  };

  const decision = {
    autoPass: comparison.gates.fact_non_regress && comparison.gates.latency_within_20pct,
    note: "manual_no_fabrication_check_required must be reviewed by human",
  };

  const output = {
    generatedAt: new Date().toISOString(),
    comparison,
    decision,
  };

  fs.writeFileSync(path.resolve(outPath), JSON.stringify(output, null, 2));

  console.log("Saved comparison:", path.resolve(outPath));
  console.log("Auto pass:", decision.autoPass);
  console.log("Weighted avg hits delta:", comparison.overall.weightedAvgHits.delta);
  console.log("Fact avg hits delta:", comparison.byType.fact.avgHits.delta);
  console.log("Latency pct:", comparison.overall.avgLatencyMsAll.pct, "%");
}

main();
