import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import {
  createRealtimeAsrSession,
  finishRealtimeAsrSession,
  subscribeRealtimeAsrSession,
} from "../src/lib/speech/volcengine-asr-relay";

config({ path: ".env.local" });

async function runOnce(): Promise<number> {
  const t0 = Date.now();
  const session = await createRealtimeAsrSession(randomUUID());

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("ready_timeout"));
    }, 8000);

    const unsub = subscribeRealtimeAsrSession(session.sessionId, (event) => {
      if (event.type === "ready") {
        clearTimeout(timeout);
        unsub();
        resolve();
      }
      if (event.type === "error") {
        clearTimeout(timeout);
        unsub();
        reject(new Error(event.message));
      }
    });
  });

  const latency = Date.now() - t0;
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
