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
    authMode: "signin",
    settings: null,
    settingsQueue: Promise.resolve(),
    members: {},
  };

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => window.DriftI18n?.t(key, vars) ?? key;
  const translateReason = (reason) => window.DriftI18n?.translateReason(reason, t) ?? reason;

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
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
      workspaceId: meta.workspaceId || workspace()?.id || null,
    });
    state.offline = true;
    updateOfflineBanner();
    return write;
  }

  async function requestOrQueue(path, options, meta) {
    try {
      return await request(path, options);
    } catch (error) {
      if (error.code === "NETWORK_ERROR" && window.DriftOffline) {
        queueOfflineWrite(path, options, meta);
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

  async function init() {
    try {
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
      if (state.currentBoardId) await loadBoard(state.currentBoardId);
      await loadToday();
      await loadNotifications();
      await loadSettings();
      const startView = state.settings?.startView;
      setView(["today", "board", "upcoming"].includes(startView) ? startView : "today");
      const inviteToken = new URLSearchParams(location.search).get("invite");
      if (inviteToken) {
        await acceptInviteFromUrl(inviteToken);
        state.currentBoardId = boards()[0]?.id ?? null;
        renderSidebar();
        if (state.currentBoardId) await loadBoard(state.currentBoardId);
        await loadToday();
      }
      state.offline = !navigator.onLine;
      updateOfflineBanner();
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
    $("accountName").textContent = guest
      ? (user?.name && user.name !== "Guest" ? `${user.name} · ${t("Guest")}` : t("Guest workspace"))
      : (user.email || user.name || t("Account"));
    $("authButton").classList.toggle("hidden", !guest);
    $("signOutButton").classList.toggle("hidden", guest);
  }

  function openAuthModal() {
    state.authMode = "signin";
    $("authTitle").textContent = "Sign in";
    $("authModeButton").textContent = "Create account";
    $("authSubmit").textContent = "Sign in";
    $("authNameField").classList.add("hidden");
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
      const result = await request(signup ? "/api/auth/signup" : "/api/auth/signin", {
        method: "POST",
        body,
      });
      if (!result) throw new Error("Email or password is incorrect.");
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

  function closeAuthModal() {
    $("authModal").classList.add("hidden");
  }

  async function loadNotifications() {
    try {
      const result = await request("/api/notifications");
      state.notifications = result.notifications ?? [];
      $("notificationCount").textContent = String(result.unreadCount ?? 0);
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
      list.append(row);
    }
  }

  async function markAllRead() {
    try {
      const result = await request("/api/notifications/read-all", { method: "PATCH" });
      state.notifications = result.notifications ?? [];
      $("notificationCount").textContent = String(result.unreadCount ?? 0);
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
      const link = `${location.origin}/?invite=${encodeURIComponent(result.token)}`;
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

  function renderCalendar(days) {
    const byDate = new Map(days.map((day) => [day.date, day]));
    const grid = $("calendarGrid");
    grid.replaceChildren();
    const first = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    const today = dateKey(new Date());
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const key = dateKey(date);
      const day = element("div", `calendar-day${date.getMonth() !== state.calendarMonth.getMonth() ? " other" : ""}${key === today ? " today" : ""}`);
      day.append(element("h3", "", String(date.getDate())));
      const data = byDate.get(key);
      for (const task of (data?.tasks ?? []).slice(0, 6)) {
        day.append(element("button", "calendar-item", task.title));
      }
      for (const block of (data?.planBlocks ?? []).slice(0, 4)) {
        day.append(element("div", "calendar-item block", `${minutesLabel(block.startMinute)} ${block.title}`));
      }
      grid.append(day);
    }
  }

  async function loadUpcoming() {
    try {
      const data = await request(`/api/upcoming?workspaceId=${encodeURIComponent(workspace().id)}&days=14`);
      const container = $("upcomingList");
      container.replaceChildren();
      for (const day of data.days ?? []) {
        if (!(day.tasks ?? []).length) continue;
        container.append(element("h3", "side-label", day.date));
        for (const task of day.tasks) container.append(simpleTaskRow(task));
      }
      if (!container.childElementCount) container.append(element("div", "empty", "Nothing due in the next 14 days."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function loadArchive() {
    try {
      const data = await request(`/api/archive?workspaceId=${encodeURIComponent(workspace().id)}`);
      const container = $("archiveList");
      container.replaceChildren();
      if (!(data.tasks ?? []).length) container.append(element("div", "empty", "Archive is empty."));
      for (const task of data.tasks ?? []) container.append(simpleTaskRow(task));
    } catch (error) {
      showToast(error.message);
    }
  }

  function simpleTaskRow(task) {
    const row = element("div", "today-row");
    const grow = element("div", "grow");
    grow.append(element("h3", "", task.title));
    grow.append(element("p", "", `${task.boardName || "Board"} · ${task.columnName || "Column"}`));
    row.append(grow, element("span", "pill", task.priority || "none"));
    return row;
  }

  async function runSearch() {
    const query = $("searchInput").value.trim();
    const results = $("searchResults");
    results.replaceChildren();
    if (!query) return;
    try {
      const data = await request(`/api/search?workspaceId=${encodeURIComponent(workspace().id)}&q=${encodeURIComponent(query)}`);
      if (!(data.results ?? []).length) results.append(element("div", "empty", "No matching tasks."));
      for (const task of data.results ?? []) {
        const row = element("div", "detail-item");
        const grow = element("div", "grow");
        grow.append(element("strong", "", task.title));
        grow.append(element("p", "", `${task.boardName} · ${task.columnName}`));
        row.append(grow, element("span", "pill", task.priority || "none"));
        results.append(row);
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  async function loadInsights() {
    try {
      const data = await request(`/api/insights?workspaceId=${encodeURIComponent(workspace().id)}`);
      const grid = $("insightsGrid");
      grid.replaceChildren();
      for (const [label, value] of [["Open", data.open], ["Done", data.done], ["Overdue", data.overdue], ["Priority groups", (data.byPriority ?? []).length]]) {
        const card = element("div", "insight-card");
        card.append(element("span", "muted small", label));
        card.append(element("strong", "", String(value ?? 0)));
        grid.append(card);
      }
      for (const row of data.byPriority ?? []) {
        const card = element("div", "insight-card");
        card.append(element("span", "muted small", row.priority || "none"));
        card.append(element("strong", "", String(row.count)));
        grid.append(card);
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  async function createWorkspace() {
    const name = window.prompt("Team workspace name");
    if (!name || !name.trim()) return;
    try {
      const result = await request("/api/workspaces", {
        method: "POST",
        body: { name: name.trim(), type: "team" },
      });
      state.boot = await request("/api/bootstrap");
      window.DriftOffline?.cacheBootstrap(state.boot);
      state.currentWorkspaceId = result.workspace.id;
      state.currentBoardId = boards()[0]?.id ?? null;
      renderSidebar();
      if (state.currentBoardId) await loadBoard(state.currentBoardId);
      setView("board");
      showToast("Team workspace created.");
    } catch (error) {
      showToast(error.message);
    }
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

  function openNewBoardModal() {
    $("boardCreateName").value = "";
    $("boardCreateDescription").value = "";
    $("boardCreateVisibility").value = "workspace";
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
      const result = await request("/api/boards", {
        method: "POST",
        body: {
          workspaceId: workspace().id,
          name,
          description: $("boardCreateDescription").value.trim(),
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
    if (!window.confirm(t("Delete \"{{name}}\"? This cannot be undone here.", { name: board.name }))) return;
    try {
      await request(`/api/boards/${encodeURIComponent(board.id)}`, { method: "DELETE" });
      await refreshBootstrap();
      const next = boards()[0] ?? null;
      state.currentBoardId = next?.id ?? null;
      if (next) await loadBoard(next.id);
      setView("board");
      showToast(t("Board deleted."));
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

    const list = $("boardList");
    list.replaceChildren();
    for (const board of boards()) {
      const button = element("button", "board-link", board.name);
      button.type = "button";
      button.dataset.boardId = board.id;
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
    document.querySelectorAll(".nav button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
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
      window.setTimeout(() => $("searchInput").focus(), 20);
    } else if (view === "insights") {
      $("viewEyebrow").textContent = t("Workspace");
      $("viewTitle").textContent = t("Insights");
      void loadInsights();
    } else if (view === "settings") {
      $("viewEyebrow").textContent = t("Account & workspace");
      $("viewTitle").textContent = t("Settings");
      if (!state.settings) void loadSettings();
    } else {
      $("viewEyebrow").textContent = t("Plan");
      $("viewTitle").textContent = t("Today");
      void loadToday();
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
    $("boardVisibility").textContent = board.visibility === "private" ? t("Private board") : t("Shared with workspace");
    const flatTasks = (board.columns ?? []).flatMap((column) => column.tasks ?? []);
    const openCount = flatTasks.filter((task) => Number(task.completed) !== 1).length;
    const doneCount = flatTasks.length - openCount;
    $("boardMeta").textContent = doneCount
      ? t("{{open}} open · {{done}} done", { open: openCount, done: doneCount })
      : t("{{open}} open", { open: openCount });
    $("boardSettingsButton").disabled = !(board.permissions?.canEdit ?? true);
    $("boardShareButton").disabled = !(board.permissions?.canShare ?? true);
    $("boardShareButton").textContent = board.shareEnabled ? t("Disable share") : t("Share link");
    $("boardDuplicateButton").disabled = !(board.permissions?.canEdit ?? true);
    $("boardArchiveButton").disabled = !(board.permissions?.canEdit ?? true);
    $("boardDeleteButton").classList.toggle("hidden", !(board.permissions?.canManage ?? true));
    for (const column of board.columns ?? []) {
      const columnNode = element("section", "column");
      columnNode.dataset.columnId = column.id;

      const head = element("div", "column-head");
      const title = element("h2", "", column.name);
      const count = element("span", "count", String((column.tasks ?? []).length));
      head.append(title, count);
      columnNode.append(head);

      const cards = element("div", "cards");
      for (const task of column.tasks ?? []) cards.append(taskCard(task));
      columnNode.append(cards);

      const add = element("button", "add-card", "+ Add task");
      add.type = "button";
      add.addEventListener("click", () => openTaskModal(null, column.id));
      columnNode.append(add);

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
          if (result?.nextTaskId) showToast(t("Next occurrence created."));
        } catch (error) {
          showToast(error.message);
        }
      });

      container.append(columnNode);
    }
  }

  function taskCard(task) {
    const card = element("article", "card");
    card.draggable = true;
    card.tabIndex = 0;
    card.addEventListener("click", () => openTaskModal(task));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTaskModal(task);
      }
    });
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/task-id", task.id);
      event.dataTransfer.effectAllowed = "move";
    });

    card.append(element("h3", "", task.title));
    if (task.description) card.append(element("p", "", task.description));
    const meta = element("div", "card-meta");
    if (task.priority && task.priority !== "none") {
      meta.append(element("span", `pill priority-${task.priority}`, task.priority));
    }
    for (const label of task.labels ?? []) {
      meta.append(element("span", `pill label-${label.color || "slate"}`, label.name));
    }
    if (task.estimateMinutes) meta.append(element("span", "pill", `${task.estimateMinutes}m`));
    if (task.actualMinutes) meta.append(element("span", "pill", `${task.actualMinutes}m tracked`));
    if (task.startDate) meta.append(element("span", "pill", `starts ${task.startDate.slice(0, 10)}`));
    if (task.dueDate) meta.append(element("span", "pill", `due ${task.dueDate.slice(0, 10)}`));
    if (task.recurrenceRule) {
      const repeat = element("span", "pill pill-repeat", `↻ ${describeRecurrence(task.recurrenceRule)}`);
      repeat.title = t("Repeats");
      meta.append(repeat);
    }
    if (task.assignee) {
      const avatar = element("span", "avatar-sm", initials(task.assignee.name));
      avatar.title = task.assignee.name || task.assignee.email || "";
      meta.append(avatar);
    }
    if (meta.childElementCount) card.append(meta);
    return card;
  }

  function renderToday() {
    const list = $("todayList");
    list.replaceChildren();
    const suggestions = state.today?.suggestions ?? [];
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
    $("capacityBar").firstElementChild.style.width = `${percent}%`;
    $("capacityHint").textContent = capacity.overbooked
      ? t("This day is over capacity.")
      : t("{{count}} minutes still open.", { count: Math.max(0, total - selected) });
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
        + (result.nextTaskId ? ` ${t("Next occurrence created.")}` : ""));
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
      try {
        await request("/api/tasks", { method: "POST", body });
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
      showToast(t("Added to {{board}}", { board: board.name }));
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

  function openTaskModal(task, columnId = null) {
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
    $("taskEyebrow").textContent = task ? "Task details" : "Capture";
    $("taskTitle").value = task?.title ?? "";
    $("taskDescription").value = task?.description ?? "";
    $("taskPriority").value = task?.priority ?? "none";
    $("taskLabels").value = (task?.labels ?? []).map((label) => label.name).join(", ");
    $("taskEstimate").value = task?.estimateMinutes ?? "";
    $("taskStart").value = task?.startDate ? String(task.startDate).slice(0, 10) : "";
    $("taskDue").value = task?.dueDate ? String(task.dueDate).slice(0, 10) : "";
    $("taskDueAllDay").checked = task ? Number(task.dueAllDay) === 1 : true;
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
    $("columnField").classList.toggle("hidden", Boolean(task));
    const completed = Boolean(task) && Number(task.completed) === 1;
    $("focusTaskButton").classList.toggle("hidden", !task || completed);
    $("completeTaskButton").classList.toggle("hidden", !task || completed);
    $("reopenTaskButton").classList.toggle("hidden", !task || !completed);
    $("deleteTaskButton").classList.toggle("hidden", !task);
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
      "task.recurred": "created the next occurrence",
      "task.deleted": "deleted the task",
      "comment.created": "commented",
      "subtask.created": "added a checklist item",
      "attachment.created": "attached a file",
      "attachment.deleted": "removed an attachment",
      "today.accepted": "added this to Today",
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
      row.append(checkbox, title);
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

  async function addSubtask() {
    const title = $("subtaskTitle").value.trim();
    if (!title || !state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/subtasks`, {
        method: "POST",
        body: { title },
      });
      $("subtaskTitle").value = "";
      await loadTaskDetail(state.editing.id);
    } catch (error) {
      showToast(error.message);
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
      const body = {
        title: $("taskTitle").value.trim(),
        description: $("taskDescription").value.trim(),
        priority: $("taskPriority").value,
        estimateMinutes: $("taskEstimate").value ? Number($("taskEstimate").value) : null,
        actualMinutes: $("taskActual").value ? Number($("taskActual").value) : null,
        labels: $("taskLabels").value.split(",").map((label) => label.trim()).filter(Boolean),
        startDate: $("taskStart").value || null,
        dueDate: $("taskDue").value || null,
        dueAllDay: $("taskDueAllDay").checked,
        assigneeId: $("taskAssignee").value || null,
        recurrenceRule,
        ...(recurrenceRule ? {} : { recurrenceEndsAt: null }),
      };
      if (task) {
        const result = await requestOrQueue(
          `/api/tasks/${encodeURIComponent(task.id)}`,
          { method: "PATCH", body: { ...body, version: task.version } },
          { kind: "task.update", label: body.title }
        );
        if (result?.queued) {
          closeModal();
          showToast(t("Saved on this device — will sync when you reconnect."));
          return;
        }
      } else {
        const result = await requestOrQueue(
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
        if (result?.queued) {
          closeModal();
          showToast(t("Saved on this device — will sync when you reconnect."));
          return;
        }
      }
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
      window.DriftSound?.play("capture");
    } catch (error) {
      showToast(error.message);
    } finally {
      save.disabled = false;
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
      if (result?.nextTaskId) showToast(t("Next occurrence created."));
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteTask() {
    const task = state.editing;
    if (!task || !window.confirm(`Delete “${task.title}”?`)) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
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
      { id: "account", label: "Account", render: renderAccountSettings },
      { id: "appearance", label: "Appearance", render: renderAppearanceSettings },
      { id: "language", label: "Language & region", render: renderLanguageSettings },
      { id: "planning", label: "Planning", render: renderPlanningSettings },
      { id: "auto-plan", label: "Auto-plan", render: renderAutoPlanSettings },
      { id: "focus", label: "Focus & capture", render: renderFocusSettings },
      { id: "sound", label: "Sound", render: renderSoundSettings },
      { id: "notifications", label: "Notifications", render: renderNotificationSettings },
      { id: "features", label: "Features", render: renderFeatureSettings },
    ];
    definitions.forEach((definition, index) => {
      const button = element("button", `settings-nav-item${index === 0 ? " active" : ""}`, definition.label);
      button.type = "button";
      button.addEventListener("click", () => {
        nav.querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button));
        document.getElementById(`settings-${definition.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.append(button);
      container.append(definition.render());
    });
    window.DriftI18n?.translateSubtree(nav);
    window.DriftI18n?.translateSubtree(container);
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

  document.addEventListener("DOMContentLoaded", () => {
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
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
    $("settingsThemeToggle").addEventListener("click", () => updateSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }));
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (state.settings?.theme === "system") applySettings();
    });
    document.querySelectorAll(".nav button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.view === "board" && !state.board && state.currentBoardId) {
          void loadBoard(state.currentBoardId).then(() => setView("board"));
          return;
        }
        setView(button.dataset.view);
      });
    });
    $("newTaskButton").addEventListener("click", () => openTaskModal(null));
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
    $("boardDuplicateButton").addEventListener("click", duplicateBoard);
    $("boardShareButton").addEventListener("click", toggleBoardShare);
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
    $("searchButton").addEventListener("click", runSearch);
    $("searchInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void runSearch(); }
    });
    $("calendarPrev").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
      void loadCalendar();
    });
    $("calendarNext").addEventListener("click", () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
      void loadCalendar();
    });
    $("notificationsButton").addEventListener("click", openNotificationsModal);
    $("closeNotificationsModal").addEventListener("click", () => $("notificationsModal").classList.add("hidden"));
    $("markAllReadButton").addEventListener("click", markAllRead);
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
    $("subtaskAddButton").addEventListener("click", addSubtask);
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
    $("authButton").addEventListener("click", openAuthModal);
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
