(() => {
  "use strict";

  const state = {
    boot: null,
    board: null,
    today: null,
    view: "today",
    currentWorkspaceId: null,
    currentBoardId: null,
    editing: null,
    detail: null,
    workspaceTasks: [],
    notifications: [],
    seenNotificationIds: new Set(),
    notificationsReady: false,
    notificationTimer: null,
    autoPlan: null,
    autoPlanSelection: "balanced",
    autoPlanApplying: false,
    autoPlanTimer: null,
    autoPlanDebounce: null,
    lastAutoApplyAt: 0,
    dayFlowAnchor: null,
    draggingTaskId: null,
    focus: null,
    focusTimer: null,
    captureRecognition: null,
    captureListening: false,
    captureInterim: "",
    captureSaving: false,
    offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calendarSelected: null,
    authMode: "signin",
    settings: null,
    settingsQueue: Promise.resolve(),
    members: {},
    selectedTaskIds: new Set(),
    bulkTargetColumn: "",
    bulkBusy: false,
    paletteOpen: false,
    paletteQuery: "",
    paletteResults: [],
    paletteActive: 0,
    paletteItems: [],
    paletteSearchSeq: 0,
    paletteTimer: null,
    singleKeyShortcuts: true,
    gPending: false,
    gTimer: null,
    paletteReturnFocus: null,
    shortcutsReturnFocus: null,
    upcomingRange: 14,
    searchStatus: "all",
    searchPriority: "",
    searchBoard: "",
    searchTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => window.DriftI18n?.t(key, vars) ?? key;
  const translateReason = (reason) => window.DriftI18n?.translateReason(reason, t) ?? reason;

  function newIdempotencyKey(prefix = "ui") {
    const random = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    if (options.workspaceId && !headers["x-workspace-id"]) headers["x-workspace-id"] = options.workspaceId;
    let response;
    try {
      response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (cause) {
      window.dispatchEvent(new Event("drift-network-error"));
      const error = new Error("You are offline. This change can be saved on this device.");
      error.code = "NETWORK_ERROR";
      error.cause = cause;
      throw error;
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status === 401) return null;
    if (!response.ok) {
      const error = new Error(data?.message || `Request failed (${response.status})`);
      error.code = data?.code || "HTTP_ERROR";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function queueOfflineWrite(path, options, meta) {
    const write = window.DriftOffline?.enqueue({
      kind: meta.kind,
      label: meta.label,
      path,
      method: options.method || "POST",
      body: options.body,
      idempotencyKey: options.idempotencyKey,
      workspaceId: meta.workspaceId || workspace()?.id || null,
    });
    state.offline = true;
    updateOfflineBanner();
    return write;
  }

  async function requestOrQueue(path, options, meta) {
    const withKey = options.idempotencyKey
      ? options
      : { ...options, idempotencyKey: newIdempotencyKey(meta?.kind || "ui") };
    try {
      return await request(path, withKey);
    } catch (error) {
      if (error.code === "NETWORK_ERROR" && window.DriftOffline) {
        queueOfflineWrite(path, withKey, meta);
        return { queued: true };
      }
      throw error;
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name, className = "icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function showToast(message, action = null) {
    const toast = $("toast");
    toast.replaceChildren();
    toast.append(element("span", "", message));
    if (action && action.label && typeof action.onClick === "function") {
      const button = element("button", "toast-action", action.label);
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        toast.classList.add("hidden");
        try {
          await action.onClick();
        } finally {
          button.disabled = false;
        }
      });
      toast.append(button);
    }
    toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 8000);
  }

  function undoToastAction(undo, after) {
    if (!undo || !undo.id) return null;
    return {
      label: t("Undo"),
      onClick: async () => {
        try {
          await request(`/api/undo/${encodeURIComponent(undo.id)}`, { method: "POST" });
          if (typeof after === "function") await after();
          showToast(t("Action undone."));
        } catch (error) {
          showToast(error.message);
        }
      },
    };
  }

  function workspace() {
    const workspaces = state.boot?.workspaces ?? [];
    return workspaces.find((item) => item.id === state.currentWorkspaceId) ?? workspaces[0] ?? null;
  }

  function offlineQueue() {
    return window.DriftOffline?.listQueuedWrites() ?? [];
  }

  function updateOfflineBanner() {
    const banner = $("offlineBanner");
    if (!banner) return;
    const queue = offlineQueue();
    const pending = queue.filter((write) => write.status !== "failed").length;
    const failed = queue.filter((write) => write.status === "failed").length;
    const show = state.offline || queue.length > 0;
    banner.classList.toggle("hidden", !show);
    if (!show) return;
    const parts = [state.offline
      ? t("You are offline. Captures and moves are saved on this device.")
      : t("Back online.")];
    if (pending) parts.push(t("{{count}} change waiting to sync.", { count: pending }));
    if (failed) parts.push(t("{{count}} change could not sync.", { count: failed }));
    $("offlineText").textContent = parts.join(" ");
    $("offlineRetryButton").classList.toggle("hidden", state.offline || pending === 0);
  }

  function renderOfflineQueue() {
    const container = $("offlineQueueList");
    container.replaceChildren();
    const queue = offlineQueue();
    if (!queue.length) {
      container.append(element("p", "field-hint", t("Everything is synced. Captures and moves you make offline will appear here until they reach the server.")));
      $("offlineSyncButton").disabled = true;
      return;
    }
    for (const write of queue) {
      const row = element("div", "detail-item");
      const grow = element("div", "grow");
      const head = element("div", "inline");
      head.append(makeBadge(write.status === "failed" ? t("Failed") : t("Pending"), write.status === "failed" ? "rose" : "slate"));
      head.append(element("strong", "", write.label || write.path));
      grow.append(head);
      grow.append(element("p", "", write.error || `${write.method} ${write.path} · ${new Date(write.createdAt).toLocaleString(state.settings?.locale || undefined)}`));
      const actions = element("div", "top-actions");
      if (write.status === "failed") {
        const retry = element("button", "btn ghost sm", t("Retry"));
        retry.type = "button";
        retry.addEventListener("click", () => {
          window.DriftOffline?.updateQueuedWrite(write.id, { status: "pending", error: "" });
          renderOfflineQueue();
          updateOfflineBanner();
          void syncOfflineQueue(true);
        });
        actions.append(retry);
      }
      const discard = element("button", "btn ghost sm", t("Discard"));
      discard.type = "button";
      discard.addEventListener("click", () => {
        window.DriftOffline?.removeQueuedWrite(write.id);
        renderOfflineQueue();
        updateOfflineBanner();
      });
      actions.append(discard);
      row.append(grow, actions);
      container.append(row);
    }
    $("offlineSyncButton").disabled = state.offline || !queue.some((write) => write.status !== "failed");
  }

  async function refreshAfterReconnect() {
    try {
      const boot = await request("/api/bootstrap");
      if (boot) {
        state.boot = boot;
        window.DriftOffline?.cacheBootstrap(boot);
        const previousWorkspace = state.currentWorkspaceId;
        const hasPrevious = boot.workspaces?.some((item) => item.id === previousWorkspace);
        state.currentWorkspaceId = hasPrevious ? previousWorkspace : boot.workspaces?.[0]?.id ?? null;
        state.currentBoardId = boards()[0]?.id ?? null;
        renderAccount();
        renderSidebar();
        if (state.currentBoardId) await loadBoard(state.currentBoardId);
        await loadToday();
      }
    } catch {
      // The next online event or sync will retry.
    }
  }

  async function syncOfflineQueue(announce = false) {
    if (state.offline || !navigator.onLine) return;
    const result = await window.DriftOffline?.replayOfflineQueue();
    updateOfflineBanner();
    if (!result) return;
    if (result.synced > 0) await refreshAfterReconnect();
    if (announce && result.synced > 0) showToast(t("{{count}} change synced.", { count: result.synced }));
    if (announce && result.failed > 0) showToast(t("{{count}} change needs attention.", { count: result.failed }));
  }

  function openOfflineQueue() {
    renderOfflineQueue();
    $("offlineModal").classList.remove("hidden");
  }

  function closeOfflineQueue() {
    $("offlineModal").classList.add("hidden");
  }

  function boards() {
    return workspace()?.boards ?? [];
  }

  function currentBoard() {
    return state.board?.board ?? null;
  }

  const RECURRENCE_LABELS = {
    "FREQ=DAILY;INTERVAL=1": "Every day",
    "FREQ=WEEKLY;INTERVAL=1": "Every week",
    "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR": "Every weekday",
    "FREQ=MONTHLY;INTERVAL=1": "Every month",
  };

  const CHECKLIST_TEMPLATES = [
    { pattern: /\b(write|draft|copy|post|announce)\b/i, items: ["Outline the key points", "Write the first draft", "Edit for clarity", "Proofread the final copy"] },
    { pattern: /\b(launch|release|ship|deploy)\b/i, items: ["Confirm the release checklist", "Prepare the rollout note", "Verify the production smoke test", "Schedule the follow-up"] },
    { pattern: /\b(review|audit|check)\b/i, items: ["Define the review criteria", "Collect the source material", "Record findings", "Assign follow-ups"] },
    { pattern: /\b(plan|strategy|retro|meeting)\b/i, items: ["Clarify the desired outcome", "List the decisions needed", "Prepare the agenda", "Capture next actions"] },
    { pattern: /\b(design|mockup|wireframe|visual)\b/i, items: ["Collect references", "Sketch the primary flow", "Build the first pass", "Review responsive states"] },
    { pattern: /\b(record|video|demo|podcast)\b/i, items: ["Write the run sheet", "Prepare the recording setup", "Record the segment", "Review the final cut"] },
    { pattern: /\b(test|qa|verify|bug)\b/i, items: ["List the critical paths", "Run the happy path", "Test edge cases", "Log and verify fixes"] },
    { pattern: /\b(book|reserve|buy|order|schedule)\b/i, items: ["Confirm the details", "Compare the options", "Make the booking", "Add a reminder"] },
  ];

  function suggestChecklistItems(title, description, existing = []) {
    const text = `${title || ""} ${description || ""}`;
    const already = new Set(existing.map((item) => String(item).trim().toLowerCase()));
    const suggestions = CHECKLIST_TEMPLATES
      .filter((template) => template.pattern.test(text))
      .flatMap((template) => template.items)
      .filter((item) => !already.has(item.toLowerCase()));
    return [...new Set(suggestions)].slice(0, 4);
  }

  function describeRecurrence(rule) {
    if (!rule) return "";
    if (RECURRENCE_LABELS[rule]) return t(RECURRENCE_LABELS[rule]);
    const fields = {};
    for (const part of String(rule).split(";")) {
      const [key, value] = part.split("=");
      if (key && value) fields[key.trim().toUpperCase()] = value.trim().toUpperCase();
    }
    const interval = Math.max(1, Math.min(52, Number(fields.INTERVAL || 1) || 1));
    if (fields.FREQ === "DAILY") return interval === 1 ? t("Every day") : t("Every {{count}} days", { count: interval });
    if (fields.FREQ === "MONTHLY") return interval === 1 ? t("Every month") : t("Every {{count}} months", { count: interval });
    if (fields.FREQ === "WEEKLY") {
      if (fields.BYDAY) {
        const names = { SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat" };
        const days = fields.BYDAY.split(",").map((code) => t(names[code.trim()] || code.trim())).filter(Boolean);
        return days.length ? t("Every {{days}}", { days: days.join(", ") }) : t("Every week");
      }
      return interval === 1 ? t("Every week") : t("Every {{count}} weeks", { count: interval });
    }
    return t("Repeats");
  }

  function initials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  async function ensureMembers(force = false) {
    const current = workspace();
    if (!current) return [];
    if (!force && state.members[current.id]) return state.members[current.id];
    const result = await request(`/api/workspaces/${encodeURIComponent(current.id)}/members`);
    state.members[current.id] = result.members ?? [];
    return state.members[current.id];
  }

  async function refreshBootstrap() {
    state.boot = await request("/api/bootstrap");
    window.DriftOffline?.cacheBootstrap(state.boot);
    renderAccount();
    renderSidebar();
    return state.boot;
  }

  function allTasks() {
    return (currentBoard()?.columns ?? []).flatMap((column) => column.tasks ?? []);
  }

  function arrangeTaskDrawer() {
    const form = $("taskForm");
    const detail = $("taskDetail");
    const notes = form?.querySelector(".task-notes-field");
    if (form && detail && notes) form.insertBefore(notes, detail);
    if (!detail) return;
    const sections = [...detail.querySelectorAll(":scope > .detail-section")];
    if (sections.length >= 6) {
      detail.append(sections[0], sections[1], sections[3], sections[4], sections[2], sections[5]);
    }
  }

  async function init() {
    try {
      arrangeTaskDrawer();
      // The guest endpoint is idempotent: it resumes an existing HttpSession or
      // creates the first workspace/board. Using it first avoids a noisy 401.
      const boot = await request("/api/auth/guest", { method: "POST" });
      state.boot = boot;
      window.DriftOffline?.cacheBootstrap(boot);
      state.currentWorkspaceId = boot.workspaces?.[0]?.id ?? null;
      state.currentBoardId = boards()[0]?.id ?? null;
      renderAccount();
      $("dateChip").textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date());
      renderSidebar();
      const initialLoads = [loadToday(), loadNotifications(), loadSettings()];
      if (state.currentBoardId) initialLoads.push(loadBoard(state.currentBoardId));
      await Promise.all(initialLoads);
      const query = new URLSearchParams(location.search);
      const requestedBoard = query.get("board");
      if (requestedBoard && boards().some((item) => item.id === requestedBoard)) {
        state.currentBoardId = requestedBoard;
        await loadBoard(requestedBoard);
        renderSidebar();
      }
      const startView = state.settings?.startView;
      const requestedView = query.get("view");
      const allowedViews = ["today", "board", "upcoming", "calendar", "search", "archive", "insights"];
      const initialView = location.pathname === "/settings"
        ? "settings"
        : allowedViews.includes(requestedView)
          ? requestedView
          : ["today", "board", "upcoming"].includes(startView) ? startView : "today";
      setView(initialView);
      const inviteToken = query.get("invite");
      if (inviteToken) {
        await acceptInviteFromUrl(inviteToken);
        state.currentBoardId = boards()[0]?.id ?? null;
        renderSidebar();
        if (state.currentBoardId) await loadBoard(state.currentBoardId);
        await loadToday();
      }
      const ssoMfa = query.get("ssoMfa");
      if (ssoMfa) {
        history.replaceState({}, "", "/");
        promptSsoMfa(ssoMfa);
      }
      const ssoError = query.get("ssoError");
      if (ssoError) {
        history.replaceState({}, "", "/");
        showToast(t("SSO sign-in failed: {{reason}}", { reason: ssoError.replaceAll("_", " ") }));
      }
      const deepLinkedTask = query.get("task");
      if (deepLinkedTask) {
        try {
          await openTaskById(deepLinkedTask);
        } catch (error) {
          showToast(error.message);
        }
      }
      state.offline = !navigator.onLine;
      updateOfflineBanner();
      if (state.notificationTimer) window.clearInterval(state.notificationTimer);
      state.notificationTimer = window.setInterval(() => {
        if (navigator.onLine) void loadNotifications();
      }, 30_000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void loadNotifications();
      });
      if (navigator.onLine && offlineQueue().length) void syncOfflineQueue(false);
    } catch (error) {
      const cached = error.code === "NETWORK_ERROR" ? window.DriftOffline?.readCachedBootstrap() : null;
      if (cached) {
        state.offline = true;
        state.boot = cached;
        state.currentWorkspaceId = cached.workspaces?.[0]?.id ?? null;
        state.currentBoardId = boards()[0]?.id ?? null;
        renderAccount();
        $("dateChip").textContent = new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(new Date());
        renderSidebar();
        if (state.currentBoardId) {
          try { await loadBoard(state.currentBoardId); } catch { /* cached copy is optional */ }
        }
        try { await loadToday(); } catch { /* cached copy is optional */ }
        const cachedSettings = window.DriftOffline?.readCachedSettings();
        state.settings = normalizeSettings(cachedSettings || DEFAULT_SETTINGS);
        applySettings();
        renderSettings();
        setView("today");
        updateOfflineBanner();
        showToast(t("You are offline. Showing the last saved copy."));
      } else {
        showToast(error.message || "Could not start the app.");
      }
    }
  }

  function renderAccount() {
    const user = state.boot?.user;
    const guest = !user || user.isGuest === 1 || user.isGuest === true;
    const name = guest
      ? (user?.name && user.name !== "Guest" ? user.name : t("Guest workspace"))
      : (user?.name || user?.email || t("Account"));
    $("accountName").textContent = name;
    $("accountEmail").textContent = guest ? t("Guest session") : (user?.email || t("Signed in"));
    const initials = String(name || "G").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
    $("accountAvatar").textContent = initials || "G";
    $("authButton").classList.toggle("hidden", !guest);
    $("signOutButton").classList.toggle("hidden", guest);
  }

  function openAuthModal() {
    state.authMode = "signin";
    $("authTitle").textContent = "Sign in";
    $("authModeButton").textContent = "Create account";
    $("authSubmit").textContent = "Sign in";
    $("authNameField").classList.add("hidden");
    $("authTotpField").classList.add("hidden");
    $("authTotp").value = "";
    $("authPassword").autocomplete = "current-password";
    $("authModal").classList.remove("hidden");
    window.setTimeout(() => $("authEmail").focus(), 20);
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === "signup";
    $("authTitle").textContent = signup ? "Create account" : "Sign in";
    $("authModeButton").textContent = signup ? "Sign in instead" : "Create account";
    $("authSubmit").textContent = signup ? "Create account" : "Sign in";
    $("authNameField").classList.toggle("hidden", !signup);
    if (signup) {
      $("authTotpField").classList.add("hidden");
      $("authTotp").value = "";
    }
    $("authPassword").autocomplete = signup ? "new-password" : "current-password";
  }

  async function submitAuth(event) {
    event.preventDefault();
    const submit = $("authSubmit");
    submit.disabled = true;
    try {
      const signup = state.authMode === "signup";
      const body = {
        email: $("authEmail").value.trim(),
        password: $("authPassword").value,
      };
      if (signup) body.name = $("authName").value.trim();
      if (!signup && $("authTotp").value.trim()) body.totp = $("authTotp").value.trim();
      const result = await request(signup ? "/api/auth/signup" : "/api/auth/signin", {
        method: "POST",
        body,
      });
      if (!result) throw new Error("Email or password is incorrect.");
      if (result.mfaRequired) {
        $("authTotpField").classList.remove("hidden");
        $("authTotp").focus();
        showToast(t("Enter your authenticator code to continue."));
        return;
      }
      state.boot = result;
      window.DriftOffline?.cacheBootstrap(result);
      state.currentWorkspaceId = result.workspaces?.[0]?.id ?? null;
      state.currentBoardId = boards()[0]?.id ?? null;
      closeAuthModal();
      renderAccount();
      renderSidebar();
      if (state.currentBoardId) await loadBoard(state.currentBoardId);
      await loadToday();
      showToast(signup ? "Account created." : "Signed in.");
    } catch (error) {
      showToast(error.message || "Could not sign in.");
    } finally {
      submit.disabled = false;
    }
  }

  function promptSsoMfa(challenge) {
    const backdrop = element("div", "modal-backdrop");
    const modal = element("div", "modal");
    modal.style.width = "min(440px, 100%)";
    const head = element("div", "modal-head");
    const headCopy = element("div");
    headCopy.append(element("p", "eyebrow", t("Single sign-on")), element("h2", "", t("Two-factor verification")));
    const close = element("button", "btn ghost sm", "×");
    close.type = "button";
    close.setAttribute("aria-label", t("Close"));
    head.append(headCopy, close);
    const copy = element("p");
    copy.style.cssText = "font-size:12px;color:var(--muted);line-height:1.6";
    copy.textContent = t("Enter your authenticator code or a backup code to finish signing in.");
    const field = element("label", "field");
    field.style.marginTop = "14px";
    field.append(element("span", "", t("Six-digit code")));
    const input = element("input", "input");
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.placeholder = "123456";
    field.append(input);
    const actions = element("div", "modal-actions");
    const cancel = element("button", "btn ghost", t("Cancel"));
    cancel.type = "button";
    const verify = element("button", "btn primary", t("Verify"));
    verify.type = "button";
    actions.append(cancel, verify);
    modal.append(head, copy, field, actions);
    backdrop.append(modal);
    document.body.append(backdrop);
    const closeModal = () => backdrop.remove();
    close.addEventListener("click", closeModal);
    cancel.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal();
    });
    verify.addEventListener("click", async () => {
      if (!input.value.trim()) {
        showToast(t("Enter a code to continue."));
        return;
      }
      verify.disabled = true;
      try {
        await request("/api/auth/mfa/challenge", {
          method: "POST",
          body: { challenge, code: input.value.trim() },
        });
        window.location.assign("/");
      } catch (error) {
        showToast(error.message);
        verify.disabled = false;
      }
    });
    input.focus();
  }

  function closeAuthModal() {
    $("authModal").classList.add("hidden");
  }

  function inQuietHours(settings = state.settings) {
    const start = settings?.quietStart;
    const end = settings?.quietEnd;
    if (start === null || start === undefined || end === null || end === undefined || start === end) return false;
    const hour = new Date().getHours();
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  async function loadNotifications() {
    try {
      const result = await request("/api/notifications");
      const notifications = result.notifications ?? [];
      const fresh = notifications.filter((notification) => !state.seenNotificationIds.has(notification.id));
      if (state.notificationsReady && !inQuietHours()) {
        const reminder = fresh.find((notification) => notification.type === "reminder");
        if (reminder) {
          const browserEnabled = state.settings?.notifications?.browser !== false;
          if (document.visibilityState === "visible") {
            window.DriftSound?.play("reminder");
          } else if (browserEnabled && "Notification" in window && window.Notification.permission === "granted") {
            try {
              const browserReminder = new window.Notification(reminder.title || t("Reminder"), {
                body: reminder.body || "",
                tag: reminder.id,
              });
              browserReminder.onclick = () => {
                window.focus();
                if (reminder.link) window.location.assign(reminder.link);
                browserReminder.close();
              };
            } catch {
              // The in-app inbox remains the source of truth.
            }
          }
        }
      }
      for (const notification of notifications) state.seenNotificationIds.add(notification.id);
      state.notificationsReady = true;
      state.notifications = notifications;
      const count = Number(result.unreadCount ?? 0);
      $("notificationCount").textContent = String(count);
      $("notificationCount").classList.toggle("zero", count === 0);
    } catch {
      // Notification polling must never interrupt the main workspace flow.
    }
  }

  async function openNotificationsModal() {
    await loadNotifications();
    renderNotifications();
    $("notificationsModal").classList.remove("hidden");
  }

  function renderNotifications() {
    const list = $("notificationList");
    list.replaceChildren();
    if (!state.notifications.length) list.append(element("div", "empty", "No notifications."));
    for (const notification of state.notifications) {
      const row = element("div", `detail-item${notification.readAt ? "" : " unread"}`);
      const grow = element("div", "grow");
      grow.append(element("strong", "", notification.title));
      if (notification.body) grow.append(element("p", "", notification.body));
      grow.append(element("p", "small muted", new Date(notification.createdAt).toLocaleString()));
      row.append(grow);
      if (!notification.readAt || notification.link) row.classList.add("clickable");
      row.addEventListener("click", async () => {
        try {
          if (!notification.readAt) {
            const result = await request(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
            state.notifications = result.notifications ?? state.notifications;
            const count = Number(result.unreadCount ?? 0);
            $("notificationCount").textContent = String(count);
            $("notificationCount").classList.toggle("zero", count === 0);
            renderNotifications();
          }
          const link = String(notification.link || "");
          const taskId = new URLSearchParams(link.split("?")[1] || "").get("task");
          if (taskId) {
            $("notificationsModal").classList.add("hidden");
            await openTaskById(taskId);
          } else if (link && link !== "/") {
            window.location.assign(link);
          }
        } catch (error) {
          showToast(error.message);
        }
      });
      list.append(row);
    }
  }

  async function markAllRead() {
    try {
      const result = await request("/api/notifications/read-all", { method: "PATCH" });
      state.notifications = result.notifications ?? [];
      const count = Number(result.unreadCount ?? 0);
      $("notificationCount").textContent = String(count);
      $("notificationCount").classList.toggle("zero", count === 0);
      renderNotifications();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function openMembersModal() {
    $("membersModal").classList.remove("hidden");
    $("inviteResult").textContent = "";
    try {
      const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/members`);
      renderMembers(result.members ?? []);
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderMembers(members) {
    const list = $("memberList");
    list.replaceChildren();
    const canManage = ["OWNER", "ADMIN"].includes(workspace()?.role);
    for (const member of members) {
      const row = element("div", "detail-item");
      const grow = element("div", "grow");
      grow.append(element("strong", "", member.name || member.email || "Member"));
      grow.append(element("p", "", `${member.email || "guest"} · ${member.role.toLowerCase()}`));
      row.append(grow);
      if (canManage && member.role !== "OWNER") {
        const select = element("select", "select");
        select.style.width = "auto";
        for (const role of ["MEMBER", "ADMIN", "GUEST"]) select.add(new Option(role.toLowerCase(), role));
        select.value = member.role;
        select.addEventListener("change", () => changeMemberRole(member.userId, select.value));
        row.append(select);
      }
      list.append(row);
    }
  }

  async function changeMemberRole(userId, role) {
    try {
      const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: { role },
      });
      renderMembers(result.members ?? []);
    } catch (error) {
      showToast(error.message);
      await openMembersModal();
    }
  }

  async function inviteMember() {
    const email = $("inviteEmail").value.trim();
    if (!email) return;
    try {
      const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/invites`, {
        method: "POST",
        body: { email, role: $("inviteRole").value },
      });
      $("inviteEmail").value = "";
      const link = `${location.origin}/invite/${encodeURIComponent(result.token)}`;
      $("inviteResult").textContent = `Invite link: ${link}`;
      try {
        await navigator.clipboard.writeText(link);
        showToast("Invite link copied.");
      } catch {
        showToast("Invite created. Copy the link from the dialog.");
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  async function acceptInviteFromUrl(token) {
    try {
      const result = await request(`/api/invites/${encodeURIComponent(token)}`, { method: "POST" });
      state.boot = result;
      window.DriftOffline?.cacheBootstrap(result);
      state.currentWorkspaceId = result.workspaces?.at(-1)?.id ?? state.currentWorkspaceId;
      history.replaceState({}, "", "/");
      showToast("Invitation accepted.");
    } catch (error) {
      showToast(error.message);
    }
  }

  function dateKey(value) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function loadCalendar() {
    $("calendarIcsLink").href = `/api/calendar/ics?workspaceId=${encodeURIComponent(workspace().id)}`;
    const year = state.calendarMonth.getFullYear();
    const month = state.calendarMonth.getMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    try {
      const result = await request(`/api/calendar?workspaceId=${encodeURIComponent(workspace().id)}&start=${dateKey(start)}&end=${dateKey(end)}`);
      $("calendarTitle").textContent = new Intl.DateTimeFormat(state.settings?.locale || undefined, { month: "long", year: "numeric" }).format(start);
      renderCalendar(result.days ?? []);
    } catch (error) {
      showToast(error.message);
    }
  }

  function calendarWeekStart() {
    const raw = Number(state.settings?.weekStartsOn);
    return Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : 1;
  }

  function renderCalendarWeekdays() {
    const row = document.querySelector(".calendar-weekdays");
    if (!row) return;
    const weekStartsOn = calendarWeekStart();
    const formatter = new Intl.DateTimeFormat(state.settings?.locale || undefined, { weekday: "short" });
    row.replaceChildren();
    for (let index = 0; index < 7; index++) {
      row.append(element("span", "", formatter.format(new Date(2024, 0, 7 + weekStartsOn + index, 12))));
    }
  }

  function selectCalendarDay(key, data, grid) {
    state.calendarSelected = key;
    grid?.querySelectorAll(".calendar-day.selected").forEach((node) => node.classList.remove("selected"));
    grid?.querySelector(`.calendar-day[data-date="${key}"]`)?.classList.add("selected");
    renderCalendarDayPanel(key, data);
  }

  function renderCalendarDayPanel(key, data) {
    const title = $("calendarDayTitle");
    const hint = $("calendarDayHint");
    const list = $("calendarDayList");
    list.replaceChildren();
    if (!key) {
      title.textContent = t("Pick a day");
      hint.textContent = t("Select a date to read it without the grid.");
      return;
    }
    const date = new Date(`${key}T12:00:00`);
    title.textContent = new Intl.DateTimeFormat(state.settings?.locale || undefined, {
      weekday: "long", month: "long", day: "numeric",
    }).format(date);
    const blocks = data?.planBlocks ?? [];
    const scheduled = new Set(blocks.map((block) => block.taskId));
    const dueOnly = (data?.tasks ?? []).filter((task) => !scheduled.has(task.id));
    const total = blocks.length + dueOnly.length;
    hint.textContent = total
      ? t("{{count}} items on this day.", { count: total })
      : t("Nothing due. Keep it that way if you can.");
    for (const block of blocks) {
      const row = element("button", "calendar-day-row scheduled");
      row.type = "button";
      row.append(element("span", "calendar-day-time", minutesLabel(block.startMinute)));
      row.append(element("span", "calendar-day-copy", block.title || block.task?.title || t("Task")));
      row.addEventListener("click", () => void openTaskById(block.taskId));
      list.append(row);
    }
    for (const task of dueOnly) {
      const row = element("button", "calendar-day-row");
      row.type = "button";
      const time = dueTimeLabel(task.dueDate);
      row.append(element("span", "calendar-day-time", time || "—"));
      row.append(element("span", "calendar-day-copy", task.title));
      row.addEventListener("click", () => void openTaskById(task.id));
      list.append(row);
    }
  }

  function renderCalendar(days) {
    const byDate = new Map(days.map((day) => [day.date, day]));
    const grid = $("calendarGrid");
    grid.replaceChildren();
    renderCalendarWeekdays();
    const first = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
    const gridStart = new Date(first);
    const startOffset = (first.getDay() - calendarWeekStart() + 7) % 7;
    gridStart.setDate(first.getDate() - startOffset);
    const today = dateKey(new Date());
    const totalDated = days.reduce((sum, day) => sum + (day.tasks ?? []).length, 0);
    $("calendarDatedCount").textContent = `${totalDated} ${t("dated")}`;
    $("calendarDatedHint").textContent = totalDated
      ? t("{{count}} dated tasks this month. Untimed work stays in its board.", { count: totalDated })
      : t("Tasks with a due date stay in their board, where they belong.");
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const key = dateKey(date);
      const data = byDate.get(key);
      const blocks = data?.planBlocks ?? [];
      const scheduled = new Set(blocks.map((block) => block.taskId));
      const dueOnly = (data?.tasks ?? []).filter((task) => !scheduled.has(task.id));
      const total = blocks.length + dueOnly.length;
      const day = element("div", `calendar-day${date.getMonth() !== state.calendarMonth.getMonth() ? " other" : ""}${key === today ? " today" : ""}${key === state.calendarSelected ? " selected" : ""}`);
      day.dataset.date = key;
      const number = element("button", "calendar-day-number", String(date.getDate()));
      number.type = "button";
      number.setAttribute("aria-pressed", String(key === state.calendarSelected));
      number.setAttribute("aria-label", `${new Intl.DateTimeFormat(state.settings?.locale || undefined, { weekday: "long", month: "long", day: "numeric" }).format(date)}, ${total} ${t(total === 1 ? "item" : "items")}`);
      number.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCalendarDay(key, data, grid);
      });
      day.append(number);
      const visibleBlocks = blocks.slice(0, 3);
      const visibleDue = dueOnly.slice(0, Math.max(0, 3 - visibleBlocks.length));
      for (const block of visibleBlocks) {
        const item = element("button", "calendar-item block", `${minutesLabel(block.startMinute)} ${block.title || block.task?.title || ""}`);
        item.type = "button";
        item.title = block.title || block.task?.title || "";
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          void openTaskById(block.taskId);
        });
        day.append(item);
      }
      for (const task of visibleDue) {
        const item = element("button", "calendar-item", task.title);
        item.type = "button";
        item.title = task.title;
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          void openTaskById(task.id);
        });
        day.append(item);
      }
      if (total > 3) {
        const more = element("button", "calendar-item calendar-more", `+${total - 3} ${t("more")}`);
        more.type = "button";
        more.addEventListener("click", (event) => {
          event.stopPropagation();
          selectCalendarDay(key, data, grid);
        });
        day.append(more);
      }
      day.addEventListener("click", () => selectCalendarDay(key, data, grid));
      grid.append(day);
    }
    if (state.calendarSelected) {
      renderCalendarDayPanel(state.calendarSelected, byDate.get(state.calendarSelected));
    } else {
      renderCalendarDayPanel(null);
    }
  }

  function priorityLabel(value) {
    const label = String(value || "none");
    return t(label.charAt(0).toUpperCase() + label.slice(1));
  }

  function dueTimeLabel(value) {
    const raw = value == null ? "" : String(value);
    if (!raw.includes("T")) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(state.settings?.locale || undefined, {
      hour: "numeric", minute: "2-digit",
    }).format(date);
  }

  function labelPills(task) {
    return (task.labels ?? []).slice(0, 3).map((label) =>
      element("span", `pill label-${label.color || "slate"}`, label.name));
  }

  async function loadUpcoming() {
    const range = Number(state.upcomingRange || 14);
    document.querySelectorAll("[data-upcoming-range]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.upcomingRange) === range);
    });
    try {
      const data = await request(`/api/upcoming?workspaceId=${encodeURIComponent(workspace().id)}&days=${range}`);
      const container = $("upcomingList");
      container.replaceChildren();
      let total = 0;
      for (const day of data.days ?? []) {
        const tasks = day.tasks ?? [];
        if (!tasks.length) continue;
        total += tasks.length;
        const date = new Date(`${day.date}T12:00:00`);
        const group = element("div", "upcoming-group");
        const left = element("div", "upcoming-date");
        left.append(element("strong", "", day.date === localDateKey() ? t("Today") : String(date.getDate())));
        const month = new Intl.DateTimeFormat(state.settings?.locale || undefined, { month: "short" }).format(date);
        const weekday = new Intl.DateTimeFormat(state.settings?.locale || undefined, { weekday: "long" }).format(date);
        left.append(element("span", "", `${month} ${weekday}`));
        left.append(element("small", "", `${tasks.length} ${t(tasks.length === 1 ? "task" : "tasks")}`));
        const cards = element("div", "upcoming-cards");
        for (const task of tasks) cards.append(upcomingRow(task));
        group.append(left, cards);
        container.append(group);
      }
      if (!total) container.append(element("div", "empty", t("Nothing due in the next {{count}} days.", { count: range })));
      const end = data.end ? new Date(`${data.end}T12:00:00`) : new Date();
      const endLabel = new Intl.DateTimeFormat(state.settings?.locale || undefined, {
        month: "long", day: "numeric",
      }).format(end);
      $("upcomingFoot").textContent = t("Showing tasks due through {{date}}. Overdue work lives in Today and Search.", { date: endLabel });
    } catch (error) {
      showToast(error.message);
    }
  }

  function upcomingRow(task) {
    const row = element("button", "upcoming-row");
    row.type = "button";
    const dot = element("span", `upcoming-dot priority-${task.priority || "none"}`);
    const copy = element("span", "upcoming-row-copy");
    copy.append(element("strong", "", task.title));
    const meta = element("span", "upcoming-row-meta");
    if (task.priority && task.priority !== "none") {
      meta.append(element("span", `pill priority-${task.priority}`, priorityLabel(task.priority)));
    }
    for (const pill of labelPills(task)) meta.append(pill);
    const time = dueTimeLabel(task.dueDate);
    if (time) meta.append(element("span", "upcoming-time", time));
    if (Number(task.subtaskCount || 0) > 0) {
      meta.append(element("span", "upcoming-time", `${Number(task.subtaskDone || 0)}/${Number(task.subtaskCount)}`));
    }
    copy.append(meta);
    const side = element("span", "upcoming-row-side");
    side.append(element("span", "upcoming-board", task.boardName || ""));
    side.append(icon("chevron"));
    row.append(dot, copy, side);
    row.addEventListener("click", () => void openTaskById(task.id));
    return row;
  }

  async function loadArchive() {
    try {
      const data = await request(`/api/archive?workspaceId=${encodeURIComponent(workspace().id)}`);
      const tasks = data.tasks ?? [];
      const archived = tasks.filter((task) => task.archivedAt);
      const completed = tasks.filter((task) => !task.archivedAt && Number(task.completed) === 1);
      renderArchivedBoards(data.archivedBoards ?? []);
      $("archiveArchivedMeta").textContent = archived.length
        ? `${archived.length} ${t(archived.length === 1 ? "task" : "tasks")} ${t("put away explicitly.")}`
        : t("0 tasks put away explicitly.");
      $("archiveCompletedMeta").textContent = completed.length
        ? `${completed.length} ${t(completed.length === 1 ? "finished task." : "finished tasks.")} ${t("Reopen one if it wasn’t really done.")}`
        : t("0 finished tasks. Reopen one if it wasn’t really done.");
      renderArchiveList($("archiveArchivedList"), archived, "archived");
      renderArchiveList($("archiveList"), completed, "completed");
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderArchivedBoards(boards) {
    const section = $("archiveBoardsSection");
    const container = $("archiveBoardsList");
    section.classList.toggle("hidden", !boards.length);
    container.replaceChildren();
    if (!boards.length) return;
    $("archiveBoardsMeta").textContent = `${boards.length} ${t(boards.length === 1 ? "board" : "boards")} ${t("folded away.")}`;
    for (const board of boards) {
      const row = element("div", "archive-row");
      const copy = element("div", "archive-copy");
      copy.append(element("strong", "", board.name));
      const count = Number(board.taskCount || 0);
      copy.append(element("span", "archive-meta",
        `${count} ${t(count === 1 ? "task" : "tasks")} · ${t("archived {{when}}", { when: relativeTime(board.archivedAt) })}`));
      const actions = element("div", "archive-actions");
      const restore = element("button", "btn sm", t("Restore"));
      restore.type = "button";
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        try {
          await request(`/api/boards/${encodeURIComponent(board.id)}`, {
            method: "PATCH",
            body: { archived: false, version: board.version },
          });
          await refreshBootstrap();
          await loadArchive();
          showToast(t("Board restored."));
        } catch (error) {
          showToast(error.message);
          restore.disabled = false;
        }
      });
      actions.append(restore);
      row.append(copy, actions);
      container.append(row);
    }
  }

  function renderArchiveList(container, tasks, kind) {
    container.replaceChildren();
    if (!tasks.length) {
      container.append(element("p", "archive-empty",
        kind === "archived" ? t("Nothing archived. A clean shelf.") : t("Nothing completed yet.")));
      return;
    }
    for (const task of tasks) {
      const row = element("div", "archive-row");
      const copy = element("div", "archive-copy");
      copy.append(element("strong", "", task.title));
      const when = kind === "archived" ? task.archivedAt : (task.completedAt || task.updatedAt);
      copy.append(element("span", "archive-meta",
        `${task.boardName || t("Board")} · ${kind === "archived" ? t("archived {{when}}", { when: relativeTime(when) }) : t("completed {{when}}", { when: relativeTime(when) })}`));
      const actions = element("div", "archive-actions");
      const open = element("button", "btn ghost sm", t("Open"));
      open.type = "button";
      open.addEventListener("click", () => void openTaskById(task.id));
      actions.append(open);
      if (kind === "archived") {
        const restore = element("button", "btn sm", t("Restore"));
        restore.type = "button";
        restore.addEventListener("click", async () => {
          restore.disabled = true;
          try {
            await request(`/api/tasks/${encodeURIComponent(task.id)}/restore`, { method: "POST" });
            showToast(t("Task restored."));
            await loadArchive();
          } catch (error) {
            showToast(error.message);
            restore.disabled = false;
          }
        });
        actions.append(restore);
      } else {
        const reopen = element("button", "btn sm", `↻ ${t("Reopen")}`);
        reopen.type = "button";
        reopen.addEventListener("click", async () => {
          reopen.disabled = true;
          try {
            await request(`/api/tasks/${encodeURIComponent(task.id)}/reopen`, { method: "POST" });
            showToast(t("Task reopened."));
            await loadArchive();
          } catch (error) {
            showToast(error.message);
            reopen.disabled = false;
          }
        });
        actions.append(reopen);
      }
      row.append(copy, actions);
      container.append(row);
    }
  }

  async function runSearch() {
    const query = $("searchInput").value.trim();
    const results = $("searchResults");
    const status = state.searchStatus || "all";
    const boardFilter = $("searchBoardFilter");
    const previousBoard = state.searchBoard || boardFilter.value;
    boardFilter.replaceChildren(new Option(t("Any board"), ""));
    for (const board of boards()) boardFilter.add(new Option(board.name, board.id));
    boardFilter.value = boards().some((board) => board.id === previousBoard) ? previousBoard : "";
    const priority = $("searchPriorityFilter").value;
    const boardId = boardFilter.value;
    state.searchPriority = priority;
    state.searchBoard = boardId;
    document.querySelectorAll("[data-search-status]").forEach((button) => {
      button.classList.toggle("active", button.dataset.searchStatus === status);
    });
    results.replaceChildren();
    try {
      const params = new URLSearchParams({ workspaceId: workspace().id, q: query });
      if (status !== "all") params.set("status", status);
      if (priority) params.set("priority", priority);
      if (boardId) params.set("boardId", boardId);
      const data = await request(`/api/search?${params.toString()}`);
      const tasks = data.results ?? [];
      const total = Number(data.total ?? tasks.length);
      $("searchMeta").textContent = `${total} ${t(total === 1 ? "result" : "results")} · ${query ? t("matching your search") : t("most recently touched")}`;
      $("searchStatusHint").textContent = status === "all" ? t("all statuses") : t(status);
      if (!tasks.length) {
        results.append(element("div", "empty", t("No matching tasks.")));
        return;
      }
      for (const task of tasks) results.append(searchRow(task));
    } catch (error) {
      showToast(error.message);
    }
  }

  function searchRow(task) {
    const row = element("button", "search-row");
    row.type = "button";
    const completed = Number(task.completed) === 1;
    const archived = Boolean(task.archivedAt);
    const marker = element("span", `search-row-marker${completed ? " done" : ""}`);
    marker.append(icon(completed ? "check" : "search"));
    const copy = element("span", "search-row-copy");
    copy.append(element("strong", "", task.title));
    if (task.description) copy.append(element("span", "search-row-description", task.description));
    const meta = element("span", "search-row-meta");
    const metaParts = [
      task.boardName || t("Board"),
      archived ? t("Archived") : (task.columnName || t("Task")),
      task.dueDate ? captureDueLabel(task) : null,
    ].filter(Boolean);
    metaParts.forEach((value, index) => {
      meta.append(element("span", "", value));
      if (index < metaParts.length - 1) meta.append(element("span", "search-meta-sep", "·"));
    });
    for (const pill of labelPills(task)) meta.append(pill);
    copy.append(meta);
    const side = element("span", "search-row-side");
    if (task.priority && task.priority !== "none") {
      side.append(element("span", `pill priority-${task.priority}`, priorityLabel(task.priority)));
    }
    side.append(element("span", "search-row-status", archived ? t("Archived") : completed ? t("Done") : t("Open")));
    if (task.assigneeName) side.append(element("span", "search-row-assignee", task.assigneeName));
    row.append(marker, copy, side, icon("chevron"));
    row.addEventListener("click", () => void openTaskById(task.id));
    return row;
  }

  async function loadInsights() {
    const grid = $("insightsGrid");
    try {
      const [data, taskPayload] = await Promise.all([
        request(`/api/insights?workspaceId=${encodeURIComponent(workspace().id)}`),
        request(`/api/tasks?workspaceId=${encodeURIComponent(workspace().id)}`),
      ]);
      const tasks = taskPayload?.tasks ?? [];
      const dated = tasks.filter((task) => task.dueDate);
      const range = Number(state.insightsRange || 30);
      const mode = state.insightsMode || "timeline";
      $("insightsTimelineButton").classList.toggle("active", mode === "timeline");
      $("insightsWorkloadButton").classList.toggle("active", mode === "workload");
      document.querySelectorAll("[data-range]").forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.range) === range);
      });
      $("insightsMeta").textContent = `${dated.length} ${t("dated tasks")} · ${Math.max(0, tasks.length - dated.length)} ${t("unscheduled")} · ${t("dates in Asia/Hong_Kong")}`;
      grid.replaceChildren();
      if (mode === "workload") {
        renderInsightsWorkload(grid, tasks, data);
        return;
      }
      renderInsightsTimeline(grid, tasks, dated, range);
    } catch (error) {
      grid.replaceChildren(element("div", "empty", error.message));
    }
  }

  function renderInsightsTimeline(grid, tasks, dated, range) {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const days = [];
    for (let index = 0; index < range; index++) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      days.push(date);
    }
    const timeline = element("div", "timeline");
    timeline.style.setProperty("--timeline-days", String(range));
    const header = element("div", "timeline-header");
    header.append(element("div", "timeline-label", t("Task")));
    const dates = element("div", "timeline-dates");
    for (const date of days) {
      const cell = element("span", dateKey(date) === localDateKey() ? "today" : "");
      cell.append(element("strong", "", new Intl.DateTimeFormat(state.settings?.locale || undefined, { weekday: "short" }).format(date).toUpperCase()));
      cell.append(element("small", "", new Intl.DateTimeFormat(state.settings?.locale || undefined, { month: "short", day: "numeric" }).format(date)));
      dates.append(cell);
    }
    header.append(dates);
    timeline.append(header);
    const groups = new Map();
    for (const task of dated) {
      const key = task.boardName || t("Board");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    for (const [boardName, boardTasks] of groups) {
      const group = element("div", "timeline-group");
      const label = element("div", "timeline-group-label");
      label.append(document.createTextNode(boardName), element("span", "", String(boardTasks.length)));
      group.append(label);
      for (const task of boardTasks) {
        const row = element("div", "timeline-row");
        const copy = element("button", "timeline-task");
        copy.type = "button";
        copy.append(element("span", "timeline-task-title", task.title));
        const meta = element("span", "timeline-task-meta");
        if (task.priority && task.priority !== "none") meta.append(element("span", `pill priority-${task.priority}`, priorityLabel(task.priority)));
        if (task.estimateMinutes) meta.append(element("span", "", `${task.estimateMinutes}m`));
        if (task.assigneeName) meta.append(element("span", "", task.assigneeName));
        copy.append(meta);
        copy.addEventListener("click", () => openTaskById(task.id));
        const track = element("div", "timeline-track");
        const due = new Date(`${String(task.dueDate).slice(0, 10)}T12:00:00`);
        const barStart = task.startDate ? new Date(`${String(task.startDate).slice(0, 10)}T12:00:00`) : due;
        const startIndex = Math.max(0, Math.min(range - 1, Math.round((barStart - start) / 86400000)));
        const endIndex = Math.max(startIndex, Math.min(range - 1, Math.round((due - start) / 86400000)));
        const bar = element("span", `timeline-bar${task.priority === "urgent" ? " urgent" : ""}${Number(task.completed) === 1 ? " done" : ""}`);
        bar.style.left = `${(startIndex / range) * 100}%`;
        bar.style.width = `${Math.max(1.6, ((endIndex - startIndex + 1) / range) * 100)}%`;
        bar.title = `${task.title} · ${String(task.dueDate).slice(0, 10)}`;
        bar.addEventListener("click", () => openTaskById(task.id));
        track.append(bar);
        row.append(copy, track);
        group.append(row);
      }
      timeline.append(group);
    }
    if (!dated.length) timeline.append(element("div", "empty", t("No dated tasks yet.")));
    const scroll = element("div", "timeline-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", t("Timeline"));
    scroll.append(timeline);
    grid.append(scroll);
    const unscheduled = tasks.filter((task) => !task.dueDate);
    if (unscheduled.length) {
      const block = element("div", "insights-unscheduled");
      block.append(element("h3", "", t("Unscheduled")));
      const list = element("div", "unscheduled-list");
      for (const task of unscheduled.slice(0, 20)) {
        const row = element("button", "unscheduled-row");
        row.type = "button";
        row.append(element("strong", "", task.title), element("span", "", task.boardName || ""));
        row.addEventListener("click", () => openTaskById(task.id));
        list.append(row);
      }
      block.append(list);
      grid.append(block);
    }
  }

  function renderInsightsWorkload(grid, tasks, data) {
    const metricGrid = element("div", "metric-grid");
    for (const [label, value] of [[t("Open"), data.open], [t("Done"), data.done], [t("Overdue"), data.overdue], [t("Priority groups"), (data.byPriority ?? []).length], [t("Dated"), tasks.filter((task) => task.dueDate).length]]) {
      const card = element("div", "metric-card");
      card.append(element("span", "", label), element("strong", "", String(value ?? 0)));
      metricGrid.append(card);
    }
    grid.append(metricGrid);
    const groups = new Map();
    for (const task of tasks) {
      const key = task.assigneeName || t("Unassigned");
      groups.set(key, (groups.get(key) ?? 0) + Number(task.estimateMinutes || 0));
    }
    const max = Math.max(1, ...groups.values());
    const card = element("div", "panel workload-panel");
    card.append(element("h2", "", t("Workload")), element("p", "hint", t("Estimated work by assignee. Unscheduled tasks included.")));
    for (const [name, minutes] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
      const row = element("div", "workload-row");
      const copy = element("div", "workload-copy");
      copy.append(element("strong", "", name), element("span", "", `${Math.floor(minutes / 60)}h ${minutes % 60}m ${t("estimated")}`));
      const bar = element("div", "workload-bar");
      const fill = element("span");
      fill.style.width = `${Math.round((minutes / max) * 100)}%`;
      bar.append(fill);
      row.append(copy, bar, element("span", "workload-time", `${Math.floor(minutes / 60)}h`));
      card.append(row);
    }
    grid.append(card);
  }

  function createWorkspace() {
    const backdrop = element("div", "modal-backdrop");
    const modal = element("div", "modal");
    modal.style.width = "min(480px, 100%)";
    const head = element("div", "modal-head");
    const headCopy = element("div");
    headCopy.append(element("p", "eyebrow", t("Workspace")), element("h2", "", t("New workspace")));
    const close = element("button", "btn ghost sm", "×");
    close.type = "button";
    close.setAttribute("aria-label", t("Close"));
    head.append(headCopy, close);
    const form = element("form", "form-grid");
    const nameField = element("label", "field");
    nameField.append(element("span", "", t("Name")));
    const name = element("input", "input");
    name.placeholder = t("Studio team");
    name.maxLength = 80;
    nameField.append(name);
    const typeField = element("label", "field");
    typeField.append(element("span", "", t("Type")));
    const type = element("select", "select");
    type.add(new Option(t("Team"), "team"));
    type.add(new Option(t("Organization"), "org"));
    typeField.append(type);
    const actions = element("div", "modal-actions");
    const cancel = element("button", "btn ghost", t("Cancel"));
    cancel.type = "button";
    const submit = element("button", "btn primary", t("Create workspace"));
    submit.type = "submit";
    submit.disabled = true;
    actions.append(cancel, submit);
    form.append(nameField, typeField);
    modal.append(head, form, actions);
    backdrop.append(modal);
    document.body.append(backdrop);
    const closeModal = () => {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKeydown);
    close.addEventListener("click", closeModal);
    cancel.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal();
    });
    name.addEventListener("input", () => {
      submit.disabled = !name.value.trim();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!name.value.trim()) return;
      submit.disabled = true;
      try {
        const result = await request("/api/workspaces", {
          method: "POST",
          body: { name: name.value.trim(), type: type.value },
        });
        state.boot = await request("/api/bootstrap");
        window.DriftOffline?.cacheBootstrap(state.boot);
        state.currentWorkspaceId = result.workspace.id;
        state.currentBoardId = boards()[0]?.id ?? null;
        renderSidebar();
        if (state.currentBoardId) await loadBoard(state.currentBoardId);
        setView("board");
        closeModal();
        showToast(t("Workspace created."));
      } catch (error) {
        showToast(error.message);
        submit.disabled = false;
      }
    });
    name.focus();
  }

  async function switchWorkspace(workspaceId) {
    state.currentWorkspaceId = workspaceId;
    state.currentBoardId = boards()[0]?.id ?? null;
    state.dayFlowAnchor = null;
    renderSidebar();
    if (state.currentBoardId) await loadBoard(state.currentBoardId);
    await loadToday();
    setView("board");
  }

  function renderBoardTemplates() {
    const container = $("boardCreateTemplates");
    if (!container) return;
    container.replaceChildren();
    const templates = state.boot?.templates ?? [];
    templates.forEach((template, index) => {
      const option = element("label", "template-option");
      const input = element("input", "");
      input.type = "radio";
      input.name = "boardTemplate";
      input.value = template.id;
      input.checked = index === 0;
      const copy = element("span", "template-copy");
      copy.append(element("strong", "", template.name || template.id));
      if (template.description) copy.append(element("span", "", template.description));
      option.append(input, copy, element("span", "badge slate", t("{{count}} columns", { count: template.columns?.length ?? 0 })));
      container.append(option);
    });
  }

  function openNewBoardModal() {
    $("boardCreateName").value = "";
    $("boardCreateDescription").value = "";
    $("boardCreateVisibility").value = "workspace";
    renderBoardTemplates();
    $("boardCreateModal").classList.remove("hidden");
    window.setTimeout(() => $("boardCreateName").focus(), 20);
  }

  async function createBoard(event) {
    event.preventDefault();
    const name = $("boardCreateName").value.trim();
    if (!name) return;
    const button = $("submitBoardCreate");
    button.disabled = true;
    try {
      const template = document.querySelector('input[name="boardTemplate"]:checked')?.value || "blank";
      const result = await request("/api/boards", {
        method: "POST",
        body: {
          workspaceId: workspace().id,
          name,
          description: $("boardCreateDescription").value.trim(),
          template,
          visibility: $("boardCreateVisibility").value,
        },
      });
      $("boardCreateModal").classList.add("hidden");
      await refreshBootstrap();
      state.currentBoardId = result.board.id;
      await loadBoard(result.board.id);
      setView("board");
      showToast(t("Board created."));
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function openColumnModal(column = null) {
    const board = currentBoard();
    if (!board) return;
    $("boardMoreMenu")?.classList.add("hidden");
    $("columnId").value = column?.id ?? "";
    $("columnModalTitle").textContent = column ? t("Column settings") : t("Add a column");
    $("columnName").value = column?.name ?? "";
    $("columnWipLimit").value = column?.wipLimit ?? "";
    $("columnWipEnforced").checked = Boolean(column?.wipEnforced);
    $("columnIsDone").checked = Boolean(column?.isDone);
    $("columnEditFields").classList.toggle("hidden", !column);
    $("submitColumn").textContent = column ? t("Save") : t("Add column");
    $("columnModal").classList.remove("hidden");
    window.setTimeout(() => $("columnName").focus(), 20);
  }

  async function saveColumn(event) {
    event.preventDefault();
    const board = currentBoard();
    if (!board) return;
    const columnId = $("columnId").value;
    const name = $("columnName").value.trim();
    if (!name) return;
    const wipText = $("columnWipLimit").value.trim();
    const button = $("submitColumn");
    button.disabled = true;
    try {
      const body = columnId
        ? {
            workspaceId: workspace().id,
            name,
            wipLimit: wipText ? Number(wipText) : null,
            wipEnforced: $("columnWipEnforced").checked,
            isDone: $("columnIsDone").checked,
          }
        : { workspaceId: workspace().id, boardId: board.id, name };
      await request(columnId ? `/api/columns/${encodeURIComponent(columnId)}` : "/api/columns", {
        method: columnId ? "PATCH" : "POST",
        body,
      });
      $("columnModal").classList.add("hidden");
      await loadBoard(board.id);
      showToast(t(columnId ? "Column updated." : "Column added."));
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteColumn(column) {
    const board = currentBoard();
    if (!board) return;
    if (!window.confirm(t("Delete the \"{{name}}\" column? It must be empty.", { name: column.name }))) return;
    try {
      await request(`/api/columns/${encodeURIComponent(column.id)}?workspaceId=${encodeURIComponent(workspace().id)}`, {
        method: "DELETE",
      });
      await loadBoard(board.id);
      showToast(t("Column deleted."));
    } catch (error) {
      showToast(error.message);
    }
  }

  function openBoardSettings() {
    const board = currentBoard();
    if (!board) return;
    $("boardSettingsName").value = board.name ?? "";
    $("boardSettingsDescription").value = board.description ?? "";
    $("boardSettingsVisibility").value = board.visibility ?? "workspace";
    $("boardSettingsModal").classList.remove("hidden");
    window.setTimeout(() => $("boardSettingsName").focus(), 20);
  }

  async function saveBoardSettings(event) {
    event.preventDefault();
    const board = currentBoard();
    if (!board) return;
    const name = $("boardSettingsName").value.trim();
    if (!name) return;
    const button = $("saveBoardSettings");
    button.disabled = true;
    try {
      await request(`/api/boards/${encodeURIComponent(board.id)}`, {
        method: "PATCH",
        body: {
          name,
          description: $("boardSettingsDescription").value.trim(),
          visibility: $("boardSettingsVisibility").value,
          version: board.version,
        },
      });
      $("boardSettingsModal").classList.add("hidden");
      await refreshBootstrap();
      await loadBoard(board.id);
      showToast(t("Board updated."));
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function toggleBoardShare() {
    const board = currentBoard();
    if (!board) return;
    const button = $("boardShareButton");
    button.disabled = true;
    try {
      const result = await request(`/api/boards/${encodeURIComponent(board.id)}/share`, {
        method: "POST",
        body: { enabled: !board.shareEnabled },
      });
      if (result.url) {
        let copied = false;
        try {
          await navigator.clipboard?.writeText(result.url);
          copied = Boolean(navigator.clipboard);
        } catch {
          copied = false;
        }
        showToast(copied
          ? t("Read-only link copied to clipboard.")
          : t("Read-only link: {{url}}", { url: result.url }));
      } else {
        showToast(t("Public link disabled."));
      }
      await refreshBootstrap();
      await loadBoard(board.id);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function duplicateBoard() {    const board = currentBoard();
    if (!board) return;
    try {
      const result = await request(`/api/boards/${encodeURIComponent(board.id)}/duplicate`, { method: "POST" });
      await refreshBootstrap();
      state.currentBoardId = result.board.id;
      await loadBoard(result.board.id);
      setView("board");
      showToast(t("Board duplicated."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function archiveBoard() {
    const board = currentBoard();
    if (!board) return;
    if (!window.confirm(t("Archive \"{{name}}\"? You can restore it later.", { name: board.name }))) return;
    try {
      await request(`/api/boards/${encodeURIComponent(board.id)}`, {
        method: "PATCH",
        body: { archived: true, version: board.version },
      });
      await refreshBootstrap();
      const next = boards()[0] ?? null;
      state.currentBoardId = next?.id ?? null;
      if (next) await loadBoard(next.id);
      setView("board");
      showToast(t("Board archived."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteCurrentBoard() {
    const board = currentBoard();
    if (!board) return;
    const workspaceId = workspace().id;
    if (!window.confirm(t("Delete \"{{name}}\"? You can undo for a few seconds.", { name: board.name }))) return;
    try {
      const result = await request(`/api/boards/${encodeURIComponent(board.id)}`, { method: "DELETE" });
      await refreshBootstrap();
      const next = boards()[0] ?? null;
      state.currentBoardId = next?.id ?? null;
      if (next) await loadBoard(next.id);
      setView("board");
      showToast(t("Board deleted."), undoToastAction(result?.undo, async () => {
        state.currentWorkspaceId = workspaceId;
        await refreshBootstrap();
        state.currentBoardId = board.id;
        await loadBoard(board.id);
        setView("board");
      }));
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderSidebar() {
    const workspaceSelect = $("workspaceSelect");
    workspaceSelect.replaceChildren();
    for (const item of state.boot?.workspaces ?? []) {
      workspaceSelect.add(new Option(item.name, item.id));
    }
    if (workspace()) workspaceSelect.value = workspace().id;
    $("newBoardButton").classList.toggle("hidden", !["OWNER", "ADMIN", "MEMBER"].includes(workspace()?.role));
    $("topbarWorkspace").textContent = workspace()?.name ?? t("Workspace");
    $("workspaceInitial").textContent = (workspace()?.name ?? "W").trim().slice(0, 1).toUpperCase();

    const list = $("boardList");
    list.replaceChildren();
    for (const board of boards()) {
      const button = element("button", "board-link");
      button.type = "button";
      button.dataset.boardId = board.id;
      button.append(icon("board"), element("span", "board-name", board.name));
      if (board.taskCount != null) button.append(element("span", "board-count", String(board.taskCount)));
      if (board.id === state.currentBoardId) button.classList.add("active");
      button.addEventListener("click", async () => {
        state.currentBoardId = board.id;
        await loadBoard(board.id);
        setView("board");
        renderSidebar();
      });
      list.append(button);
    }
  }

  async function loadBoard(boardId) {
    let data;
    try {
      data = await request(`/api/boards/${encodeURIComponent(boardId)}`);
      window.DriftOffline?.cacheBoard(boardId, data);
    } catch (error) {
      if (error.code === "NETWORK_ERROR") {
        const cached = window.DriftOffline?.readCachedBoard(boardId);
        if (cached) {
          state.offline = true;
          state.board = cached;
          state.currentBoardId = boardId;
          renderBoard();
          renderSidebar();
          updateOfflineBanner();
          return;
        }
      }
      throw error;
    }
    state.board = data;
    state.currentBoardId = boardId;
    renderBoard();
    renderSidebar();
    scheduleAutoPlanRefresh();
  }

  async function loadToday() {
    const current = workspace();
    if (!current) return;
    try {
      state.today = await request(`/api/today?workspaceId=${encodeURIComponent(current.id)}`);
      window.DriftOffline?.cacheToday(current.id, state.today);
    } catch (error) {
      if (error.code === "NETWORK_ERROR") {
        const cached = window.DriftOffline?.readCachedToday(current.id);
        if (cached) {
          state.offline = true;
          state.today = cached;
          updateOfflineBanner();
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    renderToday();
    scheduleAutoPlanRefresh();
  }

  function setView(view) {
    state.view = view;
    document.body.dataset.view = view;
    for (const [id, name] of [["todayView", "today"], ["boardView", "board"], ["calendarView", "calendar"], ["upcomingView", "upcoming"], ["archiveView", "archive"], ["searchView", "search"], ["insightsView", "insights"], ["settingsView", "settings"]]) {
      $(id).classList.toggle("hidden", name !== view);
    }
    document.querySelectorAll(".nav button, .mobile-nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    const viewLabels = {
      today: t("Today"), board: currentBoard()?.name ?? t("Board"), calendar: t("Calendar"),
      upcoming: t("Upcoming"), archive: t("Archive"), search: t("Search"),
      insights: t("Insights"), settings: t("Settings"),
    };
    $("topbarView").textContent = viewLabels[view] ?? t("Today");
    if (view === "board") {
      $("viewEyebrow").textContent = t("Board");
      $("viewTitle").textContent = currentBoard()?.name ?? t("Board");
    } else if (view === "calendar") {
      $("viewEyebrow").textContent = t("Calendar");
      $("viewTitle").textContent = t("Calendar");
      void loadCalendar();
    } else if (view === "upcoming") {
      $("viewEyebrow").textContent = t("Plan");
      $("viewTitle").textContent = t("Upcoming");
      void loadUpcoming();
    } else if (view === "archive") {
      $("viewEyebrow").textContent = t("Workspace");
      $("viewTitle").textContent = t("Archive");
      void loadArchive();
    } else if (view === "search") {
      $("viewEyebrow").textContent = t("Search");
      $("viewTitle").textContent = t("Search");
      void runSearch();
      window.setTimeout(() => $("searchInput").focus(), 20);
    } else if (view === "insights") {
      $("viewEyebrow").textContent = t("Workspace");
      $("viewTitle").textContent = t("Insights");
      void loadInsights();
    } else if (view === "settings") {
      $("viewEyebrow").textContent = t("Account & workspace");
      $("viewTitle").textContent = t("Settings");
      if (!state.settings) void loadSettings();
      window.setTimeout(focusSettingsHash, 30);
    } else {
      $("viewEyebrow").textContent = t("Plan");
      $("viewTitle").textContent = t("Today");
      void loadToday();
    }
  }

  function toggleTaskSelection(taskId, selected) {
    if (selected) state.selectedTaskIds.add(taskId);
    else state.selectedTaskIds.delete(taskId);
    const card = document.querySelector(`.card[data-task-id="${CSS.escape(taskId)}"]`);
    card?.classList.toggle("selected", selected);
    renderBulkToolbar();
  }

  function clearTaskSelection() {
    state.selectedTaskIds.clear();
    document.querySelectorAll(".card.selected").forEach((card) => card.classList.remove("selected"));
    document.querySelectorAll(".task-select").forEach((checkbox) => { checkbox.checked = false; });
    renderBulkToolbar();
  }

  function renderBulkToolbar() {
    const toolbar = $("bulkToolbar");
    if (!toolbar) return;
    const count = state.selectedTaskIds.size;
    const columns = currentBoard()?.columns ?? [];
    toolbar.classList.toggle("hidden", count === 0);
    $("bulkCount").textContent = t("{{count}} selected", { count });
    const select = $("bulkMoveTarget");
    const previous = state.bulkTargetColumn;
    select.replaceChildren();
    for (const column of columns) select.add(new Option(column.name, column.id));
    if (previous && columns.some((column) => column.id === previous)) select.value = previous;
    else if (columns.length) select.value = columns[0].id;
    state.bulkTargetColumn = select.value;
    const disabled = state.bulkBusy || count === 0;
    for (const id of ["bulkCompleteButton", "bulkArchiveButton", "bulkMoveButton", "bulkDeleteButton"]) {
      $(id).disabled = disabled;
    }
    select.disabled = disabled;
    $("bulkClearButton").disabled = state.bulkBusy;
  }

  async function runBulkTaskAction(action) {
    const taskIds = [...state.selectedTaskIds];
    if (!taskIds.length || state.bulkBusy) return;
    if (action === "delete" && !window.confirm(t("Delete {{count}} selected tasks? You can undo for a few seconds.", { count: taskIds.length }))) return;
    const targetColumnId = action === "move" ? $("bulkMoveTarget").value : null;
    state.bulkBusy = true;
    renderBulkToolbar();
    try {
      const body = { workspaceId: workspace().id, taskIds, action };
      if (action === "move") body.columnId = targetColumnId;
      const result = await request("/api/tasks/bulk", { method: "POST", body });
      state.selectedTaskIds.clear();
      await loadBoard(state.currentBoardId);
      await loadToday();
      const messages = {
        complete: taskIds.length === 1 ? "{{count}} task completed." : "{{count}} tasks completed.",
        archive: taskIds.length === 1 ? "{{count}} task archived." : "{{count}} tasks archived.",
        delete: taskIds.length === 1 ? "{{count}} task deleted." : "{{count}} tasks deleted.",
        move: taskIds.length === 1 ? "{{count}} task moved." : "{{count}} tasks moved.",
      };
      showToast(t(messages[action], { count: result.affected ?? taskIds.length }), undoToastAction(result.undo, async () => {
        await loadBoard(state.currentBoardId);
        await loadToday();
        renderBulkToolbar();
      }));
    } catch (error) {
      showToast(error.message);
    } finally {
      state.bulkBusy = false;
      renderBulkToolbar();
    }
  }

  function renderBoard() {
    const container = $("board");
    container.replaceChildren();
    const board = currentBoard();
    if (!board) return;
    $("viewTitle").textContent = board.name;
    $("boardTitle").textContent = board.name;
    $("boardDescription").textContent = board.description || t("A quiet place to move work forward.");
    const visibility = board.visibility === "private" ? t("Private board") : t("Shared with workspace");
    $("boardVisibility").textContent = visibility;
    $("boardEyebrow").textContent = `${workspace()?.name ?? t("Workspace")} · ${visibility}`;
    const flatTasks = (board.columns ?? []).flatMap((column) => column.tasks ?? []);
    const activeTaskIds = new Set(flatTasks.map((task) => task.id));
    for (const taskId of [...state.selectedTaskIds]) {
      if (!activeTaskIds.has(taskId)) state.selectedTaskIds.delete(taskId);
    }
    const openCount = flatTasks.filter((task) => Number(task.completed) !== 1).length;
    const doneCount = flatTasks.length - openCount;
    $("boardMeta").textContent = doneCount
      ? t("· {{open}} open · {{done}} done", { open: openCount, done: doneCount })
      : t("· {{open}} open", { open: openCount });

    const assigneeFilter = $("boardAssigneeFilter");
    const selectedAssignee = state.boardAssignee || "";
    const assignees = [...new Set(flatTasks.map((task) => task.assignee?.name || task.assigneeName || "").filter(Boolean))].sort();
    assigneeFilter.replaceChildren(new Option(t("Everyone"), ""));
    for (const assignee of assignees) assigneeFilter.add(new Option(assignee, assignee));
    assigneeFilter.value = assignees.includes(selectedAssignee) ? selectedAssignee : "";
    state.boardAssignee = assigneeFilter.value;

    const filterText = String(state.boardFilterText || "").toLowerCase();
    const priorityFilter = state.boardPriority || "";
    const assigneeName = state.boardAssignee || "";
    const visibleTasks = flatTasks.filter((task) => {
      const assignee = task.assignee?.name || task.assigneeName || "";
      return (!filterText || `${task.title} ${task.description || ""}`.toLowerCase().includes(filterText))
        && (!priorityFilter || task.priority === priorityFilter)
        && (!assigneeName || assignee === assigneeName);
    });
    const taskMatches = (task) => visibleTasks.includes(task);
    $("boardTaskCount").textContent = `${visibleTasks.length} ${t(visibleTasks.length === 1 ? "task" : "tasks")}`;
    $("boardSettingsButton").disabled = !(board.permissions?.canEdit ?? true);
    $("boardShareButton").disabled = !(board.permissions?.canShare ?? true);
    $("boardShareButton").textContent = board.shareEnabled ? t("Disable share") : t("Share link");
    $("boardDuplicateButton").disabled = !(board.permissions?.canEdit ?? true);
    $("boardArchiveButton").disabled = !(board.permissions?.canEdit ?? true);
    $("boardDeleteButton").classList.toggle("hidden", !(board.permissions?.canManage ?? true));
    $("boardViewButton").classList.toggle("active", state.boardMode !== "list");
    $("listViewButton").classList.toggle("active", state.boardMode === "list");

    if (state.boardMode === "list") {
      container.classList.add("list-mode");
      const table = element("div", "board-list-table");
      const header = element("div", "board-list-row board-list-head");
      header.append(element("span", "", t("Task")), element("span", "row-status", t("Status")),
        element("span", "row-priority", t("Priority")), element("span", "row-due", t("Due")), element("span", ""));
      table.append(header);
      for (const task of visibleTasks) {
        const row = element("div", "board-list-row");
        const copy = element("div");
        copy.append(element("strong", "", task.title));
        if (task.description) copy.append(element("div", "list-meta", task.description));
        const column = (board.columns ?? []).find((item) => item.id === task.columnId);
        row.append(copy, element("span", "row-status list-done", column?.isDone ? t("Done") : (column?.name || t("Open"))),
          element("span", "row-priority", priorityLabel(task.priority)),
          element("span", "row-due", task.dueDate ? String(task.dueDate).slice(0, 10) : "—"),
          icon("chevron"));
        row.addEventListener("click", () => openTaskModal(task));
        table.append(row);
      }
      if (!visibleTasks.length) table.append(element("div", "empty", t("No tasks match these filters.")));
      container.append(table);
      return;
    }
    container.classList.remove("list-mode");
    const canEdit = board.permissions?.canEdit ?? true;
    for (const column of board.columns ?? []) {
      const allColumnTasks = column.tasks ?? [];
      const openInColumn = allColumnTasks.filter((task) => Number(task.completed) !== 1).length;
      const columnTasks = allColumnTasks.filter(taskMatches);
      const columnCount = column.isDone
        ? columnTasks.length
        : columnTasks.filter((task) => Number(task.completed) !== 1).length;
      const wipOver = Boolean(column.wipEnforced && column.wipLimit && openInColumn > column.wipLimit);
      const wipNear = Boolean(column.wipEnforced && column.wipLimit && openInColumn === column.wipLimit);
      const columnNode = element("section", `column${wipOver || wipNear ? " wip-near" : ""}`);
      columnNode.dataset.columnId = column.id;
      columnNode.setAttribute("aria-label", `${column.name}, ${allColumnTasks.length} ${allColumnTasks.length === 1 ? t("task") : t("tasks")}`);

      const head = element("div", "column-head");
      const dot = element("span", `column-dot${column.isDone ? " done" : ""}`);
      dot.setAttribute("aria-hidden", "true");
      const title = element("h2", "column-title");
      title.append(document.createTextNode(column.name));
      title.append(element("span", "count", String(columnCount)));
      if (column.wipEnforced && column.wipLimit) {
        title.append(element("span", `wip-label${wipOver ? " rose" : ""}`, `WIP ${openInColumn}/${column.wipLimit}`));
      }
      const actions = element("div", "column-head-actions");
      if (canEdit) {
        const addHere = element("button", "icon-btn sm", "");
        addHere.type = "button";
        addHere.title = t("Add task to {{name}}", { name: column.name });
        addHere.setAttribute("aria-label", t("Add task to {{name}}", { name: column.name }));
        addHere.append(icon("plus"));
        addHere.addEventListener("click", () => openTaskModal(null, column.id));
        actions.append(addHere);

        const menuWrap = element("div", "column-menu-wrap");
        const trigger = element("button", "icon-btn sm", "⋯");
        trigger.type = "button";
        trigger.title = t("{{name}} actions", { name: column.name });
        trigger.setAttribute("aria-label", t("{{name}} actions", { name: column.name }));
        const menu = element("div", "board-more-menu column-menu hidden");
        const settings = element("button", "menu-item", t("Column settings"));
        settings.type = "button";
        const wip = element("button", "menu-item", t("WIP limit"));
        wip.type = "button";
        const separator = element("div", "menu-sep");
        const remove = element("button", "menu-item danger", t("Delete column"));
        remove.type = "button";
        const openColumnMenu = () => {
          const wasHidden = menu.classList.contains("hidden");
          document.querySelectorAll(".column-menu").forEach((item) => item.classList.add("hidden"));
          if (wasHidden) menu.classList.remove("hidden");
        };
        trigger.addEventListener("click", (event) => {
          event.stopPropagation();
          openColumnMenu();
        });
        menu.addEventListener("click", (event) => event.stopPropagation());
        settings.addEventListener("click", () => {
          menu.classList.add("hidden");
          openColumnModal(column);
        });
        wip.addEventListener("click", () => {
          menu.classList.add("hidden");
          openColumnModal(column);
        });
        remove.addEventListener("click", () => {
          menu.classList.add("hidden");
          void deleteColumn(column);
        });
        menu.append(settings, wip, separator, remove);
        menuWrap.append(trigger, menu);
        actions.append(menuWrap);
      }
      head.append(dot, title, actions);
      columnNode.append(head);

      const cards = element("div", "cards");
      for (const task of columnTasks) cards.append(taskCard(task));
      columnNode.append(cards);

      if (canEdit) {
        const add = element("button", "add-card", `+ ${t("Add task")}`);
        add.type = "button";
        add.addEventListener("click", () => openTaskModal(null, column.id));
        columnNode.append(add);
      }

      columnNode.addEventListener("dragover", (event) => event.preventDefault());
      columnNode.addEventListener("drop", async (event) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData("text/task-id");
        if (!taskId) return;
        const task = allTasks().find((item) => item.id === taskId);
        if (!task || task.columnId === column.id) return;
        try {
          const result = await requestOrQueue(
            `/api/tasks/${encodeURIComponent(taskId)}/move`,
            { method: "PATCH", body: { version: task.version, columnId: column.id } },
            { kind: "task.move", label: task.title }
          );
          if (result?.queued) {
            window.DriftSound?.play("tap");
            showToast(t("Saved on this device — will sync when you reconnect."));
            return;
          }
          await loadBoard(state.currentBoardId);
          window.DriftSound?.play("move");
          showToast(
            t("Task moved.") + (result?.nextTaskId ? ` ${t("Next occurrence created.")}` : ""),
            undoToastAction(result?.undo, async () => {
              await loadBoard(state.currentBoardId);
              await loadToday();
            })
          );
        } catch (error) {
          showToast(error.message);
        }
      });

      container.append(columnNode);
    }
    if (canEdit) {
      const addColumn = element("button", "column column-add-column");
      addColumn.type = "button";
      addColumn.append(icon("plus"), document.createTextNode(` ${t("Add column")}`));
      addColumn.addEventListener("click", () => openColumnModal());
      container.append(addColumn);
    }
    renderBulkToolbar();
  }

  function taskCard(task) {
    const card = element("article", `card${state.selectedTaskIds.has(task.id) ? " selected" : ""}`);
    card.dataset.taskId = task.id;
    card.draggable = true;
    card.tabIndex = 0;
    card.addEventListener("click", () => openTaskModal(task));
    card.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        void keyboardMoveTask(task, event.key);
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        void keyboardReorderTask(task, event.key);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTaskModal(task);
      }
    });
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/task-id", task.id);
      event.dataTransfer.effectAllowed = "move";
    });

    const top = element("div", "card-top-meta");
    if (task.priority && task.priority !== "none") top.append(element("span", `pill priority-${task.priority}`, priorityLabel(task.priority)));
    for (const label of task.labels ?? []) {
      top.append(element("span", `pill label-${label.color || "slate"}`, label.name));
    }
    card.append(top, element("h3", "", task.title));
    if (task.description) card.append(element("p", "card-description", task.description));
    const foot = element("div", "card-foot");
    const facts = element("div", "card-facts");
    if (task.dueDate) {
      const due = element("span", "card-fact");
      due.append(icon("calendar"), document.createTextNode(` ${captureDueLabel(task)}`));
      if (String(task.dueDate).slice(0, 10) < localDateKey() && Number(task.completed) !== 1) due.classList.add("overdue");
      facts.append(due);
    }
    if (task.estimateMinutes) {
      const estimate = element("span", "card-fact");
      estimate.append(icon("insights"), document.createTextNode(` ${task.estimateMinutes}m`));
      facts.append(estimate);
    }
    if (Number(task.subtaskCount || 0) > 0) {
      const checklist = element("span", "card-fact");
      checklist.append(icon("list"), document.createTextNode(` ${Number(task.subtaskDone || 0)}/${Number(task.subtaskCount)}`));
      facts.append(checklist);
    }
    if (Number(task.commentCount || 0) > 0) {
      const comments = element("span", "card-fact");
      comments.append(icon("message"), document.createTextNode(` ${Number(task.commentCount)}`));
      facts.append(comments);
    }
    if (task.recurrenceRule) {
      const repeat = element("span", "card-fact");
      repeat.title = t("Repeats");
      repeat.append(icon("calendar-up"), document.createTextNode(` ${describeRecurrence(task.recurrenceRule)}`));
      facts.append(repeat);
    }
    foot.append(facts);
    if (task.assignee) {
      const avatar = element("span", "avatar-sm", initials(task.assignee.name));
      avatar.title = task.assignee.name || task.assignee.email || "";
      foot.append(avatar);
    }
    const select = element("input", "task-select");
    select.type = "checkbox";
    select.checked = state.selectedTaskIds.has(task.id);
    select.title = t("Select task");
    select.setAttribute("aria-label", t("Select task"));
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("dragstart", (event) => event.preventDefault());
    select.addEventListener("change", () => toggleTaskSelection(task.id, select.checked));
    card.append(foot, select);
    return card;
  }

  function renderToday() {
    const list = $("todayList");
    list.replaceChildren();
    const suggestions = state.today?.suggestions ?? [];
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
    const name = state.boot?.user?.name || t("there");
    $("todayGreeting").textContent = `${greeting}, ${name}.`;
    $("todayDateLabel").textContent = new Intl.DateTimeFormat(state.settings?.locale || undefined, {
      weekday: "long", month: "long", day: "numeric",
    }).format(now).toUpperCase();
    if (!suggestions.length) {
      list.append(element("div", "empty", t("Nothing open. Add a task to begin.")));
    }
    for (const task of suggestions.slice(0, 50)) {
      const row = element("div", "today-row");
      const grow = element("div", "grow");
      grow.append(element("h3", "", task.title));
      const bits = [];
      if (task.reason) bits.push(translateReason(task.reason));
      if (task.blocked && task.openDependencies) bits.push(`${task.openDependencies} ${t(task.openDependencies === 1 ? "open dependency" : "open dependencies")}`);
      if (task.estimateMinutes) bits.push(`${task.estimateMinutes}m`);
      if (task.actualMinutes) bits.push(`${task.actualMinutes}${t("m tracked")}`);
      if (task.startDate) bits.push(`${t("starts")} ${task.startDate.slice(0, 10)}`);
      if (task.dueDate) bits.push(`${t("due")} ${task.dueDate.slice(0, 10)}`);
      grow.append(element("p", "", bits.join(" · ")));

      const actions = element("div", "top-actions");
      const choose = element("button", "btn sm", t(task.accepted ? "Chosen" : "Choose"));
      choose.type = "button";
      choose.disabled = Boolean(task.accepted || task.blocked);
      choose.addEventListener("click", () => todayAction("accept", task.id));
      const dismiss = element("button", "btn ghost sm", t("Dismiss"));
      dismiss.type = "button";
      dismiss.addEventListener("click", () => todayAction("dismiss", task.id));
      const open = element("button", "btn sm", t("Open"));
      open.type = "button";
      open.addEventListener("click", () => openTaskModal(task));
      actions.append(choose, dismiss, open);
      row.append(grow, actions);
      list.append(row);
    }

    const capacity = state.today?.capacity ?? { totalMinutes: 300, selectedMinutes: 0 };
    const selected = Number(capacity.selectedMinutes || 0);
    const total = Number(capacity.totalMinutes || 300);
    const percent = total ? Math.min(100, Math.round((selected / total) * 100)) : 0;
    $("capacityNumber").textContent = `${Math.floor(selected / 60)}h ${selected % 60}m`;
    $("capacityTotal").textContent = String(total);
    const minutesLeft = Math.max(0, total - selected);
    $("capacityBar").firstElementChild.style.width = `${percent}%`;
    $("capacityHint").textContent = capacity.overbooked
      ? t("This day is over capacity.")
      : t("{{count}} minutes still open.", { count: minutesLeft });
    const capacityBadge = $("capacityBadge");
    capacityBadge.textContent = capacity.overbooked ? t("Over capacity") : percent >= 80 ? t("Nearly full") : t("Open");
    capacityBadge.className = `badge ${capacity.overbooked ? "danger" : percent >= 80 ? "amber" : "moss"}`;
    $("capacitySuggested").textContent = `${suggestions.length} ${t("suggested")}`;
    $("glanceOpen").textContent = String(suggestions.length);
    $("glanceDue").textContent = String(suggestions.filter((task) => String(task.dueDate || "").slice(0, 10) === dateKey(now)).length);
    $("glanceChosen").textContent = String(suggestions.filter((task) => task.selected || task.accepted).length);

    const blocks = state.today?.planBlocks ?? [];
    const planned = blocks.reduce((sum, block) => sum + Number(block.minutes || 0), selected);
    $("todayPlanStats").textContent = `${blocks.length} ${t("blocks today")} · ${Math.floor(planned / 60)}h ${planned % 60}m ${t("planned")}`;
    const week = [];
    for (let offset = 0; offset < 5; offset++) {
      const day = new Date(now);
      day.setDate(now.getDate() + offset);
      const key = dateKey(day);
      const minutes = blocks.filter((block) => block.date === key).reduce((sum, block) => sum + Number(block.minutes || 0), 0)
        + suggestions.filter((task) => String(task.dueDate || "").slice(0, 10) === key && !task.selected).reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0);
      week.push({ key, label: new Intl.DateTimeFormat(state.settings?.locale || undefined, { weekday: "short", day: "numeric" }).format(day), minutes });
    }
    $("todayPlanWeek").replaceChildren(...week.map((entry) => {
      const item = element("span", "auto-plan-week-item");
      item.append(element("strong", "", entry.label));
      const bar = element("i");
      bar.style.width = `${Math.min(100, Math.round((entry.minutes / Math.max(1, total)) * 100))}%`;
      item.append(bar, element("small", "", entry.minutes ? `${Math.floor(entry.minutes / 60)}h ${entry.minutes % 60}m` : "0m"));
      return item;
    }));
    $("applyTodayPlanButton").disabled = !suggestions.some((task) => task.selected);
    $("applyTodayPlanButton").textContent = t("Apply plan");
    renderDayFlow(suggestions);
  }

  const DAY_MINUTES = 24 * 60;
  const DAY_FLOW_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

  function dayFlowClock(minutes) {
    const value = ((Math.round(Number(minutes) || 0) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const hour = Math.floor(value / 60);
    const minute = value % 60;
    const format = state.settings?.timeFormat || "auto";
    if (format === "24") return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    if (format === "12") {
      const suffix = hour >= 12 ? "PM" : "AM";
      return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
    }
    try {
      return new Intl.DateTimeFormat(state.settings?.locale || undefined, { hour: "numeric", minute: "2-digit" })
        .format(new Date(2000, 0, 1, hour, minute));
    } catch {
      return `${hour}:${String(minute).padStart(2, "0")}`;
    }
  }

  function currentDayMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function dayFlowAnchor() {
    if (!state.dayFlowAnchor) {
      state.dayFlowAnchor = Math.max(6 * 60, Math.ceil(currentDayMinutes() / 15) * 15);
    }
    return state.dayFlowAnchor;
  }

  function renderDayFlow(suggestions) {
    const rail = $("dayFlowRail");
    const grid = $("dayFlowGrid");
    const settings = state.settings ?? {};
    const workdayStart = Number.isFinite(Number(settings.workdayStart)) ? Number(settings.workdayStart) : 9;
    const workdayEnd = Number.isFinite(Number(settings.workdayEnd)) ? Number(settings.workdayEnd) : 18;
    const buffer = Math.max(0, Number(settings.blockBufferMinutes) || 0);
    const nowMinutes = currentDayMinutes();
    const capacity = state.today?.capacity ?? { totalMinutes: 300, selectedMinutes: 0, percent: 0, overbooked: false };

    grid.replaceChildren();
    if (workdayStart > 0) {
      const outside = element("span", "day-flow-outside");
      outside.style.left = "0";
      outside.style.width = `${(workdayStart / 24) * 100}%`;
      grid.append(outside);
    }
    if (workdayEnd < 24) {
      const outside = element("span", "day-flow-outside");
      outside.style.left = `${(workdayEnd / 24) * 100}%`;
      outside.style.width = `${((24 - workdayEnd) / 24) * 100}%`;
      grid.append(outside);
    }
    for (const hour of DAY_FLOW_HOURS) {
      const line = element("span", "day-flow-grid-line");
      line.style.left = `${(hour / 24) * 100}%`;
      grid.append(line);
    }
    grid.append(element("span", "day-flow-night"));
    const nowMarker = element("span", "day-flow-now");
    nowMarker.style.left = `${(nowMinutes / DAY_MINUTES) * 100}%`;
    nowMarker.append(element("span", "", "now"));
    grid.append(nowMarker);

    rail.querySelectorAll(".day-flow-block").forEach((node) => node.remove());
    rail.querySelectorAll(".day-flow-empty").forEach((node) => node.remove());
    const selected = suggestions.filter((task) => task.accepted || task.selected).slice(0, 14);
    const scheduled = (state.today?.planBlocks ?? [])
      .map((block) => {
        const task = suggestions.find((entry) => entry.id === block.taskId);
        if (!task || (!task.accepted && !task.selected)) return null;
        return { task: { ...task, accepted: true }, start: Number(block.startMinute), duration: Number(block.minutes), blockId: block.id };
      })
      .filter(Boolean);
    const scheduledIds = new Set(scheduled.map((block) => block.task.id));
    let cursor = scheduled.length
      ? scheduled.reduce((end, block) => Math.max(end, block.start + block.duration), dayFlowAnchor()) + buffer
      : dayFlowAnchor();
    const fallback = [];
    for (const task of selected) {
      if (scheduledIds.has(task.id)) continue;
      const duration = Math.max(15, Number(task.estimateMinutes) || 30);
      let start = cursor;
      if (start + duration > DAY_MINUTES) start = Math.max(0, DAY_MINUTES - duration);
      fallback.push({ task, start, duration });
      cursor = start + duration + buffer;
    }
    const blocks = [...scheduled, ...fallback];

    if (!blocks.length) {
      const empty = element("div", "day-flow-empty");
      empty.append(element("span", "day-flow-empty-mark", "◷"));
      empty.append(element("span", "", t("Nothing on the rail yet. Choose one task below and watch the day take shape.")));
      rail.append(empty);
    }

    for (const block of blocks) {
      const { task, start, duration } = block;
      const button = element("button", `day-flow-block ${task.accepted ? "chosen" : "suggested"} priority-${task.priority || "none"}${task.blocked ? " blocked" : ""}`);
      button.type = "button";
      button.draggable = true;
      button.style.left = `${(start / DAY_MINUTES) * 100}%`;
      button.style.width = `${Math.max(0.7, (duration / DAY_MINUTES) * 100)}%`;
      button.title = `${dayFlowClock(start)}–${dayFlowClock(start + duration)} · ${task.title}`;
      button.setAttribute("aria-label", `${task.title}, ${dayFlowClock(start)} to ${dayFlowClock(start + duration)}`);
      const mark = element("span", "day-flow-block-mark", task.accepted ? "✓" : "");
      if (!task.accepted) mark.append(element("span", ""));
      button.append(mark);
      if (duration >= 60) {
        button.append(element("span", "day-flow-block-title", task.title));
        button.append(element("span", "day-flow-block-time", `${dayFlowClock(start)} · ${duration}m`));
      }
      button.addEventListener("click", () => openTaskModal(task));
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        state.draggingTaskId = task.id;
        button.classList.add("dragging");
      });
      button.addEventListener("dragend", () => {
        state.draggingTaskId = null;
        button.classList.remove("dragging");
      });
      rail.append(button);
    }

    const hours = $("dayFlowHours");
    hours.replaceChildren();
    for (const hour of [0, 6, 12, 18, 24]) {
      const label = element("span", "", hour === 24 ? (settings.timeFormat === "24" ? "24:00" : "12 AM") : dayFlowClock(hour * 60));
      label.style.left = `${(hour / 24) * 100}%`;
      hours.append(label);
    }

    const percent = Math.max(0, Math.min(100, Number(capacity.percent) || 0));
    const circumference = 2 * Math.PI * 31;
    const arc = $("dayFlowRingValueArc");
    arc.style.strokeDasharray = String(circumference);
    arc.style.strokeDashoffset = String(circumference * (1 - percent / 100));
    $("dayFlowRing").classList.toggle("over", Boolean(capacity.overbooked));
    $("dayFlowRingValue").textContent = `${Math.round(Number(capacity.percent) || 0)}%`;
    $("dayFlowRingLabel").textContent = t(capacity.overbooked ? "over" : "planned");

    const next = blocks.find((block) => block.start + block.duration >= nowMinutes) ?? null;
    const nextNode = $("dayFlowNext");
    nextNode.replaceChildren();
    if (next) {
      nextNode.append(element("span", "day-flow-next-dot"));
      const copy = element("span");
      copy.append(element("strong", "", next.task.title));
      copy.append(element("span", "", `${dayFlowClock(next.start)} · ${next.duration}m · ${t(next.task.accepted ? "chosen" : "suggestion")}`));
      nextNode.append(copy);
    } else {
      const copy = element("span");
      copy.append(element("strong", "", t(blocks.length ? "The rail is behind you." : "The rail is clear.")));
      copy.append(element("span", "", t(blocks.length ? "Pick one small thing for the rest of the day, or stop here." : "Protect the empty space, or add one small thing.")));
      nextNode.append(copy);
    }
    const focusNext = $("dayFlowFocusNext");
    focusNext.classList.toggle("hidden", !next);
    focusNext.onclick = next ? () => openFocus(next.task) : null;

    const wrap = $("dayFlowRailWrap");
    window.requestAnimationFrame(() => {
      if (wrap.scrollWidth <= wrap.clientWidth + 1) return;
      const focus = blocks[0]?.start ?? nowMinutes;
      const target = (focus / DAY_MINUTES) * wrap.scrollWidth - wrap.clientWidth / 2;
      wrap.scrollLeft = Math.max(0, Math.min(wrap.scrollWidth - wrap.clientWidth, target));
    });
  }

  function minutesLabel(minutes) {
    const value = Number(minutes) || 0;
    const hour = Math.floor(value / 60);
    const minute = value % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  async function openAutoPlan() {
    try {
      const result = await request("/api/auto-plan", {
        method: "POST",
        body: { action: "preview", workspaceId: workspace().id },
      });
      if (result.enabled === false || !(result.options ?? []).length) {
        showToast(t("Auto-plan is turned off in Settings."));
        return;
      }
      state.autoPlan = result;
      state.autoPlanSelection = result.options.some((option) => option.id === state.autoPlanSelection)
        ? state.autoPlanSelection
        : result.options[0].id;
      renderAutoPlan();
      $("autoPlanModal").classList.remove("hidden");
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderAutoPlan() {
    const container = $("autoPlanPreview");
    container.replaceChildren();
    const options = state.autoPlan?.options ?? [];
    const selected = options.find((option) => option.id === state.autoPlanSelection) ?? options[0] ?? null;
    if (!options.length) {
      container.append(element("div", "empty", t("Auto-plan is turned off in Settings.")));
    }
    for (const option of options) {
      const panel = element("div", `detail-section auto-plan-option${selected?.id === option.id ? " active" : ""}`);
      panel.tabIndex = 0;
      panel.setAttribute("role", "button");
      panel.setAttribute("aria-pressed", String(selected?.id === option.id));
      const head = element("div", "section-head");
      head.append(element("h3", "", t(option.label)));
      head.append(element("span", "muted small", `${option.blocks?.length ?? 0} ${t("blocks")} · ${option.scheduledMinutes ?? 0} ${t("min")}`));
      panel.append(head);
      for (const block of (option.blocks ?? []).slice(0, 8)) {
        const row = element("div", "detail-item");
        row.append(element("span", "grow", `${block.date} ${minutesLabel(block.startMinute)}–${minutesLabel(block.startMinute + block.minutes)} · ${block.title}`));
        panel.append(row);
      }
      if ((option.unscheduled ?? []).length) {
        panel.append(element("p", "small muted", `${option.unscheduled.length} ${t("task(s) could not be placed.")}`));
      }
      if (option.needsEstimate) {
        panel.append(element("p", "small muted", `${option.needsEstimate} ${t("task(s) use the default estimate.")}`));
      }
      if ((option.warnings ?? []).length) {
        panel.append(element("p", "small field-error", option.warnings[0]));
      }
      if (option.overCap) {
        panel.append(element("p", "small field-error", t("This plan exceeds the weekly capacity.")));
      }
      const choose = () => {
        state.autoPlanSelection = option.id;
        renderAutoPlan();
      };
      panel.addEventListener("click", choose);
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });
      container.append(panel);
    }
    const button = $("applyAutoPlanButton");
    button.textContent = t("Apply this plan");
    button.disabled = !selected || !(selected.blocks ?? []).length;
  }

  async function applyAutoPlan() {
    const button = $("applyAutoPlanButton");
    button.disabled = true;
    try {
      const result = await request("/api/auto-plan", {
        method: "POST",
        body: {
          action: "apply",
          workspaceId: workspace().id,
          optionId: state.autoPlanSelection || "balanced",
          delegated: state.settings?.autoPlanMode === "delegated",
        },
      });
      $("autoPlanModal").classList.add("hidden");
      state.lastAutoApplyAt = Date.now();
      await loadToday();
      await loadBoard(state.currentBoardId);
      const applied = result.appliedBlocks ?? result.applied ?? 0;
      showToast(
        `Auto-plan applied — ${applied} block${applied === 1 ? "" : "s"} scheduled.`,
        result.undoId ? { label: t("Undo"), onClick: () => undoAutoPlan(result.undoId) } : null
      );
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function undoAutoPlan(undoId) {
    try {
      await request(`/api/undo/${encodeURIComponent(undoId)}`, { method: "POST" });
      state.lastAutoApplyAt = Date.now();
      await loadToday();
      if (state.currentBoardId) await loadBoard(state.currentBoardId);
      showToast(t("Previous plan restored."));
    } catch (error) {
      showToast(error.message);
    }
  }

  function restartAutoPlanScheduler() {
    window.clearInterval(state.autoPlanTimer);
    state.autoPlanTimer = null;
    const settings = state.settings;
    if (!settings || !settingOn(settings.autoPlanEnabled) || (settings.autoPlanMode || "suggest") === "suggest") return;
    const minutes = Number(settings.autoPlanRefreshMinutes || 0);
    if (minutes > 0) {
      state.autoPlanTimer = window.setInterval(() => void runAutoPlanScheduler(true), minutes * 60_000);
    }
  }

  function scheduleAutoPlanRefresh(delay = 1500) {
    if (state.autoPlanApplying || !state.settings) return;
    if (!settingOn(state.settings.autoPlanEnabled) || (state.settings.autoPlanMode || "suggest") === "suggest") return;
    window.clearTimeout(state.autoPlanDebounce);
    state.autoPlanDebounce = window.setTimeout(() => void runAutoPlanScheduler(true), delay);
  }

  async function runAutoPlanScheduler(allowApply = true) {
    const settings = state.settings;
    if (!settings || !workspace()) return;
    if (!settingOn(settings.autoPlanEnabled)) return;
    const mode = settings.autoPlanMode || "suggest";
    if (mode === "suggest" || !allowApply) return;
    if (state.autoPlanApplying) return;
    if (Date.now() - state.lastAutoApplyAt < 30_000) return;
    state.autoPlanApplying = true;
    try {
      const preview = await request("/api/auto-plan", {
        method: "POST",
        body: { action: "preview", workspaceId: workspace().id },
      });
      const balanced = (preview.options ?? []).find((option) => option.id === "balanced");
      if (!balanced || !(balanced.blocks ?? []).length) return;
      const result = await request("/api/auto-plan", {
        method: "POST",
        body: {
          action: "apply",
          workspaceId: workspace().id,
          optionId: "balanced",
          safe: mode === "safe",
          delegated: mode === "delegated",
        },
      });
      state.lastAutoApplyAt = Date.now();
      const applied = result.appliedBlocks ?? result.applied ?? 0;
      if (!applied) return;
      await loadToday();
      if (state.currentBoardId) await loadBoard(state.currentBoardId);
      showToast(
        `Auto-plan refreshed — ${applied} block${applied === 1 ? "" : "s"} scheduled.`,
        result.undoId ? { label: t("Undo"), onClick: () => undoAutoPlan(result.undoId) } : null
      );
    } catch {
      // Background planning is best-effort; manual Auto-plan still reports errors.
    } finally {
      state.autoPlanApplying = false;
    }
  }

  async function clearAutoPlan() {
    if (!window.confirm("Clear scheduled Auto-plan blocks?")) return;
    try {
      await request("/api/auto-plan", {
        method: "POST",
        body: { action: "clear", workspaceId: workspace().id },
      });
      $("autoPlanModal").classList.add("hidden");
      state.lastAutoApplyAt = Date.now();
      await loadToday();
      showToast(t("Auto-plan cleared."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function todayAction(action, taskId) {
    try {
      await request("/api/today", {
        method: "POST",
        body: { action, taskId, workspaceId: workspace().id },
      });
      await loadToday();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function rebalanceToday() {
    const button = $("dayFlowRebalance");
    button.disabled = true;
    try {
      await request("/api/today", {
        method: "POST",
        body: { action: "rebalance", workspaceId: workspace().id },
      });
      state.lastAutoApplyAt = Date.now();
      await loadToday();
      showToast(t("Today rebalanced."));
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function applyTodayPlan() {
    const taskIds = (state.today?.suggestions ?? [])
      .filter((task) => task.selected && !task.blocked)
      .map((task) => task.id);
    if (!taskIds.length) {
      showToast("Choose at least one task for today first.");
      return;
    }
    const button = $("applyTodayPlanButton");
    button.disabled = true;
    try {
      await request("/api/today", {
        method: "POST",
        body: { action: "applyPlan", workspaceId: workspace().id, taskIds },
      });
      state.lastAutoApplyAt = Date.now();
      await loadToday();
      showToast(t("Today plan applied."));
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function focusClock(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function focusMinutesLabel(minutes) {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(safe / 60);
    const rest = safe % 60;
    if (!hours) return `${rest}m`;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  function focusTargetMinutes(task) {
    return Math.max(1, Number(task?.estimateMinutes) || Number(state.settings?.focusMinutes) || 25);
  }

  async function openFocus(task) {
    if (!task?.id) return;
    try {
      const data = await request(`/api/tasks/${encodeURIComponent(task.id)}`);
      const fresh = data?.task;
      if (!fresh) throw new Error("Task not found.");
      if (Number(fresh.completed) === 1) {
        showToast("Completed tasks cannot be focused.");
        return;
      }
      closeModal();
      window.clearInterval(state.focusTimer);
      state.focusTimer = null;
      state.focus = {
        task: fresh,
        phase: "ready",
        accumulated: 0,
        startedAt: null,
        elapsed: 0,
        busy: false,
        error: "",
      };
      $("focusMode").classList.remove("hidden");
      renderFocus();
      if (settingOn(state.settings?.focusAutoStart)) {
        window.setTimeout(() => {
          if (state.focus && state.focus.phase === "ready") startFocus();
        }, 220);
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderFocus() {
    const focus = state.focus;
    if (!focus) return;
    const targetMinutes = focusTargetMinutes(focus.task);
    const targetSeconds = Math.max(60, targetMinutes * 60);
    const progress = Math.min(1, focus.elapsed / targetSeconds);
    const overEstimate = focus.elapsed > targetSeconds;
    const actualMinutes = Math.max(1, Math.round(focus.elapsed / 60));
    const deltaMinutes = actualMinutes - targetMinutes;
    const done = focus.phase === "done";
    $("focusActive").classList.toggle("hidden", done);
    $("focusDone").classList.toggle("hidden", !done);
    $("focusModeTitle").textContent = focus.task.title;
    $("focusTaskMeta").textContent = `${focus.task.boardName || t("Task")} · ${focus.task.columnName || t("Open")}`;
    $("focusPhaseLabel").textContent = t(focus.phase === "ready" ? "Ready when you are" : focus.phase === "running" ? "In focus" : focus.phase === "paused" ? "Paused" : "Complete");
    $("focusClock").textContent = focusClock(focus.elapsed);
    $("focusEstimateLabel").textContent = overEstimate
      ? t("past the estimate — still yours")
      : `${t("of")} ${focusMinutesLabel(targetMinutes)} ${t("estimated")}`;
    $("focusPrompt").textContent = t(focus.phase === "running"
      ? "The rest can wait. You only need the next small move."
      : focus.phase === "paused"
        ? "Paused. Take the breath, then decide."
        : "One task. One timer. No feed, no backlog, no noise.");
    $("focusOrb").classList.toggle("breathing", focus.phase === "running");

    const circumference = 2 * Math.PI * 112;
    const arc = $("focusRingArc");
    arc.style.strokeDasharray = String(circumference);
    arc.style.strokeDashoffset = String(circumference * (1 - progress));
    arc.classList.toggle("over", overEstimate);

    const badges = $("focusBadges");
    badges.replaceChildren();
    if (focus.task.estimateMinutes) badges.append(makeBadge(`${focus.task.estimateMinutes}m ${t("estimate")}`, "slate"));
    if (focus.task.actualMinutes) badges.append(makeBadge(`${focus.task.actualMinutes}${t("m tracked before")}`, "accent"));
    if (focus.task.priority && focus.task.priority !== "none") badges.append(makeBadge(t(focus.task.priority), "rose"));
    for (const label of (focus.task.labels ?? []).slice(0, 3)) {
      badges.append(makeBadge(label.name, label.color || "slate"));
    }

    if (done) {
      $("focusDoneCopy").textContent = `${focusClock(focus.elapsed)} ${t("of attention for")} ${focus.task.title}. ${t("The estimate was {{minutes}} minutes; the point was to begin.", { minutes: targetMinutes })}`;
      const stats = $("focusDoneStats");
      stats.replaceChildren();
      for (const [value, label] of [
        [`${actualMinutes}m`, t("tracked")],
        [focusMinutesLabel(targetMinutes), t("estimated")],
        [`${Math.abs(deltaMinutes)}m`, t(deltaMinutes > 0 ? "over" : deltaMinutes < 0 ? "under" : "on estimate")],
      ]) {
        const item = element("span");
        item.append(element("strong", "", value), document.createTextNode(` ${label}`));
        stats.append(item);
      }
      return;
    }

    const running = focus.phase === "running";
    $("focusToggle").textContent = t(running ? "Pause" : focus.phase === "paused" ? "Resume focus" : "Begin focus");
    $("focusToggle").className = running ? "btn lg" : "btn primary lg";
    $("focusComplete").disabled = focus.busy || focus.elapsed < 1;
    $("focusComplete").textContent = t(focus.busy ? "Saving…" : "Complete task");
    $("focusLogLeave").classList.toggle("hidden", focus.elapsed <= 0);
    $("focusLogLeave").disabled = focus.busy;
    $("focusError").classList.toggle("hidden", !focus.error);
    $("focusError").textContent = focus.error || "";
  }

  function focusTick() {
    const focus = state.focus;
    if (!focus || focus.phase !== "running" || focus.startedAt === null) return;
    focus.elapsed = focus.accumulated + Math.floor((Date.now() - focus.startedAt) / 1000);
    renderFocus();
  }

  function startFocus() {
    const focus = state.focus;
    if (!focus || focus.phase === "done" || focus.phase === "running") return;
    focus.startedAt = Date.now();
    focus.phase = "running";
    window.clearInterval(state.focusTimer);
    state.focusTimer = window.setInterval(focusTick, 250);
    window.DriftSound?.play("focus");
    renderFocus();
  }

  function pauseFocus() {
    const focus = state.focus;
    if (!focus || focus.phase !== "running") return;
    focus.accumulated += Math.floor((Date.now() - (focus.startedAt ?? Date.now())) / 1000);
    focus.startedAt = null;
    focus.elapsed = focus.accumulated;
    focus.phase = "paused";
    window.clearInterval(state.focusTimer);
    state.focusTimer = null;
    window.DriftSound?.play("tap");
    renderFocus();
  }

  function accumulateFocus() {
    const focus = state.focus;
    if (!focus || focus.startedAt === null) return;
    focus.accumulated += Math.floor((Date.now() - focus.startedAt) / 1000);
    focus.startedAt = null;
    focus.elapsed = focus.accumulated;
  }

  async function completeFocus() {
    const focus = state.focus;
    if (!focus || focus.busy || focus.phase === "done") return;
    accumulateFocus();
    const minutes = Math.max(1, Math.round(focus.elapsed / 60));
    focus.busy = true;
    focus.error = "";
    window.clearInterval(state.focusTimer);
    state.focusTimer = null;
    focus.phase = "paused";
    renderFocus();
    try {
      const result = await request(`/api/tasks/${encodeURIComponent(focus.task.id)}/focus`, {
        method: "POST",
        body: { minutes, complete: true },
      });
      focus.task = result.task;
      focus.phase = "done";
      focus.busy = false;
      window.DriftSound?.play("complete");
      renderFocus();
      await loadToday();
      if (state.currentBoardId) await loadBoard(state.currentBoardId);
      showToast(t("Focus complete — {{minutes}}m tracked.", { minutes })
        + (result.nextTaskId ? ` ${t("Next occurrence created.")}` : ""),
        undoToastAction(result.undo, async () => {
          await loadToday();
          if (state.currentBoardId) await loadBoard(state.currentBoardId);
        }));
    } catch (error) {
      focus.busy = false;
      focus.error = error.message;
      renderFocus();
    }
  }

  async function logFocusTime(minutes) {
    const focus = state.focus;
    if (!focus || minutes <= 0) return null;
    const result = await request(`/api/tasks/${encodeURIComponent(focus.task.id)}/focus`, {
      method: "POST",
      body: { minutes, complete: false },
    });
    focus.task = result.task;
    return result.task;
  }

  async function leaveFocus() {
    const focus = state.focus;
    if (!focus || focus.busy) return;
    if (focus.phase !== "done") {
      accumulateFocus();
      const minutes = Math.max(0, Math.round(focus.elapsed / 60));
      if (minutes > 0) {
        focus.busy = true;
        renderFocus();
        try {
          await logFocusTime(minutes);
        } catch (error) {
          focus.error = error.message;
          focus.busy = false;
          renderFocus();
          return;
        }
      }
    }
    window.clearInterval(state.focusTimer);
    state.focusTimer = null;
    state.focus = null;
    $("focusMode").classList.add("hidden");
    window.DriftSound?.play("tap");
    await loadToday();
    if (state.currentBoardId) await loadBoard(state.currentBoardId);
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dueTimeInputValue(value) {
    const text = value == null ? "" : String(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(11, 16);
    if (text.includes("T")) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      }
    }
    return "";
  }

  function addDaysToKey(key, days) {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function nextWeekdayKey(base, target, forceNext = false) {
    const date = new Date(`${base}T12:00:00`);
    let delta = (target - date.getDay() + 7) % 7;
    if (forceNext && delta === 0) delta = 7;
    date.setDate(date.getDate() + delta);
    return localDateKey(date);
  }

  function monthDateKey(base, month, day, year) {
    let chosenYear = year ?? Number(base.slice(0, 4));
    let candidate = `${chosenYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!year && candidate < base) {
      chosenYear++;
      candidate = `${chosenYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return candidate;
  }

  function parseQuickAdd(input) {
    let text = ` ${String(input || "").trim()} `;
    let priority = "none";
    const labels = [];
    text = text.replace(/\s!(urgent|high|medium|low)\b/gi, (_, value) => {
      priority = value.toLowerCase();
      return " ";
    });
    text = text.replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_, label) => {
      if (!labels.some((item) => item.toLowerCase() === label.toLowerCase())) labels.push(label);
      return " ";
    });
    let estimateMinutes = null;
    text = text.replace(/\s~(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/gi, (_, amount, unit) => {
      const value = Number(amount);
      estimateMinutes = Math.min(1440, Math.round(unit.toLowerCase().startsWith("h") ? value * 60 : value));
      return " ";
    });

    const today = localDateKey();
    const recurrenceWeekdays = {
      sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
      wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
      friday: 5, fri: 5, saturday: 6, sat: 6,
    };
    let recurrenceRule = null;
    let recurrenceDate = null;
    text = text.replace(/\s(?:every|each)\s+weekday\b/gi, () => {
      recurrenceRule = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR";
      const weekday = new Date(`${today}T12:00:00`).getDay();
      recurrenceDate = weekday >= 1 && weekday <= 5 ? today : nextWeekdayKey(today, 1, false);
      return " ";
    });
    text = text.replace(/\s(?:every|each)\s+other\s+(day|week|month)\b/gi, (_, unit) => {
      const frequency = unit.toLowerCase().startsWith("d") ? "DAILY" : unit.toLowerCase().startsWith("w") ? "WEEKLY" : "MONTHLY";
      recurrenceRule = `FREQ=${frequency};INTERVAL=2`;
      return " ";
    });
    text = text.replace(/\s(?:every|each)\s+(\d+)\s*(day|days|week|weeks|month|months)\b/gi, (_, amount, unit) => {
      const frequency = unit.toLowerCase().startsWith("d") ? "DAILY" : unit.toLowerCase().startsWith("w") ? "WEEKLY" : "MONTHLY";
      const interval = Math.max(1, Math.min(52, Number(amount) || 1));
      recurrenceRule = `FREQ=${frequency};INTERVAL=${interval}`;
      return " ";
    });
    text = text.replace(/\s(?:every|each)\s+(day|week|month)\b/gi, (_, unit) => {
      const frequency = unit.toLowerCase().startsWith("d") ? "DAILY" : unit.toLowerCase().startsWith("w") ? "WEEKLY" : "MONTHLY";
      recurrenceRule = `FREQ=${frequency};INTERVAL=1`;
      return " ";
    });
    text = text.replace(/\s(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/gi, (_, day) => {
      const index = recurrenceWeekdays[day.toLowerCase()];
      const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
      recurrenceRule = `FREQ=WEEKLY;INTERVAL=1;BYDAY=${codes[index]}`;
      recurrenceDate = nextWeekdayKey(today, index, false);
      return " ";
    });

    let date = null;
    let time = null;
    text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(\d{4})-(\d{2})-(\d{2})(?!\d)/i, (_, year, month, day) => {
      date = `${year}-${month}-${day}`;
      return " ";
    });
    text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(?:in\s+)?(\d+)\s+(day|days|week|weeks)\b/i, (_, amount, unit) => {
      date = addDaysToKey(today, Number(amount) * (unit.toLowerCase().startsWith("week") ? 7 : 1));
      return " ";
    });
    text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(today|tonight|tomorrow)\b/i, (_, word) => {
      if (word.toLowerCase() === "tomorrow") date = addDaysToKey(today, 1);
      else {
        date = today;
        if (word.toLowerCase() === "tonight") time = { hour: 20, minute: 0 };
      }
      return " ";
    });
    const weekdays = {
      sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
      wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
      friday: 5, fri: 5, saturday: 6, sat: 6,
    };
    text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i, (whole, day) => {
      if (date) return whole;
      date = nextWeekdayKey(today, weekdays[day.toLowerCase()], /next\s+/i.test(whole));
      return " ";
    });
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
      sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i, (_, month, day, year) => {
      date = monthDateKey(today, months[month.toLowerCase()], Number(day), year ? Number(year) : undefined);
      return " ";
    });
    text = text.replace(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (_, hourRaw, minuteRaw, meridiem) => {
      let hour = Number(hourRaw) % 12;
      if (meridiem.toLowerCase() === "pm") hour += 12;
      time = { hour, minute: Number(minuteRaw || 0) };
      if (!date) date = today;
      return " ";
    });
    if (!time) {
      const bareTime = text.match(/\s(?:at\s+)(\d{1,2}):(\d{2})\b/);
      if (bareTime) {
        time = { hour: Number(bareTime[1]), minute: Number(bareTime[2]) };
        text = text.replace(bareTime[0], " ");
      }
    }
    if (recurrenceRule && !date) date = recurrenceDate || today;
    const dueAllDay = !time;
    const dueDate = date
      ? (time ? `${date}T${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:00` : date)
      : null;
    const title = text
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\s+(?:at|on|by|due)\s*$/i, "")
      .trim();
    return { title, priority, labels, estimateMinutes, dueDate, dueAllDay, recurrenceRule };
  }

  function captureDueLabel(parsed) {
    if (!parsed.dueDate) return "";
    const day = parsed.dueDate.slice(0, 10);
    const today = localDateKey();
    const name = day === today
      ? t("Today")
      : day === addDaysToKey(today, 1)
        ? t("Tomorrow")
        : new Intl.DateTimeFormat(state.settings?.locale || undefined, { month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00`));
    if (parsed.dueAllDay) return name;
    const date = new Date(parsed.dueDate);
    const format = state.settings?.timeFormat || "auto";
    if (format === "24") {
      return `${name}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
    if (format === "12") {
      const suffix = date.getHours() >= 12 ? "PM" : "AM";
      return `${name}, ${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${suffix}`;
    }
    return `${name}, ${new Intl.DateTimeFormat(state.settings?.locale || undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`;
  }

  function captureVoiceSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function stopCaptureVoice() {
    const recognition = state.captureRecognition;
    state.captureRecognition = null;
    state.captureListening = false;
    state.captureInterim = "";
    if (recognition) {
      try { recognition.abort(); } catch { /* ignore */ }
    }
    const button = $("captureVoiceButton");
    if (button) {
      button.textContent = t("Speak");
      button.classList.remove("listening");
      button.setAttribute("aria-pressed", "false");
    }
    $("captureHeard")?.classList.add("hidden");
    if ($("captureVoiceError")) $("captureVoiceError").classList.add("hidden");
    if ($("captureVoiceHint")) {
      $("captureVoiceHint").textContent = captureVoiceSupported()
        ? t("Uses your browser’s speech service. Edit the words before adding; typing always works too.")
        : t("Voice isn’t available in this browser — type instead.");
    }
  }

  function populateCaptureColumns() {
    const board = boards().find((item) => item.id === $("captureBoard").value) ?? boards()[0];
    $("captureColumn").replaceChildren();
    for (const column of board?.columns ?? []) $("captureColumn").add(new Option(column.name, column.id));
  }

  function openCapture() {
    if (!workspace()) return;
    stopCaptureVoice();
    const boardList = boards();
    const preferred = boardList.find((board) => board.id === state.currentBoardId) ?? boardList[0];
    $("captureBoard").replaceChildren();
    for (const board of boardList) $("captureBoard").add(new Option(board.name, board.id));
    $("captureBoard").value = preferred?.id ?? "";
    populateCaptureColumns();
    $("captureInput").value = "";
    $("captureVoiceError").classList.add("hidden");
    $("captureHeard").classList.add("hidden");
    $("captureVoice").classList.toggle("hidden", state.settings?.features?.voice === false);
    const supported = captureVoiceSupported();
    $("captureVoiceButton").disabled = !supported;
    $("captureVoiceHint").textContent = supported
      ? t("Uses your browser’s speech service. Edit the words before adding; typing always works too.")
      : t("Voice isn’t available in this browser — type instead.");
    renderCapturePreview();
    $("captureModal").classList.remove("hidden");
    window.setTimeout(() => $("captureInput").focus(), 30);
  }

  function closeCapture() {
    stopCaptureVoice();
    $("captureModal").classList.add("hidden");
  }

  function renderCapturePreview() {
    const text = $("captureInput").value;
    const parsed = parseQuickAdd(text);
    const container = $("capturePreview");
    container.replaceChildren();
    if (!text.trim()) {
      container.append(element("span", "capture-meta", t("Plain language works — Drift parses dates, labels and priorities locally.")));
      return;
    }
    if (parsed.title) container.append(makeBadge(t("New task"), "accent"));
    if (parsed.dueDate) container.append(makeBadge(captureDueLabel(parsed), "blue"));
    if (parsed.priority !== "none") container.append(makeBadge(t(parsed.priority), "rose"));
    for (const label of parsed.labels) container.append(makeBadge(`#${label}`, "moss"));
    if (parsed.estimateMinutes) container.append(makeBadge(`${parsed.estimateMinutes}m`, "slate"));
    if (parsed.recurrenceRule) container.append(makeBadge(`↻ ${describeRecurrence(parsed.recurrenceRule)}`, "violet"));
  }

  function toggleCaptureVoice() {
    if (state.captureListening) {
      stopCaptureVoice();
      return;
    }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      $("captureVoiceError").textContent = t("Voice input isn’t available in this browser. The text field is always here.");
      $("captureVoiceError").classList.remove("hidden");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (finalText.trim()) {
        const current = $("captureInput").value;
        $("captureInput").value = `${current}${current && !/\s$/.test(current) ? " " : ""}${finalText.trim()}`;
        renderCapturePreview();
      }
      state.captureInterim = interim.trim();
      $("captureVoiceHint").textContent = state.captureInterim ? `“${state.captureInterim}”` : t("Listening… speak now. You can edit the words before adding.");
      $("captureHeard").classList.toggle("hidden", !finalText.trim() && !state.captureInterim);
    };
    recognition.onerror = (event) => {
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? t("Microphone permission was denied. You can still type the task.")
        : event.error === "no-speech"
          ? t("No speech detected. Try again, or type instead.")
          : t("Voice input stopped. You can type the task instead.");
      $("captureVoiceError").textContent = message;
      $("captureVoiceError").classList.remove("hidden");
      stopCaptureVoice();
    };
    recognition.onend = () => {
      state.captureRecognition = null;
      state.captureListening = false;
      $("captureVoiceButton").textContent = t("Speak");
      $("captureVoiceButton").classList.remove("listening");
      $("captureVoiceButton").setAttribute("aria-pressed", "false");
      $("captureHeard").classList.add("hidden");
      $("captureVoiceHint").textContent = t("Uses your browser’s speech service. Edit the words before adding; typing always works too.");
      window.setTimeout(() => $("captureInput").focus(), 30);
    };
    state.captureRecognition = recognition;
    state.captureListening = true;
    $("captureVoiceError").classList.add("hidden");
    $("captureVoiceButton").textContent = t("Stop listening");
    $("captureVoiceButton").classList.add("listening");
    $("captureVoiceButton").setAttribute("aria-pressed", "true");
    $("captureVoiceHint").textContent = t("Listening… speak now. You can edit the words before adding.");
    try {
      recognition.start();
    } catch {
      $("captureVoiceError").textContent = t("Voice input could not start. You can type the task instead.");
      $("captureVoiceError").classList.remove("hidden");
      stopCaptureVoice();
    }
  }

  async function submitCapture() {
    if (state.captureSaving) return;
    const raw = $("captureInput").value.trim();
    if (!raw) return;
    const board = boards().find((item) => item.id === $("captureBoard").value) ?? boards()[0];
    const columnId = $("captureColumn").value;
    if (!board || !columnId) return;
    const parsed = parseQuickAdd(raw);
    const body = {
      workspaceId: workspace().id,
      boardId: board.id,
      columnId,
      title: parsed.title || raw,
      description: "",
      priority: parsed.priority,
      startDate: null,
      dueDate: parsed.dueDate,
      dueAllDay: parsed.dueAllDay,
      estimateMinutes: parsed.estimateMinutes,
      actualMinutes: null,
      labels: parsed.labels,
      recurrenceRule: parsed.recurrenceRule,
    };
    const button = $("captureAddButton");
    state.captureSaving = true;
    button.disabled = true;
    button.firstChild.textContent = t("Adding…");
    try {
      let created = null;
      try {
        created = await request("/api/tasks", { method: "POST", body });
      } catch (error) {
        if (error.code === "NETWORK_ERROR" && window.DriftOffline) {
          queueOfflineWrite("/api/tasks", { method: "POST", body }, { kind: "task.create", label: body.title });
          window.DriftSound?.play("tap");
          showToast(t("Saved on this device — will sync when you reconnect."));
          if (settingOn(state.settings?.captureCloseAfterAdd)) closeCapture();
          return;
        }
        throw error;
      }
      window.DriftSound?.play("capture");
      await loadBoard(state.currentBoardId);
      await loadToday();
      showToast(t("Added to {{board}}", { board: board.name }), undoToastAction(created?.undo, async () => {
        await loadBoard(state.currentBoardId);
        await loadToday();
      }));
      if (settingOn(state.settings?.captureCloseAfterAdd)) {
        closeCapture();
      } else {
        $("captureInput").value = "";
        renderCapturePreview();
        window.setTimeout(() => $("captureInput").focus(), 30);
      }
    } catch (error) {
      window.DriftSound?.play("error");
      showToast(error.message);
    } finally {
      state.captureSaving = false;
      button.disabled = false;
      button.firstChild.textContent = `${t("Add task")} `;
    }
  }

  function renderTaskMetaBadges(task) {
    const container = $("taskMetaBadges");
    if (!container) return;
    container.replaceChildren();
    const toggle = $("taskCompleteToggle");
    if (!task) {
      toggle?.classList.add("hidden");
      return;
    }
    const completed = Number(task.completed) === 1;
    container.append(makeBadge(t(completed ? "Done" : "Open"), completed ? "accent" : "slate"));
    if (task.dueDate) container.append(makeBadge(captureDueLabel(task), "blue"));
    if (task.recurrenceRule) container.append(makeBadge(describeRecurrence(task.recurrenceRule), "violet"));
    if (task.version) container.append(element("span", "field-hint", `v${task.version}`));
    if (toggle) {
      toggle.classList.remove("hidden");
      toggle.classList.toggle("done", completed);
      toggle.textContent = completed ? "✓" : "";
      toggle.setAttribute("aria-label", t(completed ? "Reopen task" : "Complete task"));
      toggle.title = t(completed ? "Reopen task" : "Complete task");
    }
  }

  function openTaskModal(task, columnId = null) {
    if (task && !task.boardName && currentBoard()?.id === task.boardId) {
      task.boardName = currentBoard().name;
      task.columnName = (currentBoard().columns ?? []).find((column) => column.id === task.columnId)?.name;
    }
    state.editing = task;
    state.detail = null;
    $("taskDetail").classList.toggle("hidden", !task);
    $("subtaskList").replaceChildren();
    $("commentList").replaceChildren();
    $("dependencyList").replaceChildren();
    $("dependencySelect").replaceChildren();
    $("attachmentList").replaceChildren();
    $("reminderList").replaceChildren();
    $("activityList").replaceChildren();
    $("subtaskProgress").textContent = "";
    const board = currentBoard();
    const columns = board?.columns ?? [];
    $("taskModalTitle").textContent = task ? "Edit task" : "New task";
    $("taskEyebrow").textContent = task
      ? [task.boardName, task.columnName].filter(Boolean).join(" · ") || t("Task details")
      : t("New task");
    $("taskTitle").value = task?.title ?? "";
    $("taskDescription").value = task?.description ?? "";
    $("taskPriority").value = task?.priority ?? "none";
    $("taskLabels").value = (task?.labels ?? []).map((label) => label.name).join(", ");
    $("taskEstimate").value = task?.estimateMinutes ?? "";
    $("taskStart").value = task?.startDate ? String(task.startDate).slice(0, 10) : "";
    $("taskDue").value = task?.dueDate ? String(task.dueDate).slice(0, 10) : "";
    $("taskDueTime").value = task?.dueAllDay ? "" : dueTimeInputValue(task?.dueDate);
    $("taskDueAllDay").checked = task ? Number(task.dueAllDay) === 1 : true;
    $("taskDueTime").disabled = $("taskDueAllDay").checked;
    $("taskReminderOffset").value = "";
    $("taskReminderOffset").disabled = !$("taskDue").value;
    state.initialReminderOffset = "";
    $("taskActual").value = task?.actualMinutes ?? "";
    const recurrenceSelect = $("taskRecurrence");
    recurrenceSelect.replaceChildren(new Option(t("Does not repeat"), ""));
    for (const [value, label] of Object.entries(RECURRENCE_LABELS)) recurrenceSelect.add(new Option(t(label), value));
    const recurrenceRule = task?.recurrenceRule ?? "";
    if (recurrenceRule && !RECURRENCE_LABELS[recurrenceRule]) {
      recurrenceSelect.add(new Option(describeRecurrence(recurrenceRule), recurrenceRule));
    }
    recurrenceSelect.value = recurrenceRule;
    const assigneeSelect = $("taskAssignee");
    const selectedAssignee = task?.assigneeId ?? "";
    assigneeSelect.replaceChildren(new Option(t("Unassigned"), ""));
    if (selectedAssignee) {
      const currentAssignee = task?.assignee?.name || selectedAssignee;
      assigneeSelect.add(new Option(currentAssignee, selectedAssignee));
      assigneeSelect.value = selectedAssignee;
    }
    ensureMembers()
      .then((members) => {
        if (!$("taskModal").classList.contains("hidden")) {
          assigneeSelect.replaceChildren(new Option(t("Unassigned"), ""));
          for (const member of members) {
            assigneeSelect.add(new Option(member.name || member.email, member.userId || member.id));
          }
          assigneeSelect.value = selectedAssignee;
        }
      })
      .catch(() => undefined);
    $("taskColumn").replaceChildren();
    for (const column of columns) $("taskColumn").add(new Option(column.name, column.id));
    if (columnId) $("taskColumn").value = columnId;
    else if (task?.columnId) $("taskColumn").value = task.columnId;
    $("columnField").classList.remove("hidden");
    $("taskColumnLabel").textContent = task ? t("Status") : t("Column");
    $("subtaskSuggestions").replaceChildren();
    const completed = Boolean(task) && Number(task.completed) === 1;
    $("focusTaskButton").classList.toggle("hidden", !task || completed);
    $("completeTaskButton").classList.toggle("hidden", !task || completed);
    $("reopenTaskButton").classList.toggle("hidden", !task || !completed);
    $("copyTaskLinkButton").classList.toggle("hidden", !task);
    $("archiveTaskButton").classList.toggle("hidden", !task || Boolean(task.archivedAt));
    $("deleteTaskButton").classList.toggle("hidden", !task);
    renderTaskMetaBadges(task);
    $("taskModal").classList.remove("hidden");
    window.setTimeout(() => $("taskTitle").focus(), 20);
    if (task) void loadTaskDetail(task.id);
  }

  async function loadTaskDetail(taskId) {
    try {
      const [detail, taskList] = await Promise.all([
        request(`/api/tasks/${encodeURIComponent(taskId)}`),
        request(`/api/tasks?workspaceId=${encodeURIComponent(workspace().id)}`),
      ]);
      state.detail = detail;
      state.workspaceTasks = taskList.tasks ?? [];
      if (state.editing && detail.task?.id === state.editing.id) {
        state.editing = { ...state.editing, ...detail.task };
        $("taskColumn").value = detail.task.columnId;
        const nowCompleted = Number(detail.task.completed) === 1;
        $("completeTaskButton").classList.toggle("hidden", nowCompleted);
        $("reopenTaskButton").classList.toggle("hidden", !nowCompleted);
        $("focusTaskButton").classList.toggle("hidden", nowCompleted);
        $("archiveTaskButton").classList.toggle("hidden", Boolean(detail.task.archivedAt));
        const reminder = (detail.task.reminders ?? [])[0];
        let offset = "";
        if (reminder && detail.task.dueDate) {
          const dueText = String(detail.task.dueDate);
          const dueAt = new Date(dueText.includes("T") ? dueText : `${dueText}T00:00:00`);
          const diff = Math.round((dueAt.getTime() - new Date(reminder.remindAt).getTime()) / 60000);
          if (["0", "10", "30", "60", "1440"].includes(String(diff))) offset = String(diff);
        }
        $("taskReminderOffset").value = offset;
        $("taskReminderOffset").disabled = !detail.task.dueDate;
        state.initialReminderOffset = offset;
        renderTaskMetaBadges(detail.task);
      }
      renderTaskDetail();
    } catch (error) {
      showToast(error.message);
    }
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const diff = Math.max(0, Date.now() - date.getTime());
    const minute = 60000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return t("just now");
    if (diff < hour) return t("{{count}}m ago", { count: Math.floor(diff / minute) });
    if (diff < day) return t("{{count}}h ago", { count: Math.floor(diff / hour) });
    if (diff < 7 * day) return t("{{count}}d ago", { count: Math.floor(diff / day) });
    return new Intl.DateTimeFormat(state.settings?.locale || undefined, { month: "short", day: "numeric" }).format(date);
  }

  function activityLabel(action) {
    const labels = {
      "task.created": "created the task",
      "task.updated": "updated the task",
      "task.completed": "completed the task",
      "task.reopened": "reopened the task",
      "task.moved": "moved the task",
      "task.reordered": "reordered the task",
      "task.recurred": "created the next occurrence",
      "task.deleted": "deleted the task",
      "action.undone": "undid an action",
      "comment.created": "commented",
      "subtask.created": "added a checklist item",
      "attachment.created": "attached a file",
      "attachment.deleted": "removed an attachment",
      "today.accepted": "added this to Today",
      "automation.applied": "applied an automation",
    };
    return t(labels[action] || String(action || "").replace(/[._]/g, " "));
  }

  function renderTaskDetail() {    const task = state.detail?.task;
    if (!task) return;
    const subtasks = task.subtasks ?? [];
    const completed = subtasks.filter((item) => Number(item.completed) === 1).length;
    $("subtaskProgress").textContent = subtasks.length ? `${completed}/${subtasks.length}` : "";
    const list = $("subtaskList");
    list.replaceChildren();
    if (!subtasks.length) list.append(element("div", "empty", "No checklist items yet."));
    for (const subtask of subtasks) {
      const row = element("label", `detail-item${Number(subtask.completed) === 1 ? " done" : ""}`);
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = Number(subtask.completed) === 1;
      checkbox.addEventListener("change", () => toggleSubtask(subtask.id, checkbox.checked));
      const title = element("span", "grow", subtask.title);
      const remove = element("button", "btn ghost sm", t("Remove"));
      remove.type = "button";
      remove.setAttribute("aria-label", t("Remove {{name}}", { name: subtask.title }));
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void deleteSubtask(subtask);
      });
      row.append(checkbox, title, remove);
      list.append(row);
    }

    const comments = task.comments ?? [];
    const commentsList = $("commentList");
    commentsList.replaceChildren();
    if (!comments.length) commentsList.append(element("div", "empty", "No comments yet."));
    for (const comment of comments) {
      const row = element("div", "detail-item");
      const grow = element("div", "grow");
      grow.append(element("strong", "", comment.authorName || "Someone"));
      grow.append(element("p", "", comment.body));
      row.append(grow);
      commentsList.append(row);
    }

    const dependencies = task.dependencies ?? [];
    const dependencyList = $("dependencyList");
    dependencyList.replaceChildren();
    if (!dependencies.length) dependencyList.append(element("div", "empty", "No blockers."));
    for (const dependency of dependencies) {
      const row = element("div", "detail-item");
      const title = element("span", "grow", dependency.title);
      if (Number(dependency.completed) === 1) title.classList.add("muted");
      const remove = element("button", "btn ghost sm", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => removeDependency(dependency.id));
      row.append(title, remove);
      dependencyList.append(row);
    }
    const select = $("dependencySelect");
    select.replaceChildren();
    const existing = new Set(dependencies.map((item) => item.id));
    for (const item of state.workspaceTasks) {
      if (item.id === task.id || existing.has(item.id)) continue;
      select.add(new Option(item.title, item.id));
    }
    if (!select.options.length) select.add(new Option("No other tasks", ""));

    const attachments = task.attachments ?? [];
    const attachmentList = $("attachmentList");
    attachmentList.replaceChildren();
    if (!attachments.length) attachmentList.append(element("div", "empty", "No attachments."));
    for (const attachment of attachments) {
      const row = element("div", "detail-item");
      const link = element("a", "grow", attachment.name);
      link.href = `/api/attachments/${encodeURIComponent(attachment.id)}`;
      link.download = attachment.name;
      const size = element("span", "muted small", formatBytes(attachment.size));
      const remove = element("button", "btn ghost sm", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => deleteAttachment(attachment.id));
      row.append(link, size, remove);
      attachmentList.append(row);
    }

    const reminders = task.reminders ?? [];
    const reminderList = $("reminderList");
    reminderList.replaceChildren();
    if (!reminders.length) reminderList.append(element("div", "empty", "No reminder set."));
    for (const reminder of reminders) {
      const row = element("div", "detail-item");
      const text = reminder.sentAt
        ? `Sent ${new Date(reminder.remindAt).toLocaleString()}`
        : new Date(reminder.remindAt).toLocaleString();
      const label = element("span", "grow", text);
      const remove = element("button", "btn ghost sm", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => removeReminder(reminder.id));
      row.append(label, remove);
      reminderList.append(row);
    }

    const activity = task.activity ?? [];
    const activityList = $("activityList");
    activityList.replaceChildren();
    if (!activity.length) activityList.append(element("div", "empty", "No activity recorded yet."));
    for (const entry of activity.slice(0, 50)) {
      const row = element("div", "activity-item");
      const dot = element("span", `side-dot${String(entry.action).includes("completed") ? " today" : ""}`);
      const grow = element("div", "grow");
      const copy = element("div", "activity-copy");
      copy.append(element("strong", "", entry.actor?.name || "Someone"));
      copy.append(document.createTextNode(` ${activityLabel(entry.action)}`));
      grow.append(copy, element("div", "activity-time", relativeTime(entry.createdAt)));
      row.append(dot, grow);
      activityList.append(row);
    }
  }

  async function addReminder() {
    const value = $("reminderAt").value;
    if (!value || !state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/reminders`, {
        method: "POST",
        body: { remindAt: new Date(value).toISOString() },
      });
      $("reminderAt").value = "";
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function removeReminder(id) {
    if (!state.editing) return;
    try {
      await request(`/api/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function uploadAttachment() {
    const input = $("attachmentInput");
    const file = input.files?.[0];
    if (!file || !state.editing) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(state.editing.id)}/attachments`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Upload failed.");
      }
      input.value = "";
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteAttachment(id) {
    if (!state.editing) return;
    try {
      await request(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function addDependency() {
    const dependsOnTaskId = $("dependencySelect").value;
    if (!dependsOnTaskId || !state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/dependencies`, {
        method: "POST",
        body: { dependsOnTaskId },
      });
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function removeDependency(dependsOnTaskId) {
    if (!state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/dependencies/${encodeURIComponent(dependsOnTaskId)}`, {
        method: "DELETE",
      });
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function toggleSubtask(subtaskId, completed) {
    try {
      await request(`/api/subtasks/${encodeURIComponent(subtaskId)}`, {
        method: "PATCH",
        body: { completed },
      });
      if (state.editing) await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteSubtask(subtask) {
    if (!state.editing) return;
    try {
      await request(`/api/subtasks/${encodeURIComponent(subtask.id)}`, { method: "DELETE" });
      await loadTaskDetail(state.editing.id);
      await loadBoard(state.currentBoardId);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function addSubtask(titleOverride = null) {
    const title = (titleOverride ?? $("subtaskTitle").value).trim();
    if (!title || !state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/subtasks`, {
        method: "POST",
        body: { title },
      });
      $("subtaskTitle").value = "";
      $("subtaskSuggestions").replaceChildren();
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  function showChecklistSuggestions() {
    const task = state.detail?.task;
    const container = $("subtaskSuggestions");
    if (!task) return;
    container.replaceChildren();
    const suggestions = suggestChecklistItems(
      task.title,
      task.description,
      (task.subtasks ?? []).map((item) => item.title),
    );
    for (const suggestion of suggestions) {
      const button = element("button", "btn ghost sm", `+ ${suggestion}`);
      button.type = "button";
      button.addEventListener("click", () => void addSubtask(suggestion));
      container.append(button);
    }
    if (!suggestions.length) {
      container.append(element("span", "field-hint", t("No new checklist ideas for this task.")));
    }
  }

  async function addComment() {
    const body = $("commentBody").value.trim();
    if (!body || !state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/comments`, {
        method: "POST",
        body: { body },
      });
      $("commentBody").value = "";
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  function closeModal() {
    $("taskModal").classList.add("hidden");
    state.editing = null;
    state.detail = null;
  }

  async function saveTask(event) {
    event.preventDefault();
    const save = $("saveTaskButton");
    save.disabled = true;
    try {
      const task = state.editing;
      const recurrenceRule = $("taskRecurrence").value || null;
      const dueDay = $("taskDue").value || "";
      const dueAllDay = $("taskDueAllDay").checked;
      const dueDate = dueDay
        ? (dueAllDay ? dueDay : `${dueDay}T${$("taskDueTime").value || "09:00"}:00`)
        : null;
      const body = {
        title: $("taskTitle").value.trim(),
        description: $("taskDescription").value.trim(),
        priority: $("taskPriority").value,
        estimateMinutes: $("taskEstimate").value ? Number($("taskEstimate").value) : null,
        actualMinutes: $("taskActual").value ? Number($("taskActual").value) : null,
        labels: $("taskLabels").value.split(",").map((label) => label.trim()).filter(Boolean),
        startDate: $("taskStart").value || null,
        dueDate,
        dueAllDay,
        assigneeId: $("taskAssignee").value || null,
        recurrenceRule,
        ...(recurrenceRule ? {} : { recurrenceEndsAt: null }),
      };
      if ($("taskReminderOffset").value !== state.initialReminderOffset) {
        body.reminderOffsetMinutes = $("taskReminderOffset").value === ""
          ? null : Number($("taskReminderOffset").value);
      }
      let saved = null;
      if (task) {
        saved = await requestOrQueue(
          `/api/tasks/${encodeURIComponent(task.id)}`,
          { method: "PATCH", body: { ...body, version: task.version } },
          { kind: "task.update", label: body.title }
        );
        if (saved?.queued) {
          closeModal();
          showToast(t("Saved on this device — will sync when you reconnect."));
          return;
        }
      } else {
        saved = await requestOrQueue(
          "/api/tasks",
          {
            method: "POST",
            body: {
              ...body,
              workspaceId: workspace().id,
              boardId: state.currentBoardId,
              columnId: $("taskColumn").value,
            },
          },
          { kind: "task.create", label: body.title }
        );
        if (saved?.queued) {
          closeModal();
          showToast(t("Saved on this device — will sync when you reconnect."));
          return;
        }
      }
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
      window.DriftSound?.play("capture");
      if (task) {
        showToast(t("Task saved."));
      } else {
        showToast(t("Task created."), undoToastAction(saved?.undo, async () => {
          await loadBoard(state.currentBoardId);
          await loadToday();
        }));
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      save.disabled = false;
    }
  }

  async function moveEditingTask(columnId) {
    const task = state.editing;
    if (!task || !columnId || columnId === task.columnId) return;
    try {
      const result = await request(`/api/tasks/${encodeURIComponent(task.id)}/move`, {
        method: "PATCH",
        body: { version: task.version, columnId },
      });
      state.editing = { ...task, ...result.task };
      await Promise.all([loadTaskDetail(task.id), loadBoard(state.currentBoardId), loadToday()]);
      window.DriftSound?.play("move");
      showToast(t("Task moved."));
    } catch (error) {
      $("taskColumn").value = task.columnId;
      showToast(error.message);
    }
  }

  async function copyTaskLink() {
    const task = state.editing;
    if (!task) return;
    const url = `${window.location.origin}/?task=${encodeURIComponent(task.id)}`;
    try {
      await navigator.clipboard?.writeText(url);
      showToast(t("Link copied."));
    } catch {
      showToast(url);
    }
  }

  async function archiveCurrentTask() {
    const task = state.editing;
    if (!task) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: { archived: true, version: task.version },
      });
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
      showToast(t("Task archived."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function toggleDrawerComplete() {
    const task = state.editing;
    if (!task) return;
    const completed = Number(task.completed) !== 1;
    try {
      const result = await request(`/api/tasks/${encodeURIComponent(task.id)}/${completed ? "complete" : "reopen"}`, {
        method: "POST",
      });
      if (result?.task) {
        state.editing = { ...task, ...result.task };
        state.detail = state.detail ? { ...state.detail, task: { ...state.detail.task, ...result.task } } : state.detail;
      }
      await Promise.all([loadTaskDetail(task.id), loadBoard(state.currentBoardId), loadToday()]);
      window.DriftSound?.play(completed ? "complete" : "tap");
      showToast(t(completed ? "Task completed." : "Task reopened."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function setTaskCompleted(completed) {
    if (!state.editing) return;
    try {
      const result = await requestOrQueue(
        `/api/tasks/${encodeURIComponent(state.editing.id)}/${completed ? "complete" : "reopen"}`,
        { method: "POST" },
        { kind: "task.update", label: state.editing.title }
      );
      if (result?.queued) {
        closeModal();
        showToast(t("Saved on this device — will sync when you reconnect."));
        return;
      }
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
      window.DriftSound?.play(completed ? "complete" : "tap");
      showToast(
        t(completed ? "Task completed." : "Task reopened.")
          + (result?.nextTaskId ? ` ${t("Next occurrence created.")}` : ""),
        undoToastAction(result?.undo, async () => {
          await loadBoard(state.currentBoardId);
          await loadToday();
        })
      );
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteTask() {
    const task = state.editing;
    if (!task || !window.confirm(`Delete “${task.title}”?`)) return;
    try {
      const result = await request(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
      showToast(t("Task deleted."), undoToastAction(result?.undo, async () => {
        await loadBoard(state.currentBoardId);
        await loadToday();
      }));
    } catch (error) {
      showToast(error.message);
    }
  }

  const DEFAULT_FEATURES = { dayFlow: true, smartPlan: true, voice: true };
  const DEFAULT_NOTIFICATIONS = { inApp: true, email: true, mentions: true, browser: true };
  const DEFAULT_SETTINGS = {
    theme: "system",
    density: "comfortable",
    locale: "en",
    timeFormat: "auto",
    readingSize: "default",
    displayFont: "editorial",
    accent: "moss",
    motion: "system",
    startView: "today",
    capacityMinutes: 300,
    planBufferPercent: 0,
    workdayStart: 9,
    workdayEnd: 18,
    blockBufferMinutes: 0,
    focusMinutes: 25,
    focusAutoStart: 0,
    captureCloseAfterAdd: 1,
    autoPlanEnabled: 1,
    autoPlanMode: "suggest",
    autoPlanRestMinutes: 10,
    autoPlanWeeklyMinutes: 1500,
    autoPlanRefreshMinutes: 30,
    autoPlanDeepWorkMinutes: 90,
    autoPlanSplitLongTasks: 1,
    autoPlanIncludeWeekends: 0,
    autoPlanDefaultEstimateMinutes: 30,
    autoPlanCapBehavior: "stop",
    autoPlanLunchEnabled: 1,
    autoPlanLunchStart: 12,
    autoPlanLunchEnd: 13,
    autoPlanAllowStaleArchive: 0,
    autoPlanStaleDays: 30,
    emailDigest: 1,
    digestHour: 8,
    quietStart: null,
    quietEnd: null,
    weekStartsOn: 1,
    featuresJson: JSON.stringify(DEFAULT_FEATURES),
    notificationsJson: JSON.stringify(DEFAULT_NOTIFICATIONS),
    features: DEFAULT_FEATURES,
    notifications: DEFAULT_NOTIFICATIONS,
  };

  function parseJsonObject(value, fallback) {
    if (value && typeof value === "object") return { ...fallback, ...value };
    try {
      return { ...fallback, ...JSON.parse(value || "{}") };
    } catch {
      return { ...fallback };
    }
  }

  function normalizeSettings(raw) {
    const settings = {
      ...DEFAULT_SETTINGS,
      features: { ...DEFAULT_FEATURES },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    };
    for (const [key, value] of Object.entries(raw || {})) {
      settings[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    settings.features = parseJsonObject(settings.featuresJson, DEFAULT_FEATURES);
    settings.notifications = parseJsonObject(settings.notificationsJson, DEFAULT_NOTIFICATIONS);
    return settings;
  }

  function settingOn(value) {
    return value === true || value === "true" || Number(value) === 1;
  }

  async function loadSettings() {
    try {
      const data = await request("/api/settings");
      state.settings = normalizeSettings(data?.settings);
      window.DriftOffline?.cacheSettings(state.settings);
    } catch (error) {
      const cached = window.DriftOffline?.readCachedSettings();
      state.settings = normalizeSettings(cached || DEFAULT_SETTINGS);
      if (cached) state.offline = true;
      showToast(error.message);
    }
    applySettings();
    renderSettings();
    restartAutoPlanScheduler();
    scheduleAutoPlanRefresh(800);
  }

  function applySettings(settings = state.settings) {
    if (!settings) return;
    const root = document.documentElement;
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
    const dark = settings.theme === "dark" || (settings.theme === "system" && systemDark);
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.accent = settings.accent || "moss";
    root.dataset.displayFont = settings.displayFont || "editorial";
    root.dataset.readingSize = settings.readingSize || "default";
    root.dataset.density = settings.density || "comfortable";
    root.dataset.motion = settings.motion || "system";
    window.DriftI18n?.setLocale(settings.locale || "en");
    window.DriftI18n?.translateSubtree(document.body);
    const dateChip = $("dateChip");
    if (dateChip) {
      dateChip.textContent = new Intl.DateTimeFormat(settings.locale || undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date());
    }
    $("dayFlowPanel")?.classList.toggle("hidden", settings.features?.dayFlow === false);
    $("autoPlanButton")?.classList.toggle(
      "hidden",
      settings.features?.smartPlan === false || !settingOn(settings.autoPlanEnabled)
    );
    const toggle = $("settingsThemeToggle");
    if (toggle) toggle.textContent = t(dark ? "Light" : "Dark");
  }

  function setSettingsSaveState(value) {
    const node = $("settingsSaveState");
    if (!node) return;
    node.className = `settings-save-state ${value}`;
    node.textContent = value === "saving" ? t("Saving…") : value === "saved" ? t("Saved") : value === "error" ? t("Could not save") : t("Autosave");
  }

  function updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    applySettings();
    setSettingsSaveState("saving");
    state.settingsQueue = state.settingsQueue.then(async () => {
      try {
        await request("/api/settings", { method: "PATCH", body: patch });
        window.DriftOffline?.cacheSettings(state.settings);
        setSettingsSaveState("saved");
        const autoPlanKeys = [
          "autoPlanEnabled", "autoPlanMode", "autoPlanRefreshMinutes", "autoPlanWeeklyMinutes",
          "autoPlanRestMinutes", "autoPlanDeepWorkMinutes", "autoPlanSplitLongTasks",
          "autoPlanIncludeWeekends", "autoPlanDefaultEstimateMinutes", "autoPlanCapBehavior",
          "autoPlanLunchEnabled", "autoPlanLunchStart", "autoPlanLunchEnd", "capacityMinutes",
          "workdayStart", "workdayEnd", "weekStartsOn",
        ];
        if (autoPlanKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
          restartAutoPlanScheduler();
          scheduleAutoPlanRefresh(500);
        }
      } catch (error) {
        setSettingsSaveState("error");
        showToast(error.message);
        try {
          const data = await request("/api/settings");
          state.settings = normalizeSettings(data?.settings);
          applySettings();
          renderSettings();
        } catch {
          // Keep the form usable; the next change will retry the save.
        }
      }
    });
  }

  function patchFeatures(next) {
    state.settings.features = { ...state.settings.features, ...next };
    updateSettings({ featuresJson: JSON.stringify(state.settings.features) });
  }

  function patchNotifications(next) {
    state.settings.notifications = { ...state.settings.notifications, ...next };
    updateSettings({ notificationsJson: JSON.stringify(state.settings.notifications) });
  }

  function formatHour(hour, settings = state.settings) {
    const value = Number(hour) % 24;
    if (settings?.timeFormat === "24") return `${String(value).padStart(2, "0")}:00`;
    if (settings?.timeFormat === "12") {
      const suffix = value < 12 ? "AM" : "PM";
      return `${value % 12 || 12} ${suffix}`;
    }
    try {
      return new Intl.DateTimeFormat(settings?.locale || undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, value));
    } catch {
      return `${value}:00`;
    }
  }

  function hourOptions(includeMidnightEnd) {
    const values = includeMidnightEnd ? Array.from({ length: 24 }, (_, index) => index + 1) : Array.from({ length: 24 }, (_, index) => index);
    return values.map((hour) => ({ value: hour, label: formatHour(hour) }));
  }

  function makeTextInput(value, label, onCommit, placeholder = "") {
    const input = element("input", "input");
    input.type = "text";
    input.value = value ?? "";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => onCommit(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    return input;
  }

  function makeNumberInput(value, min, max, step, label, onCommit, width = 80) {
    const input = element("input", "input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value ?? min);
    input.style.width = `${width}px`;
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => onCommit(Number(input.value)));
    return input;
  }

  function makeSelect(options, value, label, onChange) {
    const select = element("select", "select");
    select.setAttribute("aria-label", label);
    for (const option of options) {
      const node = new Option(option.label, String(option.value));
      if (String(option.value) === String(value)) node.selected = true;
      select.append(node);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function makeToggle(checked, label, onChange) {
    const button = element("button", "toggle");
    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-checked", String(Boolean(checked)));
    button.addEventListener("click", () => {
      const next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", String(next));
      onChange(next);
    });
    return button;
  }

  function makeSegmented(value, options, label, onChange) {
    const group = element("div", "settings-segmented");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    for (const option of options) {
      const button = element("button", "", option.label);
      button.type = "button";
      button.dataset.value = String(option.value);
      const active = String(option.value) === String(value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => {
        group.querySelectorAll("button").forEach((node) => {
          node.classList.toggle("active", node === button);
          node.setAttribute("aria-pressed", String(node === button));
        });
        onChange(option.value);
      });
      group.append(button);
    }
    return group;
  }

  function makeRange(value, min, max, step, label, onCommit, format = String) {
    const wrap = element("div", "settings-range");
    const range = element("input", "");
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    range.setAttribute("aria-label", label);
    const output = element("strong", "settings-range-value", format(Number(value)));
    range.addEventListener("input", () => {
      output.textContent = format(Number(range.value));
    });
    range.addEventListener("change", () => onCommit(Number(range.value)));
    wrap.append(range, output);
    return wrap;
  }

  function makeBadge(text, tone) {
    return element("span", `badge ${tone || "slate"}`, text);
  }

  function settingsRow(card, title, description, control, hint) {
    const row = element("div", "settings-row");
    const copy = element("div", "settings-copy");
    copy.append(element("strong", "", title));
    if (description) copy.append(element("span", "", description));
    if (hint) copy.append(element("small", "field-hint", hint));
    const wrap = element("div", "settings-control");
    for (const node of Array.isArray(control) ? control : [control]) {
      if (node) wrap.append(node);
    }
    row.append(copy, wrap);
    card.append(row);
    return row;
  }

  function createSettingsSection(id, title, description, resetKey) {
    const section = element("section", "settings-section");
    section.id = `settings-${id}`;
    const head = element("div", "settings-section-head");
    const copy = element("div");
    const heading = element("h2", "", title);
    heading.id = `settings-${id}-title`;
    section.setAttribute("aria-labelledby", heading.id);
    copy.append(heading, element("p", "", description));
    head.append(copy);
    if (resetKey) {
      const reset = element("button", "btn ghost sm", "Restore defaults");
      reset.type = "button";
      reset.addEventListener("click", () => restoreSettingsSection(resetKey));
      head.append(reset);
    }
    section.append(head);
    const card = element("div", "settings-card");
    section.append(card);
    return { section, card };
  }

  function renderSettings() {
    if (!state.settings) return;
    const currentWorkspace = workspace();
    $("settingsWorkspaceName").textContent = currentWorkspace?.name ?? "Workspace";
    const role = currentWorkspace?.role ?? "OWNER";
    $("settingsWorkspaceRole").textContent = t(role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : role === "MEMBER" ? "Member" : "Guest");
    const nav = $("settingsNav");
    const container = $("settingsSections");
    nav.replaceChildren();
    container.replaceChildren();
    const definitions = [
      { id: "account", label: "Account", group: "You", icon: "user", render: renderAccountSettings },
      { id: "appearance", label: "Appearance", group: "You", icon: "sun", render: renderAppearanceSettings },
      { id: "language", label: "Language & region", group: "You", icon: "search", render: renderLanguageSettings },
      { id: "planning", label: "Planning", group: "You", icon: "calendar", render: renderPlanningSettings },
      { id: "auto-plan", label: "Auto-plan", group: "You", icon: "insights", render: renderAutoPlanSettings },
      { id: "focus", label: "Focus & capture", group: "You", icon: "capture", render: renderFocusSettings },
      { id: "sound", label: "Sound", group: "You", icon: "volume", render: renderSoundSettings },
      { id: "notifications", label: "Notifications", group: "You", icon: "bell", render: renderNotificationSettings },
      { id: "keyboard", label: "Keyboard", group: "You", icon: "command", render: renderKeyboardSettings },
      { id: "features", label: "Features", group: "You", icon: "command", render: renderFeatureSettings },
      { id: "security", label: "Security", group: "You", icon: "settings", render: renderSecuritySettings },
    ];
    if (["OWNER", "ADMIN"].includes(role)) {
      definitions.push({ id: "workspace", label: "Workspace", group: "Workspace", icon: "board", render: renderWorkspaceSettings });
      if ((currentWorkspace?.type ?? "personal") !== "personal") {
        definitions.push({ id: "people", label: "People", group: "Workspace", icon: "user", render: renderPeopleSettings });
        definitions.push({ id: "policies", label: "Policies", group: "Workspace", icon: "archive", render: renderPolicySettings });
      }
      definitions.push(
        { id: "automations", label: "Automations", group: "Workspace", icon: "insights", render: renderAutomationSettings },
        { id: "integrations", label: "Integrations", group: "Workspace", icon: "command", render: renderIntegrationSettings },
        { id: "audit", label: "Audit log", group: "Workspace", icon: "archive", render: renderAuditSettings },
      );
    }
    definitions.push(
      { id: "data", label: "Data & export", group: "Data", icon: "list", render: renderDataSettings },
      { id: "about", label: "About Drift", group: "Data", icon: "help", render: renderAboutSettings },
    );
    let group = null;
    definitions.forEach((definition, index) => {
      if (definition.group !== group) {
        group = definition.group;
        nav.append(element("div", "side-label settings-group", t(group)));
      }
      const button = element("button", `settings-nav-item${index === 0 ? " active" : ""}`);
      button.type = "button";
      button.dataset.section = definition.id;
      button.append(icon(definition.icon), element("span", "", t(definition.label)));
      button.addEventListener("click", () => {
        nav.querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button));
        const target = document.getElementById(`settings-${definition.id}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        target?.refreshSettingsSection?.();
        history.replaceState({}, "", `/settings#${definition.id}`);
      });
      nav.append(button);
      container.append(definition.render());
    });
    window.DriftI18n?.translateSubtree(nav);
    window.DriftI18n?.translateSubtree(container);
    window.setTimeout(focusSettingsHash, 30);
  }

  function focusSettingsHash() {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    const target = document.getElementById(`settings-${hash}`);
    const nav = $("settingsNav");
    const button = nav?.querySelector(`[data-section="${hash}"]`);
    if (!target || !button) return;
    nav.querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button));
    target.scrollIntoView({ block: "start" });
    target.refreshSettingsSection?.();
  }

  function renderAccountSettings() {
    const user = state.boot?.user ?? {};
    const guest = settingOn(user.isGuest);
    const { section, card } = createSettingsSection("account", "Account", "Your identity in this workspace. Email changes are intentionally not self-service in v1.");
    const nameInput = makeTextInput(user.name || "", "Display name", () => {}, "Your name");
    nameInput.maxLength = 80;
    nameInput.style.width = "240px";
    settingsRow(card, "Display name", "Shown on tasks, comments, and mentions.", nameInput);

    const emailControl = guest
      ? (() => {
          const button = element("button", "btn sm primary", t("Save workspace"));
          button.type = "button";
          button.addEventListener("click", openAuthModal);
          return button;
        })()
      : makeBadge(user.email || "No email", "slate");
    settingsRow(card, "Email", user.email || t("No email yet. Save this guest workspace to add one."), emailControl);

    const timezoneInput = makeTextInput(user.timezone || "Asia/Hong_Kong", "Time zone", () => {}, "Asia/Hong_Kong");
    timezoneInput.style.width = "240px";
    settingsRow(card, "Time zone", "Used for Today, reminders, digests, and recurrence. Commit by leaving the field.", timezoneInput);

    const save = element("button", "btn primary sm", "Save");
    save.type = "button";
    save.addEventListener("click", () => void saveAccount(nameInput, timezoneInput, save));
    const status = element("div", "inline");
    status.append(makeBadge(guest ? "Guest" : "Account", guest ? "amber" : "accent"), save);
    settingsRow(card, "Account status", `${guest ? t("Guest, not yet claimable across devices.") : t("Verified account.")} ${t("Two-factor is off.")}`, status);
    return section;
  }

  async function saveAccount(nameInput, timezoneInput, button) {
    const name = nameInput.value.trim() || state.boot?.user?.name || "Guest";
    const timezone = timezoneInput.value.trim();
    button.disabled = true;
    setSettingsSaveState("saving");
    try {
      const data = await request("/api/account", {
        method: "PATCH",
        body: { name, ...(timezone ? { timezone } : {}) },
      });
      if (data?.user) state.boot.user = { ...state.boot.user, ...data.user };
      window.DriftOffline?.cacheBootstrap(state.boot);
      renderAccount();
      setSettingsSaveState("saved");
      showToast("Account updated.");
    } catch (error) {
      setSettingsSaveState("error");
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function saveTimezone(input) {
    const timezone = input.value.trim();
    if (!timezone) return;
    setSettingsSaveState("saving");
    try {
      const data = await request("/api/account", { method: "PATCH", body: { timezone } });
      if (data?.user) state.boot.user = { ...state.boot.user, ...data.user };
      window.DriftOffline?.cacheBootstrap(state.boot);
      document.querySelectorAll('#settings-account input[aria-label="Time zone"], #settings-language input[aria-label="Time zone"]').forEach((node) => {
        node.value = data?.user?.timezone || timezone;
      });
      setSettingsSaveState("saved");
      showToast("Time zone updated.");
    } catch (error) {
      setSettingsSaveState("error");
      showToast(error.message);
    }
  }

  function renderAppearanceSettings() {
    const settings = state.settings;
    const { section, card } = createSettingsSection("appearance", "Appearance", "Calm by default. Choose the material, type, and motion that fit your desk.", "appearance");
    const themeGrid = element("div", "settings-theme-grid");
    for (const [value, label] of [["system", "System"], ["light", "Light"], ["dark", "Dark"]]) {
      const option = element("button", `settings-theme-card${settings.theme === value ? " active" : ""}`);
      option.type = "button";
      option.setAttribute("aria-pressed", String(settings.theme === value));
      const visual = element("span", `settings-theme-visual ${value}`);
      visual.append(element("i"), element("i"), element("i"));
      const caption = element("span");
      caption.append(document.createTextNode(label));
      option.append(visual, caption, element("span", "settings-check", "✓"));
      option.addEventListener("click", () => {
        themeGrid.querySelectorAll(".settings-theme-card").forEach((node) => {
          node.classList.toggle("active", node === option);
          node.setAttribute("aria-pressed", String(node === option));
        });
        updateSettings({ theme: value });
      });
      themeGrid.append(option);
    }
    settingsRow(card, "Theme", "Follow your system, or pin a mode for this account.", themeGrid);

    const swatches = element("div", "settings-swatches");
    for (const [value, label, color] of [["moss", "Moss", "#2f6b56"], ["ink", "Ink", "#3d5a80"], ["clay", "Clay", "#a35f43"]]) {
      const swatch = element("button", `settings-swatch${settings.accent === value ? " active" : ""}`);
      swatch.type = "button";
      swatch.setAttribute("aria-pressed", String(settings.accent === value));
      const dot = element("span");
      dot.style.background = color;
      swatch.append(dot, document.createTextNode(label));
      swatch.addEventListener("click", () => {
        swatches.querySelectorAll(".settings-swatch").forEach((node) => {
          node.classList.toggle("active", node === swatch);
          node.setAttribute("aria-pressed", String(node === swatch));
        });
        updateSettings({ accent: value });
      });
      swatches.append(swatch);
    }
    settingsRow(card, "Accent", "A quiet color for actions, focus, and the plan ring.", swatches);

    const fonts = element("div", "settings-choice-grid settings-font-grid");
    for (const [value, label, font] of [["editorial", "Editorial", '"Iowan Old Style", "Palatino Linotype", Georgia, serif'], ["modern", "Modern", "var(--font-ui)"], ["classic", "Classic", '"Charter", Cambria, Georgia, serif']]) {
      const choice = element("button", `settings-choice${settings.displayFont === value ? " active" : ""}`);
      choice.type = "button";
      choice.setAttribute("aria-pressed", String(settings.displayFont === value));
      const sample = element("span", "", "Aa");
      sample.style.fontFamily = font;
      choice.append(sample, element("small", "", label));
      choice.addEventListener("click", () => {
        fonts.querySelectorAll(".settings-choice").forEach((node) => {
          node.classList.toggle("active", node === choice);
          node.setAttribute("aria-pressed", String(node === choice));
        });
        updateSettings({ displayFont: value });
      });
      fonts.append(choice);
    }
    settingsRow(card, "Display type", "Editorial is the current serif voice. Modern uses the interface face.", fonts);

    settingsRow(card, "Reading text", "A little more room for long notes and settings copy. Page zoom still works.", makeSegmented(settings.readingSize, [{ value: "default", label: "Default" }, { value: "large", label: "Large" }], "Reading text", (value) => updateSettings({ readingSize: value })));
    settingsRow(card, "Density", "Compact reduces row height in lists and settings without hiding information.", makeSegmented(settings.density, [{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }], "Density", (value) => updateSettings({ density: value })));
    settingsRow(card, "Motion", "System respects your OS. Reduced keeps state changes instant. Full is for demos.", makeSegmented(settings.motion, [{ value: "system", label: "System" }, { value: "reduced", label: "Reduced motion" }, { value: "full", label: "Full motion" }], "Motion", (value) => updateSettings({ motion: value })));
    section.append(settingsPreview());
    return section;
  }

  function settingsPreview() {
    const block = element("div", "settings-preview-block");
    const head = element("div", "settings-preview-head");
    const copy = element("div");
    copy.append(element("span", "eyebrow", "Preview"), element("strong", "", "Today, at a glance"));
    head.append(copy, makeBadge("4h 45m", "accent"));
    const live = element("div", "settings-live-preview");
    const intro = element("div", "settings-preview-copy");
    intro.append(element("span", "eyebrow", new Intl.DateTimeFormat(state.settings.locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()));
    intro.append(element("h3", "", "Good afternoon, Maya."));
    intro.append(element("p", "", "Four small things, with room to breathe."));
    const plan = element("div", "settings-preview-plan");
    for (const width of ["38%", "24%", "18%"]) {
      const segment = element("span");
      segment.style.width = width;
      plan.append(segment);
    }
    const task = element("div", "settings-preview-task");
    task.append(element("span", "settings-preview-check", "✓"));
    const taskCopy = element("span");
    taskCopy.append(element("strong", "", "Ship the pricing page"), element("small", "", `${formatHour(18)} · 120m · Focus next`));
    task.append(taskCopy, makeBadge("95%", "accent"));
    live.append(intro, plan, task);
    block.append(head, live, element("p", "field-hint", "Editorial · Moss · Comfortable · Default text"));
    return block;
  }

  function renderLanguageSettings() {
    const settings = state.settings;
    const { section, card } = createSettingsSection("language", "Language & region", "The planner stays local. Language, dates, and the week start with you.", "language");
    const datePreview = makeBadge(new Intl.DateTimeFormat(settings.locale, { dateStyle: "medium" }).format(new Date()), "slate");
    settingsRow(card, "Language", "Preview: the app shell, Today, planning, capture, and Settings are translated.", makeSelect([{ value: "en", label: "English" }, { value: "zh-TW", label: "Traditional Chinese" }], settings.locale, "Language", (value) => {
      updateSettings({ locale: value });
      datePreview.textContent = new Intl.DateTimeFormat(value, { dateStyle: "medium" }).format(new Date());
    }));
    const timezoneInput = makeTextInput(state.boot?.user?.timezone || "Asia/Hong_Kong", "Time zone", () => {}, "Asia/Hong_Kong");
    timezoneInput.style.width = "240px";
    timezoneInput.addEventListener("change", () => void saveTimezone(timezoneInput));
    settingsRow(card, "Time zone", "Used for Today, reminders, digests, and recurrence. Commit by leaving the field.", timezoneInput);
    settingsRow(card, "Time format", `Example: ${formatHour(17)}`, makeSelect([{ value: "auto", label: "Follow language" }, { value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }], settings.timeFormat, "Time format", (value) => updateSettings({ timeFormat: value })));
    settingsRow(card, "Week starts on", "Calendar and weekly rhythms follow this setting.", makeSelect([{ value: 1, label: "Monday" }, { value: 0, label: "Sunday" }, { value: 6, label: "Saturday" }], settings.weekStartsOn, "Week starts on", (value) => updateSettings({ weekStartsOn: Number(value) })));
    settingsRow(card, "Date preview", "A local date, formatted with your language.", datePreview);
    return section;
  }

  function renderPlanningSettings() {
    const settings = state.settings;
    const { section, card } = createSettingsSection("planning", "Planning", "Capacity, breathing room, and the edges of the day. Today always explains itself.", "planning");
    const capacityWrap = element("div", "settings-range");
    const capacityRange = element("input", "");
    capacityRange.type = "range";
    capacityRange.min = "15";
    capacityRange.max = "720";
    capacityRange.step = "15";
    capacityRange.value = String(Math.min(720, settings.capacityMinutes));
    capacityRange.setAttribute("aria-label", "Capacity (minutes)");
    const capacityNumber = makeNumberInput(settings.capacityMinutes, 15, 1440, 15, "Capacity (minutes)", (value) => {
      capacityRange.value = String(Math.min(720, value));
      updateSettings({ capacityMinutes: value });
    }, 72);
    capacityRange.addEventListener("change", () => {
      const value = Number(capacityRange.value);
      capacityNumber.value = String(value);
      updateSettings({ capacityMinutes: value });
    });
    capacityWrap.append(capacityRange, capacityNumber, element("span", "field-hint", "min"));
    settingsRow(card, "Daily capacity", `${settings.capacityMinutes} minutes available to the Today planner.`, capacityWrap);

    settingsRow(card, "Plan buffer", "Keep part of the day empty. Smart Plan will leave this breathing room untouched.", makeRange(settings.planBufferPercent, 0, 40, 5, "Plan buffer", (value) => updateSettings({ planBufferPercent: value }), (value) => `${value}%`));

    const workday = element("div", "settings-inline-controls");
    const startField = element("label", "field");
    startField.append(element("span", "label", "Start"));
    startField.append(makeSelect(hourOptions(false), settings.workdayStart, "Workday start", (value) => {
      const start = Number(value);
      updateSettings({ workdayStart: start, ...(start >= settings.workdayEnd ? { workdayEnd: Math.min(24, start + 1) } : {}) });
    }));
    const endField = element("label", "field");
    endField.append(element("span", "label", "End"));
    endField.append(makeSelect(hourOptions(true), settings.workdayEnd, "Workday end", (value) => {
      const end = Number(value);
      updateSettings({ workdayEnd: end, ...(end <= settings.workdayStart ? { workdayStart: Math.max(0, end - 1) } : {}) });
    }));
    workday.append(startField, endField);
    settingsRow(card, "Workday", "Day Flow shades the hours outside this window. It is a visual cue, not a hard limit.", workday);

    settingsRow(card, "Buffer between blocks", "A little air between the blocks on the rail.", makeSelect([0, 5, 10, 15, 20, 30].map((minutes) => ({ value: minutes, label: minutes ? `${minutes} min` : "None" })), settings.blockBufferMinutes, "Buffer between blocks", (value) => updateSettings({ blockBufferMinutes: Number(value) })));
    settingsRow(card, "Default view", "Where Drift opens when no board or task link is present.", makeSelect([{ value: "today", label: "Today" }, { value: "upcoming", label: "Upcoming" }, { value: "board", label: "Board" }], settings.startView, "Default view", (value) => updateSettings({ startView: value })));
    return section;
  }

  function renderAutoPlanSettings() {
    const settings = state.settings;
    const { section, card } = createSettingsSection("auto-plan", "Auto-plan", "Let Drift shape a realistic plan from your tasks and limits. It schedules the plan layer, never your due dates or completed work.", "auto-plan");
    settingsRow(card, "Enable Auto-plan", "Generate plans in Today and keep them fresh while the app is open.", makeToggle(settingOn(settings.autoPlanEnabled), "Enable Auto-plan", (next) => updateSettings({ autoPlanEnabled: next ? 1 : 0 })));
    settingsRow(card, "Automation level", "Start with suggestions. Higher levels may move flexible plan blocks automatically.", makeSelect([{ value: "suggest", label: "Suggest only" }, { value: "safe", label: "Safe auto-apply" }, { value: "full", label: "Full plan auto-apply" }, { value: "delegated", label: "Delegated cleanup" }], settings.autoPlanMode, "Automation level", (value) => updateSettings({ autoPlanMode: value })));
    settingsRow(card, "Rest between tasks", "Every scheduled block leaves this much space before the next one.", makeSelect([0, 5, 10, 15, 20, 30].map((minutes) => ({ value: minutes, label: minutes ? `${minutes} min` : "None" })), settings.autoPlanRestMinutes, "Rest between tasks", (value) => updateSettings({ autoPlanRestMinutes: Number(value) })));
    settingsRow(card, "Weekly work limit", `${Math.round((settings.autoPlanWeeklyMinutes / 60) * 10) / 10}h per week. If the limit is reached, Auto-plan stops recommending new work even when a day has free time.`, (() => {
      const wrap = element("div", "settings-range");
      wrap.append(makeNumberInput(settings.autoPlanWeeklyMinutes, 60, 10080, 30, "Weekly work limit minutes", (value) => updateSettings({ autoPlanWeeklyMinutes: value }), 88), element("span", "field-hint", "minutes"));
      return wrap;
    })());
    settingsRow(card, "Refresh plan", "Recompute while the app is open. The app cannot run a background worker while closed.", makeSelect([{ value: 0, label: "Off" }, { value: 15, label: "Every 15 minutes" }, { value: 30, label: "Every 30 minutes" }, { value: 60, label: "Every hour" }], settings.autoPlanRefreshMinutes, "Refresh plan", (value) => updateSettings({ autoPlanRefreshMinutes: Number(value) })));
    settingsRow(card, "Longest focus block", "Long work can be split into sessions with rest between them.", makeSelect([30, 45, 60, 90, 120].map((minutes) => ({ value: minutes, label: `${minutes} min` })), settings.autoPlanDeepWorkMinutes, "Longest focus block", (value) => updateSettings({ autoPlanDeepWorkMinutes: Number(value) })));
    settingsRow(card, "Split long tasks", "When a task is longer than the focus block, schedule it as multiple sessions.", makeToggle(settingOn(settings.autoPlanSplitLongTasks), "Split long tasks", (next) => updateSettings({ autoPlanSplitLongTasks: next ? 1 : 0 })));
    settingsRow(card, "Include weekends", "Allow Saturday and Sunday in generated plans.", makeToggle(settingOn(settings.autoPlanIncludeWeekends), "Include weekends", (next) => updateSettings({ autoPlanIncludeWeekends: next ? 1 : 0 })));
    settingsRow(card, "Default estimate", "Used only when a task has no estimate. The plan labels these assumptions.", makeSelect([15, 30, 45, 60, 90].map((minutes) => ({ value: minutes, label: `${minutes} min` })), settings.autoPlanDefaultEstimateMinutes, "Default estimate", (value) => updateSettings({ autoPlanDefaultEstimateMinutes: Number(value) })));
    settingsRow(card, "At the weekly limit", "Stop scheduling new work, or keep it visible with a warning.", makeSelect([{ value: "stop", label: "Stop recommending" }, { value: "warn", label: "Show warning only" }], settings.autoPlanCapBehavior, "At the weekly limit", (value) => updateSettings({ autoPlanCapBehavior: value })));

    const lunch = element("div", "settings-inline-controls settings-auto-lunch");
    lunch.append(makeToggle(settingOn(settings.autoPlanLunchEnabled), "Protected lunch", (next) => updateSettings({ autoPlanLunchEnabled: next ? 1 : 0 })));
    lunch.append(makeSelect(hourOptions(false), settings.autoPlanLunchStart, "Lunch start", (value) => {
      const start = Number(value);
      updateSettings({ autoPlanLunchStart: start, ...(start >= settings.autoPlanLunchEnd ? { autoPlanLunchEnd: Math.min(24, start + 1) } : {}) });
    }));
    lunch.append(element("span", "field-hint", "to"));
    lunch.append(makeSelect(hourOptions(true), settings.autoPlanLunchEnd, "Lunch end", (value) => {
      const end = Number(value);
      updateSettings({ autoPlanLunchEnd: end, ...(end <= settings.autoPlanLunchStart ? { autoPlanLunchStart: Math.max(0, end - 1) } : {}) });
    }));
    settingsRow(card, "Protected lunch", "Reserve a daily break before Auto-plan fills the day.", lunch);

    const cleanup = element("div", "settings-inline-controls settings-auto-cleanup");
    cleanup.append(makeToggle(settingOn(settings.autoPlanAllowStaleArchive), "Stale task cleanup", (next) => updateSettings({ autoPlanAllowStaleArchive: next ? 1 : 0 })));
    cleanup.append(makeSelect([14, 30, 60, 90].map((days) => ({ value: days, label: `${days} days` })), settings.autoPlanStaleDays, "Stale task days", (value) => updateSettings({ autoPlanStaleDays: Number(value) })));
    settingsRow(card, "Stale task cleanup", "Delegated cleanup can archive unscheduled tasks that have not changed for this many days. Hard due dates never move.", cleanup);
    return section;
  }

  function renderFocusSettings() {
    const settings = state.settings;
    const { section, card } = createSettingsSection("focus", "Focus & capture", "Defaults for the quiet part of the product. Nothing starts without your gesture.", "focus");
    settingsRow(card, "Default focus length", "Used when a task has no estimate of its own.", makeSelect([15, 25, 45, 60, 90].map((minutes) => ({ value: minutes, label: `${minutes} min` })), settings.focusMinutes, "Default focus length", (value) => updateSettings({ focusMinutes: Number(value) })));
    settingsRow(card, "Auto-start focus", "Begin the timer after the Focus screen opens.", makeToggle(settingOn(settings.focusAutoStart), "Auto-start focus", (next) => updateSettings({ focusAutoStart: next ? 1 : 0 })));
    settingsRow(card, "Close capture after adding", "Duplicate captures are easier when the dialog stays open.", makeToggle(settingOn(settings.captureCloseAfterAdd), "Close capture after adding", (next) => updateSettings({ captureCloseAfterAdd: next ? 1 : 0 })));
    return section;
  }

  function renderSoundSettings() {
    const sound = window.DriftSound;
    const prefs = sound?.getPrefs() ?? { enabled: true, volume: 0.32, palette: "hybrid", typing: false };
    const { section, card } = createSettingsSection("sound", "Sound", "Quiet feedback for captures, completions, moves, and reminders. Generated locally; nothing is downloaded.", "sound");
    const update = (patch) => {
      const next = sound?.setPrefs(patch) ?? { ...prefs, ...patch };
      Object.assign(prefs, next);
    };

    settingsRow(card, "Interface sounds", "Quiet feedback for captures, completions, moves, and reminders.", makeToggle(prefs.enabled, "Interface sounds", (next) => {
      update({ enabled: next });
      if (next) sound?.play("tap");
    }));

    const palettes = element("div", "sound-palettes");
    for (const [id, name, description] of [
      ["wood", "Paper & wood", "Dry, short, close to the desk."],
      ["glass", "Felt & glass", "Warm, airy, a little more melodic."],
      ["hybrid", "Hybrid", "A paper transient with a soft tone."],
    ]) {
      const button = element("button", `sound-palette${prefs.palette === id ? " active" : ""}`);
      button.type = "button";
      button.setAttribute("aria-pressed", String(prefs.palette === id));
      button.append(element("span", "sound-palette-name", name), element("span", "", description));
      const dots = element("span", "sound-palette-dots");
      dots.append(element("i"), element("i"), element("i"));
      button.append(dots);
      button.addEventListener("click", () => {
        update({ palette: id, enabled: true });
        palettes.querySelectorAll(".sound-palette").forEach((node) => {
          node.classList.toggle("active", node === button);
          node.setAttribute("aria-pressed", String(node === button));
        });
        sound?.play("complete");
      });
      palettes.append(button);
    }
    settingsRow(card, "Sound character", "Try each palette on your speakers and headphones.", palettes);

    const volumeWrap = element("div", "inline sound-volume");
    const volume = element("input", "");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.step = "1";
    volume.value = String(Math.round(prefs.volume * 100));
    volume.setAttribute("aria-label", "Sound volume");
    const volumeValue = element("strong", "settings-range-value", `${Math.round(prefs.volume * 100)}%`);
    volume.addEventListener("input", () => {
      volumeValue.textContent = `${volume.value}%`;
      update({ volume: Number(volume.value) / 100 });
    });
    volume.addEventListener("change", () => sound?.play("tap"));
    volumeWrap.append(volume, volumeValue);
    settingsRow(card, "Volume", "Deliberately low by default.", volumeWrap);

    settingsRow(card, "Typing texture", "A very quiet tick while writing in a field. Off by default.", makeToggle(prefs.typing, "Typing texture", (next) => {
      update({ typing: next });
      if (next) sound?.play("key");
    }));

    const previews = element("div", "sound-previews");
    for (const [name, label] of [
      ["capture", "Capture"],
      ["complete", "Complete"],
      ["reminder", "Reminder"],
      ["move", "Move"],
      ["error", "Error"],
      ["focus", "Focus"],
    ]) {
      const button = element("button", "btn ghost sm", label);
      button.type = "button";
      button.addEventListener("click", () => {
        if (!prefs.enabled) update({ enabled: true });
        sound?.play(name);
      });
      previews.append(button);
    }
    settingsRow(card, "Preview", "Listen before you choose.", previews);
    return section;
  }

  function renderNotificationSettings() {
    const settings = state.settings;
    const notifications = { ...DEFAULT_NOTIFICATIONS, ...settings.notifications };
    const { section, card } = createSettingsSection("notifications", "Notifications", "In-app notifications are the source of truth. Email is delivered when SMTP is configured.", "notifications");
    const toggleNotification = (key, title, description) => {
      settingsRow(card, title, description, makeToggle(settingOn(notifications[key]), title, (next) => {
        notifications[key] = next;
        if (key === "browser" && next && "Notification" in window && window.Notification.permission === "default") {
          void window.Notification.requestPermission();
        }
        patchNotifications({ [key]: next });
      }));
    };
    toggleNotification("inApp", "In-app notifications", "Assignments, comments, reminders, and automations.");
    toggleNotification("mentions", "Mentions and assignments", "Only notify me when someone mentions me or assigns work.");
    toggleNotification("email", "Email notifications", "Delivered when SMTP is configured.");
    toggleNotification("browser", "Browser notifications", "Ask the browser for permission when this workspace is open.");
    settingsRow(card, "Daily digest", "A quiet summary of what is due and what changed.", makeToggle(settingOn(settings.emailDigest), "Daily digest", (next) => updateSettings({ emailDigest: next ? 1 : 0 })));
    settingsRow(card, "Digest hour", "Local time for the daily email summary.", makeSelect(Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: formatHour(hour) })), settings.digestHour, "Digest hour", (value) => updateSettings({ digestHour: Number(value) })));
    const quiet = element("div", "settings-inline-controls settings-quiet-hours");
    quiet.append(makeSelect([{ value: "", label: "Off" }, ...Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: formatHour(hour) }))], settings.quietStart ?? "", "Quiet hours start", (value) => updateSettings({ quietStart: value === "" ? null : Number(value) })));
    quiet.append(element("span", "field-hint", "to"));
    quiet.append(makeSelect([{ value: "", label: "Off" }, ...Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: formatHour(hour) }))], settings.quietEnd ?? "", "Quiet hours end", (value) => updateSettings({ quietEnd: value === "" ? null : Number(value) })));
    settingsRow(card, "Quiet hours", "Pause in-app and browser notifications during this window.", quiet);
    return section;
  }

  function renderFeatureSettings() {
    const features = { ...DEFAULT_FEATURES, ...state.settings.features };
    const { section, card } = createSettingsSection("features", "Features", "Experimental features are optional and never hide the basic text path.", "features");
    const toggleFeature = (key, title, description) => {
      settingsRow(card, title, description, makeToggle(settingOn(features[key]), title, (next) => {
        features[key] = next;
        patchFeatures({ [key]: next });
      }));
    };
    toggleFeature("dayFlow", "Day Flow", "The 24-hour rail, capacity ring, and focus-next card.");
    toggleFeature("smartPlan", "Smart Plan", "Preview a local rules plan, then apply or undo it. No model call.");
    toggleFeature("voice", "Voice capture", "Show the browser speech shortcut. Text capture is always available.");
    settingsRow(card, "Single-key shortcuts", "C, /, ? and G sequences. Saved on this device.", makeToggle(state.singleKeyShortcuts, "Single-key shortcuts", setSingleKeyShortcuts));
    return section;
  }

  const AUTOMATION_TRIGGERS = [
    ["task.created", "When a task is created"],
    ["task.moved", "When a task moves"],
    ["task.completed", "When a task is completed"],
  ];
  const AUTOMATION_ACTIONS = [
    ["set_priority", "Set priority"],
    ["add_label", "Add a label"],
    ["move_to_column", "Move to a column"],
    ["notify", "Notify the assignee"],
  ];
  const AUTOMATION_PRIORITIES = ["urgent", "high", "medium", "low", "none"];

  function renderAutomationSettings() {
    const { section, card } = createSettingsSection(
      "automations",
      "Automations",
      "Explicit rules, previews, and undo. No autonomous mutation."
    );
    const toolbar = element("div", "inline");
    toolbar.style.cssText = "justify-content:flex-end;margin-bottom:10px";
    const newRule = element("button", "btn primary sm", `+ ${t("New rule")}`);
    newRule.type = "button";
    toolbar.append(newRule);
    section.insertBefore(toolbar, card);
    const previewWrap = element("div");
    previewWrap.style.marginTop = "14px";
    section.append(previewWrap);

    const labelFor = (list, value) => t(list.find((entry) => entry[0] === value)?.[1] ?? value);
    const boardName = (id) => boards().find((board) => board.id === id)?.name ?? "";

    const renderPreview = (preview) => {
      previewWrap.replaceChildren();
      if (!preview.length) return;
      previewWrap.append(element("div", "field-hint", t("Preview against current tasks")));
      for (const entry of preview.slice(0, 6)) {
        const row = element("div", "inline");
        row.style.cssText = "font-size:11px;padding:5px 0;color:var(--muted)";
        row.append(element("span", "automation-check", "✓"));
        row.append(document.createTextNode(` ${entry.title}: ${entry.change}`));
        previewWrap.append(row);
      }
    };

    const refreshRules = async () => {
      try {
        const result = await request(`/api/automations?workspaceId=${encodeURIComponent(workspace().id)}`);
        const rules = result?.rules ?? [];
        card.replaceChildren();
        if (!rules.length) {
          const row = element("div", "settings-row");
          const copy = element("div", "settings-copy");
          copy.append(element("strong", "", t("No automations yet")));
          copy.append(element("span", "", t("A rule is a quiet, explainable helper — never a surprise.")));
          row.append(copy);
          card.append(row);
        }
        for (const rule of rules) {
          const row = element("div", "settings-row");
          const copy = element("div", "settings-copy");
          copy.append(element("strong", "", rule.name));
          const parts = [
            labelFor(AUTOMATION_TRIGGERS, rule.trigger),
            `${labelFor(AUTOMATION_ACTIONS, rule.actionType)}: ${rule.actionValue}`,
          ];
          if (rule.boardId) parts.push(boardName(rule.boardId));
          if (rule.lastRunAt) parts.push(`${t("Last ran")} ${relativeTime(rule.lastRunAt)}`);
          copy.append(element("span", "", parts.join(" · ")));
          const controls = element("div", "settings-control inline");
          controls.append(makeToggle(Boolean(rule.enabled), `${t("Enable")} ${rule.name}`, async (next) => {
            try {
              await request(`/api/automations/${encodeURIComponent(rule.id)}`, {
                method: "PATCH",
                body: { workspaceId: workspace().id, enabled: next },
              });
              showToast(t("Automation updated."));
              await refreshRules();
            } catch (error) {
              showToast(error.message);
              await refreshRules();
            }
          }));
          const remove = element("button", "btn ghost sm", t("Delete"));
          remove.type = "button";
          remove.addEventListener("click", async () => {
            if (!window.confirm(t("Delete this automation?"))) return;
            try {
              await request(`/api/automations/${encodeURIComponent(rule.id)}?workspaceId=${encodeURIComponent(workspace().id)}`, { method: "DELETE" });
              showToast(t("Automation deleted."));
              await refreshRules();
            } catch (error) {
              showToast(error.message);
            }
          });
          controls.append(remove);
          row.append(copy, controls);
          card.append(row);
        }
        renderPreview(result?.preview ?? []);
      } catch (error) {
        card.replaceChildren(element("div", "empty", error.message));
        previewWrap.replaceChildren();
      }
    };

    const openRuleModal = () => {
      const backdrop = element("div", "modal-backdrop");
      const modal = element("div", "modal");
      modal.style.width = "min(640px, 100%)";
      const head = element("div", "modal-head");
      const headCopy = element("div");
      headCopy.append(element("p", "eyebrow", workspace()?.name ?? ""));
      headCopy.append(element("h2", "", t("New automation")));
      const close = element("button", "btn ghost sm", "×");
      close.type = "button";
      close.setAttribute("aria-label", t("Close"));
      head.append(headCopy, close);
      const form = element("form", "form-grid");
      form.id = "automation-form";

      const nameField = element("label", "field");
      nameField.append(element("span", "", t("Name")));
      const nameInput = element("input", "input");
      nameInput.placeholder = t("Flag urgent work");
      nameInput.maxLength = 80;
      nameField.append(nameInput);

      const triggerField = element("label", "field");
      triggerField.append(element("span", "", t("When")));
      const trigger = element("select", "select");
      for (const [value, label] of AUTOMATION_TRIGGERS) trigger.add(new Option(t(label), value));
      triggerField.append(trigger);

      const conditionField = element("label", "field");
      conditionField.append(element("span", "", t("Only when priority is")));
      const conditionPriority = element("select", "select");
      conditionPriority.add(new Option(t("Any priority"), ""));
      for (const priority of AUTOMATION_PRIORITIES) {
        conditionPriority.add(new Option(t(priority), priority));
      }
      conditionField.append(conditionPriority);

      const actionField = element("label", "field");
      actionField.append(element("span", "", t("Do")));
      const action = element("select", "select");
      for (const [value, label] of AUTOMATION_ACTIONS) action.add(new Option(t(label), value));
      actionField.append(action);

      const scopeField = element("label", "field");
      scopeField.append(element("span", "", t("Board scope")));
      const scope = element("select", "select");
      scope.add(new Option(t("Every board"), ""));
      for (const board of boards()) scope.add(new Option(board.name, board.id));
      scopeField.append(scope);

      const valueField = element("label", "field");
      const valueLabel = element("span", "", t("Priority"));
      valueField.append(valueLabel);
      let valueControl;
      const boardColumns = () => boards().find((board) => board.id === scope.value)?.columns ?? [];
      const rebuildValue = () => {
        previewBox.replaceChildren();
        previewBox.classList.add("hidden");
        valueField.querySelectorAll(".select, .input").forEach((node) => node.remove());
        if (action.value === "set_priority") {
          valueLabel.textContent = t("Priority");
          valueControl = element("select", "select");
          for (const priority of AUTOMATION_PRIORITIES) valueControl.add(new Option(t(priority), priority));
          valueControl.value = "high";
        } else if (action.value === "move_to_column") {
          valueLabel.textContent = t("Column");
          valueControl = element("select", "select");
          if (!scope.value) {
            valueControl.add(new Option(t("Choose a board scope first"), ""));
          } else {
            valueControl.add(new Option(t("Choose column"), ""));
            for (const column of boardColumns()) valueControl.add(new Option(column.name, column.id));
          }
        } else if (action.value === "add_label") {
          valueLabel.textContent = t("Label name");
          valueControl = element("input", "input");
          valueControl.placeholder = t("Needs review");
        } else {
          valueLabel.textContent = t("Notification message");
          valueControl = element("input", "input");
          valueControl.placeholder = t("A task needs your attention");
        }
        valueField.append(valueControl);
        apply.disabled = !nameInput.value.trim() || !valueControl.value.trim();
        const syncValue = () => {
          previewBox.replaceChildren();
          previewBox.classList.add("hidden");
          apply.disabled = !nameInput.value.trim() || !valueControl.value.trim();
        };
        valueControl.addEventListener("input", syncValue);
        valueControl.addEventListener("change", syncValue);
      };
      const valueOf = () => String(valueControl?.value ?? "").trim();

      const boardField = scopeField;
      const previewBox = element("div", "automation-preview hidden");
      previewBox.setAttribute("role", "status");
      previewBox.setAttribute("aria-live", "polite");

      const clearPreview = () => {
        previewBox.replaceChildren();
        previewBox.classList.add("hidden");
      };
      action.addEventListener("change", rebuildValue);
      scope.addEventListener("change", rebuildValue);
      trigger.addEventListener("change", clearPreview);
      conditionPriority.addEventListener("change", clearPreview);
      nameInput.addEventListener("input", () => {
        clearPreview();
        apply.disabled = !nameInput.value.trim() || !valueOf();
      });

      form.append(nameField, triggerField, conditionField, actionField, valueField, boardField, previewBox);

      const actions = element("div", "modal-actions");
      const cancel = element("button", "btn ghost", t("Cancel"));
      cancel.type = "button";
      const previewButton = element("button", "btn", t("Preview impact"));
      previewButton.type = "button";
      const apply = element("button", "btn primary", t("Apply rule"));
      apply.type = "submit";
      apply.setAttribute("form", "automation-form");
      apply.disabled = true;
      actions.append(cancel, previewButton, apply);
      modal.append(head, form, actions);
      backdrop.append(modal);
      document.body.append(backdrop);

      const closeModal = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", onKeydown);
      close.addEventListener("click", closeModal);
      cancel.addEventListener("click", closeModal);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) closeModal();
      });
      nameInput.focus();

      const renderDraftPreview = (result) => {
        previewBox.replaceChildren();
        previewBox.classList.remove("hidden");
        const total = Number(result?.total ?? 0);
        previewBox.append(element("strong", "",
          total === 0 ? t("No current tasks would change.")
            : total === 1 ? t("{{count}} task would change.", { count: total })
            : t("{{count}} tasks would change.", { count: total })));
        for (const match of result?.matches ?? []) {
          const row = element("div", "automation-preview-row");
          const title = element("span", "", match.title);
          title.append(element("span", "field-hint", ` · ${match.boardName}`));
          const diff = element("span", "automation-diff");
          const before = element("del", "", match.before);
          const after = element("ins", "", match.after);
          diff.append(before, document.createTextNode(" → "), after);
          row.append(title, diff);
          previewBox.append(row);
        }
        if (result?.truncated) {
          previewBox.append(element("span", "field-hint",
            t("Showing the first {{count}}. The rule applies to every match when it runs.", { count: (result.matches ?? []).length })));
        }
        for (const reason of result?.skipped ?? []) {
          previewBox.append(element("span", "field-hint", t(reason)));
        }
        previewBox.append(element("span", "field-hint",
          t("Dry run only. Nothing changes until a matching event occurs; each run is logged and undoable for 60 seconds.")));
      };

      previewButton.addEventListener("click", async () => {
        if (!valueOf()) {
          showToast(t("Choose an action value before previewing."));
          return;
        }
        if (action.value === "move_to_column" && !scope.value) {
          showToast(t("Choose a board scope before previewing a column move."));
          return;
        }
        previewButton.disabled = true;
        try {
          const result = await request("/api/automations/preview", {
            method: "POST",
            body: {
              workspaceId: workspace().id,
              boardId: scope.value || null,
              trigger: trigger.value,
              actionType: action.value,
              actionValue: valueOf(),
              conditionsJson: JSON.stringify(conditionPriority.value ? { priority: conditionPriority.value } : {}),
            },
          });
          renderDraftPreview(result);
        } catch (error) {
          showToast(error.message);
        } finally {
          previewButton.disabled = false;
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!nameInput.value.trim() || !valueOf()) {
          showToast(t("Give the rule a name and an action value."));
          return;
        }
        apply.disabled = true;
        try {
          await request("/api/automations", {
            method: "POST",
            body: {
              workspaceId: workspace().id,
              boardId: scope.value || null,
              name: nameInput.value.trim(),
              trigger: trigger.value,
              actionType: action.value,
              actionValue: valueOf(),
              conditionsJson: JSON.stringify(conditionPriority.value ? { priority: conditionPriority.value } : {}),
              enabled: true,
            },
          });
          closeModal();
          showToast(t("Automation created."));
          await refreshRules();
        } catch (error) {
          showToast(error.message);
          apply.disabled = false;
        }
      });

      rebuildValue();
    };

    newRule.addEventListener("click", openRuleModal);
    section.refreshSettingsSection = () => void refreshRules();
    void refreshRules();
    return section;
  }

  function renderWorkspaceSettings() {
    const { section, card } = createSettingsSection(
      "workspace",
      "Workspace",
      "Personal by default. Add a team only when collaboration earns its weight."
    );
    let data = null;
    let input = null;
    let save = null;
    const render = () => {
      card.replaceChildren();
      if (!data) {
        card.append(element("div", "empty", t("Loading workspace…")));
        return;
      }
      input = element("input", "input");
      input.value = data.name || "";
      input.maxLength = 80;
      input.style.width = "260px";
      input.disabled = !["OWNER", "ADMIN"].includes(workspace()?.role);
      input.setAttribute("aria-label", t("Workspace name"));
      settingsRow(card, t("Name"), data.type === "personal" ? t("Your private space.") : t("Shared workspace"),
        input);
      settingsRow(card, t("Type"), t("Type is fixed in v1 to preserve policy semantics."),
        makeBadge(t(data.type === "personal" ? "Personal" : data.type === "team" ? "Team" : "Organization"), "slate"));
      save = element("button", "btn primary sm", t("Save workspace"));
      save.type = "button";
      save.disabled = true;
      input.addEventListener("input", () => { save.disabled = input.value.trim() === data.name; });
      save.addEventListener("click", async () => {
        if (!input.value.trim()) return;
        save.disabled = true;
        try {
          const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}`, {
            method: "PATCH",
            body: { name: input.value.trim(), version: data.version },
          });
          data = result?.workspace ?? data;
          const found = state.boot?.workspaces?.find((item) => item.id === workspace().id);
          if (found) found.name = data.name;
          window.DriftOffline?.cacheBootstrap(state.boot);
          renderSidebar();
          showToast(t("Workspace updated."));
          render();
        } catch (error) {
          showToast(error.message);
          await refresh();
        }
      });
      settingsRow(card, t("Save"), t("Renaming is visible to everyone in the workspace."), save);
    };
    const refresh = async () => {
      try {
        data = (await request(`/api/workspaces/${encodeURIComponent(workspace().id)}`))?.workspace ?? null;
      } catch (error) {
        showToast(error.message);
      }
      render();
    };
    section.refreshSettingsSection = () => void refresh();
    render();
    void refresh();
    return section;
  }

  function renderPeopleSettings() {
    const { section, card } = createSettingsSection(
      "people",
      "People",
      "Invite teammates, set their role, and keep access honest."
    );
    const list = element("div", "detail-list");
    list.append(element("div", "empty", t("Loading people…")));
    card.append(list);
    const manage = element("button", "btn primary sm", t("Manage people"));
    manage.type = "button";
    manage.style.marginTop = "12px";
    manage.addEventListener("click", openMembersModal);
    card.append(manage);
    const refresh = async () => {
      try {
        const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/members`);
        const members = result?.members ?? [];
        list.replaceChildren();
        for (const member of members) {
          const row = element("div", "settings-row");
          const copy = element("div", "settings-copy");
          copy.append(element("strong", "", member.name || member.email || t("Member")));
          copy.append(element("span", "", member.email || t("Guest member")));
          const controls = element("div", "settings-control inline");
          controls.append(makeBadge(t(member.role === "OWNER" ? "Owner" : member.role === "ADMIN" ? "Admin" : member.role === "MEMBER" ? "Member" : "Guest"), member.role === "OWNER" ? "moss" : "slate"));
          row.append(copy, controls);
          list.append(row);
        }
      } catch (error) {
        list.replaceChildren(element("div", "empty", error.message));
      }
    };
    section.refreshSettingsSection = () => void refresh();
    void refresh();
    return section;
  }

  function renderKeyboardSettings() {
    const { section, card } = createSettingsSection(
      "keyboard",
      "Keyboard",
      "A quiet power path. Turn single-key shortcuts off if they conflict with assistive technology."
    );
    settingsRow(card, t("Single-key shortcuts"), t("C capture · / search · ? shortcuts · G then T/U/C/A/S/B"), makeToggle(state.singleKeyShortcuts, t("Single-key shortcuts"), setSingleKeyShortcuts));
    const shortcuts = [
      ["Ctrl / ⌘ + K", t("Command palette")],
      ["C", t("Quick capture")],
      ["/", t("Search")],
      ["G then T / U / C / A / S / B", t("Jump to Today, Upcoming, Calendar, Archive, Search, or Board")],
      ["Alt + ← / →", t("Move a focused card between columns")],
      ["Alt + ↑ / ↓", t("Reorder a focused card")],
      ["?", t("Keyboard shortcuts")],
    ];
    for (const [keys, label] of shortcuts) {
      const row = element("div", "settings-row");
      const copy = element("div", "settings-copy");
      copy.append(element("strong", "", label));
      row.append(copy, element("kbd", "kbd", keys));
      card.append(row);
    }
    return section;
  }

  function renderAboutSettings() {
    const { section, card } = createSettingsSection(
      "about",
      "About Drift",
      "Version 1.0. Build with care. No third-party tracking scripts."
    );
    settingsRow(card, t("Runtime"), t("Spring Boot + SQLite + vanilla HTML, CSS, and JavaScript."),
      makeBadge("Spring Boot", "accent"));
    settingsRow(card, t("Health"), t("Open the health endpoint to check the local service."),
      (() => {
        const link = element("a", "btn ghost sm", "API");
        link.href = "/api/health";
        link.target = "_blank";
        link.rel = "noreferrer";
        return link;
      })());
    settingsRow(card, t("Keyboard"), t("Ctrl/⌘ K palette · C capture · G then T/U/C/A/S/B · ? shortcuts"),
      element("kbd", "kbd", "?"));
    settingsRow(card, t("Support"), t("Documentation, operations, security, and data notes ship in docs/."),
      makeBadge(t("Local-first"), "slate"));
    return section;
  }

  function renderPolicySettings() {
    const { section, card } = createSettingsSection(
      "policies",
      "Policies",
      "Who can see what, what is retained, and which capabilities are available."
    );
    let workspaceData = null;
    let busy = false;

    const render = () => {
      card.replaceChildren();
      if (!workspaceData) {
        card.append(element("div", "empty", t("Loading policies…")));
        return;
      }
      const draft = { ...workspaceData };
      const toggle = (key, title, description) => {
        settingsRow(card, t(title), t(description), makeToggle(Boolean(draft[key]), t(title), (next) => {
          draft[key] = next;
        }));
      };
      toggle("requireMfa", "Require two-factor authentication", "Members without MFA are locked out of workspace data.");
      toggle("aiEnabled", "Assistant suggestions", "Local capacity and quick-add heuristics. No customer data leaves Drift.");
      toggle("automationsEnabled", "Automations", "Allow rules for this workspace.");
      toggle("attachmentsEnabled", "Attachments", "Files up to 10 MB, type-allowlisted, local storage.");
      toggle("publicSharingEnabled", "Public share links", "Read-only board links. Disable to revoke all sharing immediately.");
      settingsRow(card, t("Archived task retention"), t("Soft-deleted content is purged by the jobs worker."),
        (() => {
          const input = element("input", "input");
          input.type = "number";
          input.min = "1";
          input.max = "3650";
          input.style.width = "100px";
          input.value = String(draft.retentionDays ?? 30);
          input.addEventListener("input", () => { draft.retentionDays = Number(input.value); });
          return input;
        })());
      settingsRow(card, t("Audit retention"), t("Audit events are retained separately for compliance."),
        (() => {
          const input = element("input", "input");
          input.type = "number";
          input.min = "30";
          input.max = "3650";
          input.style.width = "100px";
          input.value = String(draft.auditRetentionDays ?? 365);
          input.addEventListener("input", () => { draft.auditRetentionDays = Number(input.value); });
          return input;
        })());
      settingsRow(card, t("Save policies"), t("Versioned: stale saves are rejected with a conflict."),
        (() => {
          const save = element("button", "btn primary sm", t("Save policies"));
          save.type = "button";
          save.disabled = busy;
          save.addEventListener("click", async () => {
            busy = true;
            save.disabled = true;
            try {
              const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}`, {
                method: "PATCH",
                body: {
                  requireMfa: draft.requireMfa,
                  aiEnabled: draft.aiEnabled,
                  automationsEnabled: draft.automationsEnabled,
                  attachmentsEnabled: draft.attachmentsEnabled,
                  publicSharingEnabled: draft.publicSharingEnabled,
                  retentionDays: Number(draft.retentionDays),
                  auditRetentionDays: Number(draft.auditRetentionDays),
                  version: draft.version,
                },
              });
              workspaceData = result?.workspace ?? draft;
              showToast(t("Policies saved."));
              render();
            } catch (error) {
              showToast(error.message);
              await refresh();
            } finally {
              busy = false;
            }
          });
          return save;
        })());
    };

    const refresh = async () => {
      try {
        const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}`);
        workspaceData = result?.workspace ?? null;
      } catch (error) {
        workspaceData = null;
        showToast(error.message);
      }
      render();
    };

    section.refreshSettingsSection = () => void refresh();
    render();
    void refresh();
    return section;
  }

  function renderSecuritySettings() {
    const { section, card } = createSettingsSection(
      "security",
      "Security",
      "Two-factor authentication is TOTP. Sessions are opaque, hashed, and revocable."
    );
    let status = null;
    let setup = null;
    let backupCodes = [];
    let busy = false;

    const refresh = async () => {
      try {
        status = await request("/api/security/mfa");
        render();
      } catch (error) {
        card.replaceChildren(element("div", "empty", error.message));
      }
    };

    const render = () => {
      card.replaceChildren();
      const enabled = Boolean(status?.mfaEnabled);
      settingsRow(card, t("Two-factor authentication"),
        enabled ? t("Enabled with an authenticator app.") : t("Add a second factor for password and sign-in."),
        [
          makeBadge(enabled ? t("On") : t("Off"), enabled ? "moss" : "slate"),
          enabled ? null : (() => {
            const setupButton = element("button", "btn primary sm", t("Set up"));
            setupButton.type = "button";
            setupButton.disabled = busy;
            setupButton.addEventListener("click", async () => {
              busy = true;
              render();
              try {
                setup = await request("/api/security/mfa", { method: "POST", body: { action: "setup" } });
                backupCodes = [];
              } catch (error) {
                showToast(error.message);
              } finally {
                busy = false;
                render();
              }
            });
            return setupButton;
          })(),
        ]);

      if (setup) {
        const row = element("div", "settings-row");
        row.style.display = "block";
        row.style.background = "var(--surface-2)";
        const form = element("form", "form-grid");
        form.style.maxWidth = "540px";
        const qrRow = element("div", "inline");
        qrRow.style.cssText = "align-items:flex-start;gap:18px;flex-wrap:wrap";
        if (setup.qrDataUrl) {
          const image = element("img");
          image.src = setup.qrDataUrl;
          image.alt = t("QR code for authenticator app");
          image.width = 170;
          image.height = 170;
          image.style.cssText = "border-radius:12px;background:#fff;padding:8px";
          qrRow.append(image);
        }
        const qrCopy = element("div");
        qrCopy.style.flex = "1";
        qrCopy.append(element("strong", "", t("Scan with your authenticator")));
        qrCopy.append(element("p", "field-hint", t("Or enter this secret manually:")));
        const secretCode = element("code", "", setup.secret);
        secretCode.style.cssText = "display:block;word-break:break-all;font-size:10.5px;background:var(--surface);border:1px solid var(--border);padding:8px;border-radius:7px";
        qrCopy.append(secretCode);
        qrRow.append(qrCopy);
        const codeField = element("label", "field");
        codeField.append(element("span", "", t("Six-digit code")));
        const codeInput = element("input", "input");
        codeInput.inputMode = "numeric";
        codeInput.autocomplete = "one-time-code";
        codeInput.placeholder = "123456";
        codeField.append(codeInput);
        const buttons = element("div", "inline");
        const verify = element("button", "btn primary", t("Verify and enable"));
        verify.type = "submit";
        const cancel = element("button", "btn ghost", t("Cancel"));
        cancel.type = "button";
        cancel.addEventListener("click", () => {
          setup = null;
          render();
        });
        buttons.append(verify, cancel);
        form.append(qrRow, codeField, buttons);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          busy = true;
          verify.disabled = true;
          try {
            const result = await request("/api/security/mfa", {
              method: "POST",
              body: { action: "enable", secret: setup.secret, code: codeInput.value.trim() },
            });
            backupCodes = result?.backupCodes ?? [];
            setup = null;
            showToast(t("Two-factor authentication enabled."));
            await refresh();
          } catch (error) {
            showToast(error.message);
            verify.disabled = false;
          } finally {
            busy = false;
          }
        });
        row.append(form);
        card.append(row);
      }

      if (backupCodes.length) {
        const row = element("div", "settings-row");
        row.style.display = "block";
        row.style.background = "var(--warning-soft, var(--surface-2))";
        row.append(element("strong", "", t("Save these backup codes now")));
        row.append(element("p", "field-hint", t("Each code works once. They will not be shown again.")));
        const grid = element("div");
        grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px";
        for (const code of backupCodes) grid.append(element("code", "", code));
        row.append(grid);
        const copy = element("button", "btn sm", t("Copy codes"));
        copy.type = "button";
        copy.style.marginTop = "10px";
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard?.writeText(backupCodes.join("\n"));
            showToast(t("Backup codes copied."));
          } catch {
            showToast(t("Could not copy the codes."));
          }
        });
        row.append(copy);
        card.append(row);
      }

      if (enabled) {
        const row = element("div", "settings-row");
        const copy = element("div", "settings-copy");
        copy.append(element("strong", "", t("Disable two-factor")));
        copy.append(element("span", "", t("Not allowed while an organization requires it.")));
        const controls = element("div", "settings-control inline");
        const input = element("input", "input");
        input.style.width = "150px";
        input.placeholder = t("Code or backup");
        const disable = element("button", "btn danger sm", t("Disable"));
        disable.type = "button";
        disable.addEventListener("click", async () => {
          if (!input.value.trim()) {
            showToast(t("Enter a valid authenticator code to turn off two-factor."));
            return;
          }
          disable.disabled = true;
          try {
            await request("/api/security/mfa", {
              method: "POST",
              body: { action: "disable", code: input.value.trim() },
            });
            input.value = "";
            backupCodes = [];
            showToast(t("Two-factor authentication disabled."));
            await refresh();
          } catch (error) {
            showToast(error.message);
            disable.disabled = false;
          }
        });
        controls.append(input, disable);
        row.append(copy, controls);
        card.append(row);
      }

      const sessionsRow = element("div", "settings-row");
      sessionsRow.style.display = "block";
      const sessionsHead = element("div", "inline");
      sessionsHead.style.justifyContent = "space-between";
      const sessionsCopy = element("div", "settings-copy");
      sessionsCopy.append(element("strong", "", t("Active sessions")));
      sessionsCopy.append(element("span", "", t("Revoke anything you do not recognize. The current session stays.")));
      const refreshButton = element("button", "btn ghost sm", t("Refresh"));
      refreshButton.type = "button";
      refreshButton.addEventListener("click", () => void refresh());
      sessionsHead.append(sessionsCopy, refreshButton);
      sessionsRow.append(sessionsHead);
      const sessionList = element("div");
      sessionList.style.marginTop = "10px";
      for (const entry of status?.sessions ?? []) {
        const item = element("div", "inline");
        item.style.cssText = "padding:8px 0;border-top:1px solid var(--border);justify-content:space-between";
        const copy = element("span", "");
        copy.style.fontSize = "11px";
        copy.append(element("strong", "", entry.current ? t("This device") : (entry.userAgent || t("Unknown device"))));
        const hint = element("span", "field-hint");
        hint.style.display = "block";
        hint.textContent = `${t("Last used")} ${relativeTime(entry.lastUsedAt || entry.createdAt)}`;
        copy.append(hint);
        if (entry.current) {
          item.append(copy, makeBadge(t("Current"), "moss"));
        } else {
          const revoke = element("button", "btn ghost sm", t("Revoke"));
          revoke.type = "button";
          revoke.addEventListener("click", async () => {
            try {
              await request("/api/security/mfa", { method: "DELETE", body: { sessionId: entry.id } });
              showToast(t("Session revoked."));
              await refresh();
            } catch (error) {
              showToast(error.message);
            }
          });
          item.append(copy, revoke);
        }
        sessionList.append(item);
      }
      if (!(status?.sessions ?? []).length) {
        sessionList.append(element("p", "field-hint", t("Open Security to load active sessions.")));
      }
      sessionsRow.append(sessionList);
      card.append(sessionsRow);
    };

    section.refreshSettingsSection = () => void refresh();
    card.append(element("div", "empty", t("Loading security…")));
    void refresh();
    return section;
  }

  function renderDataSettings() {
    const { section, card } = createSettingsSection(
      "data",
      "Data & export",
      "Your work is portable. Export the whole workspace as JSON or a task CSV, or import tasks into a board."
    );
    const role = workspace()?.role ?? "GUEST";
    const canImport = ["OWNER", "ADMIN", "MEMBER"].includes(role);

    const download = (format) => {
      window.location.assign(`/api/export?workspaceId=${encodeURIComponent(workspace().id)}&format=${format}`);
    };
    const jsonButton = element("button", "btn sm", "JSON");
    jsonButton.type = "button";
    jsonButton.addEventListener("click", () => download("json"));
    const csvButton = element("button", "btn sm", "CSV");
    csvButton.type = "button";
    csvButton.addEventListener("click", () => download("csv"));
    settingsRow(card, t("Export workspace"),
      t("Boards, columns, tasks, labels, checklist items, and comments. Private boards only if you can see them."),
      [jsonButton, csvButton]);

    const importRow = element("div", "settings-row");
    importRow.style.cssText = "display:block";
    const importCopy = element("div", "settings-copy");
    importCopy.append(element("strong", "", t("Import tasks")));
    importCopy.append(element("span", "",
      t("CSV columns: title, description, priority, column, dueDate, estimateMinutes, labels, assignee. JSON accepts an export or a tasks array.")));
    const form = element("div", "form-grid");
    form.style.marginTop = "10px";

    const boardField = element("div", "field");
    boardField.append(element("label", "", t("Import board")));
    const boardSelect = element("select", "select");
    boardSelect.setAttribute("aria-label", t("Import board"));
    boardSelect.append(new Option(t("Choose a board"), ""));
    for (const board of boards()) boardSelect.append(new Option(board.name, board.id));
    boardField.append(boardSelect);

    const fileField = element("div", "field");
    const fileRow = element("div", "inline");
    const pick = element("label", "btn sm", t("Choose file"));
    const fileInput = element("input");
    fileInput.type = "file";
    fileInput.accept = ".csv,.json,text/csv,application/json";
    fileInput.hidden = true;
    pick.append(fileInput);
    const status = element("span", "badge slate hidden");
    fileRow.append(pick, status);
    fileField.append(fileRow);

    const actionRow = element("div", "inline");
    actionRow.style.cssText = "align-items:flex-end;gap:8px;flex-wrap:wrap";
    const importButton = element("button", "btn primary sm", t("Import into board"));
    importButton.type = "button";
    importButton.disabled = true;
    const clearButton = element("button", "btn ghost sm", t("Clear"));
    clearButton.type = "button";
    clearButton.classList.add("hidden");
    actionRow.append(importButton, clearButton);
    const accessNote = canImport ? null : element("span", "field-hint", t("Member access is required to import tasks."));
    if (accessNote) actionRow.append(accessNote);

    form.append(boardField, fileField, actionRow);
    importCopy.append(form);
    importRow.append(importCopy);
    card.append(importRow);

    const current = workspace();
    const isOwner = role === "OWNER";
    const dangerHead = element("div", "section-head");
    dangerHead.style.marginTop = "26px";
    const dangerCopy = element("div");
    dangerCopy.append(element("h3", "section-title", t("Danger zone")));
    dangerCopy.append(element("p", "section-subtitle", t("These actions are intentionally difficult to reach.")));
    dangerHead.append(dangerCopy);
    const dangerCard = element("div", "settings-card");
    dangerCard.style.borderColor = "color-mix(in srgb, var(--danger) 32%, var(--border))";

    const workspaceRow = element("div", "settings-row");
    const workspaceCopy = element("div", "settings-copy");
    workspaceCopy.append(element("strong", "", t("Delete this workspace")));
    workspaceCopy.append(element("span", "", isOwner
      ? t("Soft-deletes the workspace, revokes access, and leaves audit records. You must own another workspace.")
      : t("Only a workspace owner can delete it.")));
    const workspaceControl = element("div", "settings-control");
    if (isOwner) {
      const confirmRow = element("div", "inline");
      const confirmInput = element("input", "input");
      confirmInput.style.width = "150px";
      confirmInput.placeholder = t("Type {{name}}", { name: current?.name ?? "" });
      const deleteWorkspace = element("button", "btn danger sm", t("Delete"));
      deleteWorkspace.type = "button";
      deleteWorkspace.disabled = true;
      confirmInput.addEventListener("input", () => {
        deleteWorkspace.disabled = confirmInput.value !== current?.name;
      });
      deleteWorkspace.addEventListener("click", async () => {
        deleteWorkspace.disabled = true;
        try {
          await request(`/api/workspaces/${encodeURIComponent(current.id)}`, { method: "DELETE" });
          window.DriftOffline?.clearCachedAccountData?.();
          window.location.assign("/");
        } catch (error) {
          showToast(error.message);
          deleteWorkspace.disabled = confirmInput.value !== current?.name;
        }
      });
      confirmRow.append(confirmInput, deleteWorkspace);
      workspaceControl.append(confirmRow);
    } else {
      workspaceControl.append(makeBadge(t("Owner only"), "slate"));
    }
    workspaceRow.append(workspaceCopy, workspaceControl);
    dangerCard.append(workspaceRow);

    const accountRow = element("div", "settings-row");
    const accountCopy = element("div", "settings-copy");
    accountCopy.append(element("strong", "", t("Delete my account")));
    accountCopy.append(element("span", "", t("Soft-deletes your personal workspaces, revokes sessions, and removes credentials. Shared workspace ownership must be transferred first.")));
    const accountControl = element("div", "settings-control");
    const deleteAccount = element("button", "btn danger sm", t("Delete account"));
    deleteAccount.type = "button";
    accountControl.append(deleteAccount);
    accountRow.append(accountCopy, accountControl);
    dangerCard.append(accountRow);
    section.append(dangerHead, dangerCard);

    const openDeleteAccount = () => {
      const backdrop = element("div", "modal-backdrop");
      const modal = element("div", "modal");
      modal.style.width = "min(480px, 100%)";
      const head = element("div", "modal-head");
      const headCopy = element("div");
      headCopy.append(element("p", "eyebrow", t("This cannot be undone")));
      headCopy.append(element("h2", "", t("Delete your account?")));
      const close = element("button", "btn ghost sm", "×");
      close.type = "button";
      close.setAttribute("aria-label", t("Close"));
      head.append(headCopy, close);
      const copy = element("p");
      copy.style.cssText = "font-size:12px;color:var(--muted);line-height:1.6";
      copy.append(document.createTextNode(t("This soft-deletes your personal workspaces, removes your password and sessions. Audit records may remain for retention. Type ")));
      copy.append(element("strong", "", "DELETE"));
      copy.append(document.createTextNode(t(" to confirm.")));
      const field = element("label", "field");
      field.style.marginTop = "14px";
      field.append(element("span", "", t("Confirmation")));
      const input = element("input", "input");
      input.placeholder = "DELETE";
      input.autofocus = true;
      field.append(input);
      const actions = element("div", "modal-actions");
      const keep = element("button", "btn ghost", t("Keep account"));
      keep.type = "button";
      const forever = element("button", "btn danger", t("Delete forever"));
      forever.type = "button";
      forever.disabled = true;
      actions.append(keep, forever);
      modal.append(head, copy, field, actions);
      backdrop.append(modal);
      document.body.append(backdrop);
      const closeModal = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", onKeydown);
      close.addEventListener("click", closeModal);
      keep.addEventListener("click", closeModal);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) closeModal();
      });
      input.addEventListener("input", () => {
        forever.disabled = input.value !== "DELETE";
      });
      forever.addEventListener("click", async () => {
        if (input.value !== "DELETE") return;
        forever.disabled = true;
        try {
          await request("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
          window.DriftOffline?.clearCachedAccountData?.();
          window.location.assign("/");
        } catch (error) {
          showToast(error.message);
          forever.disabled = false;
        }
      });
      input.focus();
    };
    deleteAccount.addEventListener("click", openDeleteAccount);

    let importContent = "";
    let importFormat = "csv";
    const syncImport = () => {
      const ready = Boolean(importContent && boardSelect.value && canImport);
      importButton.disabled = !ready;
      clearButton.classList.toggle("hidden", !importContent);
      status.classList.toggle("hidden", !importContent);
      if (importContent) {
        status.textContent = t("{{count}} chars ready", { count: importContent.length.toLocaleString() });
      }
    };

    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 5_000_000) {
        showToast(t("Import files are limited to 5 MB."));
        return;
      }
      try {
        importContent = await file.text();
        importFormat = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
        syncImport();
      } catch {
        showToast(t("That file could not be read."));
      }
    });
    boardSelect.addEventListener("change", syncImport);
    clearButton.addEventListener("click", () => {
      importContent = "";
      fileInput.value = "";
      syncImport();
    });
    importButton.addEventListener("click", async () => {
      if (!boardSelect.value || !importContent) return;
      importButton.disabled = true;
      try {
        const result = await request("/api/import", {
          method: "POST",
          body: {
            workspaceId: workspace().id,
            boardId: boardSelect.value,
            format: importFormat,
            content: importContent,
          },
        });
        const count = Number(result?.imported ?? 0);
        const skipped = Number(result?.skipped ?? 0);
        showToast(skipped
          ? t("Imported {{count}} tasks; skipped {{skipped}}.", { count, skipped })
          : count === 1 ? t("Imported {{count}} task.", { count })
          : t("Imported {{count}} tasks.", { count }));
        importContent = "";
        fileInput.value = "";
        syncImport();
        await refreshBootstrap();
      } catch (error) {
        showToast(error.message);
        importButton.disabled = false;
      }
    });

    section.refreshSettingsSection = () => syncImport();
    return section;
  }

  function renderIntegrationSettings() {
    const { section, card } = createSettingsSection(
      "integrations",
      "Integrations",
      "Create personal API tokens for scripts, CLI tools, and external integrations. The raw token is shown once."
    );
    const calendarLink = element("a", "btn sm", t("Download .ics"));
    calendarLink.href = `/api/calendar/ics?workspaceId=${encodeURIComponent(workspace().id)}`;
    settingsRow(card, t("Calendar feed"), t("An ICS subscription for every due task you can see."), calendarLink);
    const created = element("div", "detail-list");
    const list = element("div", "detail-list");
    list.append(element("div", "empty", t("Loading tokens…")));
    const form = element("form", "settings-card");
    form.style.marginTop = "12px";
    const nameField = element("div", "field");
    const nameLabel = element("label", "", t("Token name"));
    const nameInput = element("input", "input");
    nameInput.maxLength = 80;
    nameInput.placeholder = t("CLI sync");
    nameField.append(nameLabel, nameInput);
    const expiryField = element("div", "field");
    const expiryLabel = element("label", "", t("Expires"));
    const expiry = element("select", "select");
    expiry.setAttribute("aria-label", t("Expires"));
    expiry.add(new Option(t("30 days"), "30"));
    expiry.add(new Option(t("90 days"), "90"));
    expiry.add(new Option(t("1 year"), "365"));
    expiryField.append(expiryLabel, expiry);
    const row = element("div", "form-row");
    row.append(nameField, expiryField);
    const submit = element("button", "btn primary sm", t("Create token"));
    submit.type = "submit";
    form.append(row, submit);
    card.append(created, list, form);

    const refresh = async () => {
      try {
        const result = await request(`/api/tokens?workspaceId=${encodeURIComponent(workspace().id)}`);
        const tokens = result?.tokens ?? [];
        list.replaceChildren();
        if (!tokens.length) list.append(element("div", "empty", t("No API tokens yet.")));
        for (const token of tokens) {
          const item = element("div", "detail-item");
          const grow = element("div", "grow");
          grow.append(element("strong", "", token.name));
          grow.append(element("p", "", `${token.prefix}… · ${t("Created")} ${new Date(token.createdAt).toLocaleDateString(state.settings?.locale || undefined)}`));
          if (token.expiresAt) grow.append(element("p", "field-hint", `${t("Expires")} ${new Date(token.expiresAt).toLocaleDateString(state.settings?.locale || undefined)}`));
          if (token.lastUsedAt) grow.append(element("p", "field-hint", `${t("Last used")} ${relativeTime(token.lastUsedAt)}`));
          const revoke = element("button", "btn ghost sm", t("Revoke"));
          revoke.type = "button";
          revoke.addEventListener("click", async () => {
            if (!window.confirm(t("Revoke this token? Tools using it will stop working."))) return;
            try {
              await request(`/api/tokens/${encodeURIComponent(token.id)}?workspaceId=${encodeURIComponent(workspace().id)}`, { method: "DELETE" });
              showToast(t("Token revoked."));
              await refresh();
            } catch (error) {
              showToast(error.message);
            }
          });
          item.append(grow, revoke);
          list.append(item);
        }
      } catch (error) {
        list.replaceChildren(element("div", "empty", error.message));
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      submit.disabled = true;
      try {
        const result = await request("/api/tokens", {
          method: "POST",
          body: { workspaceId: workspace().id, name, expiresInDays: Number(expiry.value) },
        });
        created.replaceChildren();
        const cardNode = element("div", "detail-item");
        const grow = element("div", "grow");
        grow.append(element("strong", "", t("Token created. Copy it now — it will not be shown again.")));
        const output = element("input", "input");
        output.value = result.token;
        output.readOnly = true;
        output.setAttribute("aria-label", t("New API token"));
        const copy = element("button", "btn ghost sm", t("Copy"));
        copy.type = "button";
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard?.writeText(result.token);
            showToast(t("Token copied."));
          } catch {
            output.select();
          }
        });
        grow.append(output);
        cardNode.append(grow, copy);
        created.append(cardNode);
        nameInput.value = "";
        await refresh();
      } catch (error) {
        showToast(error.message);
      } finally {
        submit.disabled = false;
      }
    });

    const hookHeader = element("div", "section-head");
    hookHeader.style.marginTop = "24px";
    const hookTitle = element("h3", "", t("Webhooks"));
    const hookHint = element("span", "field-hint", t("Send selected events to Slack, Teams, or a generic JSON endpoint."));
    hookHeader.append(hookTitle, hookHint);
    const createdHook = element("div", "detail-list");
    const hookList = element("div", "detail-list");
    hookList.append(element("div", "empty", t("Loading webhooks…")));
    const hookForm = element("form", "settings-card");
    hookForm.style.marginTop = "12px";
    const kindField = element("div", "field");
    const kindLabel = element("label", "", t("Type"));
    const kind = element("select", "select");
    kind.setAttribute("aria-label", t("Type"));
    kind.add(new Option(t("Slack"), "slack"));
    kind.add(new Option(t("Microsoft Teams"), "teams"));
    kind.add(new Option(t("Generic JSON"), "generic"));
    kindField.append(kindLabel, kind);
    const urlField = element("div", "field");
    const urlLabel = element("label", "", t("Webhook URL"));
    const url = element("input", "input");
    url.type = "url";
    url.placeholder = "https://hooks.example.com/...";
    urlField.append(urlLabel, url);
    const hookRow = element("div", "form-row");
    hookRow.append(kindField, urlField);
    const eventField = element("div", "field");
    eventField.append(element("label", "", t("Events")));
    const eventWrap = element("div");
    eventWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px 14px";
    const hookEvents = ["task.created", "task.moved", "task.completed", "task.deleted", "comment.created"];
    const eventBoxes = [];
    for (const eventName of hookEvents) {
      const label = element("label", "");
      label.style.cssText = "display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)";
      const box = element("input");
      box.type = "checkbox";
      box.value = eventName;
      box.checked = eventName !== "task.deleted" && eventName !== "comment.created";
      label.append(box, document.createTextNode(eventName));
      eventWrap.append(label);
      eventBoxes.push(box);
    }
    eventField.append(eventWrap);
    const hookSubmit = element("button", "btn primary sm", t("Add webhook"));
    hookSubmit.type = "submit";
    hookForm.append(hookRow, eventField, hookSubmit);
    card.append(hookHeader, createdHook, hookList, hookForm);

    const refreshHooks = async () => {
      try {
        const result = await request(`/api/webhooks?workspaceId=${encodeURIComponent(workspace().id)}`);
        const hooks = result?.webhooks ?? [];
        hookList.replaceChildren();
        if (!hooks.length) hookList.append(element("div", "empty", t("No webhooks yet.")));
        for (const hook of hooks) {
          const item = element("div", "detail-item");
          const grow = element("div", "grow");
          grow.append(element("strong", "", `${hook.kind} · ${hook.url}`));
          grow.append(element("p", "field-hint", `${(hook.events || []).join(", ")} · ${hook.deliveries || 0} ${t("deliveries")}`));
          grow.append(element("p", "field-hint",
            hook.lastStatus == null
              ? t("No deliveries yet.")
              : `HTTP ${hook.lastStatus} · ${relativeTime(hook.lastDeliveryAt)}`));
          const toggle = element("button", "btn ghost sm", hook.enabled ? t("Disable") : t("Enable"));
          toggle.type = "button";
          toggle.addEventListener("click", async () => {
            try {
              await request(`/api/webhooks/${encodeURIComponent(hook.id)}?workspaceId=${encodeURIComponent(workspace().id)}`, {
                method: "PATCH",
                body: { enabled: !hook.enabled },
              });
              showToast(t("Webhook updated."));
              await refreshHooks();
            } catch (error) {
              showToast(error.message);
            }
          });
          const remove = element("button", "btn danger sm", t("Delete"));
          remove.type = "button";
          remove.addEventListener("click", async () => {
            if (!window.confirm(t("Delete this webhook?"))) return;
            try {
              await request(`/api/webhooks/${encodeURIComponent(hook.id)}?workspaceId=${encodeURIComponent(workspace().id)}`, { method: "DELETE" });
              createdHook.replaceChildren();
              showToast(t("Webhook deleted."));
              await refreshHooks();
            } catch (error) {
              showToast(error.message);
            }
          });
          item.append(grow, toggle, remove);
          hookList.append(item);
        }
      } catch (error) {
        hookList.replaceChildren(element("div", "empty", error.message));
      }
    };

    hookForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const selectedEvents = eventBoxes.filter((box) => box.checked).map((box) => box.value);
      if (!url.value.trim() || !selectedEvents.length) {
        showToast(t("Choose a webhook URL and at least one event."));
        return;
      }
      hookSubmit.disabled = true;
      try {
        const result = await request("/api/webhooks", {
          method: "POST",
          body: {
            workspaceId: workspace().id,
            kind: kind.value,
            url: url.value.trim(),
            events: selectedEvents,
          },
        });
        createdHook.replaceChildren();
        const secret = result?.webhook?.secret;
        if (secret) {
          const item = element("div", "detail-item");
          const grow = element("div", "grow");
          grow.append(element("strong", "", t("Webhook created. Copy the signing secret now.")));
          const output = element("input", "input");
          output.value = secret;
          output.readOnly = true;
          output.setAttribute("aria-label", t("Webhook signing secret"));
          grow.append(output);
          const copy = element("button", "btn ghost sm", t("Copy"));
          copy.type = "button";
          copy.addEventListener("click", async () => {
            try {
              await navigator.clipboard?.writeText(secret);
              showToast(t("Signing secret copied."));
            } catch {
              output.select();
            }
          });
          item.append(grow, copy);
          createdHook.append(item);
        }
        url.value = "";
        showToast(t("Webhook created."));
        await refreshHooks();
      } catch (error) {
        showToast(error.message);
      } finally {
        hookSubmit.disabled = false;
      }
    });

    let ssoWrap = null;
    let ssoState = null;
    if ((workspace()?.type ?? "personal") === "org") {
      ssoWrap = element("div");
      ssoWrap.style.marginTop = "24px";
      section.append(ssoWrap);
    }
    const renderSso = () => {
      if (!ssoWrap) return;
      ssoWrap.replaceChildren();
      const configured = Boolean(ssoState?.configured);
      const config = ssoState?.config ?? {};
      const head = element("div", "section-head");
      const headCopy = element("div");
      headCopy.append(element("h3", "section-title", t("Single sign-on")));
      headCopy.append(element("p", "section-subtitle", t("OIDC for organization workspaces. Client secrets are encrypted at rest.")));
      head.append(headCopy, makeBadge(configured ? t("Configured") : t("Not configured"), configured ? "moss" : "slate"));
      const ssoCard = element("div", "settings-card");
      const form = element("form", "form-grid");
      const issuerField = element("label", "field");
      issuerField.append(element("span", "", t("Issuer URL")));
      const issuer = element("input", "input");
      issuer.placeholder = "https://login.example.com";
      issuer.value = config.issuer ?? "";
      issuerField.append(issuer);
      const clientField = element("label", "field");
      clientField.append(element("span", "", t("Client ID")));
      const clientId = element("input", "input");
      clientId.value = config.clientId ?? "";
      clientField.append(clientId);
      const secretField = element("label", "field");
      secretField.append(element("span", "", t("Client secret")));
      const secret = element("input", "input");
      secret.type = "password";
      secret.autocomplete = "new-password";
      secret.placeholder = configured ? t("Leave blank to keep the current secret") : "";
      secretField.append(secret);
      const domainsField = element("label", "field");
      domainsField.append(element("span", "", t("Allowed email domains")));
      const domains = element("input", "input");
      domains.placeholder = "example.com, example.org";
      domains.value = config.allowedDomains ?? "";
      domainsField.append(domains);
      const enabled = config.enabled !== false;
      const enforceSso = Boolean(config.enforceSso);
      let enabledValue = enabled;
      let enforceValue = enforceSso;
      const actions = element("div", "inline");
      const save = element("button", "btn primary", t("Save SSO"));
      save.type = "submit";
      const remove = configured ? element("button", "btn danger", t("Remove SSO")) : null;
      if (remove) {
        remove.type = "button";
        remove.addEventListener("click", async () => {
          if (!window.confirm(t("Remove the SSO configuration?"))) return;
          try {
            await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/sso`, { method: "DELETE" });
            showToast(t("SSO configuration removed."));
            await loadSso();
          } catch (error) {
            showToast(error.message);
          }
        });
      }
      const startLink = configured ? element("a", "btn ghost", t("Try SSO")) : null;
      if (startLink) {
        startLink.href = `/api/auth/sso/${encodeURIComponent(workspace().id)}`;
      }
      actions.append(save);
      if (startLink) actions.append(startLink);
      if (remove) actions.append(remove);
      form.append(issuerField, clientField, secretField, domainsField,
        settingsRow(form, t("Enable SSO"), t("Show the organization sign-in entry point."),
          makeToggle(enabledValue, t("Enable SSO"), (next) => { enabledValue = next; })),
        settingsRow(form, t("Require SSO"), t("Mark password sign-in as restricted for this organization."),
          makeToggle(enforceValue, t("Require SSO"), (next) => { enforceValue = next; })),
        actions);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!issuer.value.trim() || !clientId.value.trim() || !domains.value.trim()) {
          showToast(t("Issuer, client ID, and allowed domains are required."));
          return;
        }
        save.disabled = true;
        try {
          const result = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/sso`, {
            method: "PUT",
            body: {
              issuer: issuer.value.trim(),
              clientId: clientId.value.trim(),
              clientSecret: secret.value.trim(),
              allowedDomains: domains.value.trim(),
              enabled: enabledValue,
              enforceSso: enforceValue,
            },
          });
          ssoState = { configured: true, config: result?.config ?? null };
          showToast(t("SSO configuration saved."));
          renderSso();
        } catch (error) {
          showToast(error.message);
          save.disabled = false;
        }
      });
      ssoCard.append(form);
      ssoWrap.append(head, ssoCard);
    };
    const loadSso = async () => {
      if (!ssoWrap) return;
      try {
        ssoState = await request(`/api/workspaces/${encodeURIComponent(workspace().id)}/sso`);
      } catch (error) {
        ssoState = { configured: false, config: null };
      }
      renderSso();
    };

    section.refreshSettingsSection = () => {
      void refresh();
      void refreshHooks();
      if (ssoWrap) void loadSso();
    };
    void refresh();
    void refreshHooks();
    if (ssoWrap) void loadSso();
    return section;
  }

  function renderAuditSettings() {
    const { section, card } = createSettingsSection(
      "audit",
      "Audit log",
      "Privileged workspace actions, newest first. Retention is configured by the workspace policy."
    );
    const list = element("div", "detail-list");
    list.append(element("div", "empty", t("Loading audit log…")));
    const more = element("button", "btn ghost sm", t("Load more"));
    more.type = "button";
    more.classList.add("hidden");
    card.append(list, more);
    let cursor = null;
    let loading = false;

    const load = async (reset = false) => {
      if (loading) return;
      loading = true;
      try {
        const query = new URLSearchParams({ workspaceId: workspace().id, limit: "40" });
        if (!reset && cursor) query.set("cursor", cursor);
        const result = await request(`/api/audit?${query.toString()}`);
        if (reset) list.replaceChildren();
        const events = result?.events ?? [];
        if (!events.length && reset) list.append(element("div", "empty", t("No audit events yet.")));
        for (const event of events) {
          const item = element("div", "activity-item");
          item.append(element("span", "side-dot"));
          const grow = element("div", "grow");
          const copy = element("div", "activity-copy");
          copy.append(element("strong", "", event.actor?.name || t("Someone")));
          copy.append(document.createTextNode(` ${String(event.action).replace(/[._]/g, " ")}`));
          grow.append(copy);
          grow.append(element("div", "activity-time", `${event.entityType || ""} · ${relativeTime(event.createdAt)}`));
          item.append(grow);
          list.append(item);
        }
        cursor = result?.nextCursor ?? null;
        more.classList.toggle("hidden", !cursor);
      } catch (error) {
        list.replaceChildren(element("div", "empty", error.message));
      } finally {
        loading = false;
      }
    };

    more.addEventListener("click", () => void load(false));
    section.refreshSettingsSection = () => {
      cursor = null;
      void load(true);
    };
    void load(true);
    return section;
  }

  function restoreSettingsSection(section) {
    const sectionId = section === "auto-plan" ? "settings-auto-plan" : section === "focus" ? "settings-focus" : `settings-${section}`;
    if (section === "appearance") {
      updateSettings({ theme: "system", accent: "moss", displayFont: "editorial", readingSize: "default", density: "comfortable", motion: "system" });
    } else if (section === "language") {
      updateSettings({ locale: "en", timeFormat: "auto", weekStartsOn: 1 });
    } else if (section === "planning") {
      updateSettings({ capacityMinutes: 300, planBufferPercent: 0, workdayStart: 9, workdayEnd: 18, blockBufferMinutes: 0, startView: "today" });
    } else if (section === "auto-plan") {
      updateSettings({
        autoPlanEnabled: 1, autoPlanMode: "suggest", autoPlanRestMinutes: 10,
        autoPlanWeeklyMinutes: 1500, autoPlanRefreshMinutes: 30, autoPlanDeepWorkMinutes: 90,
        autoPlanSplitLongTasks: 1, autoPlanIncludeWeekends: 0, autoPlanDefaultEstimateMinutes: 30,
        autoPlanCapBehavior: "stop", autoPlanLunchEnabled: 1, autoPlanLunchStart: 12,
        autoPlanLunchEnd: 13, autoPlanAllowStaleArchive: 0, autoPlanStaleDays: 30
      });
    } else if (section === "focus") {
      updateSettings({ focusMinutes: 25, focusAutoStart: 0, captureCloseAfterAdd: 1 });
    } else if (section === "notifications") {
      state.settings.notifications = { ...DEFAULT_NOTIFICATIONS };
      updateSettings({ emailDigest: 1, digestHour: 8, quietStart: null, quietEnd: null, notificationsJson: JSON.stringify(DEFAULT_NOTIFICATIONS) });
    } else if (section === "features") {
      state.settings.features = { ...DEFAULT_FEATURES };
      updateSettings({ featuresJson: JSON.stringify(DEFAULT_FEATURES) });
    } else if (section === "sound") {
      window.DriftSound?.setPrefs(window.DriftSound.DEFAULT_PREFS);
    }
    renderSettings();
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function announce(message) {
    const node = $("liveRegion");
    if (!node || !message) return;
    node.textContent = "";
    window.setTimeout(() => { node.textContent = message; }, 20);
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  function anyModalOpen() {
    return [...document.querySelectorAll(".modal-backdrop")].some((node) => !node.classList.contains("hidden"));
  }

  async function goToView(view) {
    if (view === "board" && !state.board && state.currentBoardId) await loadBoard(state.currentBoardId);
    setView(view);
  }

  async function openTaskById(taskId) {
    const detail = await request(`/api/tasks/${encodeURIComponent(taskId)}`);
    const task = detail?.task;
    if (!task) return;
    if (task.boardId && task.boardId !== state.currentBoardId) {
      state.currentBoardId = task.boardId;
      await loadBoard(task.boardId);
      renderSidebar();
    }
    openTaskModal(task);
  }

  function paletteCommands() {
    const items = [];
    const navigation = [
      ["today", "Go to Today", "Your short list", "G T", "◷"],
      ["upcoming", "Go to Upcoming", "The next two weeks", "G U", "→"],
      ["calendar", "Go to Calendar", "Month view", "G C", "▦"],
      ["search", "Search everything", "Titles, notes and labels", "/", "⌕"],
      ["archive", "Go to Archive", "Completed and put away", "G A", "⌸"],
      ["insights", "Open Insights", "The longer horizon", "G I", "▤"],
      ["board", "Go to Board", "Your Kanban board", "G B", "▥"],
    ];
    for (const [view, label, hint, shortcut, icon] of navigation) {
      items.push({
        id: `go-${view}`, label: t(label), hint: t(hint), group: "Go", icon, shortcut,
        run: () => goToView(view),
      });
    }
    items.push(
      { id: "new-task", label: t("Create a new task"), hint: t("Open the full task form"), group: "Create", icon: "+", run: () => openTaskModal(null) },
      { id: "capture", label: t("Capture a new task"), hint: t("Opens quick capture"), group: "Create", icon: "C", shortcut: "C", run: openCapture },
      { id: "shortcuts", label: t("Keyboard shortcuts"), hint: t("Learn the whole app"), group: "Create", icon: "?", shortcut: "?", run: openShortcuts },
      { id: "theme", label: t("Toggle light and dark"), hint: t("Saved in your settings"), group: "Create", icon: "◐", run: () => updateSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }) },
      { id: "settings", label: t("Open settings"), hint: t("Account, team and data"), group: "Create", icon: "⚙", run: () => goToView("settings") },
    );
    for (const board of boards().slice(0, 8)) {
      items.push({
        id: `board-${board.id}`,
        label: board.name,
        hint: board.visibility === "private" ? t("Private board") : t("Shared with workspace"),
        group: "Boards",
        icon: "▦",
        run: async () => {
          state.currentBoardId = board.id;
          await loadBoard(board.id);
          setView("board");
        },
      });
    }
    const needle = state.paletteQuery.trim().toLowerCase();
    const commands = items.filter((item) => !needle || `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(needle));
    const tasks = needle.length >= 2 ? state.paletteResults.slice(0, 6).map((task) => ({
      id: `task-${task.id}`,
      label: task.title,
      hint: [task.boardName, task.columnName].filter(Boolean).join(" · "),
      group: "Tasks",
      icon: "↵",
      run: () => openTaskById(task.id),
    })) : [];
    return [...commands.slice(0, needle ? 6 : 14), ...tasks];
  }

  function renderPalette() {
    const container = $("paletteResults");
    if (!container) return;
    const items = paletteCommands();
    state.paletteItems = items;
    state.paletteActive = Math.max(0, Math.min(state.paletteActive, items.length - 1));
    container.replaceChildren();
    if (!items.length) {
      const empty = element("div", "empty", "");
      empty.style.border = "0";
      empty.append(element("h3", "", t("No matches")));
      empty.append(element("p", "", t("Try a task title, a board name, or “calendar”.")));
      container.append(empty);
      return;
    }
    const groups = new Map();
    for (const item of items) {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    for (const [group, groupItems] of groups) {
      container.append(element("div", "palette-group-label", t(group)));
      for (const item of groupItems) {
        const index = items.indexOf(item);
        const button = element("button", `palette-item${index === state.paletteActive ? " active" : ""}`);
        button.type = "button";
        button.id = `palette-${item.id}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === state.paletteActive));
        button.append(element("span", "palette-icon", item.icon));
        const copy = element("span", "palette-item-copy");
        copy.append(element("span", "palette-item-label", item.label));
        if (item.hint) copy.append(element("span", "palette-item-hint", item.hint));
        button.append(copy);
        if (item.shortcut) button.append(element("span", "palette-shortcut", item.shortcut));
        button.addEventListener("mouseenter", () => {
          state.paletteActive = index;
          updatePaletteActive();
        });
        button.addEventListener("click", () => void runPaletteItem(item));
        container.append(button);
      }
    }
    updatePaletteActive();
  }

  function updatePaletteActive() {
    const buttons = [...$("paletteResults").querySelectorAll(".palette-item")];
    buttons.forEach((button, index) => {
      const active = index === state.paletteActive;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const item = state.paletteItems[state.paletteActive];
    if (item) {
      $("paletteInput").setAttribute("aria-activedescendant", `palette-${item.id}`);
      buttons[state.paletteActive]?.scrollIntoView({ block: "nearest" });
    } else {
      $("paletteInput").removeAttribute("aria-activedescendant");
    }
  }

  function schedulePaletteSearch() {
    window.clearTimeout(state.paletteTimer);
    const query = state.paletteQuery.trim();
    if (query.length < 2) {
      state.paletteResults = [];
      renderPalette();
      return;
    }
    state.paletteTimer = window.setTimeout(async () => {
      const seq = ++state.paletteSearchSeq;
      try {
        const result = await request(`/api/search?workspaceId=${encodeURIComponent(workspace()?.id)}&q=${encodeURIComponent(query)}`);
        if (seq !== state.paletteSearchSeq) return;
        state.paletteResults = result?.results ?? [];
        renderPalette();
      } catch {
        if (seq !== state.paletteSearchSeq) return;
        state.paletteResults = [];
        renderPalette();
      }
    }, 180);
  }

  async function runPaletteItem(item) {
    closePalette(false);
    try {
      await item.run();
    } catch (error) {
      showToast(error.message);
    }
  }

  function openPalette() {
    state.paletteReturnFocus = document.activeElement;
    state.paletteOpen = true;
    state.paletteQuery = "";
    state.paletteResults = [];
    state.paletteActive = 0;
    state.paletteSearchSeq++;
    $("paletteInput").value = "";
    renderPalette();
    $("paletteModal").classList.remove("hidden");
    window.setTimeout(() => $("paletteInput").focus(), 20);
  }

  function closePalette(restoreFocus = true) {
    state.paletteOpen = false;
    state.paletteItems = [];
    window.clearTimeout(state.paletteTimer);
    if (!restoreFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    $("paletteModal").classList.add("hidden");
    const previous = state.paletteReturnFocus;
    state.paletteReturnFocus = null;
    if (restoreFocus && previous && typeof previous.focus === "function") {
      window.setTimeout(() => previous.focus(), 20);
    }
  }

  const SHORTCUT_ROWS = [
    ["Capture a task", ["C"]],
    ["Command palette", ["Ctrl", "/", "⌘", "K"]],
    ["Search everything", ["/"]],
    ["Go to Today", ["G", "then", "T"]],
    ["Go to Upcoming", ["G", "then", "U"]],
    ["Go to Calendar", ["G", "then", "C"]],
    ["Go to Archive", ["G", "then", "A"]],
    ["Go to Insights", ["G", "then", "I"]],
    ["Go to Search", ["G", "then", "S"]],
    ["Go to Board", ["G", "then", "B"]],
    ["New board", ["Shift", "N"]],
    ["Show shortcuts", ["?"]],
    ["Close a dialog", ["Esc"]],
    ["Save quick capture or comment", ["Ctrl", "/", "⌘", "Enter"]],
    ["Move a focused card", ["Alt", "←", "→"]],
    ["Reorder a focused card", ["Alt", "↑", "↓"]],
  ];

  function renderShortcutList() {
    const list = $("shortcutList");
    list.replaceChildren();
    for (const [label, keys] of SHORTCUT_ROWS) {
      const row = element("div", "shortcut-row");
      row.append(element("span", "", t(label)));
      const keyWrap = element("span", "shortcut-keys");
      for (const key of keys) {
        if (key === "then") keyWrap.append(element("span", "muted small", t("then")));
        else keyWrap.append(element("span", "kbd", key));
      }
      row.append(keyWrap);
      list.append(row);
    }
    $("singleKeyShortcutsToggle").checked = state.singleKeyShortcuts;
  }

  function openShortcuts() {
    state.shortcutsReturnFocus = document.activeElement;
    renderShortcutList();
    $("shortcutsModal").classList.remove("hidden");
  }

  function closeShortcuts() {
    $("shortcutsModal").classList.add("hidden");
    const previous = state.shortcutsReturnFocus;
    state.shortcutsReturnFocus = null;
    if (previous && typeof previous.focus === "function") window.setTimeout(() => previous.focus(), 20);
  }

  function setSingleKeyShortcuts(enabled) {
    state.singleKeyShortcuts = enabled;
    try {
      window.localStorage.setItem("drift-single-key-shortcuts", enabled ? "on" : "off");
    } catch {
      // Storage is optional.
    }
    const toggle = $("singleKeyShortcutsToggle");
    if (toggle) toggle.checked = enabled;
    renderSettings();
  }

  function focusTaskCard(taskId) {
    window.setTimeout(() => {
      document.querySelector(`.card[data-task-id="${CSS.escape(taskId)}"]`)?.focus();
    }, 30);
  }

  async function keyboardMoveTask(task, direction) {
    const columns = currentBoard()?.columns ?? [];
    const index = columns.findIndex((column) => column.id === task.columnId);
    const target = columns[index + (direction === "ArrowRight" ? 1 : -1)];
    if (!target) return;
    try {
      const result = await requestOrQueue(
        `/api/tasks/${encodeURIComponent(task.id)}/move`,
        { method: "PATCH", body: { version: task.version, columnId: target.id } },
        { kind: "task.move", label: task.title }
      );
      if (result?.queued) {
        showToast(t("Saved on this device — will sync when you reconnect."));
        return;
      }
      await loadBoard(state.currentBoardId);
      await loadToday();
      focusTaskCard(task.id);
      announce(t("Moved {{title}} to {{column}}.", { title: task.title, column: target.name }));
      showToast(t("Task moved."), undoToastAction(result?.undo, async () => {
        await loadBoard(state.currentBoardId);
        await loadToday();
        focusTaskCard(task.id);
      }));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function keyboardReorderTask(task, direction) {
    try {
      const result = await request(`/api/tasks/${encodeURIComponent(task.id)}/reorder`, {
        method: "POST",
        body: { direction: direction === "ArrowUp" ? "up" : "down" },
      });
      if (result?.moved === false) return;
      await loadBoard(state.currentBoardId);
      focusTaskCard(task.id);
      announce(t("Reordered {{title}}.", { title: task.title }));
      showToast(t("Task reordered."), undoToastAction(result?.undo, async () => {
        await loadBoard(state.currentBoardId);
        focusTaskCard(task.id);
      }));
    } catch (error) {
      showToast(error.message);
    }
  }

  function handleGlobalKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (state.paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (event.key === "Escape" && state.paletteOpen) {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "Escape" && !$("shortcutsModal").classList.contains("hidden")) {
      event.preventDefault();
      closeShortcuts();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (state.paletteOpen || !$("shortcutsModal").classList.contains("hidden")) return;
    if (anyModalOpen()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!state.singleKeyShortcuts) return;
    if (event.key === "c" || event.key === "C") {
      event.preventDefault();
      openCapture();
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      void goToView("search");
      return;
    }
    if (event.key === "?") {
      event.preventDefault();
      openShortcuts();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openNewBoardModal();
      return;
    }
    if (event.key.toLowerCase() === "g") {
      state.gPending = true;
      window.clearTimeout(state.gTimer);
      state.gTimer = window.setTimeout(() => { state.gPending = false; }, 1200);
      return;
    }
    if (state.gPending) {
      const map = { t: "today", u: "upcoming", c: "calendar", a: "archive", s: "search", i: "insights", b: "board" };
      const view = map[event.key.toLowerCase()];
      if (view) {
        event.preventDefault();
        state.gPending = false;
        void goToView(view);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    try {
      state.singleKeyShortcuts = window.localStorage.getItem("drift-single-key-shortcuts") !== "off";
    } catch {
      state.singleKeyShortcuts = true;
    }
    window.DriftSound?.init();
    updateOfflineBanner();
    window.DriftOffline?.subscribeQueue(updateOfflineBanner);
    window.addEventListener("offline", () => {
      state.offline = true;
      updateOfflineBanner();
    });
    window.addEventListener("online", () => {
      state.offline = false;
      updateOfflineBanner();
      void refreshAfterReconnect().then(() => syncOfflineQueue(true));
    });
    window.addEventListener("drift-network-error", () => {
      state.offline = true;
      updateOfflineBanner();
    });
    $("offlineReviewButton").addEventListener("click", openOfflineQueue);
    $("closeOfflineModal").addEventListener("click", closeOfflineQueue);
    $("offlineModal").addEventListener("click", (event) => {
      if (event.target === $("offlineModal")) closeOfflineQueue();
    });
    $("offlineRetryButton").addEventListener("click", () => void syncOfflineQueue(true));
    $("offlineSyncButton").addEventListener("click", () => void syncOfflineQueue(true));
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        window.setTimeout(() => {
          navigator.serviceWorker.register("/sw.js").catch(() => undefined);
        }, 1200);
      });
    }
    window.DriftI18n?.subscribe(() => {
      renderAccount();
      renderSidebar();
      if (state.settings) renderSettings();
      if (state.today) renderToday();
      if (state.autoPlan) renderAutoPlan();
      if (state.focus) renderFocus();
      if (!$("captureModal").classList.contains("hidden")) renderCapturePreview();
      if (state.view === "calendar") void loadCalendar();
      if (state.view === "upcoming") void loadUpcoming();
      if (state.view === "archive") void loadArchive();
      if (state.view === "search") void runSearch();
      if (state.view === "insights") void loadInsights();
      if (state.view) setView(state.view);
    });
    $("settingsBack").addEventListener("click", () => setView("today"));
    $("settingsSearch").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      const nav = $("settingsNav");
      let group = null;
      for (const node of nav.children) {
        if (node.classList.contains("settings-group")) {
          group = node;
          group.classList.toggle("hidden", Boolean(query));
          continue;
        }
        if (!node.matches("button")) continue;
        const match = !query || node.textContent.toLowerCase().includes(query);
        node.classList.toggle("hidden", !match);
        if (match && group) group.classList.remove("hidden");
      }
    });
    $("settingsThemeToggle").addEventListener("click", () => updateSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }));
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (state.settings?.theme === "system") applySettings();
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.view === "board" && !state.board && state.currentBoardId) {
          void loadBoard(state.currentBoardId).then(() => setView("board"));
          return;
        }
        setView(button.dataset.view);
      });
    });
    $("searchTopButton").addEventListener("click", () => {
      setView("search");
      window.setTimeout(() => $("searchInput").focus(), 20);
    });
    $("themeTopButton").addEventListener("click", () => {
      updateSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" });
    });
    $("soundTopButton").addEventListener("click", () => {
      const prefs = window.DriftSound?.getPrefs?.() ?? { enabled: true };
      window.DriftSound?.setPrefs?.({ ...prefs, enabled: !prefs.enabled });
      $("soundTopButton").classList.toggle("muted", prefs.enabled);
      showToast(prefs.enabled ? t("Sound muted.") : t("Sound on."));
    });
    $("newTaskButton").addEventListener("click", () => openTaskModal(null));
    $("paletteButton").addEventListener("click", openPalette);
    $("shortcutsButton").addEventListener("click", openShortcuts);
    $("paletteModal").addEventListener("click", (event) => {
      if (event.target === $("paletteModal")) closePalette();
    });
    $("paletteInput").addEventListener("input", (event) => {
      state.paletteQuery = event.target.value;
      state.paletteActive = 0;
      renderPalette();
      schedulePaletteSearch();
    });
    $("paletteInput").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.paletteActive = Math.min(state.paletteItems.length - 1, state.paletteActive + 1);
        updatePaletteActive();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        state.paletteActive = Math.max(0, state.paletteActive - 1);
        updatePaletteActive();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = state.paletteItems[state.paletteActive];
        if (item) void runPaletteItem(item);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    });
    $("closeShortcuts").addEventListener("click", closeShortcuts);
    $("shortcutsDone").addEventListener("click", closeShortcuts);
    $("shortcutsModal").addEventListener("click", (event) => {
      if (event.target === $("shortcutsModal")) closeShortcuts();
    });
    $("singleKeyShortcutsToggle").addEventListener("change", (event) => {
      setSingleKeyShortcuts(event.target.checked);
    });
    window.addEventListener("keydown", handleGlobalKeydown);
    $("captureButton").addEventListener("click", openCapture);
    $("closeCaptureModal").addEventListener("click", closeCapture);
    $("captureModal").addEventListener("click", (event) => {
      if (event.target === $("captureModal")) closeCapture();
    });
    $("captureBoard").addEventListener("change", populateCaptureColumns);
    $("captureInput").addEventListener("input", renderCapturePreview);
    $("captureInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submitCapture();
      }
    });
    $("captureAddButton").addEventListener("click", () => void submitCapture());
    $("captureVoiceButton").addEventListener("click", toggleCaptureVoice);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("captureModal").classList.contains("hidden")) {
        event.preventDefault();
        closeCapture();
      }
    });
    $("focusTaskButton").addEventListener("click", () => {
      if (state.editing) void openFocus(state.editing);
    });
    $("leaveFocusButton").addEventListener("click", () => void leaveFocus());
    $("focusToggle").addEventListener("click", () => {
      if (state.focus?.phase === "running") pauseFocus();
      else startFocus();
    });
    $("focusComplete").addEventListener("click", () => void completeFocus());
    $("focusLogLeave").addEventListener("click", () => void leaveFocus());
    $("focusReturn").addEventListener("click", () => void leaveFocus());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.focus) {
        event.preventDefault();
        void leaveFocus();
      }
    });
    $("dayFlowRebalance").addEventListener("click", rebalanceToday);
    $("capacityRebalanceButton").addEventListener("click", rebalanceToday);
    $("todayCaptureButton").addEventListener("click", openCapture);
    $("todayMonthButton").addEventListener("click", () => setView("calendar"));
    $("smartPlanButton").addEventListener("click", openAutoPlan);
    $("todayPlanReview").addEventListener("click", openAutoPlan);
    $("todayPlanRefresh").addEventListener("click", () => void loadToday());
    $("todayPlanClear").addEventListener("click", clearAutoPlan);
    $("glanceInsightsButton").addEventListener("click", () => setView("insights"));
    $("applyTodayPlanButton").addEventListener("click", applyTodayPlan);
    const later = $("dayFlowLater");
    later.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      later.classList.add("active");
    });
    later.addEventListener("dragleave", () => later.classList.remove("active"));
    later.addEventListener("drop", async (event) => {
      event.preventDefault();
      later.classList.remove("active");
      const taskId = event.dataTransfer.getData("text/plain") || state.draggingTaskId;
      state.draggingTaskId = null;
      if (taskId) await todayAction("dismiss", taskId);
    });
    $("newBoardButton").addEventListener("click", openNewBoardModal);
    $("boardFilterInput").addEventListener("input", (event) => {
      state.boardFilterText = event.target.value;
      renderBoard();
    });
    $("boardPriorityFilter").addEventListener("change", (event) => {
      state.boardPriority = event.target.value;
      renderBoard();
    });
    $("boardAssigneeFilter").addEventListener("change", (event) => {
      state.boardAssignee = event.target.value;
      renderBoard();
    });
    $("boardViewButton").addEventListener("click", () => {
      state.boardMode = "board";
      renderBoard();
    });
    $("listViewButton").addEventListener("click", () => {
      state.boardMode = "list";
      renderBoard();
    });
    $("boardMoreButton").addEventListener("click", () => {
      const menu = $("boardMoreMenu");
      const open = menu.classList.toggle("hidden");
      $("boardMoreButton").setAttribute("aria-expanded", String(!open));
    });
    document.addEventListener("click", (event) => {
      const menu = $("boardMoreMenu");
      if (menu && !menu.classList.contains("hidden")
        && !menu.contains(event.target) && event.target !== $("boardMoreButton")) {
        menu.classList.add("hidden");
        $("boardMoreButton").setAttribute("aria-expanded", "false");
      }
      if (!event.target.closest?.(".column-menu-wrap")) {
        document.querySelectorAll(".column-menu").forEach((item) => item.classList.add("hidden"));
      }
    });
    const newBoardTask = () => {
      const columnId = currentBoard()?.columns?.[0]?.id ?? null;
      openTaskModal(null, columnId);
    };
    $("boardNewTaskButton").addEventListener("click", newBoardTask);
    $("boardAddTaskButton").addEventListener("click", newBoardTask);
    $("boardCreateForm").addEventListener("submit", createBoard);
    $("closeBoardCreate").addEventListener("click", () => $("boardCreateModal").classList.add("hidden"));
    $("cancelBoardCreate").addEventListener("click", () => $("boardCreateModal").classList.add("hidden"));
    $("boardCreateModal").addEventListener("click", (event) => {
      if (event.target === $("boardCreateModal")) $("boardCreateModal").classList.add("hidden");
    });
    $("boardSettingsButton").addEventListener("click", openBoardSettings);
    $("boardSettingsForm").addEventListener("submit", saveBoardSettings);
    $("closeBoardSettings").addEventListener("click", () => $("boardSettingsModal").classList.add("hidden"));
    $("cancelBoardSettings").addEventListener("click", () => $("boardSettingsModal").classList.add("hidden"));
    $("boardSettingsModal").addEventListener("click", (event) => {
      if (event.target === $("boardSettingsModal")) $("boardSettingsModal").classList.add("hidden");
    });
    $("boardAddColumnButton").addEventListener("click", () => openColumnModal());
    $("columnForm").addEventListener("submit", saveColumn);
    $("closeColumnModal").addEventListener("click", () => $("columnModal").classList.add("hidden"));
    $("cancelColumnModal").addEventListener("click", () => $("columnModal").classList.add("hidden"));
    $("columnModal").addEventListener("click", (event) => {
      if (event.target === $("columnModal")) $("columnModal").classList.add("hidden");
    });
    $("boardDuplicateButton").addEventListener("click", duplicateBoard);
    $("boardShareButton").addEventListener("click", toggleBoardShare);
    $("bulkCompleteButton").addEventListener("click", () => void runBulkTaskAction("complete"));
    $("bulkArchiveButton").addEventListener("click", () => void runBulkTaskAction("archive"));
    $("bulkMoveButton").addEventListener("click", () => void runBulkTaskAction("move"));
    $("bulkMoveTarget").addEventListener("change", (event) => { state.bulkTargetColumn = event.target.value; });
    $("bulkDeleteButton").addEventListener("click", () => void runBulkTaskAction("delete"));
    $("bulkClearButton").addEventListener("click", clearTaskSelection);
    $("boardArchiveButton").addEventListener("click", archiveBoard);
    $("boardDeleteButton").addEventListener("click", deleteCurrentBoard);
    $("newWorkspaceButton").addEventListener("click", createWorkspace);
    $("autoPlanButton").addEventListener("click", openAutoPlan);
    $("closeAutoPlanModal").addEventListener("click", () => $("autoPlanModal").classList.add("hidden"));
    $("applyAutoPlanButton").addEventListener("click", applyAutoPlan);
    $("clearAutoPlanButton").addEventListener("click", clearAutoPlan);
    $("autoPlanModal").addEventListener("click", (event) => {
      if (event.target === $("autoPlanModal")) $("autoPlanModal").classList.add("hidden");
    });
    document.querySelectorAll("[data-upcoming-range]").forEach((button) => {
      button.addEventListener("click", () => {
        state.upcomingRange = Number(button.dataset.upcomingRange);
        void loadUpcoming();
      });
    });
    $("upcomingNewTaskButton").addEventListener("click", () => {
      const columnId = currentBoard()?.columns?.[0]?.id ?? null;
      openTaskModal(null, columnId);
    });
    $("searchInput").addEventListener("input", () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => void runSearch(), 180);
    });
    $("searchInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void runSearch(); }
    });
    document.querySelectorAll("[data-search-status]").forEach((button) => {
      button.addEventListener("click", () => {
        state.searchStatus = button.dataset.searchStatus;
        void runSearch();
      });
    });
    $("searchPriorityFilter").addEventListener("change", () => void runSearch());
    $("searchBoardFilter").addEventListener("change", () => void runSearch());
    $("calendarPrev").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
      void loadCalendar();
    });
    $("calendarNext").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
      void loadCalendar();
    });
    $("calendarTodayButton").addEventListener("click", () => {
      state.calendarMonth = new Date();
      void loadCalendar();
    });
    $("calendarNewTaskButton").addEventListener("click", () => {
      const columnId = currentBoard()?.columns?.[0]?.id ?? null;
      openTaskModal(null, columnId);
    });
    $("insightsNewTaskButton").addEventListener("click", () => {
      const columnId = currentBoard()?.columns?.[0]?.id ?? null;
      openTaskModal(null, columnId);
    });
    $("insightsTimelineButton").addEventListener("click", () => {
      state.insightsMode = "timeline";
      void loadInsights();
    });
    $("insightsWorkloadButton").addEventListener("click", () => {
      state.insightsMode = "workload";
      void loadInsights();
    });
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        state.insightsRange = Number(button.dataset.range);
        void loadInsights();
      });
    });
    $("notificationsButton").addEventListener("click", openNotificationsModal);
    $("closeNotificationsModal").addEventListener("click", () => $("notificationsModal").classList.add("hidden"));
    $("markAllReadButton").addEventListener("click", markAllRead);
    $("notificationSettingsButton").addEventListener("click", () => {
      $("notificationsModal").classList.add("hidden");
      history.replaceState({}, "", "/settings#notifications");
      setView("settings");
      renderSettings();
    });
    $("notificationsModal").addEventListener("click", (event) => {
      if (event.target === $("notificationsModal")) $("notificationsModal").classList.add("hidden");
    });
    $("membersButton").addEventListener("click", openMembersModal);
    $("closeMembersModal").addEventListener("click", () => $("membersModal").classList.add("hidden"));
    $("inviteButton").addEventListener("click", inviteMember);
    $("membersModal").addEventListener("click", (event) => {
      if (event.target === $("membersModal")) $("membersModal").classList.add("hidden");
    });
    $("workspaceSelect").addEventListener("change", (event) => void switchWorkspace(event.target.value));
    $("closeModal").addEventListener("click", closeModal);
    $("cancelModal").addEventListener("click", closeModal);
    $("taskForm").addEventListener("submit", saveTask);
    $("taskColumn").addEventListener("change", (event) => {
      if (state.editing) void moveEditingTask(event.target.value);
    });
    $("taskDueAllDay").addEventListener("change", (event) => {
      $("taskDueTime").disabled = event.target.checked;
      if (!event.target.checked && !$("taskDueTime").value) $("taskDueTime").value = "09:00";
    });
    $("taskDue").addEventListener("change", () => {
      $("taskReminderOffset").disabled = !$("taskDue").value;
    });
    $("taskCompleteToggle").addEventListener("click", () => void toggleDrawerComplete());
    $("copyTaskLinkButton").addEventListener("click", () => void copyTaskLink());
    $("archiveTaskButton").addEventListener("click", () => void archiveCurrentTask());
    $("subtaskAddButton").addEventListener("click", () => void addSubtask());
    $("subtaskSuggestButton").addEventListener("click", showChecklistSuggestions);
    $("commentAddButton").addEventListener("click", addComment);
    $("dependencyAddButton").addEventListener("click", addDependency);
    $("attachmentUploadButton").addEventListener("click", uploadAttachment);
    $("reminderAddButton").addEventListener("click", addReminder);
    $("subtaskTitle").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void addSubtask(); }
    });
    $("deleteTaskButton").addEventListener("click", deleteTask);
    $("completeTaskButton").addEventListener("click", () => setTaskCompleted(true));
    $("reopenTaskButton").addEventListener("click", () => setTaskCompleted(false));
    $("authButton").addEventListener("click", () => window.location.assign("/auth"));
    $("closeAuthModal").addEventListener("click", closeAuthModal);
    $("authModeButton").addEventListener("click", () => setAuthMode(state.authMode === "signin" ? "signup" : "signin"));
    $("authForm").addEventListener("submit", submitAuth);
    $("authModal").addEventListener("click", (event) => {
      if (event.target === $("authModal")) closeAuthModal();
    });
    $("taskModal").addEventListener("click", (event) => {
      if (event.target === $("taskModal")) closeModal();
    });
    $("signOutButton").addEventListener("click", async () => {
      await request("/api/auth/signout", { method: "DELETE" });
      window.location.reload();
    });
    void init();
  });
})();
