"use client";

import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import {
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { usePostHog } from "posthog-js/react";
import {
  getSourceTypeLabel,
  streamChatAPI,
  type ChatMessage,
  type ChatSource,
} from "@/lib/chat";
import type {
  DigitalHumanJobPayload,
  DigitalHumanJobSnapshot,
} from "@/lib/digital-human";
import { BrowserPcmStreamer } from "@/lib/speech/browser-pcm-streamer";
import { RoomHeader } from "@/components/RoomHeader";
import { RoomLayout } from "@/components/RoomLayout";

type ConversationState =
  | "listening"
  | "user-speaking"
  | "thinking"
  | "assistant-speaking"
  | "ended"
  | "unsupported";

type TranscriptRole = "user" | "assistant";
type ReadingMode = "all" | "en" | "zh";

interface CanvasContent {
  type: string;
  year: number;
  title: string;
  contentMd: string;
}

const INITIAL_ASSISTANT_TEXT =
  "先问我一个投资、商业或人生决策问题。我会先给出结论，再把引用原文摆出来。";

const END_SILENCE_MS = 3000;
const scrollPositions = new Map<string, number>();
let activeHighlightEl: Element | null = null;

function canvasKey(type: string, year: number) {
  return `${type}:${year}`;
}

function hasCJK(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

function extractPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractPlainText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractPlainText(node.props.children);
  return "";
}

function joinClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

function mixedModeLangClass(children: ReactNode, readingMode: ReadingMode): string {
  if (readingMode !== "all") return "";
  const text = extractPlainText(children).trim();
  if (!text) return "";
  return hasCJK(text) ? "md-lang-block md-lang-zh" : "md-lang-block md-lang-en";
}

function createReaderMarkdownComponents(readingMode: ReadingMode) {
  return {
    table: (props: ComponentPropsWithoutRef<"table">) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),
    a: (props: ComponentPropsWithoutRef<"a">) => {
      const href = props.href ?? "";
      const isExternal = /^https?:\/\//i.test(href);
      return (
        <a
          {...props}
          target={isExternal ? "_blank" : props.target}
          rel={isExternal ? "noopener noreferrer" : props.rel}
        />
      );
    },
    p: (props: ComponentPropsWithoutRef<"p">) => (
      <p {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    h1: (props: ComponentPropsWithoutRef<"h1">) => (
      <h1 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    h2: (props: ComponentPropsWithoutRef<"h2">) => (
      <h2 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    h3: (props: ComponentPropsWithoutRef<"h3">) => (
      <h3 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote
        {...props}
        className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))}
      />
    ),
  };
}

function applyHighlight(el: Element) {
  if (activeHighlightEl) activeHighlightEl.classList.remove("canvas-highlight");
  el.classList.add("canvas-highlight");
  activeHighlightEl = el;
}

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findByExcerpt(container: HTMLElement, excerpt: string): Element | null {
  const query = excerpt.trim();
  if (!query) return null;
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedQuery) return null;
  const queryPrefix = normalizedQuery.slice(0, Math.min(80, normalizedQuery.length));
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = normalizeForMatch(node.textContent ?? "");
    if (!text) continue;
    if (text.includes(queryPrefix)) return node.parentElement;
  }
  return null;
}

function scrollToChunk(container: HTMLElement, title: string | null, excerptEn: string, excerptZh?: string) {
  const zhEl = excerptZh ? findByExcerpt(container, excerptZh) : null;
  if (zhEl) {
    zhEl.scrollIntoView({ behavior: "smooth", block: "center" });
    applyHighlight(zhEl);
    return;
  }
  const enEl = findByExcerpt(container, excerptEn);
  if (enEl) {
    enEl.scrollIntoView({ behavior: "smooth", block: "center" });
    applyHighlight(enEl);
    return;
  }
  if (title && title.trim()) {
    const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const headings = container.querySelectorAll("h1, h2, h3, h4");
    for (const h of Array.from(headings)) {
      const hText = (h.textContent ?? "").toLowerCase();
      if (words.length > 0 && words.every((w) => hText.includes(w))) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        applyHighlight(h);
        return;
      }
    }
  }
}

function stripHeader(md: string) {
  const lines = md.split("\n");
  let lastMetaLine = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].trim();
    if (
      t.startsWith("原文信息") ||
      t.startsWith("- 标题") ||
      t.startsWith("- 作者") ||
      t.startsWith("- 发表") ||
      t.startsWith("- 链接") ||
      t.startsWith("- 中文") ||
      t.startsWith("- 整理") ||
      t.startsWith("- 修订") ||
      t.startsWith("- 校译") ||
      t.startsWith("- 校对") ||
      t.startsWith("[^") ||
      (t === "---" && i < 20) ||
      t === ""
    ) {
      lastMetaLine = i;
    }
  }
  return lines.slice(lastMetaLine + 1).join("\n").trim();
}

