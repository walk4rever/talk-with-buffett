"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import DarkModeToggle from './DarkModeToggle';

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const hideOnImmersivePages =
    pathname.startsWith("/text/room") ||
    pathname.startsWith("/live/room") ||
    pathname.startsWith("/letters/");

  useEffect(() => {
    document.body.classList.toggle("layout-no-header", hideOnImmersivePages);
    return () => {
      document.body.classList.remove("layout-no-header");
    };
  }, [hideOnImmersivePages]);

  if (hideOnImmersivePages) {
    return null;
  }

  return (
    <header className="header">
      <div className="container header-content">
        <Link href="/" className="logo">
          Talk with Buffett
        </Link>
        <div className="nav-actions">
          <DarkModeToggle />
          {session ? (
            <div className="user-menu">
              <span className="user-name">{session.user?.name || session.user?.email}</span>
              <button onClick={() => signOut()} className="btn-outline">
                Logout
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn-primary">
              登录 / 注册
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
