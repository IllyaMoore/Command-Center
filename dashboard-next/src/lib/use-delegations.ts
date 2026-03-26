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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch("/api/delegations")
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (Array.isArray(data)) setDelegations(data);
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
      // On deny → remove immediately. On allow → keep (host removes when agent finishes)
      if (decision === "deny") {
        setDelegations((prev) => prev.filter((d) => d.id !== id));
      }
    },
    [],
  );

  return { delegations, respond };
}
