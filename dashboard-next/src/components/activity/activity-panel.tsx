"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActivity, type ActivityFilter, type ActivityItem } from "@/lib/use-activity";
import { useAgents } from "@/lib/use-agents";

export function ActivityPanel({
  open,
  onClose,
  containerRef,
}: {
  open: boolean;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { items, loading } = useActivity();
  const { agents } = useAgents();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (containerRef?.current?.contains(target)) return;
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose, containerRef]);

  // Count activity per agent folder
  const countByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (!item.group_folder) continue;
      map.set(item.group_folder, (map.get(item.group_folder) ?? 0) + 1);
    }
    return map;
  }, [items]);

  // Agents that have activity — use canonical names from /api/agents
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      map.set(a.folder, a.name);
    }
    return map;
  }, [agents]);

  // Agent pills: all agents from /api/agents, with activity counts
  const agentPills = useMemo(() => {
    return agents.map((a) => ({
      folder: a.folder,
      name: a.name,
      count: countByFolder.get(a.folder) ?? 0,
    }));
  }, [agents, countByFolder]);

  // Reset agent filter if agent no longer exists
  useEffect(() => {
    if (agentFilter && !agentPills.some((p) => p.folder === agentFilter)) {
      setAgentFilter(null);
    }
  }, [agentFilter, agentPills]);

  if (!open) return null;

  // Apply filters
  let filtered = items;
  if (agentFilter) {
    filtered = filtered.filter((i) => i.group_folder === agentFilter);
  }
  if (filter === "tasks") {
    filtered = filtered.filter((i) => i.type === "task_run");
  } else if (filter === "messages") {
    filtered = filtered.filter((i) => i.type === "message");
  }

  const taskCount = items.filter((i) => i.type === "task_run").length;
  const msgCount = items.filter((i) => i.type === "message").length;

  return (
    <div
      ref={panelRef}
      className="fixed md:absolute top-14 md:top-[calc(100%+4px)] left-2 right-2 md:left-auto md:right-0 z-20 md:w-[380px] max-h-[calc(100vh-80px)] bg-surface-1 border border-surface-border shadow-2xl overflow-hidden flex flex-col animate-slide-down"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-surface-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Live Feed
            </div>
            <div className="font-mono text-sm font-semibold text-text-primary">
              Activity
            </div>
          </div>
          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-signal-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-signal-success" />
            </span>
            <span className="text-[9px] font-mono text-signal-success uppercase tracking-wider font-semibold">
              Live
            </span>
          </div>
        </div>

        {/* Type filter pills */}
        <div className="flex gap-1 mb-2">
          <FilterPill
            label="All"
            count={items.length}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterPill
            label="Tasks"
            count={taskCount}
            active={filter === "tasks"}
            onClick={() => setFilter("tasks")}
            dotColor="var(--signal-info)"
          />
          <FilterPill
            label="Messages"
            count={msgCount}
            active={filter === "messages"}
            onClick={() => setFilter("messages")}
            dotColor="var(--signal-success)"
          />
        </div>

        {/* Agent filter pills — only show when multiple agents have activity */}
        {agentPills.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setAgentFilter(null)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer border ${
                agentFilter === null
                  ? "bg-text-primary text-text-inverse border-text-primary"
                  : "text-text-muted border-surface-border hover:text-text-secondary hover:border-text-muted"
              }`}
            >
              All agents
            </button>
            {agentPills.map((agent) => (
              <button
                key={agent.folder}
                onClick={() => setAgentFilter(agent.folder)}
                className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer border ${
                  agentFilter === agent.folder
                    ? "bg-text-primary text-text-inverse border-text-primary"
                    : "text-text-muted border-surface-border hover:text-text-secondary hover:border-text-muted"
                }`}
              >
                {agent.name}
                <span className={`ml-1 tabular-nums ${
                  agentFilter === agent.folder ? "text-text-inverse/50" : "text-text-muted/40"
                }`}>
                  {agent.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto min-h-0 max-h-[420px]">
        {loading ? (
          <div className="p-4 space-y-2 animate-pulse">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3 py-2">
                <div className="w-0.5 h-10 bg-surface-2 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 bg-surface-2 rounded w-16" />
                  <div className="h-3 bg-surface-2 rounded w-3/4" />
                </div>
                <div className="h-2 bg-surface-2 rounded w-8 self-start mt-1" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-1">
            <span className="text-lg text-text-muted/30">&mdash;</span>
            <span className="text-xs font-mono text-text-muted">
              No activity yet
            </span>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((item, i) => (
              <FeedItem
                key={`${item.type}-${item.timestamp}-${i}`}
                item={item}
                now={now}
                showAgent={!agentFilter && agentPills.length > 1}
                agentName={item.group_folder ? agentNameMap.get(item.group_folder) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-surface-border flex items-center justify-between">
        <span className="text-[10px] font-mono text-text-muted/50">
          {filtered.length} item{filtered.length !== 1 ? "s" : ""}
        </span>
        <span className="text-[10px] font-mono text-text-muted/50">
          Streaming via SSE
        </span>
      </div>
    </div>
  );
}

/* ── Filter Pill ── */
function FilterPill({
  label,
  count,
  active,
  onClick,
  dotColor,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dotColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold transition-all duration-150 cursor-pointer ${
        active
          ? "bg-surface-3 text-text-primary"
          : "text-text-muted hover:bg-surface-2 hover:text-text-secondary"
      }`}
    >
      {dotColor && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {label}
      <span
        className={`text-[8px] tabular-nums ${
          active ? "text-text-secondary" : "text-text-muted/50"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Feed Item ── */
function FeedItem({
  item,
  now,
  showAgent,
  agentName,
}: {
  item: ActivityItem;
  now: number;
  showAgent?: boolean;
  agentName?: string;
}) {
  const isTask = item.type === "task_run";
  const isSuccess = item.status === "success";
  const isRecent = now - new Date(item.timestamp).getTime() < 60_000;

  const accentColor = isTask ? "var(--signal-info)" : "var(--signal-success)";
  const relTime = formatRelativeTime(item.timestamp, now);

  return (
    <div className="group flex gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors">
      {/* Accent strip */}
      <div className="flex flex-col items-center gap-1 pt-1">
        <div
          className="w-0.5 flex-1 rounded-full min-h-[24px] transition-opacity"
          style={{
            backgroundColor: accentColor,
            opacity: isRecent ? 1 : 0.35,
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Top row */}
        <div className="flex items-center gap-2 mb-0.5">
          {isTask ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-signal-info">
                Task
              </span>
              {item.status && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[8px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    isSuccess
                      ? "bg-signal-success/10 text-signal-success"
                      : "bg-signal-error/10 text-signal-error"
                  }`}
                >
                  {isSuccess ? "\u2713" : "\u2717"}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-signal-success">
              {item.sender_name || "Message"}
            </span>
          )}

          {/* Agent label — uses canonical name from /api/agents */}
          {showAgent && agentName && (
            <span className="text-[8px] font-mono uppercase tracking-wider text-text-muted/60">
              {agentName}
            </span>
          )}

          <span className="ml-auto text-[9px] font-mono text-text-muted/50 tabular-nums shrink-0">
            {relTime}
          </span>
        </div>

        {/* Body text */}
        <p className="text-[11px] leading-relaxed text-text-secondary truncate">
          {isTask
            ? item.task_prompt || "Scheduled task"
            : item.content || "\u2014"}
        </p>

        {/* Duration badge for tasks */}
        {isTask && item.duration_ms != null && (
          <span className="inline-block mt-1 text-[8px] font-mono font-semibold text-text-muted/60 bg-surface-2 px-1.5 py-0.5 rounded tabular-nums">
            {item.duration_ms < 1000
              ? `${item.duration_ms}ms`
              : `${(item.duration_ms / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {/* New indicator for recent items */}
      {isRecent && (
        <div className="self-start mt-1.5 shrink-0">
          <span className="text-[7px] font-mono font-bold text-primary uppercase tracking-widest bg-primary/8 px-1.5 py-0.5 rounded">
            New
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */
function formatRelativeTime(timestamp: string, now: number): string {
  const diff = now - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
