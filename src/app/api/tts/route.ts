import { NextRequest, NextResponse } from "next/server";
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Volcengine TTS binary protocol helpers (used in local/dev mode only)
// ---------------------------------------------------------------------------

function buildFrame(payload: Record<string, unknown>): Buffer {
  const header = Buffer.from([0x11, 0x10, 0x11, 0x00]);
  const jsonBuf = Buffer.from(JSON.stringify(payload), "utf-8");
  const compressed = gzipSync(jsonBuf);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(compressed.length, 0);
  return Buffer.concat([header, sizeBuf, compressed]);
}

function parseFrame(data: Buffer): {
  done: boolean;
  audio: Buffer | null;
  error: string | null;
} {
  const headerSize = (data[0] & 0x0f) * 4;
  const messageType = (data[1] >> 4) & 0x0f;
  const payload = data.subarray(headerSize);

  if (messageType === 0x0b) {
    if (payload.length < 8) return { done: false, audio: null, error: null };
    const seq = payload.readInt32BE(0);
    const size = payload.readUInt32BE(4);
    return { done: seq < 0, audio: payload.subarray(8, 8 + size), error: null };
  }

  if (messageType === 0x0f) {
    const code = payload.readUInt32BE(0);
    let msg = `TTS error code ${code}`;
    try {
      const errSize = payload.readUInt32BE(4);
      msg = gunzipSync(payload.subarray(8, 8 + errSize)).toString("utf-8");
    } catch { /* keep generic */ }
    return { done: true, audio: null, error: msg };
  }

  return { done: false, audio: null, error: null };
}

// ---------------------------------------------------------------------------
// Relay proxy mode
// ---------------------------------------------------------------------------

async function proxyToRelay(relayUrl: string, text: string): Promise<NextResponse> {
  const upstream = await fetch(`${relayUrl}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!upstream.ok) {
    const err = (await upstream.json().catch(() => ({ error: "relay error" }))) as { error?: string };
    return NextResponse.json(
      { error: err.error ?? `Relay error ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const audioBuffer = Buffer.from(await upstream.arrayBuffer());
  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.length),
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Local WebSocket mode (dev / no relay)
// ---------------------------------------------------------------------------

async function synthesizeLocal(text: string): Promise<NextResponse> {
  const APP_ID = process.env.VOLCANO_TTS_APPID ?? "";
  const ACCESS_TOKEN = process.env.VOLCANO_TTS_ACCESS_TOKEN ?? "";
  const CLUSTER = process.env.VOLCANO_TTS_CLUSTER ?? "volcano_tts";
  const VOICE_TYPE = process.env.VOLCANO_TTS_VOICE_TYPE ?? "zh_male_m191_uranus_bigtts";
  const WS_URL = process.env.VOLCANO_TTS_WS_URL ?? "wss://openspeech.bytedance.com/api/v1/tts/ws_binary";

  if (!APP_ID || !ACCESS_TOKEN) {
    return NextResponse.json({ error: "TTS credentials not configured" }, { status: 500 });
  }

  const { default: WebSocket } = await import("ws");

  const frame = buildFrame({
    app: { appid: APP_ID, token: ACCESS_TOKEN, cluster: CLUSTER },
    user: { uid: "talk-with-buffett" },
    audio: {
      voice_type: VOICE_TYPE,
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
  });

  const audioChunks = await new Promise<Buffer[]>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ws = new WebSocket(WS_URL, {
      headers: { Authorization: `Bearer;${ACCESS_TOKEN}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("TTS WebSocket timeout"));
    }, 15_000);

    ws.on("open", () => ws.send(frame));

    ws.on("message", (raw: Buffer) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      const { done, audio, error } = parseFrame(buf);
      if (error) { clearTimeout(timeout); ws.close(); reject(new Error(error)); return; }
      if (audio && audio.length > 0) chunks.push(audio);
      if (done) { clearTimeout(timeout); ws.close(); resolve(chunks); }
    });

    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
    ws.on("close", () => {
      clearTimeout(timeout);
      if (chunks.length > 0) resolve(chunks);
      else reject(new Error("TTS WS closed without audio"));
    });
  });

  const audioBuffer = Buffer.concat(audioChunks);
  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.length),
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "text too long (max 2000 chars)" }, { status: 400 });
  }

  const relayUrl = process.env.VOICE_RELAY_URL;

  try {
    return relayUrl ? await proxyToRelay(relayUrl, text) : await synthesizeLocal(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS synthesis failed";
    console.error("[tts] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
