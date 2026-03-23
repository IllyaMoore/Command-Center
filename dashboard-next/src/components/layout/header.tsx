"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTheme } from "@/lib/theme";
import { useIntegrations } from "@/lib/use-integrations";
import { CalendarPanel } from "@/components/calendar/calendar-panel";

export function Header({
  onBrainToggle,
  brainOpen,
}: {
  onBrainToggle?: () => void;
  brainOpen?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const { integrations, loading: integrationsLoading, connect } = useIntegrations();

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const connectedCount = integrations.filter((i) => i.status === "connected").length;

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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

        {/* Calendar toggle */}
        <div className="relative" ref={calendarRef}>
          <button
            onClick={() => setCalendarOpen((prev) => !prev)}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              calendarOpen
                ? "bg-primary/10 text-primary"
                : "text-text-secondary hover:bg-surface-2"
            }`}
            aria-label="Calendar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <CalendarPanel
            open={calendarOpen}
            onClose={() => setCalendarOpen(false)}
            containerRef={calendarRef}
          />
        </div>

        {/* Brain toggle */}
        {onBrainToggle && (
          <button
            onClick={onBrainToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-mono transition-colors cursor-pointer ${
              brainOpen
                ? "bg-primary/10 text-primary"
                : "text-text-secondary hover:bg-surface-2"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.5.5 2.9 1.3 4L12 22l6.7-10.5c.8-1.1 1.3-2.5 1.3-4A5.5 5.5 0 0 0 14.5 2 5.5 5.5 0 0 0 12 2.8 5.5 5.5 0 0 0 9.5 2z" />
            </svg>
            Brain
          </button>
        )}

        {/* Plug menu — global integrations */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="p-2 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors cursor-pointer relative"
            aria-label="Integrations"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v5" />
              <path d="M6 7h12l-1 9H7L6 7z" />
              <path d="M9 2v3" />
              <path d="M15 2v3" />
              <path d="M12 16v6" />
            </svg>
            {/* Status dot */}
            {!integrationsLoading && connectedCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-signal-success rounded-full" />
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-11 z-20 w-72 bg-surface-1 border border-surface-border rounded-xl shadow-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-border">
                <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
                  Integrations
                </span>
              </div>
              <div className="p-2">
                {integrationsLoading ? (
                  <p className="px-3 py-2 text-xs text-text-muted">Loading…</p>
                ) : (
                  integrations.map((integration) => {
                    const isConnected = integration.status === "connected";
                    const canConnect = ["expired", "missing_tokens", "check_failed"].includes(
                      integration.status,
                    );
                    const isNotConfigured = integration.status === "not_configured";

                    return (
                      <div
                        key={integration.name}
                        className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isConnected
                                ? "bg-signal-success"
                                : integration.status === "expired" ||
                                    integration.status === "check_failed"
                                  ? "bg-signal-warning"
                                  : "bg-surface-border"
                            }`}
                          />
                          <span className="text-xs font-mono text-text-primary">
                            {integration.displayName}
                          </span>
                        </div>
                        {isConnected ? (
                          <span className="text-[10px] font-mono text-signal-success">
                            Connected
                          </span>
                        ) : isNotConfigured ? (
                          <span className="text-[10px] font-mono text-text-muted">
                            Not configured
                          </span>
                        ) : canConnect ? (
                          <button
                            onClick={() => {
                              connect(integration);
                              setMenuOpen(false);
                            }}
                            className="px-2.5 py-1 text-[10px] font-mono font-medium text-primary bg-primary/10 rounded-md hover:bg-primary/20 transition-colors cursor-pointer"
                          >
                            {integration.status === "expired" ||
                            integration.status === "check_failed"
                              ? "Reconnect"
                              : "Connect"}
                          </button>
                        ) : (
                          <span className="text-[10px] font-mono text-signal-error">Error</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
