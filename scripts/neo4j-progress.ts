/**
 * Neo4j extraction progress — shows per-letter extraction status
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/ts-node --esm scripts/neo4j-progress.ts
 *   node --env-file=.env.local ./node_modules/.bin/ts-node --esm scripts/neo4j-progress.ts --type partnership
 */

import neo4j from "neo4j-driver";
import { PrismaClient } from "@prisma/client";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let sourceType = "shareholder";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1]) sourceType = args[++i] ?? sourceType;
  }
  return { sourceType };
}

function bar(done: number, total: number, width = 20): string {
  const pct = total === 0 ? 0 : done / total;
  const filled = Math.round(pct * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function status(done: number, total: number): string {
  if (done === 0) return "⬜ 未开始";
  if (done >= total) return "✅ 完成";
  return "🔄 进行中";
}

async function main() {
  const { sourceType } = parseArgs();

  const prisma = process.env.DIRECT_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
    : new PrismaClient();

  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );
  const session = driver.session();

  try {
    // Get all sources from Postgres
    const sources = await prisma.source.findMany({
      where: { type: sourceType },
      include: { _count: { select: { chunks: true } } },
      orderBy: { year: "asc" },
    });

    // Get processed paragraph count from Neo4j per sourceId
    const neo4jResult = await session.run(`
      MATCH (d:Document)-[:CONTAINS]->(p:Paragraph)
      WHERE (p)-[:MENTIONS_CONCEPT|MENTIONS_COMPANY]->()
      RETURN d.sourceId AS sourceId, count(p) AS processed
    `);

    const processedMap = new Map<string, number>();
    for (const record of neo4jResult.records) {
      processedMap.set(record.get("sourceId") as string, record.get("processed") as number);
    }

    // Summary stats from Neo4j
    const nodeResult = await session.run(`
      MATCH (n) RETURN labels(n)[0] AS label, count(n) AS cnt
    `);
    const nodeCounts: Record<string, number> = {};
    for (const r of nodeResult.records) {
      nodeCounts[r.get("label")] = r.get("cnt");
    }

    // Print progress table
    console.log(`\n📊 Neo4j 提取进度 — ${sourceType}\n`);
    console.log("年份  总 chunks  已提取  进度                   状态");
    console.log("────  ────────  ──────  ─────────────────────  ──────────");

    let totalChunks = 0;
    let totalProcessed = 0;

    for (const source of sources) {
      const total = source._count.chunks;
      const done = processedMap.get(source.id) ?? 0;
      totalChunks += total;
      totalProcessed += done;

      console.log(
        `${source.year}  ${String(total).padStart(8)}  ${String(done).padStart(6)}  ${bar(done, total)}  ${status(done, total)}`,
      );
    }

    console.log("────  ────────  ──────  ─────────────────────  ──────────");
    console.log(
      `合计  ${String(totalChunks).padStart(8)}  ${String(totalProcessed).padStart(6)}  ${bar(totalProcessed, totalChunks)}  ${Math.round(totalProcessed / totalChunks * 100)}%`,
    );

    console.log("\n📦 Neo4j 知识图谱节点数");
    const labels = ["Investor", "Document", "Paragraph", "Concept", "Company", "Person"];
    for (const label of labels) {
      const cnt = nodeCounts[label] ?? 0;
      console.log(`  ${label.padEnd(12)} ${cnt}`);
    }

    // Suggest next run
    const remaining = sources.filter((s) => {
      const done = processedMap.get(s.id) ?? 0;
      return done < s._count.chunks;
    });

    if (remaining.length > 0) {
      const firstYear = remaining[0]?.year;
      const lastYear = remaining[remaining.length - 1]?.year;
      console.log(`\n💡 下一步: npm run neo4j:extract -- --from ${firstYear} --to ${lastYear}`);
    } else {
      console.log(`\n✅ 全部完成`);
    }
  } finally {
    await session.close();
    await driver.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
