"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Agent, fetchAgents } from "./api";

interface AgentsContextValue {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<Agent[]>;
}

const AgentsContext = createContext<AgentsContextValue | null>(null);

/** Provider — mount once at the app root so all components share one agents list */
export function AgentsProvider({ children }: { children: React.ReactNode }) {
  const value = useAgentsInternal();
  return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
}

/** Hook — returns the shared agents state */
export function useAgents(): AgentsContextValue {
  const ctx = useContext(AgentsContext);
  if (ctx) return ctx;
  // Fallback for components outside provider (shouldn't happen)
  return useAgentsInternal();
}

function useAgentsInternal() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<Agent[]> => {
    try {
      const data = await fetchAgents();
      setAgents(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch agents");
      return [];
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

    es.onmessage = (event) => {
      if (!event.data || event.data.startsWith(":")) return;
      try {
        const data = JSON.parse(event.data);
        // SSE sends { type: "agents", agents: [...] } every 2s
        if ((data.type === "agents" || data.type === "init") && data.agents) {
          setAgents((prev) => {
            if (prev.length === 0) return prev;
            // Remove agents that no longer exist on server
            const liveFolders = new Set(
              data.agents.map((a: { folder: string }) => a.folder),
            );
            let changed = false;
            const updated: Agent[] = [];
            for (const agent of prev) {
              if (!liveFolders.has(agent.folder)) {
                changed = true;
                continue; // agent was deleted
              }
              const live = data.agents.find(
                (a: { folder: string }) => a.folder === agent.folder,
              );
              if (live && live.online !== agent.online) {
                changed = true;
                updated.push({ ...agent, online: live.online });
              } else {
                updated.push(agent);
              }
            }
            return changed ? updated : prev;
          });
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    es.onerror = () => {
      setError("Connection lost — retrying...");
    };

    return () => {
      es.close();
    };
  }, []);

  return { agents, loading, error, refresh };
}
