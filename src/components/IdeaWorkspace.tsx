"use client";

import {
  isValidElement,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { usePostHog } from "posthog-js/react";
import { WaitlistModal } from "@/components/WaitlistModal";
import { ShareModal } from "@/components/ShareModal";
import { IdeaHeader } from "@/components/IdeaHeader";
import {
  type ChatMessage,
  type ChatSource,
  streamChatAPI,
  getSourceTypeLabel,
} from "@/lib/chat";
import { getTribeMember } from "@/lib/tribe";
import { CompanyCanvas } from "@/components/CompanyCanvas";
import { POPART_MOCK, makeSkeletonCanvas } from "@/lib/canvas-mock";
import type { CanvasState } from "@/types/canvas";
import type { CompanyOverviewCard } from "@/types/canvas";

const STARTERS = [
  "护城河这个概念，你怎么理解？",
  "1999年网络泡沫时你是怎么想的？",
  "什么样的生意你永远不会买？",
  "你怎么看现在的 AI 公司？",
];

const WORKSPACE_CHAT_TRANSFER_KEY = "workspace-chat-transfer-v1";
const ANON_SESSION_KEY = "chat-anon-session-v1";

type ReadingMode = "all" | "en" | "zh";

interface CanvasContent {
  type: string;
  year: number;
  title: string;
  contentMd: string;
  videoUrl?: string | null;
  videoSource?: string | null;
}

const messageMarkdownComponents = {
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="msg-table-wrap">
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
};

const scrollPositions = new Map<string, number>();
let activeHighlightEl: Element | null = null;
let cachedTransfer:
  | { messages: ChatMessage[] }
  | null
  | undefined;

function canvasKey(type: string, year: number) {
  return `${type}:${year}`;
}

function readAnonSessionFromStorage(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(ANON_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ role: string; content: string; sources?: ChatSource[]; chatMessageId?: string; rating?: number }>;
    return parsed
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        sources: m.sources,
        chatMessageId: m.chatMessageId,
        rating: m.rating as 1 | -1 | undefined,
      }));
  } catch {
    return [];
  }
}

function readTransferFromSessionStorage() {
  if (cachedTransfer !== undefined) return cachedTransfer;
  if (typeof window === "undefined") {
    cachedTransfer = null;
    return cachedTransfer;
  }

  try {
    const raw = sessionStorage.getItem(WORKSPACE_CHAT_TRANSFER_KEY);
    if (!raw) {
      cachedTransfer = null;
      return cachedTransfer;
    }

    const parsed = JSON.parse(raw) as {
      messages?: Array<{ role: string; content: string; sources?: ChatSource[] }>;
    };

    const restored = (parsed.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        sources: m.sources,
      }));

    cachedTransfer = { messages: restored };
    return cachedTransfer;
  } catch {
    cachedTransfer = null;
    return cachedTransfer;
  }
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

function normalizeForMatch(text: string): string {
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
    if (text.includes(queryPrefix)) {
      return node.parentElement;
    }
  }
  return null;
}

