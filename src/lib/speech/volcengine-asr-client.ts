import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  decodeVolcengineFrame,
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
} from "./volcengine-protocol";

type TranscribeInput = {
  audioBuffer: Buffer;
  uid?: string;
  language?: string;
  chunkMs?: number;
};

type TranscribeOutput = {
  text: string;
  rawResponses: unknown[];
  logId: string | null;
  reqId: string;
  connectId: string;
};

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_BITS = 16;
const DEFAULT_CHANNELS = 1;
const DEFAULT_CHUNK_MS = 200;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value.trim();
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function pcmBytesPerMs(sampleRate: number, bits: number, channels: number) {
  return (sampleRate * (bits / 8) * channels) / 1000;
}

function wavToPcm16Mono(wav: Buffer) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected WAV file");
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

  if (dataOffset < 0) throw new Error("WAV data chunk not found");
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

function buildInitPayload(uid: string, reqId: string, language?: string) {
  return {
    app: {
      appid: requiredEnv("VOLCENGINE_ASR_APP_ID"),
      token: requiredEnv("VOLCENGINE_ASR_ACCESS_TOKEN"),
      cluster: requiredEnv("VOLCENGINE_ASR_CLUSTER"),
    },
    user: { uid },
    audio: {
      format: "raw",
      codec: "raw",
      rate: DEFAULT_SAMPLE_RATE,
      bits: DEFAULT_BITS,
      channel: DEFAULT_CHANNELS,
      ...(language ? { language } : {}),
    },
    request: {
      reqid: reqId,
      sequence: 1,
      nbest: 1,
      workflow: "audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate",
      show_utterances: true,
      result_type: "single",
      vad_signal: true,
      start_silence_time: process.env.VOLCENGINE_ASR_START_SILENCE_TIME?.trim() || "10000",
      vad_silence_time: process.env.VOLCENGINE_ASR_VAD_SILENCE_TIME?.trim() || "2000",
      ...(optionalEnv("VOLCENGINE_ASR_RESOURCE_ID") ? { resource_id: optionalEnv("VOLCENGINE_ASR_RESOURCE_ID") } : {}),
    },
  };
}

export async function transcribeWavWithVolcengine(input: TranscribeInput): Promise<TranscribeOutput> {
  const url = process.env.VOLCENGINE_ASR_WS_URL || "wss://openspeech.bytedance.com/api/v2/asr";
  if (url.includes("/api/v3/")) {
    throw new Error(
      `VOLCENGINE_ASR_WS_URL points to a v3 endpoint (${url}). This project currently uses the v2 streaming ASR protocol. Use wss://openspeech.bytedance.com/api/v2/asr instead.`,
    );
  }
  const reqId = randomUUID();
  const uid = input.uid ?? reqId;
  const chunkMs = input.chunkMs ?? DEFAULT_CHUNK_MS;

  const pcm = wavToPcm16Mono(input.audioBuffer);
  const bytesPerChunk = Math.max(
    1,
    Math.floor(pcmBytesPerMs(DEFAULT_SAMPLE_RATE, DEFAULT_BITS, DEFAULT_CHANNELS) * chunkMs),
  );

  return await new Promise<TranscribeOutput>((resolve, reject) => {
    const resourceId = optionalEnv("VOLCENGINE_ASR_RESOURCE_ID");
    const accessToken = requiredEnv("VOLCENGINE_ASR_ACCESS_TOKEN");
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer; ${accessToken}`,
        "X-Api-App-Key": requiredEnv("VOLCENGINE_ASR_APP_ID"),
        "X-Api-Connect-Id": reqId,
        ...(resourceId ? { "X-Api-Resource-Id": resourceId } : {}),
      },
    });
    const rawResponses: unknown[] = [];
    let finalText = "";
    let logId: string | null = null;
    let sentAudio = false;
    let sendAudioFallback: NodeJS.Timeout | null = null;

    ws.on("open", () => {
      ws.send(encodeFullClientRequest(buildInitPayload(uid, reqId, input.language)));
      sendAudioFallback = setTimeout(() => {
        if (sentAudio) return;
        sentAudio = true;
        let offset = 0;
        while (offset < pcm.length) {
          const end = Math.min(offset + bytesPerChunk, pcm.length);
          const chunk = pcm.subarray(offset, end);
          const isLast = end >= pcm.length;
          ws.send(encodeAudioOnlyRequest(chunk, isLast));
          offset = end;
        }
      }, 120);
    });

    ws.on("message", (data) => {
      const frame = decodeVolcengineFrame(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));

      if (frame.type === "ack") {
        if (!sentAudio) {
          if (sendAudioFallback) clearTimeout(sendAudioFallback);
          sentAudio = true;
          let offset = 0;
          while (offset < pcm.length) {
            const end = Math.min(offset + bytesPerChunk, pcm.length);
            const chunk = pcm.subarray(offset, end);
            const isLast = end >= pcm.length;
            ws.send(encodeAudioOnlyRequest(chunk, isLast));
            offset = end;
          }
        }
        return;
      }
      if (frame.type === "error") {
        if (sendAudioFallback) clearTimeout(sendAudioFallback);
        ws.close();
        reject(new Error(`Volcengine ASR error ${frame.errorCode}: ${frame.payload}`));
        return;
      }

      rawResponses.push(frame.payload);
      logId = frame.payload.addition?.logid ?? logId;
      if (typeof frame.payload.code === "number" && frame.payload.code !== 1000) {
        if (sendAudioFallback) clearTimeout(sendAudioFallback);
        ws.close();
        reject(new Error(`Volcengine ASR code ${frame.payload.code}: ${frame.payload.message ?? "Unknown"}`));
        return;
      }
      const text = frame.payload.result?.[0]?.text?.trim();
      if (text) {
        finalText = text;
      }

      if (frame.isLast) {
        if (sendAudioFallback) clearTimeout(sendAudioFallback);
        ws.close(1000, "final response received");
        resolve({
          text: finalText,
          rawResponses,
          logId,
          reqId,
          connectId: reqId,
        });
      }
    });

    ws.on("error", (error) => {
      reject(error);
    });

    ws.on("close", () => {
      if (!finalText && rawResponses.length === 0) {
        reject(new Error("Volcengine ASR connection closed before any response"));
      }
    });
  });
}
