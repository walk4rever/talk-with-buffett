export type SpeechRecognizerEventMap = {
  start: () => void;
  speechstart: () => void;
  result: (payload: { interimText: string; finalText: string; combinedText: string }) => void;
  end: () => void;
  error: (error: { message: string }) => void;
};

export type SpeechRecognizerEventName = keyof SpeechRecognizerEventMap;

export interface SpeechRecognizer {
  readonly provider: "browser" | "volcengine";
  start(): void;
  stop(): void;
  abort(): void;
  on<K extends SpeechRecognizerEventName>(
    event: K,
    handler: SpeechRecognizerEventMap[K],
  ): void;
  destroy(): void;
}
