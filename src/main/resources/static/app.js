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
    authMode: "signin",
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
      setView("today");
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
    $("accountName").textContent = guest ? "Guest workspace" : (user.email || user.name || "Account");
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
    state.today = await request("/api/today");
    renderToday();
  }

  function setView(view) {
    state.view = view;
    $("todayView").classList.toggle("hidden", view !== "today");
    $("boardView").classList.toggle("hidden", view !== "board");
    document.querySelectorAll(".nav button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    if (view === "board") {
      $("viewEyebrow").textContent = "Board";
      $("viewTitle").textContent = currentBoard()?.name ?? "Board";
    } else {
      $("viewEyebrow").textContent = "Plan";
      $("viewTitle").textContent = "Today";
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
    for (const task of suggestions.slice(0, 12)) {
      const row = element("div", "today-row");
      const grow = element("div", "grow");
      grow.append(element("h3", "", task.title));
      const bits = [];
      if (task.reason) bits.push(task.reason);
      if (task.estimateMinutes) bits.push(`${task.estimateMinutes}m`);
      if (task.actualMinutes) bits.push(`${task.actualMinutes}m tracked`);
      if (task.startDate) bits.push(`starts ${task.startDate.slice(0, 10)}`);
      if (task.dueDate) bits.push(`due ${task.dueDate.slice(0, 10)}`);
      grow.append(element("p", "", bits.join(" · ")));

      const actions = element("div", "top-actions");
      const choose = element("button", "btn sm", task.accepted ? "Chosen" : "Choose");
      choose.type = "button";
      choose.disabled = Boolean(task.accepted);
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

  async function todayAction(action, taskId) {
    try {
      await request("/api/today", {
        method: "POST",
        body: { action, taskId },
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

  document.addEventListener("DOMContentLoaded", () => {
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
