import { ApiClientError, api } from "@/lib/client";
import type { Bootstrap } from "@/lib/types";

const QUEUE_KEY = "drift-offline-queue.v1";
const BOOTSTRAP_KEY = "drift-bootstrap.v1";
const QUEUE_EVENT = "drift-offline-queue";
const MAX_QUEUE = 200;

export type QueuedWrite = {
  id: string;
  kind: "task.create" | "task.move" | "task.update" | "other";
  label: string;
  path: string;
  method: string;
  body: unknown;
  workspaceId?: string | null;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  status: "pending" | "failed";
  error?: string;
};

type NewWrite = Omit<QueuedWrite, "id" | "createdAt" | "attempts" | "status" | "error"> & {
  id?: string;
};

function browser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function notify() {
  if (!browser()) return;
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

export function listQueuedWrites(): QueuedWrite[] {
  if (!browser()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]).filter((item) => item && typeof item.path === "string") : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedWrite[]) {
  if (!browser()) return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  notify();
}

export function enqueueWrite(input: NewWrite): QueuedWrite {
  const write: QueuedWrite = {
    ...input,
    id: input.id ?? `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  saveQueue([...listQueuedWrites(), write]);
  return write;
}

export function removeQueuedWrite(id: string) {
  saveQueue(listQueuedWrites().filter((item) => item.id !== id));
}

export function updateQueuedWrite(id: string, patch: Partial<QueuedWrite>) {
  saveQueue(listQueuedWrites().map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

export function clearQueuedWrites() {
  if (!browser()) return;
  window.localStorage.removeItem(QUEUE_KEY);
  notify();
}

export function subscribeOfflineQueue(listener: () => void): () => void {
  if (!browser()) return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === QUEUE_KEY) listener();
  };
  window.addEventListener(QUEUE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(QUEUE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function cacheBootstrap(payload: Bootstrap) {
  if (!browser()) return;
  try {
    window.localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), payload }));
  } catch {
    // A full quota should never break the online app.
  }
}

export function readCachedBootstrap(): Bootstrap | null {
  if (!browser()) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(BOOTSTRAP_KEY) ?? "null") as { savedAt?: string; payload?: Bootstrap } | null;
    if (!value?.payload?.workspaces?.length) return null;
    const savedAt = value.savedAt ? Date.parse(value.savedAt) : 0;
    if (savedAt && Date.now() - savedAt > 1000 * 60 * 60 * 24 * 7) return null;
    return value.payload;
  } catch {
    return null;
  }
}

export function clearCachedBootstrap() {
  if (!browser()) return;
  window.localStorage.removeItem(BOOTSTRAP_KEY);
}

export function clearOfflineData() {
  if (!browser()) return;
  window.localStorage.removeItem(BOOTSTRAP_KEY);
  window.localStorage.removeItem(QUEUE_KEY);
  notify();
}

export type ReplayResult = {
  synced: number;
  failed: number;
  remaining: number;
  offline: boolean;
};

let replayPromise: Promise<ReplayResult> | null = null;

/**
 * Replays queued writes in capture order. Network loss stops the loop and
 * leaves the remainder pending; validation or conflict failures are marked
 * failed and surfaced in the UI instead of being silently dropped.
 */
export function replayOfflineQueue(): Promise<ReplayResult> {
  if (replayPromise) return replayPromise;
  replayPromise = (async () => {
    const queue = listQueuedWrites();
    let synced = 0;
    let failed = 0;
    let offline = false;

    for (const write of queue) {
      if (write.status === "failed") {
        failed += 1;
        continue;
      }
      try {
        await api(write.path, {
          method: write.method,
          body: write.body,
          workspaceId: write.workspaceId,
          idempotencyKey: write.idempotencyKey,
        });
        removeQueuedWrite(write.id);
        synced += 1;
      } catch (error) {
        const apiError = error instanceof ApiClientError ? error : null;
        if (apiError?.code === "NETWORK_ERROR") {
          offline = true;
          break;
        }
        if (apiError?.status === 401) {
          offline = true;
          break;
        }
        failed += 1;
        updateQueuedWrite(write.id, {
          status: "failed",
          attempts: write.attempts + 1,
          error: apiError?.message ?? "This change could not be synced.",
        });
      }
    }

    return { synced, failed, remaining: listQueuedWrites().length, offline };
  })().finally(() => {
    replayPromise = null;
  });
  return replayPromise;
}
