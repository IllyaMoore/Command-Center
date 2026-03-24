"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Agent, createAgent, deleteAgent } from "@/lib/api";
import { useAgentStore } from "@/lib/agent-store";
import { useAgents } from "@/lib/use-agents";
import { agentColor } from "@/lib/agent-colors";

type FilterTab = "all" | "running" | "idle";

export function FleetSidebar({ onAgentSelect }: { onAgentSelect?: () => void } = {}) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  const { agents, loading: agentsLoading, refresh } = useAgents();
  const { selectedAgent, selectAgent } = useAgentStore();

  // Auto-select first agent
  useEffect(() => {
    if (!selectedAgent && agents.length > 0) {
      selectAgent(agents[0]);
    }
  }, [agents, selectedAgent, selectAgent]);

  // Update selected agent data when agents refresh
  useEffect(() => {
    if (selectedAgent) {
      const updated = agents.find((a) => a.jid === selectedAgent.jid);
      if (updated && updated !== selectedAgent) {
        selectAgent(updated);
      }
    }
  }, [agents, selectedAgent, selectAgent]);

  const filters: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "running", label: "Running" },
    { key: "idle", label: "Idle" },
  ];

  const filtered =
    filter === "all"
      ? agents
      : agents.filter((a) =>
          filter === "running" ? a.online : !a.online,
        );

  const handleCreate = useCallback(
    async (name: string, folder: string) => {
      await createAgent(name, folder);
      setShowCreate(false);
      await refresh();
    },
    [refresh],
  );

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (agent: Agent) => {
      try {
        await deleteAgent(agent.folder);
        setDeleteTarget(null);
        setDeleteError(null);
        if (selectedAgent?.jid === agent.jid) {
          const remaining = agents.filter((a) => a.jid !== agent.jid);
          if (remaining.length > 0) selectAgent(remaining[0]);
        }
        await refresh();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to delete agent");
      }
    },
    [agents, selectedAgent, selectAgent, refresh],
  );

  function formatTimeAgo(timestamp: string | null): string {
    if (!timestamp) return "";
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return (
    <>
      <aside className="flex flex-col w-72 bg-sidebar-bg border-r border-surface-border shrink-0 h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="font-mono text-sm font-semibold text-text-primary uppercase tracking-wider">
            Agents ({agents.length})
          </h2>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            New Agent
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1 px-4 pb-3">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                filter === f.key
                  ? "bg-surface-3 text-text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto px-2">
          {agentsLoading && agents.length === 0 && (
            <div className="space-y-1 animate-pulse">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-surface-2 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-surface-2 rounded w-24" />
                    <div className="h-2.5 bg-surface-2 rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!agentsLoading && filtered.length === 0 && (
            <p className="px-3 py-4 text-xs text-text-muted text-center">
              No agents found
            </p>
          )}
          {filtered.map((agent) => {
            const color = agentColor(agent.folder);
            return (
            <button
              key={agent.jid}
              onClick={() => { selectAgent(agent); onAgentSelect?.(); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setDeleteTarget(agent);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 cursor-pointer group ${
                selectedAgent?.jid === agent.jid
                  ? "bg-sidebar-active"
                  : "hover:bg-sidebar-hover active:scale-[0.98]"
              }`}
            >
              {/* Avatar */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${color.bg} ${color.text}`}>
                {agent.name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-sidebar-text uppercase truncate">
                    {agent.name}
                  </span>
                  {agent.pendingTaskCount > 0 && (
                    <span className="bg-badge-attention text-text-inverse text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full">
                      {agent.pendingTaskCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={agent.online ? "running" : "idle"}>
                    {agent.online ? "Running" : "Idle"}
                  </Badge>
                  {agent.lastActivity && (
                    <span className="text-[10px] text-text-muted">
                      {formatTimeAgo(agent.lastActivity)}
                    </span>
                  )}
                </div>
              </div>
            </button>
            );
          })}
        </div>
      </aside>

      {/* Create Agent Modal */}
      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Agent"
        message={deleteError
          ? `Failed: ${deleteError}. Try again?`
          : `Are you sure you want to delete ${deleteTarget?.name ?? "this agent"}? The group directory will be archived, not permanently deleted.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
        onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
      />
    </>
  );
}

function CreateAgentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, folder: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate folder from name
    setFolder(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || !folder.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(name.trim(), folder.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-surface-1 rounded-xl border border-surface-border shadow-xl w-96 p-6">
        <h3 className="font-mono text-sm font-semibold text-text-primary uppercase mb-4">
          New Agent
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Marketing Assistant"
              className="w-full px-3 py-2 bg-surface-2 border border-surface-border rounded-lg text-sm text-text-primary outline-none focus:border-primary/50"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
              Folder
            </label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g. marketing"
              className="w-full px-3 py-2 bg-surface-2 border border-surface-border rounded-lg text-sm font-mono text-text-primary outline-none focus:border-primary/50"
            />
            <p className="text-[10px] text-text-muted mt-1">
              Lowercase, hyphens, underscores only
            </p>
          </div>

          {error && (
            <p className="text-xs text-signal-error">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !folder.trim()}
          >
            {loading ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

