"use client";

import { useRouter } from "next/navigation";

export function HomeModeSelect() {
  const router = useRouter();

  return (
    <div className="home-select">
      {/* Illustrative chat preview */}
      <div className="home-preview">
        <div className="home-preview-msg home-preview-msg--user">
          你怎么看现在的 AI 公司？
        </div>
        <div className="home-preview-msg home-preview-msg--assistant">
          <img
            src="/buffett-avarta.png"
            alt="Buffett"
            className="home-preview-avatar"
          />
          <div className="home-preview-body">
            <p>
              我一直有个规则：不投资我不懂的东西。AI
              让我想起了1999年——每个人都说这次不一样。
            </p>
            <div className="home-preview-citation">
              <span className="home-preview-citation-dot" />
              1999 年股东信
            </div>
          </div>
        </div>
      </div>

      {/* Mode selection */}
      <p className="home-select-label">选择对话方式</p>
      <div className="home-mode-cards">
        <button
          className="home-mode-card"
          onClick={() => router.push("/chat?mode=text")}
        >
          <span className="home-mode-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="3" y="5" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M8 10h12M8 14h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </span>
          <span className="home-mode-name">文字对话</span>
          <span className="home-mode-desc">引用原文，随时可查</span>
          <span className="home-mode-cta">开始对话 →</span>
        </button>

        <button
          className="home-mode-card home-mode-card--premium"
          onClick={() => router.push("/chat?mode=avatar")}
        >
          <span className="home-mode-badge">✦ 增值</span>
          <span className="home-mode-icon">
            <img
              src="/buffett-avarta.png"
              alt="数字人"
              className="home-mode-avatar-img"
            />
          </span>
          <span className="home-mode-name">数字人对话</span>
          <span className="home-mode-desc">视频 + 声音，沉浸式体验</span>
          <span className="home-mode-cta">体验预览 →</span>
        </button>
      </div>
    </div>
  );
}
