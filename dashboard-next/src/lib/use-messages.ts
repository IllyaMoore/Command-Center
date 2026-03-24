"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Message, fetchMessages } from "./api";

export function useMessages(groupFolder: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch initial messages when group changes
  useEffect(() => {
    if (!groupFolder) {
      setMessages([]);
      return;
    }

    setLoading(true);

    fetchMessages(groupFolder, 50)
      .then((msgs) => {
        const sorted = [...msgs].reverse();
        setMessages(sorted);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [groupFolder]);

  // SSE for real-time new messages
  useEffect(() => {
    if (!groupFolder) return;

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "messages" || data.type === "activity") {
          // Re-fetch messages for this group to get any new ones
          fetchMessages(groupFolder, 50).then((latest) => {
            const sorted = [...latest].reverse();
            setMessages(sorted);
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onmessage = handleMessage;
    es.onerror = () => {};

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [groupFolder]);

  const addOptimistic = useCallback(
    (msg: Message) => {
      setMessages((prev) => {
        // Don't add if content already exists (prevent visual dupes)
        const isDupe = prev.some(
          (p) => p.content === msg.content && p.is_from_me === msg.is_from_me &&
            Math.abs(new Date(p.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 5000,
        );
        if (isDupe) return prev;
        return [...prev, msg];
      });
    },
    [],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, loading, addOptimistic, clearMessages };
}
