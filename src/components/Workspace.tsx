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
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WaitlistModal } from "@/components/WaitlistModal";
import {
  type ChatMessage,
  type ChatSource,
  streamChatAPI,
  getSourceTypeLabel,
} from "@/lib/chat";

const STARTERS = [
  "护城河这个概念，你怎么理解？",
  "1999年网络泡沫时你是怎么想的？",
  "什么样的生意你永远不会买？",
  "你怎么看现在的 AI 公司？",
];

const WORKSPACE_CHAT_TRANSFER_KEY = "workspace-chat-transfer-v1";

type ReadingMode = "all" | "en" | "zh";

interface CanvasContent {
  type: string;
  year: number;
  title: string;
  contentMd: string;
  videoUrl?: string | null;
  videoSource?: string | null;
}

interface ReferenceItem extends ChatSource {
  key: string;
  firstSeenTurn: number;
  seenCount: number;
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
let cachedTransfer:
  | { messages: ChatMessage[]; refs: ReferenceItem[]; turns: number }
  | null
  | undefined;

function canvasKey(type: string, year: number) {
  return `${type}:${year}`;
}

function sourceKey(source: ChatSource) {
  return `${source.sourceType}|${source.year}|${source.title ?? ""}|${source.excerpt}`;
}

function upsertReferences(prev: ReferenceItem[], incoming: ChatSource[], turn: number): ReferenceItem[] {
  const map = new Map(prev.map((r) => [r.key, r]));

  for (const source of incoming) {
    const key = sourceKey(source);
    const existing = map.get(key);
    if (existing) {
      map.set(key, { ...existing, seenCount: existing.seenCount + 1 });
    } else {
      map.set(key, {
        ...source,
        key,
        firstSeenTurn: turn,
        seenCount: 1,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.firstSeenTurn !== a.firstSeenTurn) return b.firstSeenTurn - a.firstSeenTurn;
    return b.seenCount - a.seenCount;
  });
}

function collectReferencesFromMessages(restored: ChatMessage[]): { refs: ReferenceItem[]; turns: number } {
  let refs: ReferenceItem[] = [];
  let turns = 0;

  for (const msg of restored) {
    if (msg.role === "assistant" && msg.sources && msg.sources.length > 0) {
      turns += 1;
      refs = upsertReferences(refs, msg.sources, turns);
    }
  }

  return { refs, turns };
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

    const { refs, turns } = collectReferencesFromMessages(restored);
    cachedTransfer = { messages: restored, refs, turns };
    return cachedTransfer;
  } catch {
    cachedTransfer = null;
    return cachedTransfer;
  }
}

function getInitialReadingMode(): ReadingMode {
  if (typeof window === "undefined") return "all";
  const saved = window.localStorage.getItem("reader-mode");
  if (saved === "all" || saved === "en" || saved === "zh") return saved;
  return "all";
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

export function Workspace() {
  const params = useSearchParams();
  const router = useRouter();

  const canvasType = params.get("source") ?? "";
  const canvasYear = parseInt(params.get("year") ?? "0", 10);
  const hasReader = !!canvasType && canvasYear > 0;

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const restored = readTransferFromSessionStorage();
    return restored?.messages ?? [];
  });
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>(() => {
    const restored = readTransferFromSessionStorage();
    return restored?.refs ?? [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [readingMode, setReadingMode] = useState<ReadingMode>(getInitialReadingMode);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");
  const turnSeqRef = useRef(readTransferFromSessionStorage()?.turns ?? 0);

  const [canvasContent, setCanvasContent] = useState<CanvasContent | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const prevReaderKeyRef = useRef<string>("");

  const [mobilePanel, setMobilePanel] = useState<"chat" | "canvas">(
    hasReader ? "canvas" : "chat",
  );

  const filteredCanvasContent = useMemo(() => {
    if (!canvasContent?.contentMd) return "";
    return filterByLanguage(stripHeader(canvasContent.contentMd), readingMode);
  }, [canvasContent, readingMode]);
  const readerMarkdownComponents = useMemo(
    () => createReaderMarkdownComponents(readingMode),
    [readingMode],
  );

  const canvasLoading =
    hasReader &&
    (!canvasContent || canvasContent.type !== canvasType || canvasContent.year !== canvasYear);

  useEffect(() => {
    sessionStorage.removeItem(WORKSPACE_CHAT_TRANSFER_KEY);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

        requestAnimationFrame(() => {
          const savedPos = scrollPositions.get(key);
          if (savedPos && canvasScrollRef.current) {
            canvasScrollRef.current.scrollTop = savedPos;
          } else if (canvasScrollRef.current) {
            canvasScrollRef.current.scrollTop = 0;
          }
        });
      })
      .catch(() => {
        if (!cancelled) setCanvasContent(null);
      });

    return () => {
      cancelled = true;
    };
  }, [hasReader, canvasType, canvasYear]);

  const openReader = useCallback(
    (type: string, year: number) => {
      router.push(`/workspace?source=${type}&year=${year}`, { scroll: false });
      setMobilePanel("canvas");
    },
    [router],
  );

  const closeReader = useCallback(() => {
    if (hasReader && canvasScrollRef.current) {
      scrollPositions.set(canvasKey(canvasType, canvasYear), canvasScrollRef.current.scrollTop);
    }
    router.push("/workspace", { scroll: false });
    setMobilePanel("canvas");
  }, [router, hasReader, canvasType, canvasYear]);

  function changeReadingMode(mode: ReadingMode) {
    setReadingMode(mode);
    localStorage.setItem("reader-mode", mode);
  }

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);
      streamingTextRef.current = "";

