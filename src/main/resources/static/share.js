(() => {
  "use strict";

  const content = document.getElementById("shareContent");
  const statusBadge = document.getElementById("shareStatusBadge");
  const token = decodeURIComponent((window.location.pathname.split("/").filter(Boolean).pop() || ""));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function initials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDue(dueDate, allDay) {
    if (!dueDate) return "";
    const day = String(dueDate).slice(0, 10);
    const today = localDateKey();
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = localDateKey(tomorrowDate);
    let label;
    if (day === today) label = "Today";
    else if (day === tomorrow) label = "Tomorrow";
    else {
      const parsed = new Date(`${day}T12:00:00`);
      label = Number.isNaN(parsed.getTime())
        ? day
        : new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(parsed);
    }
    if (!allDay && String(dueDate).includes("T")) {
      const time = String(dueDate).slice(11, 16);
      if (time) label += ` · ${time}`;
    }
    return label;
  }

  function formatUpdated(value) {
    if (!value) return "recently";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "recently";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(parsed);
  }

  function priorityTone(priority) {
    if (priority === "high" || priority === "urgent") return "priority-high";
    if (priority === "medium") return "priority-medium";
    if (priority === "low") return "priority-low";
    return "";
  }

  function renderLoading() {
    content.replaceChildren();
    const state = element("div", "share-state");
    state.append(element("span", "share-spinner"));
    state.append(element("p", "", "Opening shared board…"));
    content.append(state);
  }

  function renderError(message) {
    statusBadge.textContent = "Private by default";
    content.replaceChildren();
    const state = element("div", "share-state");
    const mark = element("span", "share-state-mark", "○");
    const title = element("h2", "", "This board is not shared");
    const copy = element("p", "", message || "The link may have been turned off. Ask the owner for a new share link.");
    const link = element("a", "btn primary", "Open Drift");
    link.href = "/";
    state.append(mark, title, copy, link);
    content.append(state);
  }

  function renderBoard(board) {
    content.replaceChildren();
    const tasks = board.tasks || [];
    const columns = board.columns || [];
    const done = tasks.filter((task) => task.completed).length;

    const head = element("div", "share-head");
    const copy = element("div", "share-head-copy");
    copy.append(element("div", "share-eyebrow", board.workspaceName || "Shared workspace"));
    copy.append(element("h1", "share-title", board.name || "Shared board"));
    copy.append(element("p", "share-subtitle",
      board.description || "A quiet, read-only view of this board."));
    const stats = element("div", "share-stats");
    stats.append(element("span", "badge slate", `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`));
    stats.append(element("span", "badge accent", `${done} done`));
    stats.append(element("span", "badge slate", `Updated ${formatUpdated(board.updatedAt)}`));
    head.append(copy, stats);

    const canvas = element("div", "share-canvas");
    canvas.setAttribute("role", "list");
    canvas.setAttribute("aria-label", `${board.name || "Shared board"} columns`);

    for (const column of columns) {
      const columnTasks = tasks.filter((task) => task.columnId === column.id);
      const section = element("section", "share-column");
      section.setAttribute("role", "listitem");
      section.setAttribute("aria-label", column.name);
      const columnHead = element("div", "share-column-head");
      const name = element("span", "share-column-name");
      name.append(element("span", `share-dot${column.isDone ? " done" : ""}`));
      name.append(element("span", "", column.name));
      columnHead.append(name, element("span", "share-column-count", String(columnTasks.length)));
      section.append(columnHead);

      const list = element("div", "share-tasks");
      for (const task of columnTasks) {
        const card = element("article", `share-task${task.completed ? " completed" : ""}`);
        const titleRow = element("div", "share-task-title-row");
        titleRow.append(element("h3", "share-task-title", task.title));
        if (task.priority && task.priority !== "none") {
          titleRow.append(element("span", `pill ${priorityTone(task.priority)}`, task.priority));
        }
        card.append(titleRow);
        if (task.description) {
          card.append(element("p", "share-task-desc", String(task.description).slice(0, 260)));
        }
        if ((task.labels || []).length) {
          const labels = element("div", "share-labels");
          for (const label of (task.labels || []).slice(0, 3)) {
            labels.append(element("span", `pill label-${label.color || "slate"}`, label.name));
          }
          card.append(labels);
        }
        const meta = element("div", "share-task-meta");
        if (task.dueDate) meta.append(element("span", "share-chip", formatDue(task.dueDate, task.dueAllDay)));
        if ((task.subtasks || []).length) {
          const completed = task.subtasks.filter((subtask) => subtask.completed).length;
          meta.append(element("span", "share-chip", `${completed}/${task.subtasks.length}`));
        }
        meta.append(element("span", "share-task-spacer"));
        if (task.assignee) {
          const avatar = element("span", "share-avatar", initials(task.assignee.name));
          avatar.title = task.assignee.name || "";
          meta.append(avatar);
        }
        card.append(meta);
        list.append(card);
      }
      if (!columnTasks.length) list.append(element("p", "share-empty", "Nothing here."));
      section.append(list);
      canvas.append(section);
    }

    const footer = element("footer", "share-footer");
    footer.append(element("span", "", `Shared read-only by ${board.workspaceName || "the workspace"}. No email addresses or comments are exposed.`));
    const cta = element("a", "", "Make your own calm board →");
    cta.href = "/";
    footer.append(cta);

    content.append(head, canvas, footer);
  }

  async function load() {
    renderLoading();
    try {
      const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
        cache: "no-store",
        credentials: "omit",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "This board is not available.");
      }
      renderBoard(payload.board);
    } catch (error) {
      renderError(error instanceof Error ? error.message : "This board is not available.");
    }
  }

  load();
})();
