"use client";

import { useState } from "react";
import { agentColor } from "@/lib/agent-colors";

export interface DelegationCardProps {
  id: string;
  sourceGroup: string;
  targetGroup: string;
  task: string;
  context?: string;
  timestamp: string;
}

export function DelegationCard({
  request,
  isProcessing,
  onAllow,
  onDeny,
}: {
  request: DelegationCardProps;
  isProcessing?: boolean;
  onAllow?: (id: string) => Promise<void> | void;
  onDeny?: (id: string) => Promise<void> | void;
}) {
  const [status, setStatus] = useState<"pending" | "declined">("pending");
  const [loading, setLoading] = useState(false);
  const effectiveStatus = isProcessing ? "processing" : status;

  const targetColor = agentColor(request.targetGroup);

  const handleAction = async (action: "allow" | "deny") => {
    if (effectiveStatus !== "pending" || loading) return;
    setLoading(true);
    try {
      if (action === "allow") {
        await onAllow?.(request.id);
      } else {
        await onDeny?.(request.id);
        setStatus("declined");
      }
    } catch (err) {
      console.error("Delegation action failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[85%] inline-block animate-slide-down">
      <div
        className={`border border-surface-border ${
          effectiveStatus === "declined"
            ? "border-t-2 border-t-primary opacity-60"
            : effectiveStatus === "processing"
              ? "border-t-2 border-t-signal-info opacity-80"
              : "border-t-2 border-t-signal-info"
        }`}
      >
        {/* Header */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-signal-info">
            Delegation Request
          </span>
          <span className="text-[9px] font-mono text-text-muted/50 tabular-nums">
            {formatTime(request.timestamp)}
          </span>
        </div>

        {/* Body */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Delegate to
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase ${targetColor.text}`}>
              <span className={`w-2 h-2 ${targetColor.dot}`} />
              {request.targetGroup}
            </span>
          </div>
          <div className="bg-surface-2 border border-surface-border px-3 py-2">
            <p className="text-xs text-text-primary whitespace-pre-wrap">
              {request.task}
            </p>
          </div>
          {request.context && (
            <details className="mt-1.5">
              <summary className="text-[9px] font-mono text-text-muted/50 cursor-pointer hover:text-text-muted">
                Context
              </summary>
              <div className="mt-1 bg-surface-2 border border-surface-border px-3 py-2">
                <p className="text-[11px] text-text-secondary whitespace-pre-wrap">
                  {request.context}
                </p>
              </div>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 pb-3">
          {effectiveStatus === "pending" ? (
            <div className="flex gap-2">
              <button
                onClick={() => handleAction("allow")}
                disabled={loading}
                className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-text-primary text-text-inverse hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {loading ? "..." : "Allow"}
              </button>
              <button
                onClick={() => handleAction("deny")}
                disabled={loading}
                className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
                  effectiveStatus === "declined" ? "text-primary" :
                  effectiveStatus === "processing" ? "text-signal-info" :
                  "text-text-primary"
                }`}
              >
                {effectiveStatus === "processing" ? "Processing..." : "Declined"}
              </span>
              {effectiveStatus === "processing" && (
                <span className="inline-flex gap-0.5">
                  <span className="w-1 h-1 bg-signal-info animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 bg-signal-info animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 bg-signal-info animate-bounce [animation-delay:300ms]" />
                </span>
              )}
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
