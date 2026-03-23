"use client";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/lib/agent-store";

export function SettingsSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { selectedAgent } = useAgentStore();

  if (!open || !selectedAgent) return null;

  return (
    <aside className="w-80 bg-surface-1 border-l border-surface-border shrink-0 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-surface-border">
        <div>
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
            Agent Settings
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

      {/* Identity section */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Identity
        </h3>
        <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
          Agent Name
        </label>
        <input
          type="text"
          defaultValue={selectedAgent.name}
          className="w-full px-3 py-2 bg-surface-2 border border-surface-border rounded-lg text-sm font-mono text-text-primary outline-none focus:border-primary/50"
        />
        <Button variant="primary" size="sm" className="mt-2">
          Update Name
        </Button>
      </section>

      {/* Display section */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Display
        </h3>
        <div className="space-y-2">
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-text-secondary">
              Show Tool Calls
            </span>
            <input
              type="checkbox"
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-text-secondary">
              Show Thinking
            </span>
            <input
              type="checkbox"
              defaultChecked
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
          </label>
        </div>
      </section>

      {/* Session section */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Session
        </h3>
        <p className="text-xs text-text-muted mb-3">
          Start this agent in a fresh session and clear the visible transcript.
        </p>
        <Button variant="secondary" size="sm" className="w-full font-mono">
          New Session
        </Button>
      </section>

      {/* Cron Jobs section */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Cron Jobs
        </h3>
        <p className="text-xs text-text-muted">No cron jobs for this agent.</p>
      </section>

      {/* Heartbeats section */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Heartbeats
        </h3>
        <p className="text-xs text-text-muted">
          No heartbeats for this agent.
        </p>
      </section>

      {/* Delete section */}
      <section className="px-4 py-4">
        <Button variant="danger" size="sm" className="w-full font-mono">
          Delete Agent
        </Button>
        <p className="text-[10px] text-text-muted mt-2">
          Removes the agent from the gateway config and deletes its cron jobs.
        </p>
      </section>
    </aside>
  );
}
