"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Agent, fetchAgents } from "./api";

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch agents");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // SSE for real-time updates
  useEffect(() => {
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // SSE sends { type: "agents", agents: [...] } every 2s
        if ((data.type === "agents" || data.type === "init") && data.agents) {
          // Update online status directly from SSE without full re-fetch
          setAgents((prev) => {
            if (prev.length === 0) return prev;
            let changed = false;
            const updated = prev.map((agent) => {
              const live = data.agents.find(
                (a: { folder: string }) => a.folder === agent.folder,
              );
              if (live && live.online !== agent.online) {
                changed = true;
                return { ...agent, online: live.online };
              }
              return agent;
            });
            return changed ? updated : prev;
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {};

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  return { agents, loading, error, refresh };
}
