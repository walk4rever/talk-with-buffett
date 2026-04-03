import type { SpeechRecognizer, SpeechRecognizerEventMap, SpeechRecognizerEventName } from "@/lib/speech/types";

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onspeechstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function createBrowserSpeechRecognizer(): SpeechRecognizer | null {
  if (typeof window === "undefined") return null;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "zh-CN";

  const handlers: Partial<SpeechRecognizerEventMap> = {};
  let finalTranscript = "";
  let interimTranscript = "";

  recognition.onstart = () => {
    handlers.start?.();
  };

  recognition.onspeechstart = () => {
    handlers.speechstart?.();
  };

  recognition.onresult = (event) => {
    let nextInterim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        finalTranscript += text;
      } else {
        nextInterim += text;
      }
    }
    interimTranscript = nextInterim;
    handlers.result?.({
      interimText: interimTranscript,
      finalText: finalTranscript,
      combinedText: `${finalTranscript}${interimTranscript}`.trim(),
    });
  };

  recognition.onend = () => {
    handlers.end?.();
    finalTranscript = "";
    interimTranscript = "";
  };

  recognition.onerror = () => {
    handlers.error?.({ message: "browser_speech_recognition_error" });
  };

  return {
    provider: "browser",
    start() {
      recognition.start();
    },
    stop() {
      recognition.stop();
    },
    abort() {
      recognition.abort();
    },
    on<K extends SpeechRecognizerEventName>(event: K, handler: SpeechRecognizerEventMap[K]) {
      handlers[event] = handler;
    },
    destroy() {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.onspeechstart = null;
      try {
        recognition.abort();
      } catch {
        // noop
      }
    },
  };
}
