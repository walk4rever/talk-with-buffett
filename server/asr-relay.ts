/**
 * Standalone ASR relay server — deploy this to Railway.
 * Exposes the same endpoints as the Next.js API routes so that
 * the Vercel-hosted frontend can proxy to it.
 *
 * Start: npx tsx server/asr-relay.ts
 */

import http from "node:http";
import {
  createRealtimeAsrSession,
  sendRealtimeAsrChunk,
  finishRealtimeAsrSession,
  subscribeRealtimeAsrSession,
} from "../src/lib/speech/volcengine-asr-relay";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /healthz
  if (req.method === "GET" && path === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  // POST /asr/realtime/start
  if (req.method === "POST" && path === "/asr/realtime/start") {
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr || "{}") as { uid?: string };
      const session = await createRealtimeAsrSession(body.uid);
      json(res, 200, session);
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : "start_failed" });
    }
    return;
  }

  // POST /asr/realtime/:id/chunk
  const chunkMatch = path.match(/^\/asr\/realtime\/([^/]+)\/chunk$/);
  if (req.method === "POST" && chunkMatch) {
    const id = chunkMatch[1];
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr) as { audioBase64?: string; isLast?: boolean };
      if (!body.audioBase64) {
        json(res, 400, { error: "audioBase64 is required" });
        return;
      }
      sendRealtimeAsrChunk(id, Buffer.from(body.audioBase64, "base64"), Boolean(body.isLast));
      json(res, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "chunk_failed";
      if (/session not found/i.test(message)) {
        json(res, 200, { ok: true, ignored: true, reason: "session_closed" });
        return;
      }
      json(res, 500, { error: message });
    }
    return;
  }

  // POST /asr/realtime/:id/finish
  const finishMatch = path.match(/^\/asr\/realtime\/([^/]+)\/finish$/);
  if (req.method === "POST" && finishMatch) {
    const id = finishMatch[1];
    finishRealtimeAsrSession(id);
    json(res, 200, { ok: true });
    return;
  }

  // GET /asr/realtime/:id/events  (SSE)
  const eventsMatch = path.match(/^\/asr\/realtime\/([^/]+)\/events$/);
  if (req.method === "GET" && eventsMatch) {
    const id = eventsMatch[1];
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });

    let unsubscribe: (() => void) | null = null;
    let closed = false;

    const safeClose = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      res.end();
    };

    try {
      unsubscribe = subscribeRealtimeAsrSession(id, (event) => {
        if (closed) return;
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          safeClose();
          return;
        }
        if (event.type === "closed") safeClose();
      });
    } catch {
      res.write(`data: ${JSON.stringify({ type: "error", message: "ASR session not found" })}\n\n`);
      safeClose();
      return;
    }

    req.on("close", safeClose);
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[asr-relay] listening on port ${PORT}`);
});
