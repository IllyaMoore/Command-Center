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
          <div className="text-[11px] text-text-primary mb-1">
            {describeToolCall(request.tool, request.args)}
          </div>
          <details className="group">
            <summary className="text-[9px] font-mono text-text-muted/50 cursor-pointer hover:text-text-muted">
              {request.tool}
            </summary>
            <div className="mt-1 bg-surface-2 border border-surface-border px-3 py-2 overflow-x-auto">
              <code className="text-xs font-mono text-text-primary whitespace-pre-wrap break-all">
                {request.args}
              </code>
            </div>
          </details>
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

function describeToolCall(tool: string, args: string): string {
  // Parse args JSON if possible
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(args); } catch { /* use raw */ }

  const t = tool.toLowerCase();

  // Bash
  if (t === "bash") {
    const cmd = parsed?.command ?? args;
    return `Run command: ${String(cmd).slice(0, 120)}`;
  }

  // File operations
  if (t === "read") return `Read file: ${parsed?.file_path ?? args}`;
  if (t === "write") return `Write file: ${parsed?.file_path ?? args}`;
  if (t === "edit") return `Edit file: ${parsed?.file_path ?? args}`;
  if (t === "glob") return `Search files: ${parsed?.pattern ?? args}`;
  if (t === "grep") return `Search content: ${parsed?.pattern ?? args}`;

  // Google MCP
  if (t.includes("google")) {
    const action = tool.split("__").pop()?.toLowerCase() ?? "";
    if (action.includes("list_events")) return `View calendar events${parsed?.days ? ` (next ${parsed.days} day${Number(parsed.days) > 1 ? "s" : ""})` : ""}`;
    if (action.includes("create_event")) return `Create calendar event: ${parsed?.summary ?? ""}`;
    if (action.includes("search_emails") || action.includes("search_gmail")) return `Search emails: ${parsed?.query ?? ""}`;
    if (action.includes("send_email")) return `Send email to ${parsed?.to ?? ""}`;
    if (action.includes("read_email") || action.includes("get_email")) return "Read email";
    if (action.includes("list_files") || action.includes("search_drive")) return `Search Drive: ${parsed?.query ?? ""}`;
    if (action.includes("read_file") || action.includes("get_file")) return `Read file from Drive`;
    if (action.includes("list_sheets") || action.includes("read_sheet")) return "Read Google Sheet";
    return `Google: ${action.replace(/_/g, " ")}`;
  }

  // Linear
  if (t.includes("linear")) {
    const action = tool.split("__").pop()?.toLowerCase() ?? "";
    return `Linear: ${action.replace(/_/g, " ")}`;
  }

  // Slack
  if (t.includes("slack")) {
    const action = tool.split("__").pop()?.toLowerCase() ?? "";
    return `Slack: ${action.replace(/_/g, " ")}`;
  }

  // Atlassian
  if (t.includes("atlassian") || t.includes("jira") || t.includes("confluence")) {
    const action = tool.split("__").pop()?.toLowerCase() ?? "";
    return `Atlassian: ${action.replace(/_/g, " ")}`;
  }

  // Web
  if (t === "websearch") return `Web search: ${parsed?.query ?? args}`;
  if (t === "webfetch") return `Fetch URL: ${parsed?.url ?? args}`;

  // Fallback: humanize tool name
  return tool.replace(/^mcp__\w+__/i, "").replace(/_/g, " ");
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
