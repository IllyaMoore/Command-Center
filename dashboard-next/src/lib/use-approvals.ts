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

export function useApprovals() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // Subscribe to SSE for approval_requests
  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;

    es.onmessage = (event) => {
      if (!event.data || event.data.startsWith(":")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "approval_requests") {
          setApprovals(data.items ?? []);
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => es.close();
  }, []);

  // Clear approvals when SSE stops sending them (they were resolved/expired)
  // The SSE sends approval_requests every 2s — if absent, list is empty
  useEffect(() => {
    if (approvals.length === 0) return;
    const timeout = setTimeout(() => {
      // If no SSE update in 5s, re-fetch
      fetch("/api/approvals")
        .then((r) => r.json())
        .then((data) => setApprovals(Array.isArray(data) ? data : []))
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timeout);
  }, [approvals]);

  const respond = useCallback(
    async (id: string, decision: "allow" | "deny", alwaysAllow: boolean) => {
      try {
        await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, alwaysAllow }),
        });
        // Optimistically remove from local state
        setApprovals((prev) => prev.filter((a) => a.id !== id));
      } catch (err) {
        console.error("Failed to respond to approval:", err);
      }
    },
    [],
  );

  return { approvals, respond };
}
