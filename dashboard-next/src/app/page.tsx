"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { FleetSidebar } from "@/components/layout/fleet-sidebar";
import { ChatPanel } from "@/components/layout/chat-panel";
import { SettingsSidebar } from "@/components/layout/settings-sidebar";
import { AgentStoreProvider, useAgentStore } from "@/lib/agent-store";
import { AgentsProvider, useAgents } from "@/lib/use-agents";
import { deleteAgent } from "@/lib/api";

type MobileTab = "agents" | "chat" | "settings";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export default function Home() {
  return (
    <AgentStoreProvider>
      <AgentsProvider>
        <HomeInner />
      </AgentsProvider>
    </AgentStoreProvider>
  );
}

function HomeInner() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const isMobile = useIsMobile();
  const { selectedAgent, selectAgent } = useAgentStore();
  const { refresh } = useAgents();

  const handleDeleteAgent = useCallback(async () => {
    if (!selectedAgent) return;
    await deleteAgent(selectedAgent.folder);
    const remaining = await refresh();
    if (remaining.length > 0) {
      selectAgent(remaining[0]);
    }
    setSettingsOpen(false);
  }, [selectedAgent, selectAgent, refresh]);

  // On mobile, hide panels not matching active tab via inline style.
  // On desktop (isMobile=false), these return undefined — no inline style, CSS classes rule.
  const hideOnMobile = (tab: MobileTab) =>
    isMobile && mobileTab !== tab ? { display: "none" as const } : undefined;

  return (
    <div className="h-full flex flex-col">
      <Header
        onBrainToggle={() => setSettingsOpen(!settingsOpen)}
        brainOpen={settingsOpen}
      />

      {/* Main workspace: 3-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Fleet sidebar - hidden on mobile via CSS, shown via inline style when agents tab */}
        <div
          className="hidden md:flex"
          style={isMobile && mobileTab === "agents" ? { display: "flex" } : undefined}
        >
          <FleetSidebar onAgentSelect={() => isMobile && setMobileTab("chat")} />
        </div>

        {/* Chat panel */}
        <div style={hideOnMobile("chat")} className="contents">
          <ChatPanel />
        </div>

        {/* Brain panel */}
        <div style={isMobile && mobileTab !== "settings" ? { display: "none" } : undefined}>
          <SettingsSidebar
            open={isMobile ? mobileTab === "settings" : settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
              if (isMobile) setMobileTab("chat");
            }}
            onDeleteAgent={handleDeleteAgent}
            style={isMobile ? { width: "100vw" } : undefined}
          />
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden flex items-center justify-around h-14 bg-surface-1 border-t border-surface-border shrink-0"
        style={!isMobile ? { display: "none" } : undefined}
      >
        {(["agents", "chat", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex flex-col items-center gap-0.5 min-w-[64px] min-h-[44px] justify-center cursor-pointer transition-colors ${
              mobileTab === tab ? "text-primary" : "text-text-muted"
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {tab === "agents" && (
                <>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </>
              )}
              {tab === "chat" && (
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              )}
              {tab === "settings" && (
                <>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </>
              )}
            </svg>
            <span className="text-[10px] font-mono capitalize">{tab}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
