import type { SpeechRecognizer } from "@/lib/speech/types";

/**
 * Streaming ASR provider stub for Volcengine.
 *
 * We intentionally keep the interface ready, but do not fake the wire protocol.
 * To finish this integration we need the exact product docs / ws endpoint / auth fields
 * for the chosen Volcengine ASR product.
 */
export function createVolcengineSpeechRecognizer(): SpeechRecognizer {
  throw new Error(
    "Volcengine streaming ASR is not wired yet. Provide the exact Volcengine ASR websocket/API spec and credentials, then implement this recognizer.",
  );
}