      const placeholderMsg: ChatMessage = { role: "assistant", content: "", streaming: true };
      setMessages((prev) => [...prev, placeholderMsg]);

      const allMessages = [...messages, userMsg];

      await streamChatAPI(
        allMessages,
        (delta) => {
          streamingTextRef.current += delta;
          const currentText = streamingTextRef.current;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: currentText,
            };
            return updated;
          });
        },
        (sources) => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              sources,
              streaming: false,
            };
            return updated;
          });

          if (sources.length > 0) {
            turnSeqRef.current += 1;
            const turn = turnSeqRef.current;
            setReferenceItems((prev) => upsertReferences(prev, sources, turn));
          }

          setLoading(false);
        },
        (errorMsg) => {
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
      );
    },
    [messages, loading],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="workspace workspace--split">
      <div className={`workspace-chat${mobilePanel !== "chat" ? " workspace-panel--hidden-mobile" : ""}`}>
        <div className="workspace-chat-header">
          <Link href="/" className="chat-back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回
          </Link>
          <span className="workspace-chat-title">与巴菲特对话</span>
          <button
            className="workspace-mobile-toggle"
            onClick={() => setMobilePanel("canvas")}
          >
            相关原文
          </button>
        </div>

        <div className="workspace-chat-body">
          {messages.length === 0 ? (
            <div className="empty-chat">
              <Image src="/buffett-avarta.png" alt="Warren Buffett" className="empty-chat-avatar" width={120} height={120} />
              <h2 className="empty-chat-title">与巴菲特对话</h2>
              <p className="empty-chat-sub">
                基于 1957–2025 年全部合伙人/股东信 · 相关原文会自动出现在右侧
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
                <WorkspaceMessage key={i} msg={msg} />
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
              placeholder="问巴菲特任何关于投资的问题…"
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
          <p className="chat-disclaimer">
            回答基于巴菲特公开的信件、文章与演讲，仅供学习参考。
          </p>
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
              : "相关原文"}
          </span>
          {hasReader ? (
            <button className="workspace-canvas-close" onClick={closeReader} aria-label="关闭">
              关闭
            </button>
          ) : (
            <span className="workspace-canvas-count">{referenceItems.length} 条</span>
          )}
        </div>

        <div className="workspace-canvas-body" ref={canvasScrollRef}>
          {hasReader ? (
            canvasLoading ? (
              <div className="workspace-canvas-loading">加载中…</div>
            ) : canvasContent ? (
              <>
                <div className="workspace-reader-toolbar">
                  <div className="reader-mode-group" title="阅读模式">
                    <button
                      className={`reader-mode-btn${readingMode === "all" ? " reader-mode-btn--active" : ""}`}
                      onClick={() => changeReadingMode("all")}
                    >
                      中英
                    </button>
                    <button
                      className={`reader-mode-btn${readingMode === "en" ? " reader-mode-btn--active" : ""}`}
                      onClick={() => changeReadingMode("en")}
                    >
                      EN
                    </button>
                    <button
                      className={`reader-mode-btn${readingMode === "zh" ? " reader-mode-btn--active" : ""}`}
                      onClick={() => changeReadingMode("zh")}
                    >
                      中文
                    </button>
                  </div>
                </div>
                <div className="md-reader md-reader--canvas" style={{ fontSize: 16, lineHeight: 1.8 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={readerMarkdownComponents}>
                    {filteredCanvasContent}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="workspace-canvas-loading">未找到内容</div>
            )
          ) : (
            <ReferenceList items={referenceItems} onOpen={openReader} />
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceMessage({ msg }: { msg: ChatMessage }) {
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
        <Image src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" width={34} height={34} />
        <div className="msg-body">
          <p className="msg-text">{limitMsg}</p>
          <WaitlistModal
            source="chat_limit"
            title="解锁无限对话"
            desc="留下邮箱或微信，付费版上线时第一时间通知你。"
            trigger={
              <button className="waitlist-btn waitlist-btn--inline">我想要更多 →</button>
            }
          />
        </div>
      </div>
    );
  }

  if (msg.streaming && !msg.content) {
    return (
      <div className="msg msg--assistant">
        <Image src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" width={34} height={34} />
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
      <Image src="/buffett-avarta.png" alt="Buffett" className="msg-avatar" width={34} height={34} />
      <div className="msg-body">
        <div className="msg-text msg-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={messageMarkdownComponents}>
            {msg.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function ReferenceList({
  items,
  onOpen,
}: {
  items: ReferenceItem[];
  onOpen: (type: string, year: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="workspace-reference-empty">
        <p>对话开始后，相关原文会自动汇总在这里。</p>
      </div>
    );
  }

  return (
    <div className="workspace-reference-list">
      {items.map((item) => (
        <button
          key={item.key}
          className="workspace-reference-item"
          onClick={() => onOpen(item.sourceType, item.year)}
        >
          <div className="workspace-reference-meta">
            <span>{item.year} 年{getSourceTypeLabel(item.sourceType)}</span>
            {item.seenCount > 1 ? <span>出现 {item.seenCount} 次</span> : <span>首次引用</span>}
          </div>
          {item.title ? <h4 className="workspace-reference-title">{item.title}</h4> : null}
          <p className="workspace-reference-excerpt">{item.excerpt}</p>
        </button>
      ))}
    </div>
  );
}
