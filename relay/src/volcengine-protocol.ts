import { constants as zlibConstants, gzipSync, gunzipSync } from "node:zlib";

const VERSION = 0b0001;
const HEADER_SIZE = 0b0001;
const SERIALIZATION_NONE = 0b0000;
const SERIALIZATION_JSON = 0b0001;
const COMPRESSION_NONE = 0b0000;
const COMPRESSION_GZIP = 0b0001;

const MESSAGE_TYPE_FULL_CLIENT = 0b0001;
const MESSAGE_TYPE_AUDIO_ONLY = 0b0010;
const MESSAGE_TYPE_FULL_SERVER = 0b1001;
const MESSAGE_TYPE_ACK = 0b1011;
const MESSAGE_TYPE_ERROR = 0b1111;

const FAST_GZIP_OPTIONS = {
  level: zlibConstants.Z_BEST_SPEED,
} as const;

export type VolcengineAsrPayload = {
  reqid?: string;
  code?: number;
  message?: string;
  sequence?: number;
  result?: Array<{
    text?: string;
    utterances?: Array<{
      definite?: boolean;
      text?: string;
      start_time?: number;
      end_time?: number;
    }>;
  }>;
  addition?: {
    duration?: string;
    logid?: string;
  };
};

export type VolcengineAsrResponse =
  | {
      type: "response";
      isLast: boolean;
      payload: VolcengineAsrPayload;
    }
  | {
      type: "ack";
    }
  | {
      type: "error";
      errorCode: number;
      payload: string;
    };

function encodeHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
) {
  return Buffer.from([
    (VERSION << 4) | HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]);
}

export function encodeFullClientRequest(payload: Record<string, unknown>) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const compressed = gzipSync(json, FAST_GZIP_OPTIONS);
  const header = encodeHeader(MESSAGE_TYPE_FULL_CLIENT, 0b0000, SERIALIZATION_JSON, COMPRESSION_GZIP);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(compressed.length, 0);
  return Buffer.concat([header, size, compressed]);
}

export function encodeAudioOnlyRequest(audioChunk: Buffer, isLast: boolean) {
  const disableAudioGzip = process.env.VOLCENGINE_ASR_AUDIO_GZIP === "0";
  const payload = disableAudioGzip ? audioChunk : gzipSync(audioChunk, FAST_GZIP_OPTIONS);
  const header = encodeHeader(
    MESSAGE_TYPE_AUDIO_ONLY,
    isLast ? 0b0010 : 0b0000,
    SERIALIZATION_NONE,
    disableAudioGzip ? COMPRESSION_NONE : COMPRESSION_GZIP,
  );
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

export function decodeVolcengineFrame(input: Buffer): VolcengineAsrResponse {
  const first = input[0] ?? 0;
  const second = input[1] ?? 0;
  const third = input[2] ?? 0;
  const headerSize = first & 0x0f;
  const messageType = (second & 0xf0) >> 4;
  const compression = third & 0x0f;
  const offset = headerSize * 4;

  if (messageType === MESSAGE_TYPE_FULL_SERVER) {
    const flags = second & 0x0f;
    const hintedHasSeq = (flags & 0x01) !== 0;

    const getPayloadBounds = (hasSeq: boolean) => {
      const sequenceOffset = offset;
      const sizeOffset = hasSeq ? offset + 4 : offset;
      if (hasSeq && input.length < sequenceOffset + 4) return null;
      if (input.length < sizeOffset + 4) return null;
      const payloadSize = input.readUInt32BE(sizeOffset);
      const payloadStart = sizeOffset + 4;
      const payloadEnd = payloadStart + payloadSize;
      if (payloadEnd > input.length) return null;
      return { sizeOffset, payloadStart, payloadEnd };
    };

    const tryParse = (hasSeq: boolean) => {
      const bounds = getPayloadBounds(hasSeq);
      if (!bounds) throw new Error("Invalid Volcengine payload bounds");
      const sequence = hasSeq ? input.readInt32BE(offset) : 0;
      const payloadBuffer = input.subarray(bounds.payloadStart, bounds.payloadEnd);
      const raw = compression === COMPRESSION_GZIP ? gunzipSync(payloadBuffer) : payloadBuffer;
      const payload = JSON.parse(raw.toString("utf8")) as VolcengineAsrPayload;
      const isLast =
        (typeof payload.sequence === "number" && payload.sequence < 0) || (hasSeq && sequence < 0);
      return { payload, isLast };
    };

    const hintedBounds = getPayloadBounds(hintedHasSeq);
    const fallbackBounds = hintedHasSeq ? null : getPayloadBounds(true);
    const shouldTryFallbackFirst = !hintedBounds && !!fallbackBounds;

    try {
      const parsed = tryParse(shouldTryFallbackFirst ? true : hintedHasSeq);
      return { type: "response", ...parsed };
    } catch (error) {
      if (hintedHasSeq || shouldTryFallbackFirst) throw error;
      const parsed = tryParse(true);
      return { type: "response", ...parsed };
    }
  }

  if (messageType === MESSAGE_TYPE_ACK) {
    return { type: "ack" };
  }

  if (messageType === MESSAGE_TYPE_ERROR) {
    const errorCode = input.readUInt32BE(offset);
    const errorSize = input.readUInt32BE(offset + 4);
    const errorBuffer = input.subarray(offset + 8, offset + 8 + errorSize);
    const decompressed = compression === COMPRESSION_GZIP ? gunzipSync(errorBuffer) : errorBuffer;
    return {
      type: "error",
      errorCode,
      payload: decompressed.toString("utf8"),
    };
  }

  throw new Error(`Unsupported Volcengine frame type: ${messageType}`);
}
