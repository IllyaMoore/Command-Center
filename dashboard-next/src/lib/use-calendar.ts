"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  color?: string;
}

export function useCalendar(view: "day" | "week" = "day") {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      // Only show loading spinner on initial load, not on view switches
      if (!hasLoaded.current) setLoading(true);
      const res = await fetch(`/api/calendar/events?view=${view}`);
      if (!res.ok) {
        setError(`fetch_failed`);
        return;
      }
      const data = await res.json();
      setEvents(data.events ?? []);
      setError(data.error ?? null);
      hasLoaded.current = true;
    } catch {
      setError("fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { events, loading, error, refresh };
}
