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

    es.addEventListener("agents", () => {
      // Re-fetch full agent list on any agent status change
      refresh();
    });

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [refresh]);

  return { agents, loading, error, refresh };
}
