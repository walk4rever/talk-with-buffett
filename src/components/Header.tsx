"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import DarkModeToggle from './DarkModeToggle';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="header">
      <div className="container header-content">
        <Link href="/" className="logo">
          Learn from Buffett
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
            <button onClick={() => signIn()} className="btn-primary">
              Login
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
