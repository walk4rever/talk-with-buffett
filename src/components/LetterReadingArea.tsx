"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DualColumnReader } from "./DualColumnReader";
import { SingleColumnReader } from "./SingleColumnReader";
import { ChatDrawer } from "./ChatDrawer";

type ReadingMode = "dual" | "en" | "zh";

interface Section {
  id: string;
  order: number;
  contentEn: string;
  contentZh: string | null;
  hasTable?: boolean;
  tableData?: string | null;
}

interface LetterReadingAreaProps {
  year: number;
  sections: Section[];
  isPaid: boolean;
}

const FONT_SIZES = [14, 15, 16, 17, 18, 20];
const LINE_HEIGHTS = [1.5, 1.65, 1.8, 2.0, 2.2];

const DEFAULT_FONT = 2;      // index → 16px
const DEFAULT_LINE = 2;      // index → 1.8

export function LetterReadingArea({ year, sections }: LetterReadingAreaProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fontIdx, setFontIdx] = useState(DEFAULT_FONT);
  const [lineIdx, setLineIdx] = useState(DEFAULT_LINE);
  const [readingMode, setReadingMode] = useState<ReadingMode>("dual");

  // Restore from localStorage on mount
  useEffect(() => {
    const f = localStorage.getItem("reader-font-idx");
    const l = localStorage.getItem("reader-line-idx");
    const m = localStorage.getItem("reader-mode");
    if (f !== null) setFontIdx(Number(f));
    if (l !== null) setLineIdx(Number(l));
    if (m !== null) setReadingMode(m as ReadingMode);
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

  return (
    <>
      {/* Sticky bar */}
      <div className="letter-bar">
        <Link href="/" className="back-link">← 返回</Link>
        <span className="letter-bar-title">{year} 致股东信</span>
        <span className="letter-bar-meta">{sections.length} 段</span>

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

          {/* Reading mode */}
          <div className="reader-ctrl-group reader-mode-group" title="阅读模式">
            <button
              className={`reader-mode-btn${readingMode === "dual" ? " reader-mode-btn--active" : ""}`}
              onClick={() => changeReadingMode("dual")}
            >
              双栏
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

      {/* Column labels */}
      {readingMode === "dual" && (
        <div className="reading-columns-header">
          <span>英文原文</span>
          <span>中文译文</span>
        </div>
      )}

      {/* Reader */}
      {readingMode === "dual" ? (
        <DualColumnReader
          sections={sections}
          fontSize={FONT_SIZES[fontIdx]}
          lineHeight={LINE_HEIGHTS[lineIdx]}
        />
      ) : (
        <SingleColumnReader
          sections={sections}
          language={readingMode}
          fontSize={FONT_SIZES[fontIdx]}
          lineHeight={LINE_HEIGHTS[lineIdx]}
        />
      )}

      {/* FAB */}
      <button
        className={`chat-fab${drawerOpen ? " chat-fab--active" : ""}`}
        onClick={() => setDrawerOpen((v) => !v)}
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

      <ChatDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
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
