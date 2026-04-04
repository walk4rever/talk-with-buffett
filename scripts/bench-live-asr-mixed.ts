import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import {
  createRealtimeAsrSession,
  finishRealtimeAsrSession,
  sendRealtimeAsrChunk,
  subscribeRealtimeAsrSession,
} from "../src/lib/speech/volcengine-asr-relay";

config({ path: ".env.local" });

function makeChunk(ms: number, sampleRate = 16000) {
  const samples = Math.floor((ms / 1000) * sampleRate);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const sample = Math.floor(Math.sin(i / 37) * 6200);
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

async function runWorkload(chunks: number): Promise<number> {
  const session = await createRealtimeAsrSession(randomUUID());
  const t0 = Date.now();
  for (let i = 0; i < chunks; i++) {
    sendRealtimeAsrChunk(session.sessionId, makeChunk(80), false);
  }

  const latency = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("ready_timeout"));
    }, 8000);

    const unsub = subscribeRealtimeAsrSession(session.sessionId, (event) => {
      if (event.type === "ready") {
        clearTimeout(timeout);
        unsub();
        resolve(Date.now() - t0);
      }
      if (event.type === "error") {
        clearTimeout(timeout);
        unsub();
        reject(new Error(event.message));
      }
    });
  });

  finishRealtimeAsrSession(session.sessionId);
  return latency;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function runScenario(chunks: number, runs: number) {
  const values: number[] = [];
  for (let i = 0; i < runs; i++) values.push(await runWorkload(chunks));
  return { values, median: median(values) };
}

async function main() {
  const runs = 3;
  const single = await runScenario(1, runs);
  const multi = await runScenario(3, runs);

  // mixed metric: mean of medians to avoid overfitting to one workload
  const mixed = Math.round((single.median + multi.median) / 2);

  console.log(`single_runs=${single.values.join(",")}`);
  console.log(`multi_runs=${multi.values.join(",")}`);
  console.log(`single_median=${single.median}`);
  console.log(`multi_median=${multi.median}`);
  console.log(`METRIC asr_response_time=${mixed}`);
  setTimeout(() => process.exit(0), 50);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