function scrollToChunk(
  container: HTMLElement,
  title: string | null,
  excerptEn: string,
  excerptZh?: string,
) {
  // Strategy 1: match zh excerpt first in mixed/zh content, then fallback to en excerpt.
  // Excerpt match targets the exact paragraph, which is more precise than a section heading.
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

  // Strategy 2: fall back to heading match by title when excerpt match fails.
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

function stripHeader(md: string): string {
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

function filterByLanguage(md: string, mode: ReadingMode): string {
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

export function IdeaWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const posthog = usePostHog();
  const { data: session, status: sessionStatus } = useSession();

  const canvasType = params.get("source") ?? "";
  const canvasYear = parseInt(params.get("year") ?? "0", 10);
  const canvasExcerpt = params.get("q") ?? "";
  const canvasExcerptZh = params.get("qzh") ?? "";
  const canvasTitle = params.get("t") ?? "";
  const hasReader = !!canvasType && canvasYear > 0;
  const initialQuestion = params.get("ask") ?? "";
  const personId = "buffett";
  const person = getTribeMember("buffett");
  if (!person) {
    throw new Error("Missing default tribe member: buffett");
  }

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [storageRestored, setStorageRestored] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const readingMode: ReadingMode = "all";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");

  const [canvasContent, setCanvasContent] = useState<CanvasContent | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const prevReaderKeyRef = useRef<string>("");

  const [mobilePanel, setMobilePanel] = useState<"chat" | "canvas">(
    hasReader ? "canvas" : "chat",
  );
  const [shareData, setShareData] = useState<{ question: string; answer: string } | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasState>(() =>
    makeSkeletonCanvas("Apple", "AAPL", "us"),
  );

  // Canvas reader font / line-height controls (shared localStorage keys with LetterReadingArea)
  const CANVAS_FONT_SIZES = [14, 15, 16, 17, 18, 20];
  const CANVAS_LINE_HEIGHTS = [1.5, 1.65, 1.8, 2.0, 2.2];
  const [canvasFontIdx, setCanvasFontIdx] = useState(() => {
    if (typeof window === "undefined") return 2;
    const saved = window.localStorage.getItem("reader-font-idx");
    const parsed = Number(saved);
    if (!Number.isFinite(parsed)) return 2;
    return Math.max(0, Math.min(CANVAS_FONT_SIZES.length - 1, parsed));
  });
  const [canvasLineIdx, setCanvasLineIdx] = useState(() => {
    if (typeof window === "undefined") return 2;
    const saved = window.localStorage.getItem("reader-line-idx");
    const parsed = Number(saved);
    if (!Number.isFinite(parsed)) return 2;
    return Math.max(0, Math.min(CANVAS_LINE_HEIGHTS.length - 1, parsed));
  });
  function changeCanvasFontIdx(next: number) {
    const clamped = Math.max(0, Math.min(CANVAS_FONT_SIZES.length - 1, next));
    setCanvasFontIdx(clamped);
    localStorage.setItem("reader-font-idx", String(clamped));
  }
  function changeCanvasLineIdx(next: number) {
    const clamped = Math.max(0, Math.min(CANVAS_LINE_HEIGHTS.length - 1, next));
    setCanvasLineIdx(clamped);
    localStorage.setItem("reader-line-idx", String(clamped));
  }

  const filteredCanvasContent = useMemo(() => {
    if (!canvasContent?.contentMd) return "";
    const md = filterByLanguage(stripHeader(canvasContent.contentMd), readingMode);
    // Normalize non-standard </br> closing tags to <br/> for rehype-raw
    return md.replace(/<\/br>/gi, "<br/>");
  }, [canvasContent, readingMode]);
  const readerMarkdownComponents = useMemo(
    () => createReaderMarkdownComponents(readingMode),
    [readingMode],
  );

  const canvasLoading =
    hasReader &&
    (!canvasContent || canvasContent.type !== canvasType || canvasContent.year !== canvasYear);

  const canvasCompanyName = useMemo(() => {
    const overview = canvasState.cards.find((c) => c.type === "company_overview") as
      | CompanyOverviewCard | undefined;
    return overview?.name ?? null;
  }, [canvasState]);

  useEffect(() => {
    sessionStorage.removeItem(WORKSPACE_CHAT_TRANSFER_KEY);
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Restore client-side chat state only after hydration to avoid SSR/CSR mismatch.
  useEffect(() => {
    const transfer = readTransferFromSessionStorage();
    if (transfer?.messages.length) {
      setMessages(transfer.messages);
      setStorageRestored(true);
      return;
    }

    const anonMessages = readAnonSessionFromStorage();
    if (anonMessages.length > 0) {
      setMessages(anonMessages);
    }
    setStorageRestored(true);
  }, []);

  // Load chat history for authenticated users on mount.
  // Only runs once when session resolves; skips if messages already exist
  // (e.g. transferred from sessionStorage during in-page navigation).
  const historyLoadedRef = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    if (!storageRestored) return;
    if (sessionStatus === "loading") return;
    if (sessionStatus !== "authenticated" || !session?.user?.id) return;
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    if (messages.length > 0) return;

    setHistoryLoading(true);
    fetch("/api/chat/history")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages: ChatMessage[] } | null) => {
        if (data?.messages?.length) {
          setMessages(data.messages);
        }
      })
      .catch((err) => console.error("[history] failed to load:", err))
      .finally(() => setHistoryLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, session?.user?.id, storageRestored, messages.length]);

  // Persist messages to sessionStorage for anonymous users so navigation
  // away and back within the same tab restores the conversation.
  useEffect(() => {
    if (sessionStatus === "authenticated") return;
    if (messages.length === 0) return;
    try {
      sessionStorage.setItem(ANON_SESSION_KEY, JSON.stringify(messages));
    } catch {
      // Ignore storage quota errors
    }
  }, [messages, sessionStatus]);

  const sendRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    if (!storageRestored) return;
    if (initialQuestion && sendRef.current && messages.length === 0) {
      sendRef.current(initialQuestion);
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageRestored]);

  useEffect(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!hasReader) {
      return;
    }

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

        // Only handle non-excerpt scroll here (saved position / reset to top).
        // Excerpt scrolling is handled by a separate useEffect that runs after
        // React has committed the readingMode-filtered DOM.
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

  // Scroll to the cited excerpt after React commits the filtered DOM.
  // Must depend on canvasContent (new source loaded) AND the excerpt params.
  // Intentionally excludes readingMode: we don't want to re-scroll on mode toggle.
  useEffect(() => {
    if (!canvasContent || !canvasScrollRef.current) return;
    if (!canvasTitle && !canvasExcerpt && !canvasExcerptZh) return;
    scrollToChunk(canvasScrollRef.current, canvasTitle || null, canvasExcerpt, canvasExcerptZh);
  }, [canvasContent, canvasTitle, canvasExcerpt, canvasExcerptZh]);

  const closeReader = useCallback(() => {
    if (hasReader && canvasScrollRef.current) {
      scrollPositions.set(canvasKey(canvasType, canvasYear), canvasScrollRef.current.scrollTop);
    }
    router.push("/idea", { scroll: false });
    setMobilePanel("canvas");
  }, [router, hasReader, canvasType, canvasYear]);


  const loadCanvasForCompany = useCallback(
    async (ticker: string, name: string, market: 'us' | 'hk' | 'a') => {
      try {
        const url = `/api/canvas?ticker=${encodeURIComponent(ticker)}&name=${encodeURIComponent(name)}&market=${market}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json() as CanvasState;
        setCanvasState(data);
      } catch {
        // Leave skeleton in place on error
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      posthog?.capture("chat_sent", {
        message_length: trimmed.length,
        turn_count: messages.filter((m) => m.role === "user").length + 1,
      });

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const detected = detectAndInitCanvas(trimmed, setCanvasState);
      if (detected) {
        loadCanvasForCompany(detected.ticker, detected.name, detected.market);
      }
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);
      streamingTextRef.current = "";

      const placeholderMsg: ChatMessage = { role: "assistant", content: "", streaming: true, question: trimmed };
      setMessages((prev) => [...prev, placeholderMsg]);

      // Throttle streaming state updates to ~80ms to avoid per-token re-renders
      let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
      function flushStreamingText() {
        const currentText = streamingTextRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: currentText };
          return updated;
        });
        rafId = null;
      }

      await streamChatAPI(
        [...messages, userMsg],
        (delta) => {
          streamingTextRef.current += delta;
          if (!rafId) rafId = requestAnimationFrame(flushStreamingText);
        },
        (sources, chatMessageId) => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              sources,
              chatMessageId,
            };
            return updated;
          });
        },
        () => {
          // Flush any pending streaming text before marking done
          if (rafId) { cancelAnimationFrame(rafId); flushStreamingText(); }
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              streaming: false,
            };
            return updated;
          });
          setLoading(false);
        },
        (errorMsg) => {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: errorMsg,
              streaming: false,
            };
            return updated;
          });
          setLoading(false);
        },
        personId,
      );
    },
    [messages, loading, posthog, personId, loadCanvasForCompany],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  const handleRate = useCallback((chatMessageId: string, rating: 1 | -1) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.chatMessageId === chatMessageId ? { ...m, rating } : m,
      ),
    );
    fetch(`/api/chat/${chatMessageId}/rating`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    }).catch((err) => console.error("[rating] failed:", err));
  }, []);

  return (
    <>
    <div className="workspace workspace--split">
      <div className={`workspace-chat${mobilePanel !== "chat" ? " workspace-panel--hidden-mobile" : ""}`}>
        <IdeaHeader title="巴菲特部落" onOpenSide={() => setMobilePanel("canvas")} />

        <div className="workspace-chat-body" ref={chatBodyRef}>
          {historyLoading ? (
            <div className="history-loading">
              <div className="history-loading-spinner" />
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-chat">
              <div className="empty-chat-avatar empty-chat-avatar--initials" style={{ background: person.color }}>
                {person.initials.slice(0, 2)}
              </div>
              <h2 className="empty-chat-title">{person.nameZh}</h2>
              <p className="empty-chat-sub">
                {person.hasData
                  ? "基于 1958–2025 年全部合伙人/股东信 · 提到公司名研究画布会自动更新"
                  : `${person.nameZh}的资料正在整理中，敬请期待`}
              </p>
              <div className="starter-grid">
                {STARTERS.map((s) => (
                  <button key={s} className="starter-chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((msg, i) => (
                <WorkspaceMessage
                  key={i}
                  msg={msg}
                  onOpenSources={() => setMobilePanel("canvas")}
                  onRate={handleRate}
                  onShare={(question, answer) => setShareData({ question, answer })}
                  isAuthenticated={sessionStatus === "authenticated"}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="chat-input-wrap">
          <form className="chat-input-bar" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              type="text"
              placeholder={`问${person.nameZh}任何关于投资的问题…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <button
              className="chat-send-btn"
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="发送"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      <div className={`workspace-canvas${mobilePanel !== "canvas" ? " workspace-panel--hidden-mobile" : ""}`}>
        <div className="workspace-canvas-header">
          <button
            className="workspace-mobile-toggle"
            onClick={() => setMobilePanel("chat")}
          >
            ← 对话
          </button>
          <span className="workspace-canvas-title">
            {hasReader
              ? (canvasContent
                ? `${canvasContent.year} ${getSourceTypeLabel(canvasContent.type)}`
                : "加载中…")
              : (canvasCompanyName ?? "研究画布")}
          </span>
          {hasReader ? (
            <button className="workspace-canvas-close" onClick={closeReader} aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <span style={{ width: 40 }} />
          )}
        </div>

        <div className="workspace-canvas-body" ref={canvasScrollRef}>
          {hasReader ? (
            canvasLoading ? (
              <div className="workspace-canvas-loading">加载中…</div>
            ) : canvasContent ? (
              <>
                {/* Canvas reading controls */}
                <div className="canvas-reader-controls">
                  <div className="reader-ctrl-group" title="字体大小">
                    <button
                      className="reader-ctrl-btn"
                      onClick={() => changeCanvasFontIdx(canvasFontIdx - 1)}
                      disabled={canvasFontIdx === 0}
                      aria-label="缩小字体"
                    >
                      A<sup>−</sup>
                    </button>
                    <span className="reader-ctrl-val">{CANVAS_FONT_SIZES[canvasFontIdx]}px</span>
                    <button
                      className="reader-ctrl-btn"
                      onClick={() => changeCanvasFontIdx(canvasFontIdx + 1)}
                      disabled={canvasFontIdx === CANVAS_FONT_SIZES.length - 1}
                      aria-label="放大字体"
                    >
                      A<sup>+</sup>
                    </button>
                  </div>
                  <div className="reader-ctrl-sep" />
                  <div className="reader-ctrl-group" title="行间距">
                    <button
                      className="reader-ctrl-btn"
                      onClick={() => changeCanvasLineIdx(canvasLineIdx - 1)}
                      disabled={canvasLineIdx === 0}
                      aria-label="减小行距"
                    >
                      <CanvasLineHeightIcon tight />
                    </button>
                    <span className="reader-ctrl-val">{CANVAS_LINE_HEIGHTS[canvasLineIdx].toFixed(1)}</span>
                    <button
                      className="reader-ctrl-btn"
                      onClick={() => changeCanvasLineIdx(canvasLineIdx + 1)}
                      disabled={canvasLineIdx === CANVAS_LINE_HEIGHTS.length - 1}
                      aria-label="增大行距"
                    >
                      <CanvasLineHeightIcon />
                    </button>
                  </div>
                </div>
                <div
                  className="md-reader md-reader--canvas"
                  style={{ fontSize: CANVAS_FONT_SIZES[canvasFontIdx], lineHeight: CANVAS_LINE_HEIGHTS[canvasLineIdx] }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={readerMarkdownComponents}>
                    {filteredCanvasContent}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="workspace-canvas-loading">未找到内容</div>
            )
          ) : (
            <CompanyCanvas state={canvasState} />
          )}

        </div>
      </div>
    </div>
    {shareData && (
      <ShareModal
        question={shareData.question}
        answer={shareData.answer}
        onClose={() => setShareData(null)}
      />
    )}
    </>
  );
}

function WorkspaceMessage({
  msg,
  onOpenSources,
  onRate,
  onShare,
  isAuthenticated,
}: {
  msg: ChatMessage;
  onOpenSources: () => void;
  onRate: (chatMessageId: string, rating: 1 | -1) => void;
  onShare: (question: string, answer: string) => void;
  isAuthenticated: boolean;
}) {
  const openSources = () => onOpenSources();

  if (msg.role === "user") {
    return (
      <div className="msg msg--user">
        <p className="msg-text">{msg.content}</p>
      </div>
    );
  }

  if (msg.content.startsWith("__LIMIT__")) {
    const limitMsg = msg.content.slice(9);
    return (
      <div className="msg msg--assistant">
        <Image src="/buffett-avarta.jpg" alt="Buffett" className="msg-avatar" width={34} height={34} />
        <div className="msg-body">
          <p className="msg-text">{limitMsg}</p>
          {isAuthenticated ? (
            <WaitlistModal
              source="chat_limit"
              title="解锁无限对话"
              desc="留下邮箱或微信，付费版上线时第一时间通知你。"
              trigger={
                <button className="waitlist-btn waitlist-btn--inline">我想要更多 →</button>
              }
            />
          ) : (
            <a href="/login" className="waitlist-btn waitlist-btn--inline">
              注册免费账号 →
            </a>
          )}
        </div>
      </div>
    );
  }

  if (msg.streaming && !msg.content) {
    return (
      <div className="msg msg--assistant">
        <Image src="/buffett-avarta.jpg" alt="Buffett" className="msg-avatar" width={34} height={34} />
        <div className="msg-body">
          <div className="thinking-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg--assistant">
      <Image src="/buffett-avarta.jpg" alt="Buffett" className="msg-avatar" width={34} height={34} />
      <div className="msg-body">
        <div className="msg-text msg-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={messageMarkdownComponents}>
            {msg.content}
          </ReactMarkdown>
        </div>
        <div className="workspace-msg-footer">
          {msg.sources && msg.sources.length > 0 ? (
            <button
              type="button"
              className="workspace-source-chip"
              onClick={openSources}
              aria-label={`${msg.sources.length} sources`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3.5h10M3 8h10M3 12.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>{msg.sources.length} sources</span>
            </button>
          ) : null}
          {msg.chatMessageId && !msg.streaming ? (
            <div className="msg-rating">
              <button
                type="button"
                className="msg-rating-btn msg-share-btn"
                aria-label="分享"
                onClick={() => onShare(msg.question ?? "", msg.content)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.8"/>
                  <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/>
                  <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.8"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
              <button
                type="button"
                className={`msg-rating-btn${msg.rating === 1 ? " msg-rating-btn--active" : ""}`}
                aria-label="thumbs up"
                onClick={() => onRate(msg.chatMessageId!, 1)}
              >
                👍
              </button>
              <button
                type="button"
                className={`msg-rating-btn${msg.rating === -1 ? " msg-rating-btn--active" : ""}`}
                aria-label="thumbs down"
                onClick={() => onRate(msg.chatMessageId!, -1)}
              >
                👎
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


type CompanyPattern = { regex: RegExp; name: string; ticker: string; market: 'us' | 'hk' | 'a' };

const COMPANY_PATTERNS: CompanyPattern[] = [
  { regex: /泡泡玛特|pop\s*mart/i,         name: '泡泡玛特', ticker: '09992.HK', market: 'hk' },
  { regex: /比亚迪|byd/i,                  name: '比亚迪',   ticker: '002594',  market: 'a'  },
  { regex: /苹果|apple|aapl/i,             name: 'Apple',    ticker: 'AAPL',    market: 'us' },
  { regex: /腾讯|tencent/i,                name: '腾讯',     ticker: '00700.HK', market: 'hk' },
  { regex: /茅台|kweichow/i,               name: '贵州茅台', ticker: '600519',  market: 'a'  },
  { regex: /亚马逊|amazon|amzn/i,          name: 'Amazon',   ticker: 'AMZN',    market: 'us' },
  { regex: /谷歌|google|alphabet|googl/i,  name: 'Alphabet', ticker: 'GOOGL',   market: 'us' },
  { regex: /微软|microsoft|msft/i,         name: 'Microsoft',ticker: 'MSFT',    market: 'us' },
]

// Returns the matched company or null (POP MART uses mock data and skips fetch).
function detectAndInitCanvas(
  text: string,
  setCanvasState: (s: CanvasState) => void,
): { ticker: string; name: string; market: 'us' | 'hk' | 'a' } | null {
  for (const pattern of COMPANY_PATTERNS) {
    if (pattern.regex.test(text)) {
      if (pattern.name === '泡泡玛特') {
        setCanvasState(POPART_MOCK);
        return null;
      }
      setCanvasState(makeSkeletonCanvas(pattern.name, pattern.ticker, pattern.market));
      return { ticker: pattern.ticker, name: pattern.name, market: pattern.market };
    }
  }
  return null;
}

function CanvasLineHeightIcon({ tight }: { tight?: boolean }) {
  const gap = tight ? 3 : 6;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="4" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4" y1={3 + gap} x2="12" y2={3 + gap} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4" y1={3 + gap * 2} x2="12" y2={3 + gap * 2} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
