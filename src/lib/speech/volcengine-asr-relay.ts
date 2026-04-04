import { randomUUID } from "node:crypto";
import {
  decodeVolcengineFrame,
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
} from "./volcengine-protocol";

type RelayEvent =
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "error"; message: string }
  | { type: "ready" }
  | { type: "closed" };

type Session = {
  id: string;
  ws: {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    send: (data: Buffer) => void;
    close: (code?: number, reason?: string) => void;
  };
  uid: string;
  reqId: string;
  logId: string | null;
  lastText: string;
  finalEmitted: boolean;
  initAcked: boolean;
  open: boolean;
  closed: boolean;
  finishing: boolean;
  nextSeq: number;
  initFallback: NodeJS.Timeout | null;
  pending: Array<{ chunk: Buffer; isLast: boolean }>;
  sentAudio: boolean;
  listeners: Set<(event: RelayEvent) => void>;
};

let wsCtorPromise: Promise<
  new (url: string, options?: { headers?: Record<string, string> }) => Session["ws"]
> | null = null;

async function getWebSocketCtor() {
  if (!wsCtorPromise) {
    process.env.WS_NO_BUFFER_UTIL = "1";
    process.env.WS_NO_UTF_8_VALIDATE = "1";
    wsCtorPromise = import("ws").then(
      (mod) => mod.default as unknown as new (url: string, options?: { headers?: Record<string, string> }) => Session["ws"],
    );
  }
  return wsCtorPromise;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value.trim();
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function relayStore() {
  const globalKey = "__VOLCENGINE_ASR_RELAY_STORE__" as const;
  const g = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, Session>;
  };
  if (!g[globalKey]) g[globalKey] = new Map<string, Session>();
  return g[globalKey]!;
}

function emit(session: Session, event: RelayEvent) {
  for (const listener of [...session.listeners]) {
    try {
      listener(event);
    } catch {
      session.listeners.delete(listener);
    }
  }
}

function extractTranscriptText(payload: unknown): string {
  const obj = payload as {
    result?: Array<{ text?: string; utterances?: Array<{ text?: string }> }> | { text?: string; utterances?: Array<{ text?: string }> };
    text?: string;
  };
  const resultList = Array.isArray(obj.result) ? obj.result : obj.result ? [obj.result] : [];
  const directTexts = resultList
    .map((item) => item?.text?.trim())
    .filter((text): text is string => Boolean(text));
  if (directTexts.length > 0) {
    return directTexts.join(" ").trim();
  }
  const utteranceTexts = resultList
    .flatMap((item) => item?.utterances ?? [])
    .map((utterance) => utterance?.text?.trim())
    .filter((text): text is string => Boolean(text));
  if (utteranceTexts.length > 0) {
    return utteranceTexts.join(" ").trim();
  }
  return obj.text?.trim() ?? "";
}

