"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAgentStore } from "@/lib/agent-store";
import { fetchPrompt, savePrompt } from "@/lib/api";
import { useIntegrations, STATUS_LABELS, type Integration } from "@/lib/use-integrations";
import { useTasks } from "@/lib/use-tasks";
import type { ScheduledTask, CreateTaskPayload } from "@/lib/api";

type Tab = "behavior" | "capabilities" | "automations" | "advanced";

const TABS: { id: Tab; label: string }[] = [
  { id: "behavior", label: "Behavior" },
  { id: "capabilities", label: "Capabilities" },
  { id: "automations", label: "Automations" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsSidebar({
  open,
  onClose,
  onDeleteAgent,
  style,
}: {
  open: boolean;
  onClose: () => void;
  onDeleteAgent?: () => Promise<void>;
  style?: React.CSSProperties;
}) {
  const { selectedAgent } = useAgentStore();
  const [activeTab, setActiveTab] = useState<Tab>("capabilities");

  if (!selectedAgent) return null;

  return (
    <aside
      data-testid="settings-sidebar"
      className={`bg-surface-1 border-l border-surface-border shrink-0 h-full flex flex-col overflow-hidden transition-all duration-200 ease-out ${
        open ? "w-[420px] opacity-100" : "w-0 opacity-0 pointer-events-none"
      }`}
      style={style}
    >
      {/* Header */}
      <div className="px-4 py-4 border-b border-surface-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Agent Inspector
            </div>
            <div className="font-mono text-sm font-semibold text-text-primary uppercase">
              {selectedAgent.name}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs font-mono text-text-secondary bg-surface-2 rounded-md hover:bg-surface-3 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Tab navigation */}
        <nav className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold tracking-wider uppercase rounded-md transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "bg-surface-1 text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "behavior" && <BehaviorTab />}
        {activeTab === "capabilities" && <CapabilitiesTab />}
        {activeTab === "automations" && <AutomationsTab />}
        {activeTab === "advanced" && <AdvancedTab onDeleteAgent={onDeleteAgent} />}
      </div>
    </aside>
  );
}

/* ── Behavior tab ── */
function BehaviorTab() {
  const { selectedAgent } = useAgentStore();
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = content !== savedContent;

  // Load prompt when agent changes
  useEffect(() => {
    if (!selectedAgent) return;
    setLoading(true);
    setStatus("idle");
    fetchPrompt(selectedAgent.folder)
      .then((text) => {
        setContent(text);
        setSavedContent(text);
      })
      .catch(() => {
        setContent("");
        setSavedContent("");
      })
      .finally(() => setLoading(false));
  }, [selectedAgent?.folder, selectedAgent]);

  const handleSave = useCallback(async () => {
    if (!selectedAgent || !dirty) return;
    setSaving(true);
    setStatus("idle");
    try {
      await savePrompt(selectedAgent.folder, content);
      setSavedContent(content);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }, [selectedAgent, content, dirty]);

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return (
    <section className="px-4 py-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
          System Prompt
        </h3>
        <div className="flex items-center gap-2">
          {status === "saved" && (
            <span className="text-[10px] font-mono text-signal-success">Saved</span>
          )}
          {status === "error" && (
            <span className="text-[10px] font-mono text-signal-error">Failed to save</span>
          )}
          {dirty && status === "idle" && (
            <span className="text-[10px] font-mono text-text-muted">Unsaved</span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 bg-surface-2 border border-surface-border animate-pulse" />
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 min-h-[300px] w-full px-3 py-2 bg-surface-2 border border-surface-border text-xs font-mono text-text-primary outline-none focus:border-primary/50 resize-none leading-relaxed"
          spellCheck={false}
        />
      )}
    </section>
  );
}

/* ── Toggle Switch ── */
function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={disabled ? undefined : onToggle}
      className={`w-9 h-5 rounded-full relative transition-colors ${
        disabled ? "bg-surface-border cursor-not-allowed" : on ? "bg-primary cursor-pointer" : "bg-surface-border cursor-pointer"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
          on ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

/* ── Capabilities tab (implemented) ── */
function CapabilitiesTab() {
  const { selectedAgent } = useAgentStore();
  const { integrations, loading, connect, disconnect } = useIntegrations();
  const [execMode, setExecMode] = useState<"ask" | "auto">("auto");
  const [execLoading, setExecLoading] = useState(true);
  const [webAccess, setWebAccess] = useState(true);
  const [fileTools, setFileTools] = useState(true);
  const [mcpExpanded, setMcpExpanded] = useState(false);

  // Load saved approval mode
  useEffect(() => {
    if (!selectedAgent) return;
    setExecLoading(true);
    fetch(`/api/agents/${encodeURIComponent(selectedAgent.folder)}/settings`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.approvalMode) setExecMode(data.approvalMode);
      })
      .catch((err) => {
        console.error("Failed to load agent settings:", err);
      })
      .finally(() => setExecLoading(false));
  }, [selectedAgent?.folder]);

  // Persist on change — revert on failure
  const handleExecMode = async (mode: "ask" | "auto") => {
    const prev = execMode;
    setExecMode(mode);
    if (!selectedAgent) return;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(selectedAgent.folder)}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalMode: mode }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.error("Failed to save approval mode:", err);
      setExecMode(prev); // Revert
    }
  };

  const execDescriptions = {
    ask: "Requires approval for each command",
    auto: "Commands execute automatically",
  };

  return (
    <div>
      {/* MCP Integrations */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          MCP Integrations
        </h3>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-surface-2 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {integrations.filter((i) => i.featured).map((integration) => (
              <SettingsIntegrationRow key={integration.name} integration={integration} onConnect={() => connect(integration)} onDisconnect={() => disconnect(integration)} />
            ))}
            {integrations.some((i) => !i.featured) && (
              <>
                <button
                  onClick={() => setMcpExpanded((p) => !p)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors cursor-pointer"
                >
                  <span className="flex-1 h-px bg-surface-border" />
                  {mcpExpanded ? "Less" : `+${integrations.filter((i) => !i.featured).length} more`}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`transition-transform duration-200 ${mcpExpanded ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {mcpExpanded && integrations.filter((i) => !i.featured).map((integration) => (
                  <SettingsIntegrationRow key={integration.name} integration={integration} onConnect={() => connect(integration)} onDisconnect={() => disconnect(integration)} />
                ))}
              </>
            )}
          </div>
        )}
      </section>

      {/* Permissions */}
      <section className="px-4 py-4">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Permissions
        </h3>
        <div className="space-y-3">
          {/* Run commands */}
          <div>
            <label className="text-xs font-mono text-text-secondary block mb-1.5">
              Run commands
            </label>
            <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
              {(["ask", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleExecMode(mode)}
                  disabled={execLoading}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase rounded-md transition-colors cursor-pointer ${
                    execMode === mode
                      ? "bg-surface-1 text-text-primary shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              {execDescriptions[execMode]}
            </p>
          </div>

          {/* Web access */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg">
            <div>
              <span className="text-xs font-mono text-text-primary block">Web access</span>
              <span className="text-[10px] font-mono text-text-muted">
                Fetch live web results
              </span>
            </div>
            <Toggle on={webAccess} onToggle={() => setWebAccess(!webAccess)} />
          </div>

          {/* File tools */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg">
            <div>
              <span className="text-xs font-mono text-text-primary block">File tools</span>
              <span className="text-[10px] font-mono text-text-muted">
                Read and edit workspace files
              </span>
            </div>
            <Toggle on={fileTools} onToggle={() => setFileTools(!fileTools)} />
          </div>

          {/* Browser automation */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-lg opacity-50">
            <div>
              <span className="text-xs font-mono text-text-primary block">Browser automation</span>
              <span className="text-[10px] font-mono text-text-muted">
                Coming soon
              </span>
            </div>
            <Toggle on={false} onToggle={() => {}} disabled />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Automations tab ── */
function AutomationsTab() {
  const { selectedAgent } = useAgentStore();
  const { tasks, loading, create, update, remove, triggerRun } = useTasks(selectedAgent?.folder);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCreate = useCallback(async (payload: CreateTaskPayload) => {
    await create(payload);
    setShowForm(false);
  }, [create]);

  const handleUpdate = useCallback(async (payload: CreateTaskPayload) => {
    if (!editingTask) return;
    await update(editingTask.id, {
      prompt: payload.prompt,
      schedule_type: payload.schedule_type,
      schedule_value: payload.schedule_value,
    });
    setEditingTask(null);
  }, [editingTask, update]);

  const handleToggleStatus = useCallback(async (task: ScheduledTask) => {
    setActionError(null);
    try {
      await update(task.id, { status: task.status === "active" ? "paused" : "active" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed");
    }
  }, [update]);

  const handleRunNow = useCallback(async (task: ScheduledTask) => {
    setActionError(null);
    try {
      await triggerRun(task.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed");
    }
  }, [triggerRun]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed");
    }
  }, [deleteTarget, remove]);

  // Show form (create or edit)
  if (showForm || editingTask) {
    return (
      <TaskForm
        agent={selectedAgent!}
        task={editingTask}
        onSubmit={editingTask ? handleUpdate : handleCreate}
        onCancel={() => { setShowForm(false); setEditingTask(null); }}
      />
    );
  }

  return (
    <div>
      <section className="px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
            Scheduled Tasks
          </h3>
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            + New
          </Button>
        </div>

        {actionError && (
          <p className="text-xs text-signal-error mb-3">{actionError}</p>
        )}

        {loading && tasks.length === 0 && (
          <div className="space-y-2 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 bg-surface-2 border border-surface-border" />
            ))}
          </div>
        )}

        {!loading && tasks.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-xs text-text-muted mb-3">No automations configured</p>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
              Create first automation
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => handleToggleStatus(task)}
              onEdit={() => setEditingTask(task)}
              onRunNow={() => handleRunNow(task)}
              onDelete={() => setDeleteTarget(task)}
            />
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Automation"
        message={`Delete this automation and all its run history? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ── Task Card ── */
function TaskCard({
  task,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
}: {
  task: ScheduledTask;
  onToggle: () => void;
  onEdit: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  const statusColor = task.status === "active"
    ? "bg-signal-success"
    : task.status === "paused"
      ? "bg-signal-warning"
      : "bg-surface-border";

  const promptPreview = task.prompt.split("\n")[0].slice(0, 60);
  const scheduleLabel = (() => {
    if (task.schedule_type === "interval") return `Every ${Math.round(parseInt(task.schedule_value) / 60000)}m`;
    if (task.schedule_type === "once") return "Once";
    // Parse cron into human-readable
    const parts = task.schedule_value.trim().split(/\s+/);
    if (parts.length !== 5) return task.schedule_value;
    const [minP, hourP, domP, , dowP] = parts;
    const time = `${hourP.padStart(2, "0")}:${minP.padStart(2, "0")}`;
    if (dowP !== "*") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return `${days[parseInt(dowP)] ?? dowP} ${time}`;
    }
    if (domP !== "*") return `${domP}th monthly ${time}`;
    return `Daily ${time}`;
  })();

  return (
    <div className="bg-surface-2 border border-surface-border p-3">
      {/* Header row */}
      <div className="flex items-start gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${statusColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-text-primary truncate">{promptPreview}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-text-muted bg-surface-3 px-1.5 py-0.5">
              {scheduleLabel}
            </span>
            <span className="text-[10px] font-mono text-text-muted uppercase">
              {task.status}
            </span>
          </div>
        </div>
      </div>

      {/* Last/Next run */}
      <div className="flex items-center gap-3 mb-2 text-[10px] font-mono text-text-muted">
        {task.last_run && (
          <span>Last: {formatTimeAgoShort(task.last_run)}</span>
        )}
        {task.next_run && task.status === "active" && (
          <span>Next: {formatTimeAgoShort(task.next_run, true)}</span>
        )}
      </div>

      {/* Run history dots */}
      {task.recent_runs && task.recent_runs.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          {task.recent_runs.slice(0, 10).map((run, i) => (
            <span
              key={i}
              title={`${run.status} — ${run.duration_ms}ms`}
              className={`w-1.5 h-1.5 rounded-full ${
                run.status === "success" ? "bg-signal-success" : "bg-signal-error"
              }`}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onToggle}
          className="px-2 py-1 text-[10px] font-mono text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer"
          title={task.status === "active" ? "Pause" : "Resume"}
        >
          {task.status === "active" ? "Pause" : "Resume"}
        </button>
        <button
          onClick={onEdit}
          className="px-2 py-1 text-[10px] font-mono text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer"
        >
          Edit
        </button>
        {task.status === "active" && (
          <button
            onClick={onRunNow}
            className="px-2 py-1 text-[10px] font-mono text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer"
          >
            Run Now
          </button>
        )}
        <button
          onClick={onDelete}
          className="px-2 py-1 text-[10px] font-mono text-text-muted hover:text-signal-error hover:bg-signal-error/10 transition-colors cursor-pointer ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/* ── Task Form (Create / Edit) ── */
type Channel = "telegram" | "whatsapp";

function TaskForm({
  agent,
  task,
  onSubmit,
  onCancel,
}: {
  agent: { jid: string; folder: string };
  task: ScheduledTask | null;
  onSubmit: (payload: CreateTaskPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState<Channel>(
    task?.chat_jid?.startsWith("tg:") ? "telegram" : "telegram",
  );
  const [telegramChatId, setTelegramChatId] = useState(
    task?.chat_jid?.startsWith("tg:") ? task.chat_jid.replace("tg:", "") : "",
  );
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  // --- Recurring schedule state ---
  type RecurringFrequency = "daily" | "weekly" | "monthly";
  const parseCronToRecurring = (
    cron: string,
  ): { frequency: RecurringFrequency; dayOfWeek: number; dayOfMonth: number; hour: number; minute: number } => {
    const defaults = { frequency: "daily" as RecurringFrequency, dayOfWeek: 1, dayOfMonth: 1, hour: 13, minute: 0 };
    if (!cron) return defaults;
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return defaults;
    const [minP, hourP, domP, , dowP] = parts;
    const minute = parseInt(minP) || 0;
    const hour = parseInt(hourP) || 0;
    if (dowP !== "*") return { frequency: "weekly", dayOfWeek: parseInt(dowP) || 0, dayOfMonth: 1, hour, minute };
    if (domP !== "*") return { frequency: "monthly", dayOfWeek: 1, dayOfMonth: parseInt(domP) || 1, hour, minute };
    return { frequency: "daily", dayOfWeek: 1, dayOfMonth: 1, hour, minute };
  };

  const buildCronFromRecurring = (
    freq: RecurringFrequency, dow: number, dom: number, hour: number, minute: number,
  ): string => {
    if (freq === "weekly") return `${minute} ${hour} * * ${dow}`;
    if (freq === "monthly") return `${minute} ${hour} ${dom} * *`;
    return `${minute} ${hour} * * *`;
  };

  const initRecurring = task?.schedule_type === "cron" ? parseCronToRecurring(task.schedule_value) : null;

  const [scheduleType, setScheduleType] = useState<"cron" | "interval" | "once">(
    task?.schedule_type ?? "cron",
  );
  const [scheduleValue, setScheduleValue] = useState(task?.schedule_value ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState(
    task?.schedule_type === "interval"
      ? String(Math.round(parseInt(task.schedule_value) / 60000))
      : "60",
  );
  const [recurFrequency, setRecurFrequency] = useState<RecurringFrequency>(initRecurring?.frequency ?? "daily");
  const [recurDayOfWeek, setRecurDayOfWeek] = useState(initRecurring?.dayOfWeek ?? 1);
  const [recurDayOfMonth, setRecurDayOfMonth] = useState(initRecurring?.dayOfMonth ?? 1);
  const [recurHour, setRecurHour] = useState(initRecurring?.hour ?? 13);
  const [recurMinute, setRecurMinute] = useState(initRecurring?.minute ?? 0);
  // --- Shared time picker popover state ---
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timePickerRef = useRef<HTMLDivElement>(null);
  const hourColRef = useRef<HTMLDivElement>(null);
  const minuteColRef = useRef<HTMLDivElement>(null);

  // --- Once schedule state ---
  const parseOnceValue = (v: string) => {
    const d = v ? new Date(v) : null;
    if (d && !isNaN(d.getTime())) {
      return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate(), hour: now.getHours() + 1, minute: 0 };
  };
  const initOnce = parseOnceValue(task?.schedule_type === "once" ? task.schedule_value : "");
  const [onceYear, setOnceYear] = useState(initOnce.year);
  const [onceMonth, setOnceMonth] = useState(initOnce.month);
  const [onceDay, setOnceDay] = useState(initOnce.day);
  const [onceHour, setOnceHour] = useState(initOnce.hour);
  const [onceMinute, setOnceMinute] = useState(initOnce.minute);
  const [onceTimeOpen, setOnceTimeOpen] = useState(false);
  const onceTimeRef = useRef<HTMLDivElement>(null);
  const onceHourColRef = useRef<HTMLDivElement>(null);
  const onceMinuteColRef = useRef<HTMLDivElement>(null);
  const [onceCalOpen, setOnceCalOpen] = useState(false);
  const onceCalRef = useRef<HTMLDivElement>(null);

  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const firstDayOfWeek = (y: number, m: number) => new Date(y, m, 1).getDay();
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Build ISO string from once parts
  const buildOnceValue = () => {
    const d = new Date(onceYear, onceMonth, onceDay, onceHour, onceMinute);
    return d.toISOString();
  };

  // Close popovers on outside click
  useEffect(() => {
    if (!timePickerOpen && !onceTimeOpen && !onceCalOpen) return;
    const handler = (e: MouseEvent) => {
      if (timePickerOpen && timePickerRef.current && !timePickerRef.current.contains(e.target as Node)) {
        setTimePickerOpen(false);
      }
      if (onceTimeOpen && onceTimeRef.current && !onceTimeRef.current.contains(e.target as Node)) {
        setOnceTimeOpen(false);
      }
      if (onceCalOpen && onceCalRef.current && !onceCalRef.current.contains(e.target as Node)) {
        setOnceCalOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [timePickerOpen, onceTimeOpen, onceCalOpen]);

  // Auto-scroll time columns to selected value when popover opens
  useEffect(() => {
    if (!timePickerOpen && !onceTimeOpen) return;
    requestAnimationFrame(() => {
      const scrollTo = (container: HTMLDivElement | null, index: number) => {
        if (!container) return;
        const child = container.children[index] as HTMLElement | undefined;
        child?.scrollIntoView({ block: "center", behavior: "instant" });
      };
      if (timePickerOpen) {
        scrollTo(hourColRef.current, recurHour);
        const minuteIndex = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].indexOf(recurMinute);
        scrollTo(minuteColRef.current, minuteIndex >= 0 ? minuteIndex : 0);
      }
      if (onceTimeOpen) {
        scrollTo(onceHourColRef.current, onceHour);
        const minuteIndex = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].indexOf(onceMinute);
        scrollTo(onceMinuteColRef.current, minuteIndex >= 0 ? minuteIndex : 0);
      }
    });
  }, [timePickerOpen, onceTimeOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const [contextMode, setContextMode] = useState<"group" | "isolated">(
    task?.context_mode ?? "group",
  );
  const [model, setModel] = useState(task?.model ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolvedJid = channel === "telegram" ? `tg:${telegramChatId}` : agent.jid;

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    if (channel === "telegram" && !telegramChatId.trim()) {
      setError("Telegram Chat ID is required");
      return;
    }
    let value = scheduleValue;
    if (scheduleType === "cron") {
      value = buildCronFromRecurring(recurFrequency, recurDayOfWeek, recurDayOfMonth, recurHour, recurMinute);
    }
    if (scheduleType === "once") {
      value = buildOnceValue();
    }
    if (scheduleType === "interval") {
      const mins = parseInt(intervalMinutes);
      if (isNaN(mins) || mins < 1) {
        setError("Interval must be at least 1 minute");
        return;
      }
      value = String(mins * 60000);
    }
    if (!value.trim()) {
      setError("Schedule value is required");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        group_folder: agent.folder,
        chat_jid: resolvedJid,
        prompt: prompt.trim(),
        schedule_type: scheduleType,
        schedule_value: value.trim(),
        context_mode: contextMode,
        model: model || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="px-4 py-4">
      <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-4">
        {task ? "Edit Automation" : "New Automation"}
      </h3>

      {/* Channel selector */}
      <div className="mb-4">
        <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1.5">
          Deliver via
        </label>
        <div className="flex gap-0.5 bg-surface-2 p-0.5">
          <button
            onClick={() => setChannel("telegram")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-mono font-semibold uppercase transition-colors cursor-pointer ${
              channel === "telegram"
                ? "bg-surface-1 text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
            Telegram
          </button>
          <button
            disabled
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-mono font-semibold uppercase text-text-muted/40 cursor-not-allowed"
            title="Coming soon"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            WhatsApp
          </button>
        </div>
      </div>

      {/* Telegram Chat ID */}
      {channel === "telegram" && (
        <div className="mb-3">
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
            Chat ID
          </label>
          <input
            type="text"
            value={telegramChatId}
            onChange={(e) => setTelegramChatId(e.target.value)}
            placeholder="e.g. 914543095 or -100123456789"
            className="w-full px-3 py-2 bg-surface-2 border border-surface-border text-xs font-mono text-text-primary outline-none focus:border-primary/50"
          />
          <p className="text-[9px] text-text-muted mt-1">Send /chatid to the bot to get your ID</p>
        </div>
      )}

      <div className="space-y-3">
        {/* Prompt */}
        <div>
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do on this schedule?"
            rows={5}
            className="w-full px-3 py-2 bg-surface-2 border border-surface-border text-xs font-mono text-text-primary outline-none focus:border-primary/50 resize-none"
            autoFocus
          />
        </div>

        {/* Schedule type */}
        <div>
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
            Schedule
          </label>
          <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5 mb-2">
            {([
              { value: "cron", label: "Recurring" },
              { value: "interval", label: "Interval" },
              { value: "once", label: "Once" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setScheduleType(opt.value)}
                className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase rounded-md transition-colors cursor-pointer ${
                  scheduleType === opt.value
                    ? "bg-surface-1 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {scheduleType === "cron" && (
            <div className="border border-surface-border bg-surface-1 animate-fade-in">
              {/* Frequency row — labeled table-style */}
              <div className="flex items-center border-b border-surface-border">
                <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider px-3 py-2.5 border-r border-surface-border w-16 shrink-0">
                  Every
                </span>
                <div className="flex flex-1">
                  {([
                    { value: "daily", label: "Day" },
                    { value: "weekly", label: "Week" },
                    { value: "monthly", label: "Month" },
                  ] as const).map((opt, i) => (
                    <button
                      key={opt.value}
                      onClick={() => setRecurFrequency(opt.value)}
                      className={`flex-1 px-2 py-2.5 text-[10px] font-mono font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
                        i < 2 ? "border-r border-surface-border" : ""
                      } ${
                        recurFrequency === opt.value
                          ? "bg-surface-3 text-text-primary"
                          : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day of week — compact grid cells */}
              {recurFrequency === "weekly" && (
                <div className="flex items-center border-b border-surface-border">
                  <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider px-3 py-2.5 border-r border-surface-border w-16 shrink-0">
                    On
                  </span>
                  <div className="flex flex-1">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, i) => (
                      <button
                        key={i}
                        onClick={() => setRecurDayOfWeek(i)}
                        className={`flex-1 py-2.5 text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                          i < 6 ? "border-r border-surface-border" : ""
                        } ${
                          recurDayOfWeek === i
                            ? "bg-surface-3 text-text-primary"
                            : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Day of month — calendar grid */}
              {recurFrequency === "monthly" && (
                <div className="border-b border-surface-border">
                  <div className="flex items-center border-b border-surface-border">
                    <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider px-3 py-2 w-full">
                      Day of month
                    </span>
                  </div>
                  <div className="grid grid-cols-7">
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <button
                        key={d}
                        onClick={() => setRecurDayOfMonth(d)}
                        className={`py-2 text-[10px] font-mono transition-colors cursor-pointer border-b border-r border-surface-border ${
                          recurDayOfMonth === d
                            ? "bg-surface-3 text-text-primary font-bold"
                            : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Time — compact row with popover */}
              <div className="relative" ref={timePickerRef}>
                <button
                  type="button"
                  onClick={() => setTimePickerOpen((v) => !v)}
                  className="flex items-center w-full cursor-pointer group"
                >
                  <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider px-3 py-2.5 border-r border-surface-border w-16 shrink-0 text-left">
                    At
                  </span>
                  <span className="flex-1 px-3 py-2.5 text-xs font-mono text-text-primary font-semibold tracking-wider group-hover:bg-surface-2 transition-colors">
                    {String(recurHour).padStart(2, "0")}
                    <span className="text-text-muted mx-0.5">:</span>
                    {String(recurMinute).padStart(2, "0")}
                  </span>
                  <span className={`pr-3 text-text-muted text-[10px] transition-transform ${timePickerOpen ? "rotate-180" : ""}`}>
                    &#9662;
                  </span>
                </button>

                {/* Popover */}
                {timePickerOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 border border-surface-border border-t-0 bg-surface-1 shadow-[0_4px_12px_rgba(0,0,0,0.3)] animate-slide-down">
                    <div className="flex max-h-[160px]">
                      {/* Hour column */}
                      <div ref={hourColRef} className="flex-1 overflow-y-auto border-r border-surface-border">
                        {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                          <button
                            key={h}
                            onClick={() => setRecurHour(h)}
                            className={`w-full px-2 py-1.5 text-[11px] font-mono text-center transition-colors cursor-pointer ${
                              recurHour === h
                                ? "bg-surface-3 text-text-primary font-bold"
                                : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                            }`}
                          >
                            {String(h).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                      {/* Separator */}
                      <div className="flex items-center px-1 select-none bg-surface-1">
                        <span className="text-text-muted font-mono text-sm font-bold">:</span>
                      </div>
                      {/* Minute column */}
                      <div ref={minuteColRef} className="flex-1 overflow-y-auto">
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                          <button
                            key={m}
                            onClick={() => setRecurMinute(m)}
                            className={`w-full px-2 py-1.5 text-[11px] font-mono text-center transition-colors cursor-pointer ${
                              recurMinute === m
                                ? "bg-surface-3 text-text-primary font-bold"
                                : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                            }`}
                          >
                            {String(m).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary bar */}
              <div className="border-t border-surface-border bg-surface-2 px-3 py-2">
                <p className="text-[10px] font-mono text-text-secondary tracking-wide">
                  {recurFrequency === "daily" && (
                    <>
                      <span className="text-text-primary font-semibold">Every day</span>
                      {" at "}
                      <span className="text-text-primary font-semibold">{String(recurHour).padStart(2, "0")}:{String(recurMinute).padStart(2, "0")}</span>
                    </>
                  )}
                  {recurFrequency === "weekly" && (
                    <>
                      <span className="text-text-primary font-semibold">Every {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][recurDayOfWeek]}</span>
                      {" at "}
                      <span className="text-text-primary font-semibold">{String(recurHour).padStart(2, "0")}:{String(recurMinute).padStart(2, "0")}</span>
                    </>
                  )}
                  {recurFrequency === "monthly" && (
                    <>
                      <span className="text-text-primary font-semibold">{recurDayOfMonth}{recurDayOfMonth === 1 ? "st" : recurDayOfMonth === 2 ? "nd" : recurDayOfMonth === 3 ? "rd" : "th"} of every month</span>
                      {" at "}
                      <span className="text-text-primary font-semibold">{String(recurHour).padStart(2, "0")}:{String(recurMinute).padStart(2, "0")}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
          {scheduleType === "interval" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-text-muted">Every</span>
              <input
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                className="w-20 px-3 py-2 bg-surface-2 border border-surface-border text-xs font-mono text-text-primary outline-none focus:border-primary/50"
              />
              <span className="text-[10px] font-mono text-text-muted">minutes</span>
            </div>
          )}
          {scheduleType === "once" && (
            <div className="border border-surface-border bg-surface-1 animate-fade-in">
              {/* Date row — clickable with calendar popover */}
              <div className="relative" ref={onceCalRef}>
                <button
                  type="button"
                  onClick={() => { setOnceCalOpen((v) => !v); setOnceTimeOpen(false); }}
                  className="flex items-center w-full cursor-pointer group"
                >
                  <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider px-3 py-2.5 border-r border-surface-border w-16 shrink-0 text-left">
                    Date
                  </span>
                  <span className="flex-1 px-3 py-2.5 text-xs font-mono text-text-primary font-semibold tracking-wider group-hover:bg-surface-2 transition-colors">
                    {onceDay} {MONTH_NAMES[onceMonth]} {onceYear}
                  </span>
                  <span className={`pr-3 text-text-muted text-[10px] transition-transform ${onceCalOpen ? "rotate-180" : ""}`}>
                    &#9662;
                  </span>
                </button>

                {onceCalOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 border border-surface-border border-t-0 bg-surface-1 shadow-[0_4px_12px_rgba(0,0,0,0.3)] animate-slide-down">
                    {/* Month/Year nav */}
                    <div className="flex items-center border-b border-surface-border">
                      <button
                        type="button"
                        onClick={() => { if (onceMonth === 0) { setOnceMonth(11); setOnceYear((y) => y - 1); } else setOnceMonth((m) => m - 1); }}
                        className="px-3 py-2 text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors cursor-pointer text-xs font-mono"
                      >
                        &#8249;
                      </button>
                      <span className="flex-1 text-center text-[10px] font-mono font-semibold text-text-primary uppercase tracking-wider">
                        {MONTH_NAMES[onceMonth]} {onceYear}
                      </span>
                      <button
                        type="button"
                        onClick={() => { if (onceMonth === 11) { setOnceMonth(0); setOnceYear((y) => y + 1); } else setOnceMonth((m) => m + 1); }}
                        className="px-3 py-2 text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors cursor-pointer text-xs font-mono"
                      >
                        &#8250;
                      </button>
                    </div>
                    {/* Weekday headers */}
                    <div className="grid grid-cols-7 border-b border-surface-border">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                        <span key={d} className="py-1.5 text-[9px] font-mono text-text-muted text-center uppercase">
                          {d}
                        </span>
                      ))}
                    </div>
                    {/* Day grid */}
                    <div className="grid grid-cols-7">
                      {Array.from({ length: firstDayOfWeek(onceYear, onceMonth) }, (_, i) => (
                        <span key={`e${i}`} className="py-2" />
                      ))}
                      {Array.from({ length: daysInMonth(onceYear, onceMonth) }, (_, i) => i + 1).map((d) => {
                        const isToday = (() => { const t = new Date(); return d === t.getDate() && onceMonth === t.getMonth() && onceYear === t.getFullYear(); })();
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => { setOnceDay(d); setOnceCalOpen(false); }}
                            className={`py-2 text-[10px] font-mono text-center transition-colors cursor-pointer ${
                              onceDay === d
                                ? "bg-surface-3 text-text-primary font-bold"
                                : isToday
                                  ? "text-primary font-medium hover:bg-surface-2"
                                  : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                            }`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Time row — same popover pattern */}
              <div className="relative border-t border-surface-border" ref={onceTimeRef}>
                <button
                  type="button"
                  onClick={() => { setOnceTimeOpen((v) => !v); setOnceCalOpen(false); }}
                  className="flex items-center w-full cursor-pointer group"
                >
                  <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider px-3 py-2.5 border-r border-surface-border w-16 shrink-0 text-left">
                    Time
                  </span>
                  <span className="flex-1 px-3 py-2.5 text-xs font-mono text-text-primary font-semibold tracking-wider group-hover:bg-surface-2 transition-colors">
                    {String(onceHour).padStart(2, "0")}
                    <span className="text-text-muted mx-0.5">:</span>
                    {String(onceMinute).padStart(2, "0")}
                  </span>
                  <span className={`pr-3 text-text-muted text-[10px] transition-transform ${onceTimeOpen ? "rotate-180" : ""}`}>
                    &#9662;
                  </span>
                </button>

                {onceTimeOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 border border-surface-border border-t-0 bg-surface-1 shadow-[0_4px_12px_rgba(0,0,0,0.3)] animate-slide-down">
                    <div className="flex max-h-[160px]">
                      <div ref={onceHourColRef} className="flex-1 overflow-y-auto border-r border-surface-border">
                        {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setOnceHour(h)}
                            className={`w-full px-2 py-1.5 text-[11px] font-mono text-center transition-colors cursor-pointer ${
                              onceHour === h
                                ? "bg-surface-3 text-text-primary font-bold"
                                : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                            }`}
                          >
                            {String(h).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center px-1 select-none bg-surface-1">
                        <span className="text-text-muted font-mono text-sm font-bold">:</span>
                      </div>
                      <div ref={onceMinuteColRef} className="flex-1 overflow-y-auto">
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setOnceMinute(m)}
                            className={`w-full px-2 py-1.5 text-[11px] font-mono text-center transition-colors cursor-pointer ${
                              onceMinute === m
                                ? "bg-surface-3 text-text-primary font-bold"
                                : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
                            }`}
                          >
                            {String(m).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="border-t border-surface-border bg-surface-2 px-3 py-2">
                <p className="text-[10px] font-mono text-text-secondary tracking-wide">
                  <span className="text-text-primary font-semibold">{onceDay} {MONTH_NAMES[onceMonth]} {onceYear}</span>
                  {" at "}
                  <span className="text-text-primary font-semibold">{String(onceHour).padStart(2, "0")}:{String(onceMinute).padStart(2, "0")}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Context mode */}
        <div>
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
            Context
          </label>
          <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
            {(["group", "isolated"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setContextMode(mode)}
                className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase rounded-md transition-colors cursor-pointer ${
                  contextMode === mode
                    ? "bg-surface-1 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {mode === "group" ? "Persistent" : "Isolated"}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-1">
            {contextMode === "group" ? "Agent remembers previous runs" : "Fresh context each run"}
          </p>
        </div>

        {/* Model */}
        <div>
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider block mb-1">
            Model
          </label>
          <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
            {[
              { value: "", label: "Default" },
              { value: "claude-sonnet-4-6", label: "Sonnet" },
              { value: "claude-opus-4-6", label: "Opus" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setModel(opt.value)}
                className={`flex-1 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase rounded-md transition-colors cursor-pointer ${
                  model === opt.value
                    ? "bg-surface-1 text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-signal-error">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
        >
          {loading ? "Saving..." : task ? "Save" : "Create"}
        </Button>
      </div>
    </section>
  );
}

/* ── Time formatting helper ── */
function formatTimeAgoShort(timestamp: string, future = false): string {
  const diff = future
    ? new Date(timestamp).getTime() - Date.now()
    : Date.now() - new Date(timestamp).getTime();
  if (diff < 0) return future ? "now" : "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return future ? "< 1m" : "just now";
  if (mins < 60) return `${mins}m${future ? "" : " ago"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h${future ? "" : " ago"}`;
  return `${Math.floor(hours / 24)}d${future ? "" : " ago"}`;
}

/* ── Advanced tab ── */
function AdvancedTab({ onDeleteAgent }: { onDeleteAgent?: () => Promise<void> }) {
  const { selectedAgent } = useAgentStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!onDeleteAgent) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteAgent();
      setConfirmDelete(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Model */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Model
        </h3>
        <p className="text-xs text-text-muted mb-3">
          Override the default model for this agent.
        </p>
        <div className="px-3 py-2.5 bg-surface-2 border border-surface-border rounded-lg text-xs font-mono text-text-muted">
          Default (claude-sonnet-4-6)
        </div>
      </section>

      {/* Thinking */}
      <section className="px-4 py-4 border-b border-surface-border">
        <h3 className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-3">
          Thinking Level
        </h3>
        <div className="px-3 py-2.5 bg-surface-2 border border-surface-border rounded-lg text-xs font-mono text-text-muted">
          Low
        </div>
      </section>

      {/* Danger zone */}
      <section className="px-4 py-4">
        <h3 className="text-[10px] font-mono text-signal-error uppercase tracking-wider mb-3">
          Danger Zone
        </h3>
        <Button
          variant="danger"
          size="sm"
          className="w-full font-mono"
          onClick={() => setConfirmDelete(true)}
        >
          Delete Agent
        </Button>
        <p className="text-[10px] text-text-muted mt-2">
          Permanently removes {selectedAgent?.name} and all its data.
        </p>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Agent Permanently"
        message={
          deleteError
            ? `Failed: ${deleteError}. Try again?`
            : `This will permanently delete "${selectedAgent?.name ?? ""}" — its system prompt, memory, logs, and chat history. This action cannot be undone.`
        }
        confirmLabel={deleting ? "Deleting..." : "Delete Permanently"}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmDelete(false); setDeleteError(null); }}
      />
    </div>
  );
}

/* ── Settings Integration Row ── */
function SettingsIntegrationRow({ integration, onConnect, onDisconnect }: { integration: Integration; onConnect: () => void; onDisconnect: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isConnected = integration.status === "connected";
  const canConnect = ["expired", "missing_tokens", "check_failed"].includes(integration.status);

  const statusText = STATUS_LABELS[integration.status] ?? "Error";

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isConnected
                ? "bg-signal-success"
                : canConnect
                  ? "bg-signal-warning"
                  : "bg-surface-border"
            }`}
          />
          <div>
            <span className="text-xs font-mono text-text-primary block">{integration.displayName}</span>
            <span className="text-[10px] font-mono text-text-muted">{statusText}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isConnected && (
            <button
              onClick={() => setConfirmOpen(true)}
              className="px-2 py-1 text-[10px] font-mono font-medium text-text-muted hover:text-signal-error hover:bg-signal-error/10 transition-colors cursor-pointer"
            >
              Disconnect
            </button>
          )}
          {canConnect && (
            <button
              onClick={onConnect}
              className="px-2.5 py-1 text-[10px] font-mono font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer"
            >
              {integration.status === "expired" || integration.status === "check_failed" ? "Reconnect" : "Connect"}
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Disconnect Integration"
        message={`Remove ${integration.displayName} tokens? You will need to re-authorize to use this integration again.`}
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={() => { setConfirmOpen(false); onDisconnect(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
