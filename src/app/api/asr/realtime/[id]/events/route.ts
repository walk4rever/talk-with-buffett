import { subscribeRealtimeAsrSession } from "@/lib/speech/volcengine-asr-relay";

export const runtime = "nodejs";
export const maxDuration = 60;

function encodeSse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // When VOICE_RELAY_URL is set, pipe the SSE stream from the relay server.
  const relayUrl = process.env.VOICE_RELAY_URL;
  if (relayUrl) {
    const upstream = await fetch(`${relayUrl}/asr/realtime/${id}/events`, {
      signal: AbortSignal.timeout(60_000),
    });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // In-process fallback (local dev / single-server deploy).
  let unsubscribe: (() => void) | null = null;
  let streamClosed = false;
  const safeClose = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (streamClosed) return;
    streamClosed = true;
    unsubscribe?.();
    unsubscribe = null;
    controller?.close();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      try {
        unsubscribe = subscribeRealtimeAsrSession(id, (event) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(encodeSse(event)));
          } catch {
            safeClose(controller);
            return;
          }
          if (event.type === "closed") {
            safeClose(controller);
          }
        });
      } catch {
        controller.enqueue(encoder.encode(encodeSse({ type: "error", message: "ASR session not found" })));
        safeClose(controller);
      }
    },
    cancel() {
      safeClose();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
