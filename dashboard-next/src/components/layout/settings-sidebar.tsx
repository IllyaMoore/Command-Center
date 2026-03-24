"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/lib/agent-store";
import { useIntegrations } from "@/lib/use-integrations";

type Tab = "behavior" | "capabilities" | "automations" | "advanced";

const TABS: { id: Tab; label: string }[] = [
  { id: "behavior", label: "Behavior" },
  { id: "capabilities", label: "Capabilities" },
  { id: "automations", label: "Automations" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { selectedAgent } = useAgentStore();
  const [activeTab, setActiveTab] = useState<Tab>("capabilities");

  if (!selectedAgent) return null;

  return (
    <aside
      className={`bg-surface-1 border-l border-surface-border shrink-0 h-full flex flex-col overflow-hidden transition-all duration-200 ease-out ${
        open ? "w-[420px] opacity-100" : "w-0 opacity-0 pointer-events-none"
      }`}
    >
      {/* Header */}
      <div className="px-4 py-4 border-b border-surface-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Agent Inspector
            </div>
            <div className="font-mono text-sm font-semibold text-text-primary uppercase">
              {selectedAgent.name}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs font-mono text-text-secondary bg-surface-2 rounded-md hover:bg-surface-3 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Tab navigation */}
        <nav className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold tracking-wider uppercase rounded-md transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "bg-surface-1 text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "behavior" && <BehaviorTab />}
        {activeTab === "capabilities" && <CapabilitiesTab />}
        {activeTab === "automations" && <AutomationsTab />}
        {activeTab === "advanced" && <AdvancedTab />}
      </div>
    </aside>
  );
}

/* ── Behavior tab (placeholder) ── */
function BehaviorTab() {
  return (
    <section className="px-4 py-4">
      <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
        Personality
      </h3>
      <p className="text-xs text-text-muted mb-3">
        Edit this agent&apos;s CLAUDE.md to change its behavior, role, and instructions.
      </p>
      <div className="w-full h-48 bg-surface-2 border border-surface-border rounded-lg p-3 text-xs font-mono text-text-muted flex items-center justify-center">
        Coming soon
      </div>
    </section>
  );
}

/* ── Toggle Switch ── */
function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={disabled ? undefined : onToggle}
      className={`w-9 h-5 rounded-full relative transition-colors ${
        disabled ? "bg-surface-border cursor-not-allowed" : on ? "bg-primary cursor-pointer" : "bg-surface-border cursor-pointer"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
          on ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

/* ── Capabilities tab (implemented) ── */
function CapabilitiesTab() {
  const { integrations, loading, connect } = useIntegrations();
  const [execMode, setExecMode] = useState<"off" | "ask" | "auto">("ask");
  const [webAccess, setWebAccess] = useState(true);
  const [fileTools, setFileTools] = useState(true);

  const execDescriptions = {
    off: "Agent cannot execute commands",
    ask: "Requires approval for each command",
    auto: "Commands execute automatically",
  };

  return (
    <div>
      {/* MCP Integrations */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          MCP Integrations
        </h3>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-surface-2 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {integrations.map((integration) => {
              const isConnected = integration.status === "connected";
              const canConnect = ["expired", "missing_tokens", "check_failed"].includes(
                integration.status,
              );
              const isNotConfigured = integration.status === "not_configured";

              return (
                <div
                  key={integration.name}
                  className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isConnected
                          ? "bg-signal-success"
                          : canConnect
                            ? "bg-signal-warning"
                            : "bg-surface-border"
                      }`}
                    />
                    <div>
                      <span className="text-xs font-mono text-text-primary block">
                        {integration.displayName}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted">
                        {isConnected
                          ? "Connected"
                          : isNotConfigured
                            ? "Credentials not configured"
                            : integration.status === "expired"
                              ? "Token expired"
                              : integration.status === "missing_tokens"
                                ? "Not authorized"
                                : integration.status === "check_failed"
                                  ? "Check failed"
                                  : "Error"}
                      </span>
                    </div>
                  </div>
                  {canConnect && (
                    <button
                      onClick={() => connect(integration)}
                      className="px-2.5 py-1 text-[10px] font-mono font-medium text-primary bg-primary/10 rounded-md hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      {integration.status === "expired" ||
                      integration.status === "check_failed"
                        ? "Reconnect"
                        : "Connect"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Permissions */}
      <section className="px-4 py-4">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Permissions
        </h3>
        <div className="space-y-3">
          {/* Run commands */}
          <div>
            <label className="text-xs font-mono text-text-secondary block mb-1.5">
              Run commands
            </label>
            <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
              {(["off", "ask", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setExecMode(mode)}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase rounded-md transition-colors cursor-pointer ${
                    execMode === mode
                      ? "bg-surface-1 text-text-primary shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              {execDescriptions[execMode]}
            </p>
          </div>

          {/* Web access */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg">
            <div>
              <span className="text-xs font-mono text-text-primary block">Web access</span>
              <span className="text-[10px] font-mono text-text-muted">
                Fetch live web results
              </span>
            </div>
            <Toggle on={webAccess} onToggle={() => setWebAccess(!webAccess)} />
          </div>

          {/* File tools */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg">
            <div>
              <span className="text-xs font-mono text-text-primary block">File tools</span>
              <span className="text-[10px] font-mono text-text-muted">
                Read and edit workspace files
              </span>
            </div>
            <Toggle on={fileTools} onToggle={() => setFileTools(!fileTools)} />
          </div>

          {/* Browser automation */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg opacity-50">
            <div>
              <span className="text-xs font-mono text-text-primary block">Browser automation</span>
              <span className="text-[10px] font-mono text-text-muted">
                Coming soon
              </span>
            </div>
            <Toggle on={false} onToggle={() => {}} disabled />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Automations tab (placeholder) ── */
function AutomationsTab() {
  return (
    <section className="px-4 py-4">
      <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
        Cron Jobs
      </h3>
      <p className="text-xs text-text-muted mb-4">
        Manage scheduled tasks for this agent.
      </p>
      <div className="w-full py-8 bg-surface-2 border border-surface-border rounded-lg text-xs font-mono text-text-muted flex items-center justify-center">
        Coming soon
      </div>
    </section>
  );
}

/* ── Advanced tab (placeholder) ── */
function AdvancedTab() {
  const { selectedAgent } = useAgentStore();

  return (
    <div>
      {/* Model */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Model
        </h3>
        <p className="text-xs text-text-muted mb-3">
          Override the default model for this agent.
        </p>
        <div className="px-3 py-2.5 bg-surface-2 border border-surface-border rounded-lg text-xs font-mono text-text-muted">
          Default (claude-sonnet-4-6)
        </div>
      </section>

      {/* Thinking */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Thinking Level
        </h3>
        <div className="px-3 py-2.5 bg-surface-2 border border-surface-border rounded-lg text-xs font-mono text-text-muted">
          Low
        </div>
      </section>

      {/* Danger zone */}
      <section className="px-4 py-4">
        <h3 className="text-[10px] font-mono text-signal-error uppercase tracking-wider mb-3">
          Danger Zone
        </h3>
        <Button variant="danger" size="sm" className="w-full font-mono">
          Delete Agent
        </Button>
        <p className="text-[10px] text-text-muted mt-2">
          Removes {selectedAgent?.name} and all its cron jobs.
        </p>
      </section>
    </div>
  );
}
