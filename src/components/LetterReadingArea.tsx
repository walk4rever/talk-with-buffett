"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ReadingMode = "all" | "en" | "zh";

interface LetterReadingAreaProps {
  year: number;
  contentMd: string;
  sourceType?: string;
}

const FONT_SIZES = [14, 15, 16, 17, 18, 20];
const LINE_HEIGHTS = [1.5, 1.65, 1.8, 2.0, 2.2];

const DEFAULT_FONT = 2;      // index → 16px
const DEFAULT_LINE = 2;      // index → 1.8

// ── CJK detection ──────────────────────────────────────────────────────────

function isCJKLine(text: string): boolean {
  const stripped = text.replace(/^[\s\-\*\d\.\(\)（）\[\]·>#]+/, "");
  if (!stripped) return false;
  const code = stripped.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x303f)
  );
}

// ── Strip metadata header ──────────────────────────────────────────────────

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

// ── Filter markdown by language ────────────────────────────────────────────

function filterByLanguage(md: string, mode: ReadingMode): string {
  if (mode === "all") return md;

  const lines = md.split("\n");
  const result: string[] = [];
  let inTable = false;
  let tableIsTarget = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track table blocks — keep table with its header language
    if (trimmed.startsWith("|") || trimmed.match(/^---[\s|:]+/)) {
      if (!inTable) {
        inTable = true;
        // Table language determined by first cell content
        tableIsTarget = mode === "en" ? !isCJKLine(trimmed) : isCJKLine(trimmed);
      }
      if (tableIsTarget) result.push(line);
      continue;
    } else {
      inTable = false;
    }

    // Empty lines: keep for spacing
    if (!trimmed) {
      result.push(line);
      continue;
    }

    // Headings: keep for both (they often have both languages)
    if (trimmed.startsWith("#")) {
      if (mode === "en") {
        // Strip Chinese from heading like "# Insurance Operations 保险业务"
        const cleaned = trimmed.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, "").trim();
        result.push(cleaned);
      } else {
        // Keep Chinese part of heading, or full heading if no Chinese
        const zhMatch = trimmed.match(/([\u4e00-\u9fff][\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s·\-—]+)/);
        if (zhMatch) {
          const level = trimmed.match(/^#+/)?.[0] ?? "#";
          result.push(`${level} ${zhMatch[1].trim()}`);
        }
      }
      continue;
    }

    // Regular paragraphs: filter by language
    const isZh = isCJKLine(trimmed);
    if (mode === "en" && !isZh) result.push(line);
    if (mode === "zh" && isZh) result.push(line);
  }

  // Clean up excessive blank lines
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Component ──────────────────────────────────────────────────────────────

export function LetterReadingArea({ year, contentMd, sourceType = "shareholder" }: LetterReadingAreaProps) {
  const router = useRouter();
  const [fontIdx, setFontIdx] = useState(DEFAULT_FONT);
  const [lineIdx, setLineIdx] = useState(DEFAULT_LINE);
  const [readingMode, setReadingMode] = useState<ReadingMode>("all");

  // Restore from localStorage on mount
  useEffect(() => {
    const f = localStorage.getItem("reader-font-idx");
    const l = localStorage.getItem("reader-line-idx");
    const m = localStorage.getItem("reader-mode");
    if (f !== null) setFontIdx(Number(f));
    if (l !== null) setLineIdx(Number(l));
    if (m !== null && (m === "all" || m === "en" || m === "zh")) {
      setReadingMode(m);
    }
  }, []);

  function changeReadingMode(mode: ReadingMode) {
    setReadingMode(mode);
    localStorage.setItem("reader-mode", mode);
  }

  function changeFontIdx(next: number) {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, next));
    setFontIdx(clamped);
    localStorage.setItem("reader-font-idx", String(clamped));
  }

  function changeLineIdx(next: number) {
    const clamped = Math.max(0, Math.min(LINE_HEIGHTS.length - 1, next));
    setLineIdx(clamped);
    localStorage.setItem("reader-line-idx", String(clamped));
  }

  const body = useMemo(() => stripHeader(contentMd), [contentMd]);
  const filtered = useMemo(() => filterByLanguage(body, readingMode), [body, readingMode]);

  return (
    <>
      {/* Sticky bar */}
      <div className="letter-bar">
        <Link href="/" className="back-link">← 返回</Link>
        <span className="letter-bar-title">
          {year} {{ shareholder: "致股东信", partnership: "致合伙人信", annual_meeting: "股东大会", article: "文章", interview: "采访" }[sourceType] ?? sourceType}
        </span>

        {/* Reading mode — centered */}
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

        <div className="reader-controls">
          {/* Font size */}
          <div className="reader-ctrl-group" title="字体大小">
            <button
              className="reader-ctrl-btn"
              onClick={() => changeFontIdx(fontIdx - 1)}
              disabled={fontIdx === 0}
              aria-label="缩小字体"
            >
              A<sup>−</sup>
            </button>
            <span className="reader-ctrl-val">{FONT_SIZES[fontIdx]}px</span>
            <button
              className="reader-ctrl-btn"
              onClick={() => changeFontIdx(fontIdx + 1)}
              disabled={fontIdx === FONT_SIZES.length - 1}
              aria-label="放大字体"
            >
              A<sup>+</sup>
            </button>
          </div>

          <div className="reader-ctrl-sep" />

          {/* Line height */}
          <div className="reader-ctrl-group" title="行间距">
            <button
              className="reader-ctrl-btn"
              onClick={() => changeLineIdx(lineIdx - 1)}
              disabled={lineIdx === 0}
              aria-label="减小行距"
            >
              <LineHeightIcon tight />
            </button>
            <span className="reader-ctrl-val">{LINE_HEIGHTS[lineIdx].toFixed(1)}</span>
            <button
              className="reader-ctrl-btn"
              onClick={() => changeLineIdx(lineIdx + 1)}
              disabled={lineIdx === LINE_HEIGHTS.length - 1}
              aria-label="增大行距"
            >
              <LineHeightIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Markdown reader */}
      <div
        className="md-reader"
        style={{ fontSize: FONT_SIZES[fontIdx], lineHeight: LINE_HEIGHTS[lineIdx] }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{filtered}</ReactMarkdown>
      </div>

      {/* FAB → navigate to workspace with this source open */}
      <button
        className="chat-fab"
        onClick={() => router.push(`/workspace?source=${sourceType}&year=${year}`)}
        aria-label="与巴菲特对话"
        title="与巴菲特对话"
      >
        <span className="chat-fab-ring" />
        <img
          src="/buffett-avarta.png"
          alt="Warren Buffett"
          className="chat-fab-img"
        />
        <span className="chat-fab-label">问问他</span>
      </button>
    </>
  );
}

// Inline SVG icon for line height
function LineHeightIcon({ tight }: { tight?: boolean }) {
  const gap = tight ? 3 : 6;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="4" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4" y1={3 + gap} x2="12" y2={3 + gap} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4" y1={3 + gap * 2} x2="12" y2={3 + gap * 2} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
