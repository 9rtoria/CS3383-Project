"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CornerDownLeft,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Settings,
  SunMedium,
  Sunrise,
  Command,
} from "lucide-react";
import { Kbd } from "@/components/ui";
import { api } from "@/lib/client";
import type { SearchPayload, Workspace } from "@/lib/types";

export type AppView = "today" | "upcoming" | "calendar" | "search" | "archive" | "insights" | "board";

type Item = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  shortcut?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onNavigate: (view: AppView) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenTask: (taskId: string) => void;
  onQuickCapture: () => void;
  onShowShortcuts: () => void;
};

export function CommandPalette({ open, onClose, workspace, onNavigate, onOpenBoard, onOpenTask, onQuickCapture, onShowShortcuts }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchPayload | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 20);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setResults(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const current = ++seq.current;
      try {
        const payload = await api<SearchPayload>(`/api/search?q=${encodeURIComponent(query.trim())}&limit=6&status=open&workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id });
        if (current === seq.current) setResults(payload);
      } catch {
        if (current === seq.current) setResults(null);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query, workspace.id]);

  const commands = useMemo<Item[]>(() => {
    const navigation: Item[] = [
      { id: "go-today", label: "Go to Today", hint: "Your short list", group: "Go", icon: <SunMedium size={15} />, shortcut: "G T", run: () => { onNavigate("today"); onClose(); } },
      { id: "go-upcoming", label: "Go to Upcoming", hint: "The next two weeks", group: "Go", icon: <ArrowRight size={15} />, shortcut: "G U", run: () => { onNavigate("upcoming"); onClose(); } },
      { id: "go-calendar", label: "Go to Calendar", hint: "Month view", group: "Go", icon: <CalendarDays size={15} />, shortcut: "G C", run: () => { onNavigate("calendar"); onClose(); } },
      { id: "go-search", label: "Search everything", hint: "Titles, notes and labels", group: "Go", icon: <Search size={15} />, shortcut: "/", run: () => { onNavigate("search"); onClose(); } },
      { id: "go-archive", label: "Go to Archive", hint: "Completed and put away", group: "Go", icon: <Archive size={15} />, run: () => { onNavigate("archive"); onClose(); } },
      { id: "go-insights", label: "Open Timeline and Workload", hint: "The longer horizon", group: "Go", icon: <BarChart3 size={15} />, shortcut: "G I", run: () => { onNavigate("insights"); onClose(); } },
    ];
    const create: Item[] = [
      { id: "new-task", label: "Capture a new task", hint: "Opens quick capture", group: "Create", icon: <Plus size={15} />, shortcut: "C", run: () => { onQuickCapture(); onClose(); } },
      { id: "shortcuts", label: "Keyboard shortcuts", hint: "Learn the whole app", group: "Create", icon: <Command size={15} />, shortcut: "?", run: () => { onShowShortcuts(); onClose(); } },
      { id: "theme", label: "Toggle light and dark", hint: "Saved on this device", group: "Create", icon: typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? <SunMedium size={15} /> : <Moon size={15} />, run: () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem("drift-theme", next);
        window.dispatchEvent(new Event("drift-theme-change"));
        onClose();
      } },
      { id: "settings", label: "Open settings", hint: "Account, team and data", group: "Create", icon: <Settings size={15} />, run: () => { window.location.assign("/settings"); } },
    ];
    const boards: Item[] = workspace.boards.slice(0, 8).map((board) => ({
      id: `board-${board.id}`,
      label: board.name,
      hint: `${board.taskCount} tasks · ${board.visibility === "private" ? "private" : "shared"}`,
      group: "Boards",
      icon: <LayoutGrid size={15} />,
      run: () => { onOpenBoard(board.id); onClose(); },
    }));
    return [...navigation, ...create, ...boards];
  }, [onClose, onNavigate, onOpenBoard, onQuickCapture, onShowShortcuts, workspace.boards]);

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((item) => `${item.label} ${item.hint ?? ""} ${item.group}`.toLowerCase().includes(needle));
  }, [commands, query]);

  const tasks = results?.results ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of filteredCommands.slice(0, query ? 6 : 12)) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    if (tasks.length) {
      map.set("Tasks", tasks.map((task) => ({
        id: `task-${task.id}`,
        label: task.title,
        hint: `${task.board?.name ?? "Board"}${task.column ? ` · ${task.column.name}` : ""}`,
        group: "Tasks",
        icon: <CornerDownLeft size={15} />,
        run: () => { onOpenTask(task.id); onClose(); },
      })));
    }
    return [...map.entries()];
  }, [filteredCommands, onClose, onOpenTask, query, tasks]);

  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  useEffect(() => {
    setActive(0);
  }, [query, tasks.length]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ maxWidth: "100vw" }}
    >
      <div className="palette-card">
        <div className="palette-search">
          <Search size={18} aria-hidden style={{ color: "var(--muted)" }} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search or jump to…"
            aria-label="Search commands and tasks"
            aria-controls="palette-results"
            aria-activedescendant={flat[active] ? `palette-${flat[active]!.id}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(flat.length - 1, value + 1)); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
              else if (event.key === "Enter") { event.preventDefault(); flat[active]?.run(); }
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" id="palette-results" role="listbox" aria-label="Results">
          {grouped.map(([group, items]) => (
            <div key={group}>
              <div className="palette-group-label">{group}</div>
              {items.map((item) => {
                const index = flat.findIndex((entry) => entry.id === item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    id={`palette-${item.id}`}
                    role="option"
                    aria-selected={index === active}
                    className={`palette-item${index === active ? " active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => item.run()}
                  >
                    <span className="palette-icon">{item.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 550 }}>{item.label}</span>
                      {item.hint ? <span style={{ display: "block", color: "var(--faint)", fontSize: 10.5, marginTop: 1 }}>{item.hint}</span> : null}
                    </span>
                    {item.shortcut ? <span className="palette-shortcut">{item.shortcut}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 ? <div className="empty" style={{ border: 0 }}><h3>No matches</h3><p>Try a task title, a board name, or “calendar”.</p></div> : null}
        </div>
        <div className="palette-foot">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
          <span><Kbd>↵</Kbd> Open</span>
          <span><Kbd>Esc</Kbd> Close</span>
          <span style={{ marginLeft: "auto" }}>Drift command</span>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
