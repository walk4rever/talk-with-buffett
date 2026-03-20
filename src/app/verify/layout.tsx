"use client";

import { useEffect } from "react";

export default function VerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // 隐藏全局 Header
    const header = document.querySelector("header");
    if (header) header.style.display = "none";
    
    // 移除 container 的宽度限制
    const container = document.querySelector("main");
    if (container) {
      (container as HTMLElement).style.maxWidth = "none";
      (container as HTMLElement).style.padding = "0";
      (container as HTMLElement).style.margin = "0";
      (container as HTMLElement).style.width = "100%";
    }
  }, []);

  return <>{children}</>;
}