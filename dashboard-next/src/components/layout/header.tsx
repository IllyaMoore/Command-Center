"use client";

import Image from "next/image";
import { useTheme } from "@/lib/theme";

export function Header() {
  const { theme, toggle } = useTheme();

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-surface-1 border-b border-surface-border shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <Image src="/logo.svg" alt="NanoClaw" width={28} height={28} />
        <span className="font-display text-[17px] font-bold tracking-tight text-text-primary">
          NanoClaw Studio
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="p-2 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors cursor-pointer"
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
        </button>

        {/* Brain button placeholder */}
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-mono text-text-secondary hover:bg-surface-2 transition-colors cursor-pointer">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.5.5 2.9 1.3 4L12 22l6.7-10.5c.8-1.1 1.3-2.5 1.3-4A5.5 5.5 0 0 0 14.5 2 5.5 5.5 0 0 0 12 2.8 5.5 5.5 0 0 0 9.5 2z" />
          </svg>
          Brain
        </button>

        {/* Menu */}
        <button className="p-2 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors cursor-pointer">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
