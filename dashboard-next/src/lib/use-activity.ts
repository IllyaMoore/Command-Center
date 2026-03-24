"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ActivityItem {
  type: "task_run" | "message";
  timestamp: string;
  task_id?: string;
  task_prompt?: string;
  status?: string;
  result?: string | null;
  error?: string | null;
  duration_ms?: number;
  sender_name?: string;
  content?: string;
  chat_jid?: string;
  group_folder?: string;
}

export type ActivityFilter = "all" | "tasks" | "messages";

export function useActivity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const es = new EventSource("/api/activity/stream");
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "initial") {
          setItems(data.items ?? []);
          setLoading(false);
        } else if (data.type === "update") {
          setItems((prev) => [...(data.items ?? []), ...prev].slice(0, 100));
        }
      } catch {
        // heartbeat or parse error
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return es;
  }, []);

  useEffect(() => {
    const es = connect();
    return () => es.close();
  }, [connect]);

  return { items, loading };
}
