"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ScheduledTask,
  CreateTaskPayload,
  UpdateTaskPayload,
  fetchTasks,
  createTaskApi,
  updateTaskApi,
  deleteTaskApi,
  runTaskNow,
} from "./api";

export function useTasks(groupFolder: string | undefined) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupFolder) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchTasks(groupFolder);
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, [groupFolder]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (payload: CreateTaskPayload) => {
      const created = await createTaskApi(payload);
      setTasks((prev) => [created, ...prev]);
      return created;
    },
    [],
  );

  const update = useCallback(
    async (id: string, updates: UpdateTaskPayload) => {
      const updated = await updateTaskApi(id, updates);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteTaskApi(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [],
  );

  const triggerRun = useCallback(
    async (id: string) => {
      await runTaskNow(id);
    },
    [],
  );

  return { tasks, loading, error, refresh, create, update, remove, triggerRun };
}
