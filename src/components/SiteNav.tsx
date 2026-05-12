"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { BtLogoMark } from "@/components/BtLogoMark";

export function SiteNav() {
  const { data: session } = useSession();

  return (
    <nav className="home-nav">
      <div className="home-nav-in">
        <Link href="/" className="home-nav-logo">
          <BtLogoMark />
          Buffett Tribe
        </Link>
        <div className="home-nav-right">
          {session ? (
            <span className="home-nav-link">{session.user?.email || session.user?.name || "已登录"}</span>
          ) : (
            <Link href="/login" className="home-nav-login">登录</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
