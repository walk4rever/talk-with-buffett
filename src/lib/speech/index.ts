import { createBrowserSpeechRecognizer } from "@/lib/speech/browser-recognizer";
import { createVolcengineSpeechRecognizer } from "@/lib/speech/volcengine-recognizer";
import type { SpeechRecognizer } from "@/lib/speech/types";

export type SpeechProviderName = "browser" | "volcengine";

export function createSpeechRecognizer(): SpeechRecognizer | null {
  const provider = (process.env.NEXT_PUBLIC_SPEECH_PROVIDER ?? "browser") as SpeechProviderName;

  if (provider === "volcengine") {
    return createVolcengineSpeechRecognizer();
  }

  return createBrowserSpeechRecognizer();
}

export type { SpeechRecognizer } from "@/lib/speech/types";
