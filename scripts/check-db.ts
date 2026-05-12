/**
 * check-db.ts
 *
 * Lightweight DB connectivity probe for Prisma.
 *
 * Usage:
 *   npm run check:db
 *   npm run check:db -- --times 10 --interval-ms 800 --timeout-ms 4000
 */
import { PrismaClient } from "@prisma/client";

type Options = {
  times: number;
  intervalMs: number;
  timeoutMs: number;
};

const db = new PrismaClient();

function parseArgs(args: string[]): Options {
  const timesArg = args.find((_, i) => args[i - 1] === "--times");
  const intervalArg = args.find((_, i) => args[i - 1] === "--interval-ms");
  const timeoutArg = args.find((_, i) => args[i - 1] === "--timeout-ms");

  const times = timesArg ? parseInt(timesArg, 10) : 5;
  const intervalMs = intervalArg ? parseInt(intervalArg, 10) : 1000;
  const timeoutMs = timeoutArg ? parseInt(timeoutArg, 10) : 5000;

  if (!Number.isFinite(times) || times <= 0) {
    throw new Error("Invalid --times, expected positive integer.");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error("Invalid --interval-ms, expected non-negative integer.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Invalid --timeout-ms, expected positive integer.");
  }

  return { times, intervalMs, timeoutMs };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function safeDbHost() {
  const url = process.env.DATABASE_URL;
  if (!url) return "DATABASE_URL not set";
  try {
    const host = new URL(url).host;
    return host;
  } catch {
    return "DATABASE_URL parse failed";
  }
}

async function probeOnce(timeoutMs: number) {
  const start = Date.now();
  await withTimeout(db.$queryRaw`SELECT 1`, timeoutMs);
  return Date.now() - start;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`[check-db] target=${safeDbHost()} times=${opts.times} intervalMs=${opts.intervalMs} timeoutMs=${opts.timeoutMs}`);

  const latencies: number[] = [];
  const errors: string[] = [];

  for (let i = 1; i <= opts.times; i++) {
    try {
      const latency = await probeOnce(opts.timeoutMs);
      latencies.push(latency);
      console.log(`[check-db] #${i} OK ${latency}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      console.log(`[check-db] #${i} FAIL ${msg}`);
    }

    if (i < opts.times && opts.intervalMs > 0) {
      await sleep(opts.intervalMs);
    }
  }

  const success = latencies.length;
  const fail = errors.length;
  const successRate = ((success / opts.times) * 100).toFixed(1);
  const min = latencies.length ? Math.min(...latencies) : 0;
  const max = latencies.length ? Math.max(...latencies) : 0;
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;

  console.log("\n[check-db] summary");
  console.log(`[check-db] success=${success} fail=${fail} successRate=${successRate}%`);
  console.log(`[check-db] latencyMs min=${min} avg=${avg} max=${max}`);

  if (fail > 0) {
    const counts = new Map<string, number>();
    for (const msg of errors) {
      counts.set(msg, (counts.get(msg) ?? 0) + 1);
    }
    console.log("[check-db] errorBreakdown");
    for (const [msg, count] of counts.entries()) {
      console.log(`[check-db] ${count}x ${msg}`);
    }
  }

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[check-db] fatal ${msg}`);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
