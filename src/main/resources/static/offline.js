(() => {
  "use strict";

  const QUEUE_KEY = "drift-offline-queue.v1";
  const BOOTSTRAP_KEY = "drift-bootstrap.v1";
  const BOARD_PREFIX = "drift-board.v1:";
  const TODAY_PREFIX = "drift-today.v1:";
  const SETTINGS_KEY = "drift-settings.v1";
  const QUEUE_EVENT = "drift-offline-queue";
  const MAX_QUEUE = 200;

  function listQueuedWrites() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.path === "string") : [];
    } catch {
      return [];
    }
  }

  function notify() {
    window.dispatchEvent(new Event(QUEUE_EVENT));
  }

  function saveQueue(queue) {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    } catch {
      // Storage can be unavailable in private windows.
    }
    notify();
  }

  function enqueue(input) {
    const write = {
      ...input,
      id: input.id || `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: "pending",
      error: "",
    };
    saveQueue([...listQueuedWrites(), write]);
    return write;
  }

  function removeQueuedWrite(id) {
    saveQueue(listQueuedWrites().filter((item) => item.id !== id));
  }

  function updateQueuedWrite(id, patch) {
    saveQueue(listQueuedWrites().map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function clearCachedAccountData() {
    try {
      const keys = [];
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key && (key === QUEUE_KEY || key === BOOTSTRAP_KEY || key === SETTINGS_KEY
          || key.startsWith(BOARD_PREFIX) || key.startsWith(TODAY_PREFIX))) {
          keys.push(key);
        }
      }
      for (const key of keys) window.localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in private windows.
    }
    notify();
  }

  function clearQueuedWrites() {
    try {
      window.localStorage.removeItem(QUEUE_KEY);
    } catch {
      // ignore
    }
    notify();
  }

  function subscribeQueue(listener) {
    window.addEventListener(QUEUE_EVENT, listener);
    window.addEventListener("storage", (event) => {
      if (event.key === QUEUE_KEY) listener();
    });
    return () => window.removeEventListener(QUEUE_EVENT, listener);
  }

  function cacheBootstrap(payload) {
    if (!payload?.workspaces?.length) return;
    try {
      window.localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), payload }));
    } catch {
      // ignore quota errors
    }
  }

  function readCachedBootstrap() {
    try {
      const value = JSON.parse(window.localStorage.getItem(BOOTSTRAP_KEY) || "null");
      if (!value?.payload?.workspaces?.length) return null;
      const savedAt = value.savedAt ? Date.parse(value.savedAt) : 0;
      if (savedAt && Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) return null;
      return value.payload;
    } catch {
      return null;
    }
  }

  function cacheBoard(boardId, payload) {
    if (!boardId || !payload?.board) return;
    try {
      window.localStorage.setItem(`${BOARD_PREFIX}${boardId}`, JSON.stringify({ savedAt: new Date().toISOString(), payload }));
    } catch {
      // ignore
    }
  }

  function readCachedBoard(boardId) {
    try {
      const value = JSON.parse(window.localStorage.getItem(`${BOARD_PREFIX}${boardId}`) || "null");
      if (!value?.payload?.board) return null;
      const savedAt = value.savedAt ? Date.parse(value.savedAt) : 0;
      if (savedAt && Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) return null;
      return value.payload;
    } catch {
      return null;
    }
  }

  function cacheToday(workspaceId, payload) {
    if (!workspaceId || !payload) return;
    try {
      window.localStorage.setItem(`${TODAY_PREFIX}${workspaceId}`, JSON.stringify({ savedAt: new Date().toISOString(), payload }));
    } catch {
      // ignore
    }
  }

  function readCachedToday(workspaceId) {
    try {
      const value = JSON.parse(window.localStorage.getItem(`${TODAY_PREFIX}${workspaceId}`) || "null");
      if (!value?.payload) return null;
      const savedAt = value.savedAt ? Date.parse(value.savedAt) : 0;
      if (savedAt && Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) return null;
      return value.payload;
    } catch {
      return null;
    }
  }

  let replayPromise = null;

  function cacheSettings(settings) {
    if (!settings) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }

  function readCachedSettings() {
    try {
      return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "null");
    } catch {
      return null;
    }
  }

  function replayOfflineQueue() {
    if (replayPromise) return replayPromise;
    replayPromise = (async () => {
      const queue = listQueuedWrites();
      let synced = 0;
      let failed = 0;
      let offline = false;
      for (const write of queue) {
        if (write.status === "failed") {
          failed++;
          continue;
        }
        try {
          const response = await fetch(write.path, {
            method: write.method || "POST",
            credentials: "same-origin",
            headers: write.body === undefined ? undefined : { "content-type": "application/json" },
            body: write.body === undefined ? undefined : JSON.stringify(write.body),
          });
          if (response.status === 401) {
            offline = true;
            break;
          }
          if (!response.ok) {
            let message = `Request failed (${response.status})`;
            try {
              const data = await response.json();
              if (data?.message) message = data.message;
            } catch {
              // ignore
            }
            failed++;
            updateQueuedWrite(write.id, {
              status: "failed",
              attempts: (write.attempts || 0) + 1,
              error: message,
            });
            continue;
          }
          removeQueuedWrite(write.id);
          synced++;
        } catch {
          offline = true;
          break;
        }
      }
      return { synced, failed, remaining: listQueuedWrites().length, offline };
    })().finally(() => {
      replayPromise = null;
    });
    return replayPromise;
  }

  window.DriftOffline = {
    listQueuedWrites,
    enqueue,
    removeQueuedWrite,
    updateQueuedWrite,
    clearQueuedWrites,
    clearCachedAccountData,
    subscribeQueue,
    cacheBootstrap,
    readCachedBootstrap,
    cacheBoard,
    readCachedBoard,
    cacheToday,
    readCachedToday,
    cacheSettings,
    readCachedSettings,
    replayOfflineQueue,
  };
})();
