"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type RoomHeaderProps = {
  title: string;
  onOpenSide: () => void;
  sideLabel?: string;
  rightSlot?: ReactNode;
};

export function RoomHeader({
  title,
  onOpenSide,
  sideLabel = "原文",
  rightSlot,
}: RoomHeaderProps) {
  return (
    <div className="workspace-chat-header">
      <Link href="/" className="chat-back">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        返回
      </Link>
      <span className="workspace-chat-title workspace-chat-title--desktop">{title}</span>
      {rightSlot ?? (
        <button className="workspace-mobile-toggle" onClick={onOpenSide}>
          {sideLabel}
        </button>
      )}
    </div>
  );
}
