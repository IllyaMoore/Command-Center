"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PendingDelegation {
  id: string;
  sourceGroup: string;
  targetGroup: string;
  task: string;
  context?: string;
  chatJid: string;
  timestamp: string;
  receivedAt: number;
}

export function useDelegations() {
  const [delegations, setDelegations] = useState<PendingDelegation[]>([]);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch("/api/delegations")
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (Array.isArray(data)) {
            setDelegations(data);
            // Clean up processing set — remove IDs no longer in pending
            setProcessing((prev) => {
              const pendingIds = new Set(data.map((d: PendingDelegation) => d.id));
              const next = new Set([...prev].filter((id) => pendingIds.has(id)));
              return next.size === prev.size ? prev : next;
            });
          }
        })
        .catch((err) => {
          console.error("Failed to fetch delegations:", err);
        });
    };

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const respond = useCallback(
    async (id: string, decision: "allow" | "deny") => {
      const res = await fetch(`/api/delegations/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      if (decision === "deny") {
        setDelegations((prev) => prev.filter((d) => d.id !== id));
      } else {
        setProcessing((prev) => new Set([...prev, id]));
      }
    },
    [],
  );

  return { delegations, processing, respond };
}
