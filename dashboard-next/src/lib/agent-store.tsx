"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Agent } from "./api";

interface AgentStoreValue {
  selectedAgent: Agent | null;
  selectAgent: (agent: Agent) => void;
}

const AgentStoreContext = createContext<AgentStoreValue>({
  selectedAgent: null,
  selectAgent: () => {},
});

export function AgentStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const selectAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
  }, []);

  return (
    <AgentStoreContext.Provider value={{ selectedAgent, selectAgent }}>
      {children}
    </AgentStoreContext.Provider>
  );
}

export function useAgentStore() {
  return useContext(AgentStoreContext);
}
