"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PendingApproval {
  id: string;
  groupFolder: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  timestamp: string;
  receivedAt: number;
}

/**
 * Subscribes to approval_requests from the EXISTING /api/events SSE stream
 * in useMessages. Does NOT open a second connection — instead, polls
 * /api/approvals every 2s to stay in sync.
 */
export function useApprovals() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll /api/approvals periodically (SSE is shared via useMessages)
  useEffect(() => {
    const poll = () => {
      fetch("/api/approvals")
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (Array.isArray(data)) setApprovals(data);
        })
        .catch((err) => {
          console.error("Failed to fetch approvals:", err);
        });
    };

    poll(); // initial fetch
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const respond = useCallback(
    async (id: string, decision: "allow" | "deny", alwaysAllow: boolean) => {
      try {
        const res = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, alwaysAllow }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error("Approval response failed:", res.status, err);
          return;
        }
        // Only remove from UI after confirmed success
        setApprovals((prev) => prev.filter((a) => a.id !== id));
      } catch (err) {
        console.error("Failed to respond to approval:", err);
      }
    },
    [],
  );

  return { approvals, respond };
}
