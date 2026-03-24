"use client";

import { useState, useEffect, useCallback } from "react";

export interface Integration {
  name: string;
  displayName: string;
  authPath: string;
  postMessageId: string;
  featured: boolean;
  status: "connected" | "expired" | "missing_tokens" | "check_failed" | "not_configured" | "error";
}

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
    const results = await Promise.all(
      PROVIDERS.map(async (p) => {
        try {
          const res = await fetch(`${p.authPath}/status`);
          const data = await res.json();
          return { ...p, status: data.status as Integration["status"] };
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
      await fetch(`${integration.authPath}/disconnect`, { method: "POST" });
      refresh();
    },
    [refresh],
  );

  return { integrations, loading, connect, disconnect, refresh };
}
