"use client";

import { useRef, useState, useEffect } from "react";
import { ShareCard } from "./ShareCard";

interface ShareModalProps {
  question: string;
  answer: string;
  onClose: () => void;
}

export function ShareModal({ question, answer, onClose }: ShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "capturing" | "done" | "error">("idle");

  // Auto-capture on mount
  useEffect(() => {
    let cancelled = false;

    async function capture() {
      if (!cardRef.current) return;
      setStatus("capturing");
      try {
        // Dynamic import so html2canvas is not in the main bundle
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(cardRef.current, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#FFFDF8",
          logging: false,
        });
        if (!cancelled) {
          setImageUrl(canvas.toDataURL("image/jpeg", 0.92));
          setStatus("done");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    // Small delay so the card is fully rendered before capture
    const timer = setTimeout(capture, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <span>分享到朋友圈</span>
          <button className="share-modal-close" onClick={onClose} aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="share-modal-body">
          {/* Hidden card for html2canvas capture */}
          <div style={{ position: "absolute", left: -9999, top: 0, pointerEvents: "none" }}>
            <div ref={cardRef}>
              <ShareCard question={question} answer={answer} />
            </div>
          </div>

          {status === "capturing" && (
            <div className="share-modal-loading">
              <div className="share-modal-spinner" />
              <span>生成图片中…</span>
            </div>
          )}

          {status === "done" && imageUrl && (
            <>
              <div className="share-modal-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="分享卡片" className="share-modal-image" />
              </div>
              <p className="share-modal-hint">长按图片保存，分享到朋友圈</p>
            </>
          )}

          {status === "error" && (
            <p className="share-modal-error">图片生成失败，请稍后重试</p>
          )}
        </div>
      </div>
    </div>
  );
}
