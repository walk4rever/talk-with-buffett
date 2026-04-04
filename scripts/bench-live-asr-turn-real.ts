import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createRealtimeAsrSession,
  finishRealtimeAsrSession,
  sendRealtimeAsrChunk,
  subscribeRealtimeAsrSession,
} from "../src/lib/speech/volcengine-asr-relay";

config({ path: ".env.local" });

const FIXTURE_DIR = join(process.cwd(), "data", "fixtures");
const FIXTURE_WAV = join(FIXTURE_DIR, "asr-zh-fixture.wav");
const FIXTURE_AIFF = join(FIXTURE_DIR, "asr-zh-fixture.aiff");

function ensureFixture() {
  if (existsSync(FIXTURE_WAV)) return;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const text = "你好 巴菲特 今天我想请教你关于长期投资和企业护城河的问题";
  execSync(`say -v Tingting -o "${FIXTURE_AIFF}" "${text}"`);
  execSync(`afconvert -f WAVE -d LEI16@16000 -c 1 "${FIXTURE_AIFF}" "${FIXTURE_WAV}"`);
}

function wavToPcm16Mono(wav: Buffer) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected WAV");
  }

  let offset = 12;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      channels = wav.readUInt16LE(chunkDataOffset + 2);
      bitsPerSample = wav.readUInt16LE(chunkDataOffset + 14);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) throw new Error("WAV data not found");
  if (bitsPerSample !== 16) throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);

  const data = wav.subarray(dataOffset, dataOffset + dataSize);
  if (channels === 1) return data;

  const samples = data.length / 2 / channels;
  const mono = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      sum += data.readInt16LE((i * channels + ch) * 2);
    }
    mono.writeInt16LE(Math.round(sum / channels), i * 2);
  }
  return mono;
}

function slicePcmChunks(pcm: Buffer, chunkMs: number) {
  const bytesPerMs = (16000 * 2) / 1000;
  const chunkBytes = Math.max(2, Math.floor(bytesPerMs * chunkMs));
  const chunks: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += chunkBytes) {
    chunks.push(pcm.subarray(i, Math.min(i + chunkBytes, pcm.length)));
  }
  return chunks;
}

async function runTurn(chunks: Buffer[]): Promise<number> {
  const session = await createRealtimeAsrSession(randomUUID());
  const t0 = Date.now();

  const done = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("turn_timeout"));
    }, 15000);

    const unsub = subscribeRealtimeAsrSession(session.sessionId, (event) => {
      if (event.type === "error") {
        clearTimeout(timeout);
        unsub();
        reject(new Error(event.message));
      }
      if (event.type === "closed") {
        clearTimeout(timeout);
        unsub();
        resolve(Date.now() - t0);
      }
    });
  });

  for (const chunk of chunks) {
    sendRealtimeAsrChunk(session.sessionId, chunk, false);
  }
  finishRealtimeAsrSession(session.sessionId);

  return done;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function scenario(chunks: Buffer[], runs: number) {
  const vals: number[] = [];
  for (let i = 0; i < runs; i++) vals.push(await runTurn(chunks));
  return { vals, med: median(vals) };
}

async function main() {
  ensureFixture();
  const wav = readFileSync(FIXTURE_WAV);
  const pcm = wavToPcm16Mono(wav);
  const allChunks = slicePcmChunks(pcm, 120);

  const shortChunks = allChunks.slice(0, 3);
  const fullChunks = allChunks;

  const runs = 5;
  const short = await scenario(shortChunks, runs);
  const full = await scenario(fullChunks, runs);
  const metric = Math.round((short.med + full.med) / 2);

  console.log(`short_turn_runs=${short.vals.join(",")}`);
  console.log(`full_turn_runs=${full.vals.join(",")}`);
  console.log(`short_turn_median=${short.med}`);
  console.log(`full_turn_median=${full.med}`);
  console.log(`METRIC asr_response_time=${metric}`);
  setTimeout(() => process.exit(0), 50);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