function filterByLanguage(md: string, mode: ReadingMode) {
  if (mode === "all") return md;
  const lines = md.split("\n");
  const result: string[] = [];
  let inTable = false;
  let tableIsTarget = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") || trimmed.match(/^---[\s|:]+/)) {
      if (!inTable) {
        inTable = true;
        tableIsTarget = mode === "en" ? !hasCJK(trimmed) : hasCJK(trimmed);
      }
      if (tableIsTarget) result.push(line);
      continue;
    } else {
      inTable = false;
    }
    if (!trimmed) {
      result.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      if (mode === "en") {
        result.push(trimmed.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, "").trim());
      } else {
        const zhMatch = trimmed.match(/([\u4e00-\u9fff][\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s·\-—]+)/);
        if (zhMatch) {
          const level = trimmed.match(/^#+/)?.[0] ?? "#";
          result.push(`${level} ${zhMatch[1].trim()}`);
        } else {
          result.push(trimmed);
        }
      }
      continue;
    }
    const isZh = hasCJK(trimmed);
    if (mode === "en" && !isZh) result.push(line);
    if (mode === "zh" && isZh) result.push(line);
  }
  const filtered = result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!filtered && mode !== "en") return md;
  return filtered;
}


/** Split text into complete sentences and a trailing remainder. */
function extractCompleteSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ("。！？!?".includes(text[i])) {
      const s = text.slice(start, i + 1).trim();
      if (s.length > 1) sentences.push(s);
      start = i + 1;
    }
  }
  return { sentences, remainder: text.slice(start) };
}

const VOICE_RELAY_URL = "https://relay.air7.fun";

