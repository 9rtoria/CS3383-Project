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
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    authMode: "signin",
    settings: null,
    settingsQueue: Promise.resolve(),
  };

  const $ = (id) => document.getElementById(id);

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status === 401) return null;
    if (!response.ok) {
      throw new Error(data?.message || `Request failed (${response.status})`);
    }
    return data;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 3600);
  }

  function workspace() {
    const workspaces = state.boot?.workspaces ?? [];
    return workspaces.find((item) => item.id === state.currentWorkspaceId) ?? workspaces[0] ?? null;
  }

  function boards() {
    return workspace()?.boards ?? [];
  }

  function currentBoard() {
    return state.board?.board ?? null;
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
    } catch (error) {
      showToast(error.message || "Could not start the app.");
    }
  }

  function renderAccount() {
    const user = state.boot?.user;
    const guest = !user || user.isGuest === 1 || user.isGuest === true;
    $("accountName").textContent = guest
      ? (user?.name && user.name !== "Guest" ? `${user.name} · Guest` : "Guest workspace")
      : (user.email || user.name || "Account");
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
      $("calendarTitle").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(start);
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
    renderSidebar();
    if (state.currentBoardId) await loadBoard(state.currentBoardId);
    await loadToday();
    setView("board");
  }

  async function createBoard() {
    const name = window.prompt("Board name");
    if (!name || !name.trim()) return;
    try {
      const result = await request("/api/boards", {
        method: "POST",
        body: { workspaceId: workspace().id, name: name.trim() },
      });
      state.boot = await request("/api/bootstrap");
      state.currentBoardId = result.board.id;
      renderSidebar();
      await loadBoard(result.board.id);
      setView("board");
      showToast("Board created.");
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
    const data = await request(`/api/boards/${encodeURIComponent(boardId)}`);
    state.board = data;
    state.currentBoardId = boardId;
    renderBoard();
    renderSidebar();
  }

  async function loadToday() {
    state.today = await request(`/api/today?workspaceId=${encodeURIComponent(workspace().id)}`);
    renderToday();
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
      $("viewEyebrow").textContent = "Board";
      $("viewTitle").textContent = currentBoard()?.name ?? "Board";
    } else if (view === "calendar") {
      $("viewEyebrow").textContent = "Calendar";
      $("viewTitle").textContent = "Calendar";
      void loadCalendar();
    } else if (view === "upcoming") {
      $("viewEyebrow").textContent = "Plan";
      $("viewTitle").textContent = "Upcoming";
      void loadUpcoming();
    } else if (view === "archive") {
      $("viewEyebrow").textContent = "Workspace";
      $("viewTitle").textContent = "Archive";
      void loadArchive();
    } else if (view === "search") {
      $("viewEyebrow").textContent = "Search";
      $("viewTitle").textContent = "Search";
      window.setTimeout(() => $("searchInput").focus(), 20);
    } else if (view === "insights") {
      $("viewEyebrow").textContent = "Workspace";
      $("viewTitle").textContent = "Insights";
      void loadInsights();
    } else if (view === "settings") {
      $("viewEyebrow").textContent = "Account & workspace";
      $("viewTitle").textContent = "Settings";
      if (!state.settings) void loadSettings();
    } else {
      $("viewEyebrow").textContent = "Plan";
      $("viewTitle").textContent = "Today";
      void loadToday();
    }
  }

  function renderBoard() {
    const container = $("board");
    container.replaceChildren();
    const board = currentBoard();
    if (!board) return;
    $("viewTitle").textContent = board.name;
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
          await request(`/api/tasks/${encodeURIComponent(taskId)}/move`, {
            method: "PATCH",
            body: { version: task.version, columnId: column.id },
          });
          await loadBoard(state.currentBoardId);
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
    if (meta.childElementCount) card.append(meta);
    return card;
  }

  function renderToday() {
    const list = $("todayList");
    list.replaceChildren();
    const suggestions = state.today?.suggestions ?? [];
    if (!suggestions.length) {
      list.append(element("div", "empty", "Nothing open. Add a task to begin."));
    }
    for (const task of suggestions.slice(0, 50)) {
      const row = element("div", "today-row");
      const grow = element("div", "grow");
      grow.append(element("h3", "", task.title));
      const bits = [];
      if (task.reason) bits.push(task.reason);
      if (task.blocked && task.openDependencies) bits.push(`${task.openDependencies} open dependency`);
      if (task.estimateMinutes) bits.push(`${task.estimateMinutes}m`);
      if (task.actualMinutes) bits.push(`${task.actualMinutes}m tracked`);
      if (task.startDate) bits.push(`starts ${task.startDate.slice(0, 10)}`);
      if (task.dueDate) bits.push(`due ${task.dueDate.slice(0, 10)}`);
      grow.append(element("p", "", bits.join(" · ")));

      const actions = element("div", "top-actions");
      const choose = element("button", "btn sm", task.accepted ? "Chosen" : "Choose");
      choose.type = "button";
      choose.disabled = Boolean(task.accepted || task.blocked);
      choose.addEventListener("click", () => todayAction("accept", task.id));
      const dismiss = element("button", "btn ghost sm", "Dismiss");
      dismiss.type = "button";
      dismiss.addEventListener("click", () => todayAction("dismiss", task.id));
      const open = element("button", "btn sm", "Open");
      open.type = "button";
      open.addEventListener("click", () => openTaskModal(task));
      actions.append(choose, dismiss, open);
      row.append(grow, actions);
      list.append(row);
    }

    const flow = $("dayFlowList");
    flow.replaceChildren();
    const blocks = state.today?.planBlocks ?? [];
    if (!blocks.length) {
      flow.append(element("div", "empty", "No scheduled blocks yet. Use Auto-plan to shape the day."));
    }
    for (const block of blocks) {
      const row = element("div", "today-row");
      const time = element("strong", "", `${minutesLabel(block.startMinute)}–${minutesLabel(block.startMinute + block.minutes)}`);
      const grow = element("div", "grow");
      grow.append(element("h3", "", block.title));
      grow.append(element("p", "", `${block.minutes} min · ${block.priority || "none"} priority`));
      row.append(time, grow);
      flow.append(row);
    }

    const capacity = state.today?.capacity ?? { totalMinutes: 300, selectedMinutes: 0 };
    const selected = Number(capacity.selectedMinutes || 0);
    const total = Number(capacity.totalMinutes || 300);
    const percent = total ? Math.min(100, Math.round((selected / total) * 100)) : 0;
    $("capacityNumber").textContent = `${Math.floor(selected / 60)}h ${selected % 60}m`;
    $("capacityBar").firstElementChild.style.width = `${percent}%`;
    $("capacityHint").textContent = capacity.overbooked
      ? "This day is over capacity."
      : `${Math.max(0, total - selected)} minutes still open.`;
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
      state.autoPlan = result;
      renderAutoPlan();
      $("autoPlanModal").classList.remove("hidden");
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderAutoPlan() {
    const container = $("autoPlanPreview");
    container.replaceChildren();
    for (const option of state.autoPlan?.options ?? []) {
      const panel = element("div", "detail-section");
      const head = element("div", "section-head");
      head.append(element("h3", "", option.label));
      head.append(element("span", "muted small", `${option.blocks?.length ?? 0} blocks · ${option.scheduledMinutes ?? 0} min`));
      panel.append(head);
      for (const block of (option.blocks ?? []).slice(0, 6)) {
        const row = element("div", "detail-item");
        row.append(element("span", "grow", `${block.date} ${minutesLabel(block.startMinute)}–${minutesLabel(block.startMinute + block.minutes)} · ${block.title}`));
        panel.append(row);
      }
      if ((option.unscheduled ?? []).length) {
        panel.append(element("p", "small muted", `${option.unscheduled.length} task(s) could not be placed.`));
      }
      container.append(panel);
    }
    $("applyAutoPlanButton").disabled = !(state.autoPlan?.options?.length);
  }

  async function applyAutoPlan() {
    const button = $("applyAutoPlanButton");
    button.disabled = true;
    try {
      await request("/api/auto-plan", {
        method: "POST",
        body: { action: "apply", workspaceId: workspace().id, optionId: "balanced" },
      });
      $("autoPlanModal").classList.add("hidden");
      await loadToday();
      await loadBoard(state.currentBoardId);
      showToast("Auto-plan applied.");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
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
      await loadToday();
      showToast("Auto-plan cleared.");
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
    $("taskColumn").replaceChildren();
    for (const column of columns) $("taskColumn").add(new Option(column.name, column.id));
    if (columnId) $("taskColumn").value = columnId;
    else if (task?.columnId) $("taskColumn").value = task.columnId;
    $("columnField").classList.toggle("hidden", Boolean(task));
    const completed = Boolean(task) && Number(task.completed) === 1;
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

  function renderTaskDetail() {
    const task = state.detail?.task;
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
      };
      if (task) {
        await request(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          body: { ...body, version: task.version },
        });
      } else {
        await request("/api/tasks", {
          method: "POST",
          body: {
            ...body,
            workspaceId: workspace().id,
            boardId: state.currentBoardId,
            columnId: $("taskColumn").value,
          },
        });
      }
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
    } catch (error) {
      showToast(error.message);
    } finally {
      save.disabled = false;
    }
  }

  async function setTaskCompleted(completed) {
    if (!state.editing) return;
    try {
      await request(`/api/tasks/${encodeURIComponent(state.editing.id)}/${completed ? "complete" : "reopen"}`, {
        method: "POST",
      });
      closeModal();
      await loadBoard(state.currentBoardId);
      await loadToday();
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
    } catch (error) {
      state.settings = normalizeSettings(DEFAULT_SETTINGS);
      showToast(error.message);
    }
    applySettings();
    renderSettings();
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
    root.lang = settings.locale || "en";
    $("dayFlowPanel")?.classList.toggle("hidden", settings.features?.dayFlow === false);
    $("autoPlanButton")?.classList.toggle("hidden", settings.features?.smartPlan === false);
    const toggle = $("settingsThemeToggle");
    if (toggle) toggle.textContent = dark ? "Light" : "Dark";
  }

  function setSettingsSaveState(value) {
    const node = $("settingsSaveState");
    if (!node) return;
    node.className = `settings-save-state ${value}`;
    node.textContent = value === "saving" ? "Saving…" : value === "saved" ? "Saved" : value === "error" ? "Could not save" : "Autosave";
  }

  function updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    applySettings();
    setSettingsSaveState("saving");
    state.settingsQueue = state.settingsQueue.then(async () => {
      try {
        await request("/api/settings", { method: "PATCH", body: patch });
        setSettingsSaveState("saved");
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
    $("settingsWorkspaceRole").textContent = currentWorkspace?.role ?? "Owner";
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
          const button = element("button", "btn sm primary", "Save workspace");
          button.type = "button";
          button.addEventListener("click", openAuthModal);
          return button;
        })()
      : makeBadge(user.email || "No email", "slate");
    settingsRow(card, "Email", user.email || "No email yet. Save this guest workspace to add one.", emailControl);

    const timezoneInput = makeTextInput(user.timezone || "Asia/Hong_Kong", "Time zone", () => {}, "Asia/Hong_Kong");
    timezoneInput.style.width = "240px";
    settingsRow(card, "Time zone", "Used for Today, reminders, digests, and recurrence.", timezoneInput);

    const save = element("button", "btn primary sm", "Save");
    save.type = "button";
    save.addEventListener("click", () => void saveAccount(nameInput, timezoneInput, save));
    const status = element("div", "inline");
    status.append(makeBadge(guest ? "Guest" : "Account", guest ? "amber" : "accent"), save);
    settingsRow(card, "Account status", `${guest ? "Guest, not yet claimable across devices." : "Verified account."} Two-factor is off.`, status);
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

    settingsRow(card, "Reading text", "A little more room for long notes and settings copy.", makeSegmented(settings.readingSize, [{ value: "default", label: "Default" }, { value: "large", label: "Large" }], "Reading text", (value) => updateSettings({ readingSize: value })));
    settingsRow(card, "Density", "Compact reduces row height in lists and settings without hiding information.", makeSegmented(settings.density, [{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }], "Density", (value) => updateSettings({ density: value })));
    settingsRow(card, "Motion", "System respects your OS. Reduced keeps state changes instant.", makeSegmented(settings.motion, [{ value: "system", label: "System" }, { value: "reduced", label: "Reduced motion" }, { value: "full", label: "Full motion" }], "Motion", (value) => updateSettings({ motion: value })));
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
    settingsRow(card, "Time zone", "Used for Today, reminders, digests, and recurrence.", timezoneInput);
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
    }
    renderSettings();
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("DOMContentLoaded", () => {
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
    $("newBoardButton").addEventListener("click", createBoard);
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
