"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BtLogoMark } from "@/components/BtLogoMark";
import DarkModeToggle from './DarkModeToggle';

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const hideOnImmersivePages =
    pathname === "/" ||
    pathname.startsWith("/idea") ||
    pathname.startsWith("/letters/");

  useEffect(() => {
    document.body.classList.toggle("layout-no-header", hideOnImmersivePages);
    return () => {
      document.body.classList.remove("layout-no-header");
    };
  }, [hideOnImmersivePages]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (hideOnImmersivePages) {
    return null;
  }

  return (
    <header className="header">
      <div className="container header-content">
        <Link href="/" className="logo">
          <BtLogoMark className="logo-mark" />
          Talk with Buffett
        </Link>
        <div className="nav-actions">
          <DarkModeToggle />
          {session ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-menu-trigger"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="user-name">{session.user?.name || session.user?.email}</span>
              </button>
              {menuOpen ? (
                <div className="user-menu-dropdown" role="menu">
                  <button onClick={() => signOut()} className="user-menu-item user-menu-logout" role="menuitem">
                    退出登录
                  </button>
                </div>
              ) : null}
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
