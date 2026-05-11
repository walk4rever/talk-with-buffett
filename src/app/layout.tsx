import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "巴菲特部落 · Buffett Tribe",
  description: "追踪顶级价值投资人的信件与持仓 — 他们说了什么，他们怎么做的。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <ErrorBoundary>
            <main>
              {children}
            </main>
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
