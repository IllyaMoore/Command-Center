"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCalendar, type CalendarEvent } from "@/lib/use-calendar";

type View = "day" | "week";

export function CalendarPanel({
  open,
  onClose,
  containerRef,
}: {
  open: boolean;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [view, setView] = useState<View>("day");
  const { events, loading, error } = useCalendar(view);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const [now, setNow] = useState(new Date());

  // Tick every minute for the time indicator
  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, [open]);

  // Close on outside click (ignore clicks on the container/toggle button)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        // Ignore clicks on the toggle button container
        if (containerRef?.current?.contains(target)) return;
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer to avoid catching the click that opened the panel
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", escHandler);
    });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open, onClose, containerRef]);

  // Measure content height for smooth transitions
  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const h = innerRef.current.scrollHeight;
    setContentHeight(h);
  }, [events, view, loading, error]);

  if (!open) return null;

  const today = new Date();
  const dayProgress = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);

  const dayEvents = events.filter((e) => !e.allDay);
  const allDayEvents = events.filter((e) => e.allDay);

  // Group events by day for week view
  const eventsByDay = groupByDay(events);

  return (
    <div
      ref={panelRef}
      className="absolute top-[calc(100%+4px)] right-0 z-20 w-[400px] max-h-[calc(100vh-80px)] bg-surface-1 border border-surface-border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-slide-down"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-surface-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Schedule
            </div>
            <div className="font-mono text-sm font-semibold text-text-primary">
              {formatDateHeader(today, view)}
            </div>
          </div>
          <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-[10px] font-mono font-semibold uppercase rounded-md transition-colors cursor-pointer ${
                  view === v
                    ? "bg-surface-1 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Day progress bar */}
        <div className="relative h-1 bg-surface-2 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary/60 rounded-full transition-all duration-1000"
            style={{ width: `${dayProgress * 100}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-primary rounded-full shadow-[0_0_6px_rgba(22,163,74,0.5)] transition-all duration-1000"
            style={{ left: `calc(${dayProgress * 100}% - 4px)` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[8px] font-mono text-text-muted/40">00:00</span>
          <span className="text-[8px] font-mono text-text-muted/40">12:00</span>
          <span className="text-[8px] font-mono text-text-muted/40">24:00</span>
        </div>
      </div>

      {/* Content — animated height */}
      <div
        ref={contentRef}
        className="overflow-hidden transition-[height] duration-250 ease-out"
        style={{ height: contentHeight ? `${contentHeight}px` : "auto" }}
      >
        <div ref={innerRef}>
          {loading ? (
            <div className="py-3 px-4 space-y-1 animate-pulse">
              {[...Array(view === "week" ? 7 : 4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="w-1 h-6 bg-surface-2 rounded-full shrink-0" />
                  <div className="w-12 h-3 bg-surface-2 rounded" />
                  <div className="flex-1 h-3 bg-surface-2 rounded" />
                </div>
              ))}
            </div>
          ) : error === "missing_credentials" || error === "auth_failed" ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="text-xs font-mono text-text-muted">
                Google Calendar not connected
              </span>
              <span className="text-[10px] font-mono text-text-muted/60">
                Connect via Integrations menu
              </span>
            </div>
          ) : view === "day" ? (
            <div key="day" className="animate-fade-in">
              <DayView
                dayEvents={dayEvents}
                allDayEvents={allDayEvents}
                now={now}
              />
            </div>
          ) : (
            <div key="week" className="animate-fade-in">
              <WeekView eventsByDay={eventsByDay} now={now} />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-surface-border flex items-center justify-between">
        <span className="text-[10px] font-mono text-text-muted/50">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
        <span className="text-[10px] font-mono text-text-muted/50">
          {formatTime(now)}
        </span>
      </div>
    </div>
  );
}

/* ── Day View ── */
function DayView({
  dayEvents,
  allDayEvents,
  now,
}: {
  dayEvents: CalendarEvent[];
  allDayEvents: CalendarEvent[];
  now: Date;
}) {
  if (dayEvents.length === 0 && allDayEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-1">
        <span className="text-lg">—</span>
        <span className="text-xs font-mono text-text-muted">No events today</span>
      </div>
    );
  }

  const nowMs = now.getTime();

  return (
    <div className="py-2">
      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="px-4 pb-2 mb-2 border-b border-surface-border/50">
          {allDayEvents.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2/50 mb-1 last:mb-0"
            >
              <div
                className="w-1 h-4 rounded-full shrink-0"
                style={{ backgroundColor: ev.color || "#16a34a" }}
              />
              <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider shrink-0">
                All day
              </span>
              <span className="text-xs font-mono text-text-primary truncate">
                {ev.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Timed events */}
      <div className="px-4 space-y-0.5">
        {dayEvents.map((ev, i) => {
          const startMs = new Date(ev.start).getTime();
          const endMs = new Date(ev.end).getTime();
          const isPast = endMs < nowMs;
          const isCurrent = startMs <= nowMs && nowMs < endMs;
          const isNext =
            !isCurrent && startMs > nowMs && (i === 0 || new Date(dayEvents[i - 1].end).getTime() <= nowMs);
          const durationMin = Math.round((endMs - startMs) / 60_000);

          // Insert "now" divider before next event
          const showNowDivider =
            isNext &&
            i > 0 &&
            new Date(dayEvents[i - 1].end).getTime() < nowMs;

          return (
            <div key={ev.id}>
              {showNowDivider && <NowDivider time={now} />}
              <div
                className={`flex gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isCurrent
                    ? "bg-primary/8 ring-1 ring-primary/20"
                    : isPast
                      ? "opacity-40"
                      : "hover:bg-surface-2/50"
                }`}
              >
                {/* Time column */}
                <div className="w-14 shrink-0 pt-0.5">
                  <div className="text-[11px] font-mono text-text-secondary tabular-nums">
                    {formatTime(new Date(ev.start))}
                  </div>
                  <div className="text-[9px] font-mono text-text-muted/50 tabular-nums">
                    {durationMin < 60
                      ? `${durationMin}m`
                      : `${Math.floor(durationMin / 60)}h${durationMin % 60 ? ` ${durationMin % 60}m` : ""}`}
                  </div>
                </div>

                {/* Color bar + content */}
                <div className="flex gap-2.5 flex-1 min-w-0">
                  <div
                    className="w-0.5 rounded-full shrink-0 self-stretch"
                    style={{ backgroundColor: ev.color || "#16a34a" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary truncate leading-snug">
                      {ev.title}
                    </div>
                    <div className="text-[10px] font-mono text-text-muted/60 mt-0.5">
                      {formatTime(new Date(ev.start))} — {formatTime(new Date(ev.end))}
                      {ev.location && (
                        <span className="ml-2">· {ev.location}</span>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  {isCurrent && (
                    <span className="text-[8px] font-mono font-semibold text-primary uppercase tracking-wider self-center shrink-0 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      Now
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Now divider at the end if all events are past */}
        {dayEvents.length > 0 &&
          dayEvents.every((ev) => new Date(ev.end).getTime() < nowMs) && (
            <NowDivider time={now} />
          )}
      </div>
    </div>
  );
}

/* ── Week View ── */
function WeekView({
  eventsByDay,
  now,
}: {
  eventsByDay: Map<string, CalendarEvent[]>;
  now: Date;
}) {
  const todayKey = dateKey(now);

  // Build 7-day range starting from today
  const days: Date[] = [];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  return (
    <div className="py-2 px-4 space-y-1">
      {days.map((day) => {
        const key = dateKey(day);
        const isToday = key === todayKey;
        const dayEvents = eventsByDay.get(key) ?? [];

        return (
          <div
            key={key}
            className={`rounded-lg px-3 py-2 ${
              isToday ? "bg-primary/5 ring-1 ring-primary/15" : ""
            }`}
          >
            {/* Day header */}
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-mono uppercase tracking-wider ${
                  isToday ? "text-primary font-semibold" : "text-text-muted"
                }`}
              >
                {day.toLocaleDateString("en", { weekday: "short" })}
              </span>
              <span
                className={`text-[10px] font-mono ${
                  isToday ? "text-primary" : "text-text-muted/50"
                }`}
              >
                {day.getDate()}
              </span>
              {isToday && (
                <span className="text-[8px] font-mono text-primary uppercase tracking-wider ml-auto">
                  Today
                </span>
              )}
              {dayEvents.length === 0 && (
                <span className="text-[9px] font-mono text-text-muted/30 ml-auto">
                  —
                </span>
              )}
            </div>

            {/* Event bars */}
            {dayEvents.length > 0 && (
              <div className="space-y-0.5 ml-1">
                {dayEvents.slice(0, 4).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-2">
                    <div
                      className="w-1 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: ev.color || "#16a34a" }}
                    />
                    <span className="text-[10px] font-mono text-text-muted tabular-nums shrink-0">
                      {ev.allDay
                        ? "all day"
                        : formatTime(new Date(ev.start))}
                    </span>
                    <span className="text-[10px] text-text-secondary truncate">
                      {ev.title}
                    </span>
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <span className="text-[9px] font-mono text-text-muted/40 ml-3">
                    +{dayEvents.length - 4} more
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Now Divider ── */
function NowDivider({ time }: { time: Date }) {
  return (
    <div className="flex items-center gap-2 py-1 px-3">
      <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(22,163,74,0.4)]" />
      <div className="flex-1 h-px bg-primary/30" />
      <span className="text-[9px] font-mono text-primary tabular-nums">
        {formatTime(time)}
      </span>
    </div>
  );
}

/* ── Helpers ── */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateHeader(date: Date, view: View): string {
  if (view === "week") {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    return `${date.toLocaleDateString("en", { month: "short", day: "numeric" })} — ${end.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
  }
  return date.toLocaleDateString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.start);
    const key = dateKey(d);
    const arr = map.get(key) ?? [];
    arr.push(ev);
    map.set(key, arr);
  }
  return map;
}
