"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { FleetSidebar } from "@/components/layout/fleet-sidebar";
import { ChatPanel } from "@/components/layout/chat-panel";
import { SettingsSidebar } from "@/components/layout/settings-sidebar";
import { AgentStoreProvider } from "@/lib/agent-store";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <AgentStoreProvider>
      <div className="h-full flex flex-col">
        <Header
          onBrainToggle={() => setSettingsOpen(!settingsOpen)}
          brainOpen={settingsOpen}
        />

        {/* Main workspace: 3-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Fleet sidebar - hidden on mobile */}
          <div className="hidden md:flex">
            <FleetSidebar />
          </div>

          {/* Chat panel - always visible */}
          <ChatPanel />

          {/* Brain panel */}
          <SettingsSidebar
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden flex items-center justify-around h-14 bg-surface-1 border-t border-surface-border shrink-0">
          <button className="flex flex-col items-center gap-0.5 p-2 text-text-muted cursor-pointer">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="text-[10px] font-mono">Agents</span>
          </button>
          <button className="flex flex-col items-center gap-0.5 p-2 text-primary cursor-pointer">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-[10px] font-mono">Chat</span>
          </button>
          <button className="flex flex-col items-center gap-0.5 p-2 text-text-muted cursor-pointer">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="text-[10px] font-mono">Settings</span>
          </button>
        </nav>
      </div>
    </AgentStoreProvider>
  );
}