/** Fetch Doubao TTS audio for a text sentence. Returns an object URL for playback. */
async function fetchTtsAudio(text: string): Promise<string> {
  const url = VOICE_RELAY_URL ? `${VOICE_RELAY_URL}/tts` : "/api/tts";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "TTS request failed" }))) as { error?: string };
    throw new Error(err.error ?? `TTS error ${res.status}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function asrUrl(path: string): string {
  return VOICE_RELAY_URL ? `${VOICE_RELAY_URL}${path}` : `/api${path}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function createDigitalHumanJob(payload: DigitalHumanJobPayload) {
  const res = await fetch("/api/digital-human/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "failed to create digital human job");
  }
  return (await res.json()) as { job: DigitalHumanJobSnapshot };
}

async function fetchDigitalHumanJob(jobId: string) {
  const res = await fetch(`/api/digital-human/jobs/${jobId}`);
  if (!res.ok) throw new Error("failed to fetch digital human job");
  return (await res.json()) as { job: DigitalHumanJobSnapshot };
}

export function LiveRoomWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const posthog = usePostHog();
  const canvasType = params.get("source") ?? "";
  const canvasYear = parseInt(params.get("year") ?? "0", 10);
  const canvasExcerpt = params.get("q") ?? "";
  const canvasExcerptZh = params.get("qzh") ?? "";
  const canvasTitle = params.get("t") ?? "";
  const hasReader = !!canvasType && canvasYear > 0;

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationState, setConversationState] =
    useState<ConversationState>("listening");
  const [sessionLive, setSessionLive] = useState(true);
  const [muted, setMuted] = useState(false);
  const [activeSources, setActiveSources] = useState<ChatSource[]>([]);
  const [currentUserText, setCurrentUserText] = useState("");
  const [activeJob, setActiveJob] = useState<DigitalHumanJobSnapshot | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [digitalHumanAvailable, setDigitalHumanAvailable] = useState(true);
  const [citationSheetOpen, setCitationSheetOpen] = useState(false);
  const [isAsrStreaming, setIsAsrStreaming] = useState(false);
  const [speechErrorMessage, setSpeechErrorMessage] = useState<string | null>(null);
  // null = show full msg.content; string = show only spoken-so-far (subtitle sync)
  const [spokenText, setSpokenText] = useState<string | null>(null);
  const readingMode: ReadingMode = "all";
  const [canvasContent, setCanvasContent] = useState<CanvasContent | null>(null);
  const pollingRef = useRef<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechQueueRef = useRef<string[]>([]);
  const pendingSentenceRef = useRef<string>("");
  const isSpeechActiveRef = useRef(false);
  const streamingDoneRef = useRef(false);
  const speakNextRef = useRef<() => void>(() => undefined);
  const ttsPrefetchRef = useRef<Promise<string> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamerRef = useRef<BrowserPcmStreamer | null>(null);
  const asrSessionIdRef = useRef<string | null>(null);
  const asrSessionPendingRef = useRef<Promise<string> | null>(null);
  const asrEventSourceRef = useRef<EventSource | null>(null);
  const isAsrFinishingRef = useRef(false);
  const isAsrStartingRef = useRef(false);
  const asrFinalReceivedRef = useRef(false);
  const asrSendChainRef = useRef<Promise<void>>(Promise.resolve());
  const accumulatedUserTextRef = useRef<string>("");
  const detectedSpeechRef = useRef(false);
  const silenceMsRef = useRef(0);
  const assistantSpeakingRef = useRef(false);
  const sessionLiveRef = useRef(sessionLive);
  const mutedRef = useRef(muted);
  const chatMessagesRef = useRef(chatMessages);
  const sendQuestionRef = useRef<(question: string) => Promise<void>>(
    async () => undefined,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const prevReaderKeyRef = useRef<string>("");

  const stageStatus = useMemo(() => {
    switch (conversationState) {
      case "user-speaking":
        return "你正在说话";
      case "thinking":
        return "巴菲特正在思考";
      case "assistant-speaking":
        return "巴菲特正在回答";
      case "ended":
        return "会话已暂停";
      case "unsupported":
        return "浏览器不支持实时语音";
      default:
        if (isAsrStreaming) return "你正在说话";
        return muted ? "麦克风已静音" : "正在聆听";
    }
  }, [conversationState, isAsrStreaming, muted]);
  const bottomStatusText = speechErrorMessage
    ? speechErrorMessage
    : !digitalHumanAvailable
      ? "数字人视频暂不可用，已自动降级为语音播报"
      : stageStatus;

  const filteredCanvasContent = useMemo(() => {
    if (!canvasContent?.contentMd) return "";
    const md = filterByLanguage(stripHeader(canvasContent.contentMd), readingMode);
    return md.replace(/<\/br>/gi, "<br/>");
  }, [canvasContent, readingMode]);

  const readerMarkdownComponents = useMemo(
    () => createReaderMarkdownComponents(readingMode),
    [readingMode],
  );

  const canvasLoading =
    hasReader &&
    (!canvasContent || canvasContent.type !== canvasType || canvasContent.year !== canvasYear);

  function stopPolling() {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function stopSpeech() {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      const src = ttsAudioRef.current.src;
      ttsAudioRef.current.src = "";
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      ttsAudioRef.current = null;
    }
    // Revoke any prefetched blob that won't be used
    ttsPrefetchRef.current?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    ttsPrefetchRef.current = null;
    speechQueueRef.current = [];
    isSpeechActiveRef.current = false;
    assistantSpeakingRef.current = false;
  }

  const stopAsrStreaming = useCallback(async () => {
    asrEventSourceRef.current?.close();
    asrEventSourceRef.current = null;
    asrSessionIdRef.current = null;
    asrSessionPendingRef.current = null;
    isAsrFinishingRef.current = false;
    asrSendChainRef.current = Promise.resolve();
    asrFinalReceivedRef.current = false;
    accumulatedUserTextRef.current = "";
    detectedSpeechRef.current = false;
    silenceMsRef.current = 0;
    const streamer = streamerRef.current;
    streamerRef.current = null;
    if (streamer) {
      await streamer.stop().catch(() => undefined);
    }
    isAsrStartingRef.current = false;
    setIsAsrStreaming(false);
  }, []);

  const finishAsrSession = useCallback(async () => {
    const sessionId = asrSessionIdRef.current;
    if (!sessionId || isAsrFinishingRef.current) return;
    isAsrFinishingRef.current = true;
    await fetch(asrUrl(`/asr/realtime/${sessionId}/finish`), { method: "POST" }).catch(() => undefined);
  }, []);

  const ensureAsrSession = useCallback(async () => {
    if (asrSessionIdRef.current) return asrSessionIdRef.current;
    if (asrSessionPendingRef.current) return asrSessionPendingRef.current;

    const pending = (async () => {
      const res = await fetch(asrUrl("/asr/realtime/start"), { method: "POST" });
      if (!res.ok) throw new Error("failed_to_start_asr_session");
      const data = (await res.json()) as { sessionId: string };
      asrSessionIdRef.current = data.sessionId;
      const es = new EventSource(asrUrl(`/asr/realtime/${data.sessionId}/events`));
      // sessionCleared: true after isFinal so stale events from this session are ignored
      let sessionCleared = false;
      es.onmessage = (event) => {
        if (sessionCleared) return;
        const payload = JSON.parse(event.data) as
          | { type: "transcript"; text: string; isFinal: boolean }
          | { type: "error"; message: string }
          | { type: "closed" }
          | { type: "ready" };
        if (payload.type === "transcript") {
          // Show accumulated text from previous sessions + current partial
          const displayText = accumulatedUserTextRef.current
            ? `${accumulatedUserTextRef.current} ${payload.text}`
            : payload.text;
          setCurrentUserText(displayText);
          setConversationState("user-speaking");
          if (payload.isFinal) {
            const wasFinishing = isAsrFinishingRef.current;
            // Accumulate text across sessions — Volcengine may fire isFinal on brief pauses
            accumulatedUserTextRef.current = accumulatedUserTextRef.current
              ? `${accumulatedUserTextRef.current} ${payload.text}`
              : payload.text;
            // Clear this session's refs but keep streamer running
            sessionCleared = true;
            asrEventSourceRef.current = null;
            asrSessionIdRef.current = null;
            asrSessionPendingRef.current = null;
            isAsrFinishingRef.current = false;
            asrSendChainRef.current = Promise.resolve();
            es.close();
            if (wasFinishing) {
              // Client had triggered 3s-silence finish; submit now that we have final text
              const text = accumulatedUserTextRef.current;
              accumulatedUserTextRef.current = "";
              void stopAsrStreaming();
              void sendQuestionRef.current(text);
            }
            // Otherwise keep streamer running — chunk callback handles continued speech or timeout
          }
        }
        if (payload.type === "error") {
          sessionCleared = true;
          setSpeechErrorMessage("语音识别失败，请重试。");
          void stopAsrStreaming();
          setConversationState("ended");
        }
        if (payload.type === "closed") {
          if (sessionCleared) return;
          sessionCleared = true;
          setSpeechErrorMessage("语音识别会话已结束，请重试。");
          void stopAsrStreaming();
          setConversationState("ended");
        }
      };
      es.onerror = () => {
        if (sessionCleared) return;
        sessionCleared = true;
        setSpeechErrorMessage("语音识别连接中断，请重试。");
        es.close();
        void stopAsrStreaming();
        setConversationState("ended");
      };
      asrEventSourceRef.current = es;
      return data.sessionId;
    })();

    asrSessionPendingRef.current = pending;
    try {
      return await pending;
    } finally {
      asrSessionPendingRef.current = null;
    }
  }, [stopAsrStreaming]);

  const startAsrStreaming = useCallback(async () => {
    if (
      !sessionLiveRef.current ||
      mutedRef.current ||
      assistantSpeakingRef.current ||
      streamerRef.current ||
      isAsrStartingRef.current
    ) {
      return;
    }
    isAsrStartingRef.current = true;
    accumulatedUserTextRef.current = "";
    setCurrentUserText("");
    try {
      setSpeechErrorMessage(null);
      const streamer = new BrowserPcmStreamer();
      streamerRef.current = streamer;
      await streamer.start(async ({ pcm16, durationMs, rms }) => {
        if (assistantSpeakingRef.current || mutedRef.current || isAsrFinishingRef.current) return;
        const speaking = rms > 0.018;
        // Skip early only if no speech detected yet and currently silent
        if (!speaking && !detectedSpeechRef.current) return;
        if (speaking) {
          detectedSpeechRef.current = true;
          silenceMsRef.current = 0;
          setIsAsrStreaming(true);
          setConversationState("user-speaking");
        } else if (detectedSpeechRef.current) {
          silenceMsRef.current += durationMs;
        }
        const shouldFinish = detectedSpeechRef.current && silenceMsRef.current >= END_SILENCE_MS;
        // If silence timeout reached and we have accumulated text but no active session,
        // submit directly without starting a new ASR session
        if (shouldFinish && accumulatedUserTextRef.current && !asrSessionIdRef.current) {
          const text = accumulatedUserTextRef.current;
          accumulatedUserTextRef.current = "";
          void stopAsrStreaming();
          void sendQuestionRef.current(text);
          return;
        }
        // Don't start a new session during silence after previous session finalised
        if (!asrSessionIdRef.current && !speaking) return;
        const sessionId = await ensureAsrSession();
        if (isAsrFinishingRef.current) return;
        const audioBase64 = arrayBufferToBase64(pcm16);
        const sendTask = asrSendChainRef.current
          .catch(() => undefined)
          .then(async () => {
            const res = await fetch(asrUrl(`/asr/realtime/${sessionId}/chunk`), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audioBase64 }),
            }).catch(() => null);
            if (res && !res.ok) {
              const payload = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
              const text = payload?.error ?? "";
              if (/session not found/i.test(text) || payload?.reason === "session_closed") {
                asrSessionIdRef.current = null;
                return;
              }
              setSpeechErrorMessage(text ? `语音识别失败：${text}` : "语音识别失败，请重试。");
              void stopAsrStreaming();
              setConversationState("ended");
            }
          });
        asrSendChainRef.current = sendTask;
        if (shouldFinish) {
          await asrSendChainRef.current.catch(() => undefined);
          await finishAsrSession();
        }
      });
      setConversationState("listening");
    } catch (error) {
      console.error("[speech] streamer start failed", error);
      setSpeechSupported(false);
      setSpeechErrorMessage("无法启用实时语音，请检查麦克风权限。");
      setConversationState("unsupported");
    } finally {
      isAsrStartingRef.current = false;
    }
  }, [ensureAsrSession, finishAsrSession, stopAsrStreaming]);

  const sendQuestion = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) {
      if (sessionLiveRef.current && !mutedRef.current) {
        setConversationState("listening");
        window.setTimeout(() => void startAsrStreaming(), 280);
      }
      return;
    }

    stopSpeech();
    stopPolling();
    setActiveJob(null);
    setActiveSources([]);
    setSpokenText("");
    streamingDoneRef.current = false;
    pendingSentenceRef.current = "";
    setConversationState("thinking");

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true };
    const nextMessages = [...chatMessagesRef.current, userMsg];
    setChatMessages((prev) => [...prev, userMsg, placeholder]);

    let streamBuffer = "";
    let sourcesFromStream: ChatSource[] = [];
    let chatMessageIdFromStream: string | undefined;
    let streamFailed = false;
    await streamChatAPI(
      nextMessages,
      (delta) => {
        streamBuffer += delta;
        // Queue complete sentences for immediate playback
        pendingSentenceRef.current += delta;
        const { sentences, remainder } = extractCompleteSentences(pendingSentenceRef.current);
        pendingSentenceRef.current = remainder;
        for (const sentence of sentences) {
          speechQueueRef.current.push(sentence);
          speakNextRef.current();
        }
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: streamBuffer,
          };
          return updated;
        });
      },
      (sources, chatMessageId) => {
        sourcesFromStream = sources;
        chatMessageIdFromStream = chatMessageId;
      },
      (errorMsg) => {
        streamFailed = true;
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: errorMsg,
            streaming: false,
          };
          return updated;
        });
        setConversationState(sessionLiveRef.current && !mutedRef.current ? "listening" : "ended");
        if (sessionLiveRef.current && !mutedRef.current) {
          window.setTimeout(() => void startAsrStreaming(), 320);
        }
      },
      "live",
    );
    if (streamFailed) return;

    const finalAnswer = streamBuffer.trim();
    setChatMessages((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        content: finalAnswer,
        sources: sourcesFromStream,
        chatMessageId: chatMessageIdFromStream,
        streaming: false,
      };
      return updated;
    });
    setActiveSources(sourcesFromStream);

    if (!finalAnswer) {
      setConversationState("listening");
      window.setTimeout(() => void startAsrStreaming(), 300);
      return;
    }

    if (digitalHumanAvailable) {
      try {
        const { job } = await createDigitalHumanJob({
          chatMessageId: chatMessageIdFromStream,
          question: trimmed,
          answer: finalAnswer,
          sources: sourcesFromStream,
        });
        setActiveJob(job);
        if (job.status !== "ready") {
          pollingRef.current = window.setInterval(async () => {
            try {
              const { job: latestJob } = await fetchDigitalHumanJob(job.id);
              setActiveJob(latestJob);
              if (latestJob.status === "ready" || latestJob.status === "failed") {
                stopPolling();
              }
            } catch {
              stopPolling();
            }
          }, 1800);
        }
      } catch (error) {
        console.error("[digital-human] unavailable", error);
        setDigitalHumanAvailable(false);
        setActiveJob(null);
      }
    }

    // Flush any remaining sentence fragment, mark streaming done, then trigger speech.
    if (pendingSentenceRef.current.trim()) {
      speechQueueRef.current.push(pendingSentenceRef.current.trim());
      pendingSentenceRef.current = "";
    }
    streamingDoneRef.current = true;

    speakNextRef.current(); // start queue if not already playing
    // Edge case: queue may already be empty (all sentences were spoken during streaming)
    if (speechQueueRef.current.length === 0 && !isSpeechActiveRef.current) {
      assistantSpeakingRef.current = false;
      setSpokenText(null);
      setConversationState(sessionLiveRef.current && !mutedRef.current ? "listening" : "ended");
      if (sessionLiveRef.current && !mutedRef.current) {
        window.setTimeout(() => void startAsrStreaming(), 320);
      }
    }
  }, [digitalHumanAvailable, startAsrStreaming]);

  useEffect(() => {
    sessionLiveRef.current = sessionLive;
    mutedRef.current = muted;
    chatMessagesRef.current = chatMessages;
    sendQuestionRef.current = sendQuestion;
  }, [chatMessages, muted, sendQuestion, sessionLive]);

  // Keep speakNextRef up to date (refs avoid stale closures in utterance callbacks)
  useEffect(() => {
    const onSpeechDone = () => {
      assistantSpeakingRef.current = false;
      setSpokenText(null);
      setConversationState(sessionLiveRef.current && !mutedRef.current ? "listening" : "ended");
      if (sessionLiveRef.current && !mutedRef.current) {
        window.setTimeout(() => void startAsrStreaming(), 320);
      }
    };

    const onSentenceEnd = () => {
      ttsAudioRef.current = null;
      isSpeechActiveRef.current = false;
      if (speechQueueRef.current.length > 0) {
        speakNextRef.current();
      } else if (streamingDoneRef.current) {
        onSpeechDone();
      }
    };

    const prefetchNext = () => {
      if (speechQueueRef.current.length > 0 && !ttsPrefetchRef.current) {
        const nextText = speechQueueRef.current[0];
        ttsPrefetchRef.current = fetchTtsAudio(nextText).catch(() => "");
      }
    };

    const playAudio = (objectUrl: string, textToSpeak: string) => {
      if (!objectUrl) { onSentenceEnd(); return; }
      const audio = new Audio(objectUrl);
      ttsAudioRef.current = audio;
      // Start prefetching next sentence as soon as playback begins
      audio.onplay = prefetchNext;
      audio.onended = () => { URL.revokeObjectURL(objectUrl); onSentenceEnd(); };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        ttsAudioRef.current = null;
        isSpeechActiveRef.current = false;
        onSpeechDone();
      };
      void audio.play();
    };

    speakNextRef.current = () => {
      if (isSpeechActiveRef.current || speechQueueRef.current.length === 0) return;
      const textToSpeak = speechQueueRef.current.shift()!;
      isSpeechActiveRef.current = true;
      assistantSpeakingRef.current = true;
      setConversationState("assistant-speaking");
      setSpokenText((prev) => (prev ?? "") + textToSpeak);

      // Use prefetched audio if available, otherwise fetch now
      const pending = ttsPrefetchRef.current;
      ttsPrefetchRef.current = null;
      if (pending) {
        pending.then((url) => playAudio(url, textToSpeak)).catch(() => {
          isSpeechActiveRef.current = false;
          onSpeechDone();
        });
      } else {
        fetchTtsAudio(textToSpeak)
          .then((url) => playAudio(url, textToSpeak))
          .catch(() => {
            isSpeechActiveRef.current = false;
            onSpeechDone();
          });
      }
    };
  }, [startAsrStreaming]);

  useEffect(() => {
    if (!sessionLive || muted) return;
    const timer = window.setTimeout(() => {
      void startAsrStreaming();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [muted, sessionLive, startAsrStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, currentUserText]);

  useEffect(() => {
    return () => {
      stopPolling();
      stopSpeech();
      void stopAsrStreaming();
    };
  }, [stopAsrStreaming]);

  useEffect(() => {
    if (!hasReader) return;
    if (prevReaderKeyRef.current && canvasScrollRef.current) {
      scrollPositions.set(prevReaderKeyRef.current, canvasScrollRef.current.scrollTop);
    }
    let cancelled = false;
    fetch(`/api/source?type=${canvasType}&year=${canvasYear}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCanvasContent(data);
        const key = canvasKey(canvasType, canvasYear);
        prevReaderKeyRef.current = key;
        if (!canvasTitle && !canvasExcerpt && !canvasExcerptZh) {
          requestAnimationFrame(() => {
            const savedPos = scrollPositions.get(key);
            if (savedPos && canvasScrollRef.current) {
              canvasScrollRef.current.scrollTop = savedPos;
            } else if (canvasScrollRef.current) {
              canvasScrollRef.current.scrollTop = 0;
            }
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCanvasContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasReader, canvasType, canvasYear, canvasTitle, canvasExcerpt, canvasExcerptZh]);

  useEffect(() => {
    if (!canvasContent || !canvasScrollRef.current) return;
    if (!canvasTitle && !canvasExcerpt && !canvasExcerptZh) return;
    scrollToChunk(canvasScrollRef.current, canvasTitle || null, canvasExcerpt, canvasExcerptZh);
  }, [canvasContent, canvasTitle, canvasExcerpt, canvasExcerptZh]);

  const openReader = useCallback(
    (type: string, year: number, excerpt?: string, title?: string | null, chunkId?: string, excerptZh?: string) => {
      posthog?.capture("reader_opened", { source_type: type, year });
      const q = excerpt ? `&q=${encodeURIComponent(excerpt.slice(0, 100))}` : "";
      const qzh = excerptZh ? `&qzh=${encodeURIComponent(excerptZh.slice(0, 100))}` : "";
      const t = title ? `&t=${encodeURIComponent(title)}` : "";
      const c = chunkId ? `&c=${encodeURIComponent(chunkId)}` : "";
      router.push(`/live/room?source=${type}&year=${year}${q}${qzh}${t}${c}`, { scroll: false });
      setCitationSheetOpen(true);
    },
    [posthog, router],
  );

  const closeReader = useCallback(() => {
    if (hasReader && canvasScrollRef.current) {
      scrollPositions.set(canvasKey(canvasType, canvasYear), canvasScrollRef.current.scrollTop);
    }
    router.push("/live/room", { scroll: false });
  }, [router, hasReader, canvasType, canvasYear]);


  function handleMuteToggle() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (nextMuted) {
      void stopAsrStreaming();
      setConversationState("ended");
      return;
    }
    if (sessionLive) {
      setConversationState("listening");
      window.setTimeout(() => void startAsrStreaming(), 160);
    }
  }

  function handleEndSession() {
    setSessionLive(false);
    setConversationState("ended");
    void stopAsrStreaming();
    stopSpeech();
    stopPolling();
  }

  function handleResumeSession() {
    setSessionLive(true);
    setConversationState(muted ? "ended" : "listening");
    if (!muted && speechSupported) {
      window.setTimeout(() => void startAsrStreaming(), 180);
    }
  }

  function handleInterrupt() {
    stopSpeech();
    stopPolling();
    setSpokenText(null);
    streamingDoneRef.current = true;
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setActiveJob(null);
    if (sessionLiveRef.current && !mutedRef.current) {
      setConversationState("listening");
      window.setTimeout(() => void startAsrStreaming(), 200);
    } else {
      setConversationState(sessionLive ? "listening" : "ended");
    }
  }

  return (
    <RoomLayout
      rootClassName="workspace workspace--split avatar-workspace"
      mainClassName="workspace-chat avatar-workspace-chat"
      sideClassName="workspace-canvas avatar-workspace-canvas"
      main={(
        <>
          <RoomHeader
            title="Live Room"
            onOpenSide={() => setCitationSheetOpen(true)}
            rightSlot={<div className="avatar-room-header-placeholder" />}
          />

          <div className="workspace-chat-body avatar-workspace-body">
          <div className="avatar-workspace-video-panel">
            <div className="avatar-workspace-video-frame">
              {activeJob?.videoUrl ? (
                <video
                  ref={videoRef}
                  className="avatar-workspace-video"
                  src={activeJob.videoUrl}
                  autoPlay
                  muted
                  playsInline
                  loop
                  controls={false}
                />
              ) : (
                <Image
                  src="/buffett-avarta.jpg"
                  alt="Warren Buffett"
                  className="avatar-workspace-video"
                  width={1080}
                  height={1080}
                  priority
                />
              )}
              {(conversationState === "assistant-speaking" || conversationState === "thinking") && (
                <div className="avatar-workspace-video-ring" />
              )}
            </div>
          </div>

          <div className="avatar-workspace-transcript-panel">
            <div className="avatar-workspace-transcript-current">
              {chatMessages.length === 0 ? (
                <p className="avatar-transcript-empty">{INITIAL_ASSISTANT_TEXT}</p>
              ) : (
                chatMessages.map((msg, i) => {
                  // For the last assistant message while spokenText is active,
                  // only reveal text that has been spoken (subtitle sync).
                  const isActiveAssistant =
                    spokenText !== null &&
                    msg.role === "assistant" &&
                    i === chatMessages.length - 1;
                  const displayContent = isActiveAssistant ? spokenText : msg.content;
                  return (
                    <div key={i} className={`avatar-transcript-msg avatar-transcript-msg--${msg.role}`}>
                      <span className="avatar-transcript-label">
                        {msg.role === "user" ? "你" : "巴菲特"}
                      </span>
                      {msg.role === "assistant" ? (
                        <div className="avatar-transcript-md">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={readerMarkdownComponents}>
                            {displayContent || "\u00a0"}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="avatar-transcript-user-text">{msg.content}</p>
                      )}
                    </div>
                  );
                })
              )}
              {/* 实时 ASR 草稿（未发送的当前发言） */}
              {conversationState === "user-speaking" && currentUserText && (
                <div className="avatar-transcript-msg avatar-transcript-msg--user avatar-transcript-msg--draft">
                  <span className="avatar-transcript-label">你</span>
                  <p className="avatar-transcript-user-text">{currentUserText}</p>
                </div>
              )}
            </div>
            <div className="avatar-workspace-bottom-controls">
              <p className="avatar-workspace-status-text">{bottomStatusText}</p>
              <div className="avatar-workspace-control-row">
                {/* 打断 — 常驻，巴菲特未说话时 disabled */}
                <button
                  type="button"
                  className="avatar-workspace-icon-btn avatar-workspace-icon-btn--interrupt"
                  onClick={handleInterrupt}
                  disabled={conversationState !== "assistant-speaking"}
                  title="打断"
                  aria-label="打断当前播报"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="3"/>
                  </svg>
                </button>
                {/* 静音 / 开麦 */}
                <button
                  type="button"
                  className={`avatar-workspace-icon-btn${muted ? "" : " avatar-workspace-icon-btn--active"}`}
                  onClick={handleMuteToggle}
                  title={muted ? "开启麦克风" : "静音"}
                  aria-label={muted ? "开启麦克风" : "静音"}
                >
                  {muted ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                  )}
                </button>
                {/* 挂断（红色电源图标）/ 恢复（绿色播放图标） */}
                {sessionLive ? (
                  <button
                    type="button"
                    className="avatar-workspace-icon-btn avatar-workspace-icon-btn--danger"
                    onClick={handleEndSession}
                    title="结束会话"
                    aria-label="结束会话"
                  >
                    {/* 电源关闭 */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                      <line x1="12" y1="2" x2="12" y2="12"/>
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="avatar-workspace-icon-btn avatar-workspace-icon-btn--resume"
                    onClick={handleResumeSession}
                    title="开始会话"
                    aria-label="开始会话"
                  >
                    {/* 播放三角 */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <polygon points="6,3 20,12 6,21"/>
                    </svg>
                  </button>
                )}
              </div>
              <div />
            </div>
            <div ref={bottomRef} />
          </div>
          </div>
        </>
      )}
      side={(
        <>
          <div className="workspace-canvas-header">
            <button
              className="workspace-mobile-toggle"
              onClick={() => setCitationSheetOpen(false)}
            >
              ← 对话
            </button>
            <span className="workspace-canvas-title">
              {hasReader
                ? (canvasContent
                  ? `${canvasContent.year} ${getSourceTypeLabel(canvasContent.type)}`
                  : "加载中…")
                : "相关原文"}
            </span>
          {null}
            {hasReader ? (
              <button className="workspace-canvas-close" onClick={closeReader} aria-label="关闭">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            ) : (
              <span className="workspace-canvas-count">{activeSources.length} 条</span>
            )}
          </div>

          <div className="workspace-canvas-body" ref={canvasScrollRef}>
            {hasReader ? (
              canvasLoading ? (
                <div className="workspace-canvas-loading">加载中…</div>
              ) : canvasContent ? (
                <div className="md-reader md-reader--canvas" style={{ fontSize: 16, lineHeight: 1.8 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={readerMarkdownComponents}>
                    {filteredCanvasContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="workspace-canvas-loading">未找到内容</div>
              )
            ) : (
              <LiveReferenceList items={activeSources} onOpen={openReader} />
            )}
          </div>
        </>
      )}
      overlay={(
        <div
          className={`digital-human-citation-sheet${citationSheetOpen ? " digital-human-citation-sheet--open" : ""}`}
          aria-hidden={!citationSheetOpen}
        >
          <button
            type="button"
            className="digital-human-citation-sheet-backdrop"
            onClick={() => setCitationSheetOpen(false)}
            aria-label="关闭原文引用"
          />
          <div className="digital-human-citation-sheet-panel">
            <div className="digital-human-citation-sheet-handle" />
            <div className="workspace-canvas-header digital-human-citation-sheet-header">
              <span className="workspace-canvas-title">相关原文</span>
              <button
                type="button"
                className="avatar-workspace-btn"
                onClick={() => setCitationSheetOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="workspace-canvas-body digital-human-citation-sheet-body">
              {hasReader ? (
                canvasLoading ? (
                  <div className="workspace-canvas-loading">加载中…</div>
                ) : canvasContent ? (
                  <div className="md-reader md-reader--canvas" style={{ fontSize: 16, lineHeight: 1.8 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={readerMarkdownComponents}>
                      {filteredCanvasContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="workspace-canvas-loading">未找到内容</div>
                )
              ) : (
                <LiveReferenceList items={activeSources} onOpen={openReader} />
              )}
            </div>
          </div>
        </div>
      )}
    />
  );
}

function LiveReferenceList({
  items,
  onOpen,
}: {
  items: ChatSource[];
  onOpen: (type: string, year: number, excerpt?: string, title?: string | null, chunkId?: string, excerptZh?: string) => void;
}) {
  const posthog = usePostHog();
  if (items.length === 0) {
    return (
      <div className="workspace-reference-empty">
        <p>右侧默认展示最近一条回复的原文索引。</p>
      </div>
    );
  }
  const sorted = [...items].sort((a, b) => a.year - b.year);
  const RETRIEVAL_LABELS: Record<string, string> = {
    keyword: "关键词",
    semantic: "语义",
    both: "关键词+语义",
  };
  return (
    <div className="workspace-reference-list">
      {sorted.map((item) => {
        const retrievalLabel = item.retrieval ? RETRIEVAL_LABELS[item.retrieval] : null;
        const scoreLabel =
          item.retrieval === "both"
            ? ""
            : item.retrieval === "semantic" && item.semanticScore != null
              ? ` ${Math.round(item.semanticScore * 100)}%`
              : item.retrieval === "keyword" && item.keywordScore != null
                ? ` ${item.keywordScore.toFixed(2)}`
                : "";
        return (
          <button
            key={item.chunkId ?? `${item.sourceType}-${item.year}-${item.title ?? ""}-${item.excerpt.slice(0, 40)}`}
            className="workspace-reference-item"
            onClick={() => {
              posthog?.capture("source_clicked", { source_type: item.sourceType, year: item.year, retrieval: item.retrieval });
              onOpen(item.sourceType, item.year, item.excerpt, item.title, item.chunkId, item.excerptZh);
            }}
          >
            <div className="workspace-reference-meta">
              <span>{item.year} 年{getSourceTypeLabel(item.sourceType)}</span>
              {retrievalLabel && (
                <span className="source-retrieval-tag">{retrievalLabel}{scoreLabel}</span>
              )}
            </div>
            {item.title ? <h4 className="workspace-reference-title">{item.title}</h4> : null}
            <p className="workspace-reference-excerpt">{item.excerptZh || item.excerpt}</p>
          </button>
        );
      })}
    </div>
  );
}
