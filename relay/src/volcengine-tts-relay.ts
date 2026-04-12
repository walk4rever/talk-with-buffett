import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

let wsCtorPromise: Promise<
  new (url: string, options?: { headers?: Record<string, string> }) => import("ws").WebSocket
> | null = null;

async function getWebSocketCtor() {
  if (!wsCtorPromise) {
    process.env.WS_NO_BUFFER_UTIL = "1";
    process.env.WS_NO_UTF_8_VALIDATE = "1";
    wsCtorPromise = import("ws").then(
      (mod) => mod.default as unknown as new (url: string, options?: { headers?: Record<string, string> }) => import("ws").WebSocket,
    );
  }
  return wsCtorPromise;
}

// ---------------------------------------------------------------------------
// Volcengine TTS binary protocol (v1 ws_binary)
// ---------------------------------------------------------------------------

const TTS_HEADER = Buffer.from([0x11, 0x10, 0x11, 0x00]);

function buildTtsFrame(payload: Record<string, unknown>): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(payload), "utf-8");
  const compressed = gzipSync(jsonBuf);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(compressed.length, 0);
  return Buffer.concat([TTS_HEADER, sizeBuf, compressed]);
}

function parseTtsFrame(data: Buffer): {
  done: boolean;
  audio: Buffer | null;
  error: string | null;
} {
  const headerSize = (data[0] & 0x0f) * 4;
  const messageType = (data[1] >> 4) & 0x0f;
  const payload = data.subarray(headerSize);

  // 0xb = audio-only server response
  if (messageType === 0x0b) {
    if (payload.length < 8) {
      return { done: false, audio: null, error: null };
    }
    const sequenceNumber = payload.readInt32BE(0);
    const payloadSize = payload.readUInt32BE(4);
    const audio = payload.subarray(8, 8 + payloadSize);
    return { done: sequenceNumber < 0, audio, error: null };
  }

  // 0xf = error
  if (messageType === 0x0f) {
    const code = payload.readUInt32BE(0);
    let msg = `TTS error code ${code}`;
    try {
      const errPayloadSize = payload.readUInt32BE(4);
      msg = gunzipSync(payload.subarray(8, 8 + errPayloadSize)).toString("utf-8");
    } catch {
      // keep generic message
    }
    return { done: true, audio: null, error: msg };
  }

  // 0xc = frontend info (ignore)
  return { done: false, audio: null, error: null };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type TtsConfig = {
  wsUrl: string;
  appId: string;
  accessToken: string;
  cluster: string;
  voiceType: string;
};

let cachedConfig: TtsConfig | null = null;

function getConfig(): TtsConfig {
  if (!cachedConfig) {
    const appId = process.env.VOLCANO_TTS_APPID?.trim();
    const accessToken = process.env.VOLCANO_TTS_ACCESS_TOKEN?.trim();
    if (!appId || !accessToken) {
      throw new Error("Missing VOLCANO_TTS_APPID or VOLCANO_TTS_ACCESS_TOKEN");
    }
    cachedConfig = {
      wsUrl: process.env.VOLCANO_TTS_WS_URL?.trim() || "wss://openspeech.bytedance.com/api/v1/tts/ws_binary",
      appId,
      accessToken,
      cluster: process.env.VOLCANO_TTS_CLUSTER?.trim() || "volcano_tts",
      voiceType: process.env.VOLCANO_TTS_VOICE_TYPE?.trim() || "zh_male_m191_uranus_bigtts",
    };
  }
  return cachedConfig;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function synthesize(text: string): Promise<Buffer> {
  const config = getConfig();

  const requestPayload = {
    app: { appid: config.appId, token: config.accessToken, cluster: config.cluster },
    user: { uid: "talk-with-buffett" },
    audio: {
      voice_type: config.voiceType,
      encoding: "mp3",
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 0.95,
    },
    request: {
      reqid: randomUUID(),
      text,
      text_type: "plain",
      operation: "submit",
    },
  };

  const frame = buildTtsFrame(requestPayload);
  const WebSocketCtor = await getWebSocketCtor();

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ws = new WebSocketCtor(config.wsUrl, {
      headers: { Authorization: `Bearer;${config.accessToken}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("TTS WebSocket timeout"));
    }, 15_000);

    ws.on("open", () => {
      ws.send(frame);
    });

    ws.on("message", (raw: Buffer) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      const { done, audio, error } = parseTtsFrame(buf);
      if (error) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(error));
        return;
      }
      if (audio && audio.length > 0) {
        chunks.push(audio);
      }
      if (done) {
        clearTimeout(timeout);
        ws.close();
        resolve(Buffer.concat(chunks));
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error("TTS WS closed without audio"));
      }
    });
  });
}
