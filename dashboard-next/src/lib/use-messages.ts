"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Message, fetchMessages } from "./api";

export function useMessages(groupFolder: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchingRef = useRef(false);
  const optimisticRef = useRef<Message | null>(null);

  const loadMessages = useCallback(
    async (folder: string) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const msgs = await fetchMessages(folder, 50);
        const sorted = [...msgs].reverse();

        // If we have an optimistic message not yet in server response, keep it
        const opt = optimisticRef.current;
        if (
          opt &&
          !sorted.some(
            (s) =>
              s.content === opt.content &&
              s.is_from_me &&
              Math.abs(
                new Date(s.timestamp).getTime() -
                  new Date(opt.timestamp).getTime(),
              ) < 10000,
          )
        ) {
          // Optimistic not yet on server — insert it at the right position
          setMessages([...sorted, opt]);
        } else {
          // Server has the message — clear optimistic, use server data only
          optimisticRef.current = null;
          setMessages(sorted);
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
      } finally {
        fetchingRef.current = false;
      }
    },
    [],
  );

  // Fetch initial messages when group changes
  useEffect(() => {
    if (!groupFolder) {
      setMessages([]);
      optimisticRef.current = null;
      return;
    }
    setLoading(true);
    loadMessages(groupFolder).finally(() => setLoading(false));
  }, [groupFolder, loadMessages]);

  // SSE for real-time new messages
  useEffect(() => {
    if (!groupFolder) return;

    const es = new EventSource("/api/events");

    es.onmessage = (event) => {
      if (!event.data || event.data.startsWith(":")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "messages" || data.type === "activity") {
          loadMessages(groupFolder);
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    es.onerror = () => {};

    return () => es.close();
  }, [groupFolder, loadMessages]);

  const addOptimistic = useCallback((msg: Message) => {
    optimisticRef.current = msg;
    setMessages((prev) => [...prev, msg]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    optimisticRef.current = null;
  }, []);

  return { messages, loading, addOptimistic, clearMessages };
}
