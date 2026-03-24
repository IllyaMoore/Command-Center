"use client";

import { useState, useEffect, useCallback } from "react";

export type IntegrationStatus = "connected" | "expired" | "missing_tokens" | "check_failed" | "missing_credentials" | "error";

export interface Integration {
  name: string;
  displayName: string;
  authPath: string;
  postMessageId: string;
  featured: boolean;
  status: IntegrationStatus;
}

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: "Connected",
  missing_credentials: "Credentials not configured",
  expired: "Token expired",
  missing_tokens: "Not authorized",
  check_failed: "Check failed",
  error: "Error",
};

const PROVIDERS = [
  {
    name: "google-calendar",
    displayName: "Google Calendar",
    authPath: "/api/auth/google-calendar",
    postMessageId: "gcal-connected",
    featured: true,
  },
  {
    name: "gmail",
    displayName: "Gmail",
    authPath: "/api/auth/gmail",
    postMessageId: "gmail-connected",
    featured: true,
  },
  {
    name: "google-drive",
    displayName: "Google Drive",
    authPath: "/api/auth/google-drive",
    postMessageId: "gdrive-connected",
    featured: true,
  },
  {
    name: "google-sheets",
    displayName: "Google Sheets",
    authPath: "/api/auth/google-sheets",
    postMessageId: "gsheets-connected",
    featured: false,
  },
] as const;

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const validStatuses = new Set<IntegrationStatus>(["connected", "expired", "missing_tokens", "check_failed", "missing_credentials"]);
    const results = await Promise.all(
      PROVIDERS.map(async (p) => {
        try {
          const res = await fetch(`${p.authPath}/status`);
          const data = await res.json();
          const status = validStatuses.has(data.status) ? data.status as IntegrationStatus : "error" as const;
          return { ...p, status };
        } catch {
          return { ...p, status: "error" as const };
        }
      }),
    );
    setIntegrations(results);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = useCallback(
    (integration: Integration) => {
      window.open(integration.authPath, `${integration.name}-auth`, "width=500,height=700");
      const handler = (e: MessageEvent) => {
        if (e.data === integration.postMessageId) {
          window.removeEventListener("message", handler);
          refresh();
        }
      };
      window.addEventListener("message", handler);
    },
    [refresh],
  );

  const disconnect = useCallback(
    async (integration: Integration) => {
      try {
        const res = await fetch(`${integration.authPath}/disconnect`, { method: "POST" });
        if (!res.ok) {
          console.error(`Disconnect failed: ${res.status}`);
        }
      } catch (err) {
        console.error("Disconnect failed:", err);
      }
      refresh();
    },
    [refresh],
  );

  return { integrations, loading, connect, disconnect, refresh };
}
