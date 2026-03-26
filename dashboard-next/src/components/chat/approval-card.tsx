"use client";

import { useState } from "react";

export interface ApprovalCardProps {
  id: string;
  tool: string;
  args: string;
  cwd?: string;
  timestamp: string;
}

type Resolution = {
  action: "approved" | "always_allow" | "denied";
  at: string;
};

export function ApprovalCard({
  request,
  agentName,
  onApprove,
  onAlwaysAllow,
  onDeny,
}: {
  request: ApprovalCardProps;
  agentName: string;
  onApprove?: (id: string) => Promise<void> | void;
  onAlwaysAllow?: (id: string) => Promise<void> | void;
  onDeny?: (id: string) => Promise<void> | void;
}) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: Resolution["action"]) => {
    if (resolution || loading) return; // Guard double-click
    setLoading(true);
    try {
      if (action === "approved") await onApprove?.(request.id);
      else if (action === "always_allow") await onAlwaysAllow?.(request.id);
      else await onDeny?.(request.id);
      setResolution({ action, at: new Date().toISOString() });
    } catch (err) {
      console.error("Approval action failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const resolved = resolution !== null;

  return (
    <div className="max-w-[85%] inline-block animate-slide-down">
      <div
        className={`border border-surface-border ${
          resolved
            ? resolution.action === "denied"
              ? "border-t-2 border-t-primary opacity-60"
              : "border-t-2 border-t-text-primary opacity-60"
            : "border-t-2 border-t-signal-warning"
        }`}
      >
        {/* Header */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-signal-warning">
              Execution Request
            </span>
          </div>
          <span className="text-[9px] font-mono text-text-muted/50 tabular-nums">
            {formatTime(request.timestamp)}
          </span>
        </div>

        {/* Tool + command */}
        <div className="px-4 pb-2">
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1">
            {request.tool}
          </div>
          <div className="bg-surface-2 border border-surface-border px-3 py-2 overflow-x-auto">
            <code className="text-xs font-mono text-text-primary whitespace-pre-wrap break-all">
              {request.args}
            </code>
          </div>
          {request.cwd && (
            <div className="mt-1.5 text-[9px] font-mono text-text-muted/50">
              cwd: {request.cwd}
            </div>
          )}
        </div>

        {/* Actions or resolution stamp */}
        <div className="px-4 pb-3">
          {resolved ? (
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
                  resolution.action === "denied"
                    ? "text-primary"
                    : "text-text-primary"
                }`}
              >
                {resolution.action === "approved"
                  ? "Approved"
                  : resolution.action === "always_allow"
                    ? "Always allowed"
                    : "Denied"}
              </span>
              <span className="text-[9px] font-mono text-text-muted/40 tabular-nums">
                {formatTime(resolution.at)}
              </span>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => handleAction("approved")}
                disabled={loading}
                className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-text-primary text-text-inverse hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {loading ? "..." : "Approve"}
              </button>
              <button
                onClick={() => handleAction("always_allow")}
                disabled={loading}
                className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider border border-surface-border text-text-secondary hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                Always Allow
              </button>
              <button
                onClick={() => handleAction("denied")}
                disabled={loading}
                className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
