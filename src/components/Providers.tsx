"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { PostHogProvider } from "./PostHogProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PostHogProvider>
      <SessionProvider>{children}</SessionProvider>
    </PostHogProvider>
  );
}
