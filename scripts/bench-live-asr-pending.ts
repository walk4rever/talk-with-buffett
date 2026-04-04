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
    const sample = Math.floor(Math.sin(i / 40) * 6000);
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

async function runOnce(): Promise<number> {
  const session = await createRealtimeAsrSession(randomUUID());
  const t0 = Date.now();
  // Force pending-audio path: send chunk immediately before ready/ack.
  sendRealtimeAsrChunk(session.sessionId, makeChunk(80), false);

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

async function main() {
  const values: number[] = [];
  for (let i = 0; i < 3; i++) values.push(await runOnce());
  values.sort((a, b) => a - b);
  const median = values[1];
  console.log(`runs=${values.join(",")}`);
  console.log(`METRIC asr_response_time=${median}`);
  setTimeout(() => process.exit(0), 50);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