function buildInitPayload(session: Session) {
  return {
    app: {
      appid: requiredEnv("VOLCENGINE_ASR_APP_ID"),
      token: requiredEnv("VOLCENGINE_ASR_ACCESS_TOKEN"),
      cluster: requiredEnv("VOLCENGINE_ASR_CLUSTER"),
    },
    user: { uid: session.uid },
    audio: {
      format: "raw",
      codec: "raw",
      rate: 16000,
      bits: 16,
      channel: 1,
      language: "zh-CN",
    },
    request: {
      reqid: session.reqId,
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

function sendAudioFrame(session: Session, chunk: Buffer, isLast: boolean) {
  session.nextSeq += 1;
  if (chunk.length > 0) session.sentAudio = true;
  session.ws.send(encodeAudioOnlyRequest(chunk, isLast));
}

function flushPending(session: Session) {
  for (const item of session.pending) {
    sendAudioFrame(session, item.chunk, item.isLast);
    if (item.isLast) session.finishing = true;
  }
  session.pending = [];
}

function markSessionReady(session: Session) {
  if (session.closed || session.initAcked) return;
  session.initAcked = true;
  if (session.initFallback) clearTimeout(session.initFallback);
  session.initFallback = null;
  emit(session, { type: "ready" });
  flushPending(session);
}

export async function createRealtimeAsrSession(uid?: string) {
  const url = process.env.VOLCENGINE_ASR_WS_URL || "wss://openspeech.bytedance.com/api/v2/asr";
  if (url.includes("/api/v3/")) {
    throw new Error(
      `VOLCENGINE_ASR_WS_URL points to a v3 endpoint (${url}). This realtime relay is implemented for the v2 streaming ASR protocol. Use wss://openspeech.bytedance.com/api/v2/asr instead.`,
    );
  }
  const id = randomUUID();
  const reqId = randomUUID();
  const resolvedUid = uid ?? id;

  const resourceId = optionalEnv("VOLCENGINE_ASR_RESOURCE_ID");
  const accessToken = requiredEnv("VOLCENGINE_ASR_ACCESS_TOKEN");
  const WebSocketCtor = await getWebSocketCtor();
  const ws = new WebSocketCtor(url, {
    headers: {
      Authorization: `Bearer; ${accessToken}`,
      "X-Api-App-Key": requiredEnv("VOLCENGINE_ASR_APP_ID"),
      "X-Api-Connect-Id": reqId,
      ...(resourceId ? { "X-Api-Resource-Id": resourceId } : {}),
    },
  });

  const session: Session = {
    id,
    ws,
    uid: resolvedUid,
    reqId,
    logId: null,
    lastText: "",
    finalEmitted: false,
    initAcked: false,
    open: false,
    closed: false,
    finishing: false,
    nextSeq: 1,
    initFallback: null,
    pending: [],
    sentAudio: false,
    listeners: new Set(),
  };
  relayStore().set(id, session);

  ws.on("open", () => {
    session.open = true;
    ws.send(encodeFullClientRequest(buildInitPayload(session)));
    const initFallbackMs = Number(process.env.VOLCENGINE_ASR_INIT_FALLBACK_MS ?? "120");
    session.initFallback = setTimeout(() => {
      markSessionReady(session);
    }, Number.isFinite(initFallbackMs) ? Math.max(0, initFallbackMs) : 120);
  });

  ws.on("message", (data) => {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const frame = decodeVolcengineFrame(buffer);
      if (frame.type === "ack") {
        markSessionReady(session);
        return;
      }
      if (frame.type === "error") {
        console.error("[asr relay] volcengine error frame", {
          sessionId: session.id,
          reqId: session.reqId,
          errorCode: frame.errorCode,
          payload: frame.payload,
        });
        emit(session, {
          type: "error",
          message: `Volcengine ASR error ${frame.errorCode}: ${frame.payload}`,
        });
        return;
      }

      session.logId = frame.payload.addition?.logid ?? session.logId;
      if (typeof frame.payload.code === "number" && frame.payload.code !== 1000) {
        const message = frame.payload.message ?? `ASR code=${frame.payload.code}`;
        emit(session, { type: "error", message });
        ws.close(1000, "non-success code received");
        return;
      }
      const text = extractTranscriptText(frame.payload);
      const isFinal = frame.isLast;
      if (text) {
        session.lastText = text;
        if (isFinal) session.finalEmitted = true;
        emit(session, { type: "transcript", text, isFinal });
      }
      if (frame.isLast) {
        ws.close(1000, "final response received");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "decode_failed";
      console.error("[asr relay] decode failed", {
        sessionId: session.id,
        reqId: session.reqId,
        message,
      });
      emit(session, { type: "error", message });
      ws.close();
    }
  });

  ws.on("error", (error) => {
    const err = error as Error;
    console.error("[asr relay] websocket error", {
      sessionId: session.id,
      reqId: session.reqId,
      message: err.message,
    });
    emit(session, { type: "error", message: err.message });
  });

  ws.on("close", (code, reason) => {
    const closeCode = Number(code);
    const closeReason = String(reason ?? "");
    session.closed = true;
    if (session.initFallback) clearTimeout(session.initFallback);
    session.initFallback = null;
    if (!session.finalEmitted && session.lastText) {
      session.finalEmitted = true;
      emit(session, { type: "transcript", text: session.lastText, isFinal: true });
    }
    console.log("[asr relay] websocket closed", {
      sessionId: session.id,
      reqId: session.reqId,
      code: closeCode,
      reason: closeReason,
      logId: session.logId,
    });
    emit(session, { type: "closed" });
    relayStore().delete(session.id);
  });

  return {
    sessionId: session.id,
    reqId: session.reqId,
    logId: session.logId,
  };
}

export function sendRealtimeAsrChunk(sessionId: string, chunk: Buffer, isLast = false) {
  const session = relayStore().get(sessionId);
  if (!session || session.closed) throw new Error("ASR session not found");
  if (session.finishing) return;

  if (session.open && session.initAcked) {
    sendAudioFrame(session, chunk, isLast);
  } else {
    session.pending.push({ chunk, isLast });
  }

  if (isLast) {
    session.finishing = true;
  }
}

export function finishRealtimeAsrSession(sessionId: string) {
  const session = relayStore().get(sessionId);
  if (!session || session.closed || session.finishing) return;
  session.finishing = true;

  // When no audio was ever sent, closing directly is more stable than sending
  // an empty final frame (which often triggers backend code=1012).
  const hasAudio = session.sentAudio || session.pending.some((item) => item.chunk.length > 0);
  if (!hasAudio) {
    session.ws.close(1000, "no_audio");
    return;
  }

  if (session.open && session.initAcked) {
    sendAudioFrame(session, Buffer.alloc(0), true);
  } else {
    session.pending.push({ chunk: Buffer.alloc(0), isLast: true });
  }
}

export function subscribeRealtimeAsrSession(sessionId: string, listener: (event: RelayEvent) => void) {
  const session = relayStore().get(sessionId);
  if (!session) throw new Error("ASR session not found");
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}
