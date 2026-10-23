"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  Command,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SunMedium,
  UserRound,
  WifiOff,
} from "lucide-react";
import { Avatar, EmptyState, LoadingButton, Menu, MenuItem, Modal } from "@/components/ui";
import { QuickCapture } from "@/components/quick-capture";
import { CommandPalette, type AppView } from "@/components/command-palette";
import { BoardView } from "@/components/board-view";
import { TodayView } from "@/components/today-view";
import { CalendarView, UpcomingView } from "@/components/time-views";
import { ArchiveView, SearchView } from "@/components/search-archive";
import { TaskDrawer } from "@/components/task-drawer";
import { InsightsView } from "@/components/insights-view";
import { useToast } from "@/components/toast";
import { api, ApiClientError, formatApiError, newIdempotencyKey } from "@/lib/client";
import {
  cacheBootstrap,
  listQueuedWrites,
  readCachedBootstrap,
  removeQueuedWrite,
  replayOfflineQueue,
  subscribeOfflineQueue,
  updateQueuedWrite,
  type QueuedWrite,
} from "@/lib/offline";
import { formatDate, roleLabel } from "@/lib/format";
import type { Bootstrap, Task, Workspace } from "@/lib/types";

const VIEWS: AppView[] = ["today", "upcoming", "calendar", "search", "archive", "insights", "board"];
const WORKSPACE_KEY = "drift-workspace";
const VIEW_TITLES: Record<AppView, string> = {
  today: "Today",
  upcoming: "Upcoming",
  calendar: "Calendar",
  search: "Search",
  archive: "Archive",
  insights: "Insights",
  board: "Board",
};

function readInitialParams(): { view: AppView | null; boardId: string | null; taskId: string | null } {
  if (typeof window === "undefined") return { view: null, boardId: null, taskId: null };
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  return {
    view: viewParam && VIEWS.includes(viewParam as AppView) ? (viewParam as AppView) : null,
    boardId: params.get("board"),
    taskId: params.get("task"),
  };
}

export function AppRoot() {
  const toast = useToast();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [view, setView] = useState<AppView>("today");
  const [boardId, setBoardId] = useState<string>("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [singleKeyShortcuts, setSingleKeyShortcuts] = useState(true);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [offline, setOffline] = useState(false);
  const [booting, setBooting] = useState(true);
  const [queuedWrites, setQueuedWrites] = useState<QueuedWrite[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const initialized = useRef(false);
  const timezoneSynced = useRef(false);
  const gPending = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);

  const refreshBootstrap = useCallback(async (silent = true) => {
    try {
      const payload = await api<Bootstrap>("/api/bootstrap");
      setData(payload);
      cacheBootstrap(payload);
      setError("");
      return payload;
    } catch (refreshError) {
      if (!silent) setError(formatApiError(refreshError));
      return null;
    }
  }, []);

  const syncQueue = useCallback(async (announce = false) => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await replayOfflineQueue();
      setQueuedWrites(listQueuedWrites());
      if (result.offline) setOffline(true);
      if (result.synced > 0) {
        setRefreshKey((value) => value + 1);
        await refreshBootstrap();
        if (announce) toast.success(`${result.synced} saved change${result.synced === 1 ? "" : "s"} synced.`);
      }
      if (result.failed > 0 && announce) {
        toast.error(`${result.failed} change${result.failed === 1 ? "" : "s"} need attention. Open the offline queue to review.`);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setQueuedWrites(listQueuedWrites());
    }
  }, [refreshBootstrap, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await api<Bootstrap>("/api/bootstrap");
        cacheBootstrap(payload);
        if (!cancelled) setData(payload);
      } catch (loadError) {
        const cached = readCachedBootstrap();
        if (!cancelled && cached && loadError instanceof ApiClientError && loadError.code === "NETWORK_ERROR") {
          setData(cached);
          setOffline(true);
        } else if (!cancelled) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!cancelled) setBooting(false);
        if (!cancelled && navigator.onLine) void syncQueue();
      }
    })();
    const onOnline = () => { setOffline(false); void refreshBootstrap(); void syncQueue(); };
    const onOffline = () => setOffline(true);
    const onNetworkError = () => setOffline(true);
    setOffline(!navigator.onLine);
    setQueuedWrites(listQueuedWrites());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("drift-network-error", onNetworkError);
    const unsubscribe = subscribeOfflineQueue(() => setQueuedWrites(listQueuedWrites()));
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("drift-network-error", onNetworkError);
    };
  }, [refreshBootstrap, syncQueue]);

  useEffect(() => {
    if (!data || timezoneSynced.current) return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === data.user.timezone) return;
    // Guests start with UTC because the server cannot infer a browser timezone.
    // Adopt the browser's zone once so "tomorrow 2pm" means the user's 2pm.
    if (data.user.timezone !== "UTC") {
      timezoneSynced.current = true;
      return;
    }
    timezoneSynced.current = true;
    void api<{ user: { timezone: string } }>("/api/settings", { method: "PATCH", body: { timezone: detected } })
      .then(() => {
        setData((current) => {
          if (!current) return current;
          const next = { ...current, user: { ...current.user, timezone: detected } };
          cacheBootstrap(next);
          return next;
        });
      })
      .catch(() => undefined);
  }, [data]);

  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    const params = readInitialParams();
    const saved = localStorage.getItem(WORKSPACE_KEY);
    const nextWorkspace = data.workspaces.find((workspace) => workspace.id === saved) ?? data.workspaces[0];
    if (nextWorkspace) {
      setWorkspaceId(nextWorkspace.id);
      if (params.boardId && nextWorkspace.boards.some((board) => board.id === params.boardId)) {
        setBoardId(params.boardId);
        if (!params.view) setView("board");
      } else if (nextWorkspace.boards[0]) {
        setBoardId(nextWorkspace.boards[0].id);
      }
      if (params.view) setView(params.view);
      if (params.taskId) setTaskId(params.taskId);
    }
  }, [data]);

  useEffect(() => {
    if (!data || !workspaceId) return;
    const workspace = data.workspaces.find((item) => item.id === workspaceId);
    if (workspace && !workspace.boards.some((board) => board.id === boardId) && workspace.boards[0]) {
      setBoardId(workspace.boards[0].id);
    }
  }, [boardId, data, workspaceId]);

  useEffect(() => {
    if (!initialized.current) return;
    const params = new URLSearchParams();
    if (view !== "today") params.set("view", view);
    if (view === "board" || boardId) params.set("board", boardId);
    if (taskId) params.set("task", taskId);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }, [boardId, taskId, view]);

  const workspace = useMemo(() => data?.workspaces.find((item) => item.id === workspaceId) ?? data?.workspaces[0], [data, workspaceId]);
  const boardSummary = workspace?.boards.find((board) => board.id === boardId) ?? workspace?.boards[0];

  const refreshAll = useCallback(() => {
    setRefreshKey((value) => value + 1);
    void refreshBootstrap();
  }, [refreshBootstrap]);

  const navigate = useCallback((next: AppView) => {
    if (next === "board" && !boardSummary && workspace?.boards[0]) setBoardId(workspace.boards[0].id);
    setView(next);
  }, [boardSummary, workspace]);

  const openBoard = useCallback((nextBoardId: string) => {
    setBoardId(nextBoardId);
    setView("board");
    setTaskId(null);
  }, []);

  const switchWorkspace = useCallback((nextId: string) => {
    const next = data?.workspaces.find((item) => item.id === nextId);
    setWorkspaceId(nextId);
    localStorage.setItem(WORKSPACE_KEY, nextId);
    setView(next?.boards.length ? "today" : "today");
    setBoardId(next?.boards[0]?.id ?? "");
    setTaskId(null);
    setRefreshKey((value) => value + 1);
  }, [data?.workspaces]);

  useEffect(() => {
    setSingleKeyShortcuts(window.localStorage.getItem("drift-single-key-shortcuts") !== "off");
  }, []);

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (isTyping(event.target)) return;
      if (!singleKeyShortcuts) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setCaptureOpen(true);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        setView("search");
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "g") {
        gPending.current = true;
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(() => { gPending.current = false; }, 1200);
        return;
      }
      if (gPending.current) {
        const key = event.key.toLowerCase();
        const map: Record<string, AppView> = { t: "today", u: "upcoming", c: "calendar", a: "archive", s: "search", i: "insights", b: "board" };
        if (map[key]) {
          event.preventDefault();
          setView(map[key]!);
          gPending.current = false;
        }
      }
      if (event.key.toLowerCase() === "n" && event.shiftKey) {
        event.preventDefault();
        setNewBoardOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [singleKeyShortcuts]);

  async function signOut() {
    try {
      await api("/api/auth/signout", { method: "DELETE" });
    } catch {
      // Session is cleared client-side even if the revoke call races a network issue.
    }
    window.location.assign("/auth");
  }

  if (booting && !data) {
    return (
      <div className="app-shell" aria-busy="true" aria-label="Loading Drift">
        <aside className="sidebar">
          <div className="brand-row"><span className="brand"><span className="brand-mark">≈</span> Drift</span></div>
          <div className="skeleton" style={{ height: 36, margin: "0 8px 18px" }} />
          {[0, 1, 2, 3, 4].map((item) => <div className="skeleton" key={item} style={{ height: 38, margin: "3px 8px" }} />)}
        </aside>
        <div className="main-shell">
          <div className="topbar"><div className="skeleton" style={{ width: 180, height: 18 }} /></div>
          <div className="content"><div className="skeleton" style={{ height: 230, borderRadius: 18 }} /></div>
        </div>
      </div>
    );
  }

  if (!data || !workspace) {
    return (
      <main id="main" className="content narrow" style={{ paddingTop: 70 }}>
        <div className="card card-pad" style={{ textAlign: "center" }}>
          <h1 className="page-title" style={{ fontSize: 32 }}>Drift couldn’t start</h1>
          <p className="page-subtitle" style={{ margin: "10px auto 18px" }}>{error || "No workspace is available for this session."}</p>
          <div className="inline" style={{ justifyContent: "center" }}>
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn" href="/auth">Sign in</a>
          </div>
          {error ? <p className="field-error" style={{ marginTop: 14 }}>{error}</p> : null}
        </div>
      </main>
    );
  }

  const unread = data.unreadCount;
  const failedWrites = queuedWrites.filter((write) => write.status === "failed");
  const pendingWrites = queuedWrites.filter((write) => write.status !== "failed");
  const currentTitle = view === "board" ? boardSummary?.name ?? "Board" : VIEW_TITLES[view];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-row">
          <Link className="brand" href="/" aria-label="Drift home">
            <span className="brand-mark" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h12a5 5 0 0 1 0 10H9" /><circle cx="5" cy="18" r="1.6" fill="currentColor" stroke="none" /></svg>
            </span>
            Drift
          </Link>
          <Menu
            trigger={<Plus size={15} />}
            triggerLabel="New board"
            triggerClassName="icon-btn sm"
          >
            {(close) => (
              <>
                <MenuItem icon={<LayoutGrid size={14} />} onClick={() => { close(); setNewBoardOpen(true); }}>New board</MenuItem>
                <MenuItem icon={<Sparkles size={14} />} onClick={() => { close(); setCaptureOpen(true); }}>Quick capture</MenuItem>
                <MenuItem icon={<Settings size={14} />} onClick={() => { close(); window.location.assign("/settings"); }}>Workspace settings</MenuItem>
              </>
            )}
          </Menu>
        </div>

        <div className="workspace-switcher">
          <Menu
            trigger={
              <>
                <span className="workspace-avatar" aria-hidden>{workspace.name.slice(0, 2).toUpperCase()}</span>
                <span className="workspace-copy"><strong>{workspace.name}</strong><span>{workspace.type === "personal" ? "Personal workspace" : workspace.type === "team" ? "Team workspace" : "Organization"}</span></span>
                <ChevronDown size={14} aria-hidden style={{ color: "var(--faint)" }} />
              </>
            }
            triggerClassName="workspace-button"
            align="left"
            width={252}
          >
            {(close) => (
              <>
                <div className="menu-label">Workspaces</div>
                {data.workspaces.map((item) => (
                  <MenuItem key={item.id} icon={<span className="workspace-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{item.name.slice(0, 2).toUpperCase()}</span>} active={item.id === workspace.id} onClick={() => { close(); switchWorkspace(item.id); }}>
                    <span style={{ display: "block" }}>{item.name}</span>
                    <span style={{ display: "block", fontSize: 10, color: "var(--faint)" }}>{roleLabel(item.role)} · {item.memberCount} member{item.memberCount === 1 ? "" : "s"}</span>
                  </MenuItem>
                ))}
                <div className="menu-sep" />
                <MenuItem icon={<Plus size={14} />} onClick={() => { close(); window.location.assign("/settings#workspace"); }}>Create a team workspace</MenuItem>
              </>
            )}
          </Menu>
        </div>

        <nav className="nav-section" aria-label="Views">
          <div className="nav-label">Plan</div>
          <button type="button" className={`nav-item${view === "today" ? " active" : ""}`} onClick={() => navigate("today")} aria-current={view === "today" ? "page" : undefined}>
            <SunMedium size={16} aria-hidden /> Today <span className="nav-kbd">G T</span>
          </button>
          <button type="button" className={`nav-item${view === "upcoming" ? " active" : ""}`} onClick={() => navigate("upcoming")} aria-current={view === "upcoming" ? "page" : undefined}>
            <CalendarDays size={16} aria-hidden /> Upcoming <span className="nav-kbd">G U</span>
          </button>
          <button type="button" className={`nav-item${view === "calendar" ? " active" : ""}`} onClick={() => navigate("calendar")} aria-current={view === "calendar" ? "page" : undefined}>
            <CalendarDays size={16} aria-hidden /> Calendar <span className="nav-kbd">G C</span>
          </button>
          <button type="button" className={`nav-item${view === "search" ? " active" : ""}`} onClick={() => navigate("search")} aria-current={view === "search" ? "page" : undefined}>
            <Search size={16} aria-hidden /> Search <span className="nav-kbd">/</span>
          </button>
          <button type="button" className={`nav-item${view === "archive" ? " active" : ""}`} onClick={() => navigate("archive")} aria-current={view === "archive" ? "page" : undefined}>
            <Archive size={16} aria-hidden /> Archive
          </button>
          <button type="button" className={`nav-item${view === "insights" ? " active" : ""}`} onClick={() => navigate("insights")} aria-current={view === "insights" ? "page" : undefined}>
            <BarChart3 size={16} aria-hidden /> Insights <span className="nav-kbd">G I</span>
          </button>
        </nav>

        <nav className="nav-section" aria-label="Boards" style={{ marginTop: 4, minHeight: 0, overflowY: "auto" }}>
          <div className="nav-label" style={{ display: "flex", alignItems: "center" }}>
            <span style={{ flex: 1 }}>Boards</span>
            <button type="button" className="icon-btn sm" aria-label="New board" onClick={() => setNewBoardOpen(true)} style={{ width: 22, height: 22, minWidth: 22 }}><Plus size={12} /></button>
          </div>
          {workspace.boards.map((board) => (
            <button type="button" key={board.id} className={`nav-item${view === "board" && board.id === boardSummary?.id ? " active" : ""}`} onClick={() => openBoard(board.id)}>
              <LayoutGrid size={16} aria-hidden />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.name}</span>
              <span className="nav-count">{board.taskCount}</span>
            </button>
          ))}
          {workspace.boards.length === 0 ? <p className="field-hint" style={{ padding: "4px 10px" }}>No active boards. Create one to begin.</p> : null}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-foot">
          {data.user.isGuest ? (
            <a className="auth-guest-banner" href="/auth?claim=1" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={14} aria-hidden />
              <span style={{ flex: 1 }}>Save this workspace to an account</span>
            </a>
          ) : null}
          <button type="button" className="user-button" onClick={() => window.location.assign("/settings")}>
            <Avatar name={data.user.name} src={data.user.avatarUrl} size="sm" />
            <span className="user-copy"><strong>{data.user.name}</strong><span>{data.user.isGuest ? "Guest session" : data.user.email}</span></span>
            <Settings size={14} aria-hidden style={{ color: "var(--faint)" }} />
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <span className="hide-mobile" style={{ color: "var(--faint)" }}>{workspace.name}</span>
            <span className="hide-mobile" aria-hidden>/</span>
            <strong>{currentTitle}</strong>
            {workspace.mfaLocked ? <span className="badge amber" title="This workspace requires MFA">MFA locked</span> : null}
          </div>
          <div className="topbar-actions">
            <button type="button" className="btn soft sm hide-small" onClick={() => setCaptureOpen(true)}><Plus size={13} aria-hidden /> Capture <span className="kbd" style={{ background: "transparent", borderColor: "currentColor", color: "inherit", opacity: 0.6 }}>C</span></button>
            <button type="button" className="icon-btn" aria-label="Command palette" title="Command palette (Ctrl K)" onClick={() => setPaletteOpen(true)}><Command size={17} /></button>
            <button type="button" className="icon-btn" aria-label="Search" onClick={() => navigate("search")}><Search size={17} /></button>
            <Menu
              trigger={<><Bell size={17} />{unread ? <span className="notification-dot" aria-hidden /> : null}</>}
              triggerLabel={`Notifications${unread ? `, ${unread} unread` : ""}`}
            >
              {(close) => (
                <div style={{ minWidth: 295 }}>
                  <div className="menu-label" style={{ display: "flex", alignItems: "center" }}><span style={{ flex: 1 }}>Notifications</span>{unread ? <button type="button" className="btn ghost sm" style={{ padding: "2px 5px", minHeight: 22 }} onClick={async () => { try { await api("/api/notifications", { method: "PATCH", workspaceId: workspace.id, body: { all: true, read: true } }); await refreshBootstrap(); toast.success("All caught up."); } catch (notifyError) { toast.error(formatApiError(notifyError)); } }}><CheckCheck size={12} /> Mark read</button> : null}</div>
                  <div style={{ maxHeight: 360, overflowY: "auto" }}>
                    {data.notifications.length ? data.notifications.map((notification) => (
                      <button key={notification.id} type="button" className={`menu-item${notification.readAt ? "" : " active"}`} onClick={async () => {
                        close();
                        if (!notification.readAt) {
                          await api("/api/notifications", { method: "PATCH", workspaceId: workspace.id, body: { id: notification.id, read: true } }).catch(() => undefined);
                          void refreshBootstrap();
                        }
                        if (notification.link) {
                          const params = new URLSearchParams(notification.link.split("?")[1] ?? "");
                          if (params.get("task")) setTaskId(params.get("task"));
                        }
                      }}>
                        <span className={`side-dot${notification.readAt ? "" : " today"}`} aria-hidden />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontWeight: 600 }}>{notification.title}</span>
                          {notification.body ? <span style={{ display: "block", fontSize: 10.5, color: "var(--faint)", whiteSpace: "normal" }}>{notification.body}</span> : null}
                          <span style={{ display: "block", fontSize: 9.5, color: "var(--faint)", marginTop: 2 }}>{formatDate(notification.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        </span>
                      </button>
                    )) : <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>No notifications. A calm inbox.</div>}
                  </div>
                  <div className="menu-sep" />
                  <MenuItem icon={<Bell size={13} />} onClick={() => { close(); window.location.assign("/settings#notifications"); }}>Notification settings</MenuItem>
                </div>
              )}
            </Menu>
            <button type="button" className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}><HelpCircle size={17} /></button>
            <Menu trigger={typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? <SunMedium size={17} /> : <Moon size={17} />} triggerLabel="Theme and account">
              {(close) => (
                <>
                  <div className="menu-label">{data.user.name}</div>
                  <MenuItem icon={<UserRound size={14} />} onClick={() => { close(); window.location.assign("/settings"); }}>Account settings</MenuItem>
                  <MenuItem icon={<Settings size={14} />} onClick={() => { close(); window.location.assign("/settings#workspace"); }}>Workspace settings</MenuItem>
                  <MenuItem icon={typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? <SunMedium size={14} /> : <Moon size={14} />} onClick={() => {
                    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
                    localStorage.setItem("drift-theme", next);
                    window.dispatchEvent(new Event("drift-theme-change"));
                    close();
                  }}>Switch to {typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "light" : "dark"} mode</MenuItem>
                  <div className="menu-sep" />
                  <MenuItem icon={<LogOut size={14} />} danger onClick={() => { close(); void signOut(); }}>Sign out</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </header>

        {offline || queuedWrites.length ? (
          <div style={{ background: "var(--warning-soft)", color: "var(--warning)", padding: "8px 28px", fontSize: 11.5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <WifiOff size={13} aria-hidden />
            <span style={{ flex: 1, minWidth: 200 }}>
              {offline ? "You are offline. Captures and moves are saved on this device." : "Back online."}
              {pendingWrites.length ? ` ${pendingWrites.length} change${pendingWrites.length === 1 ? "" : "s"} waiting to sync.` : ""}
              {failedWrites.length ? ` ${failedWrites.length} change${failedWrites.length === 1 ? "" : "s"} could not sync.` : ""}
            </span>
            <button type="button" className="btn sm" onClick={() => setQueueOpen(true)}>Review queue</button>
            {!offline && pendingWrites.length ? (
              <button type="button" className="btn sm primary" disabled={syncing} onClick={() => void syncQueue(true)}>
                <RefreshCw size={12} className={syncing ? "spin" : undefined} aria-hidden /> {syncing ? "Syncing…" : "Retry now"}
              </button>
            ) : null}
          </div>
        ) : null}

        <main id="main" className={view === "board" ? "content board-content" : "content"}>
          {data.user.isGuest && view === "today" ? (
            <div className="auth-guest-banner" style={{ maxWidth: 900 }}>
              <Sparkles size={15} aria-hidden />
              <span style={{ flex: 1 }}>You&apos;re in a guest workspace — no signup needed. Your tasks are saved in this session. <strong>Save it to an account</strong> whenever you want to keep it across devices.</span>
              <a className="btn sm" href="/auth?claim=1">Save workspace</a>
            </div>
          ) : null}

          {workspace.mfaLocked ? (
            <EmptyState icon={<UserRound size={20} />} title="Multi-factor authentication required" description={`${workspace.name} requires MFA. Enable it in account settings, then reload.`} action={<a className="btn primary" href="/settings#security">Open security settings</a>} />
          ) : view === "today" ? (
            <TodayView workspace={workspace} refreshKey={refreshKey} userName={data.user.name} onOpenTask={setTaskId} onQuickCapture={() => setCaptureOpen(true)} onNavigate={(next) => navigate(next)} onChanged={refreshAll} />
          ) : view === "upcoming" ? (
            <UpcomingView workspace={workspace} refreshKey={refreshKey} onOpenTask={setTaskId} onQuickCapture={() => setCaptureOpen(true)} />
          ) : view === "calendar" ? (
            <CalendarView workspace={workspace} refreshKey={refreshKey} onOpenTask={setTaskId} onQuickCapture={() => setCaptureOpen(true)} />
          ) : view === "search" ? (
            <SearchView workspace={workspace} refreshKey={refreshKey} onOpenTask={setTaskId} onNavigateBoard={openBoard} />
          ) : view === "archive" ? (
            <ArchiveView workspace={workspace} refreshKey={refreshKey} onOpenTask={setTaskId} onChanged={refreshAll} />
          ) : view === "insights" ? (
            <InsightsView workspace={workspace} refreshKey={refreshKey} timeZone={data.user.timezone} onOpenTask={setTaskId} onQuickCapture={() => setCaptureOpen(true)} />
          ) : boardSummary ? (
            <BoardView key={boardSummary.id} workspace={workspace} boardId={boardSummary.id} refreshKey={refreshKey} timeZone={data.user.timezone} currentUserId={data.user.id} onOpenTask={setTaskId} onQuickCapture={() => setCaptureOpen(true)} onNewBoard={() => setNewBoardOpen(true)} onChanged={refreshAll} onOpenBoard={openBoard} />
          ) : (
            <EmptyState icon={<LayoutGrid size={20} />} title="No board yet" description="Create a board to start moving work." action={<button type="button" className="btn primary" onClick={() => setNewBoardOpen(true)}><Plus size={14} /> New board</button>} />
          )}
        </main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          <button type="button" className={`nav-item${view === "today" ? " active" : ""}`} onClick={() => navigate("today")}><SunMedium size={18} aria-hidden /> Today</button>
          <button type="button" className={`nav-item${view === "upcoming" ? " active" : ""}`} onClick={() => navigate("upcoming")}><CalendarDays size={18} aria-hidden /> Upcoming</button>
          <button type="button" className={`nav-item${view === "board" ? " active" : ""}`} onClick={() => navigate("board")}><LayoutGrid size={18} aria-hidden /> Board</button>
          <button type="button" className={`nav-item${view === "search" ? " active" : ""}`} onClick={() => navigate("search")}><Search size={18} aria-hidden /> Search</button>
          <button type="button" className="nav-item" onClick={() => window.location.assign("/settings")}><Settings size={18} aria-hidden /> Settings</button>
        </nav>
      </div>

      <QuickCapture
        open={captureOpen}
        workspace={workspace}
        timeZone={data.user.timezone}
        defaultBoardId={view === "board" ? boardSummary?.id : undefined}
        onClose={() => setCaptureOpen(false)}
        onCreated={async (task: Task) => {
          setRefreshKey((value) => value + 1);
          await refreshBootstrap();
          if (task.id) toast.success("Task captured.");
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        workspace={workspace}
        onNavigate={navigate}
        onOpenBoard={openBoard}
        onOpenTask={setTaskId}
        onQuickCapture={() => setCaptureOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      <TaskDrawer taskId={taskId} workspace={workspace} onClose={() => setTaskId(null)} onChanged={refreshAll} onOpenTask={setTaskId} />

      <NewBoardModal
        open={newBoardOpen}
        onClose={() => setNewBoardOpen(false)}
        data={data}
        workspace={workspace}
        onCreated={async (id) => { setNewBoardOpen(false); await refreshBootstrap(); openBoard(id); }}
      />

      <Modal
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="Offline queue"
        eyebrow={`${pendingWrites.length} pending · ${failedWrites.length} failed`}
        width={620}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setQueueOpen(false)}>Close</button>
            <button type="button" className="btn primary" disabled={syncing || !pendingWrites.length || offline} onClick={() => void syncQueue(true)}>
              <RefreshCw size={13} className={syncing ? "spin" : undefined} aria-hidden /> {syncing ? "Syncing…" : "Sync now"}
            </button>
          </>
        }
      >
        {queuedWrites.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            <p className="field-hint" style={{ marginTop: 0 }}>Changes are replayed in the order you made them. A failed item is kept here so nothing is silently lost.</p>
            {queuedWrites.map((write) => (
              <div key={write.id} className="settings-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={`badge ${write.status === "failed" ? "rose" : "slate"}`}>{write.status === "failed" ? "Failed" : "Pending"}</span>
                      <strong style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{write.label}</strong>
                    </div>
                    <div className="field-hint" style={{ marginTop: 4 }}>
                      {write.kind.replace(".", " · ")} · {new Date(write.createdAt).toLocaleString()}
                      {write.error ? ` — ${write.error}` : ""}
                    </div>
                  </div>
                  {write.status === "failed" ? (
                    <button type="button" className="btn ghost sm" onClick={() => { updateQueuedWrite(write.id, { status: "pending", error: undefined }); void syncQueue(true); }}>Retry</button>
                  ) : null}
                  <button type="button" className="btn ghost sm" onClick={() => removeQueuedWrite(write.id)} aria-label={`Discard ${write.label}`}>Discard</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="field-hint" style={{ margin: 0 }}>Everything is synced. Captures and moves you make offline will appear here until they reach the server.</p>
        )}
      </Modal>

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        singleKeyShortcuts={singleKeyShortcuts}
        onToggleSingleKey={(enabled) => {
          setSingleKeyShortcuts(enabled);
          window.localStorage.setItem("drift-single-key-shortcuts", enabled ? "on" : "off");
        }}
      />
    </div>
  );
}

function NewBoardModal({ open, onClose, data, workspace, onCreated }: {
  open: boolean;
  onClose: () => void;
  data: Bootstrap;
  workspace: Workspace;
  onCreated: (id: string) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("blank");
  const [visibility, setVisibility] = useState("workspace");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setTemplate("blank");
    setVisibility("workspace");
    setError("");
  }, [open]);

  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ board: { id: string } }>("/api/boards", {
        method: "POST",
        workspaceId: workspace.id,
        idempotencyKey: newIdempotencyKey("board"),
        body: { workspaceId: workspace.id, name: name.trim(), description, template, visibility },
      });
      toast.success("Board created.");
      await onCreated(result.board.id);
    } catch (createError) {
      setError(formatApiError(createError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="A new board" eyebrow={workspace.name} width={560}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><LoadingButton loading={saving} onClick={() => void create()}>Create board</LoadingButton></>}>
      <div className="form-grid">
        <label className="field"><span>Name</span><input className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Home, Launch, Writing" maxLength={120} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} /></label>
        <label className="field"><span>Description <span className="field-hint">(optional)</span></span><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs here?" maxLength={200} /></label>
        <div className="field">
          <span className="label">Starting point</span>
          <div style={{ display: "grid", gap: 7 }}>
            {data.templates.map((item) => (
              <label key={item.id} className={`settings-row${template === item.id ? "" : ""}`} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px", cursor: "pointer", background: template === item.id ? "var(--accent-softer)" : "var(--surface)" }}>
                <input type="radio" name="template" value={item.id} checked={template === item.id} onChange={() => setTemplate(item.id)} />
                <span className="settings-copy" style={{ marginLeft: 4 }}><strong>{item.name}</strong><span>{item.description}</span></span>
                <span className="badge slate">{item.columns.length} columns</span>
              </label>
            ))}
          </div>
        </div>
        <label className="field"><span>Visibility</span><select className="select" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="workspace">Everyone in {workspace.name}</option><option value="private">Private to me</option></select></label>
        {error ? <InlineErrorText>{error}</InlineErrorText> : null}
      </div>
    </Modal>
  );
}

function InlineErrorText({ children }: { children: string }) {
  return <p className="field-error" role="alert">{children}</p>;
}

function ShortcutsDialog({ open, onClose, singleKeyShortcuts, onToggleSingleKey }: { open: boolean; onClose: () => void; singleKeyShortcuts: boolean; onToggleSingleKey: (enabled: boolean) => void }) {
  const rows = [
    ["Capture a task", "C"],
    ["Command palette", "Ctrl / ⌘ K"],
    ["Search everything", "/"],
    ["Go to Today", "G then T"],
    ["Go to Upcoming", "G then U"],
    ["Go to Calendar", "G then C"],
    ["Go to Archive", "G then A"],
    ["Go to Insights", "G then I"],
    ["Go to Search", "G then S"],
    ["Go to current board", "G then B"],
    ["New board", "Shift N"],
    ["Move card between columns", "Alt + ← / →"],
    ["Reorder card in column", "Alt + ↑ / ↓"],
    ["Show shortcuts", "?"],
    ["Close a dialog", "Esc"],
    ["Save quick capture or comment", "Ctrl / ⌘ Enter"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" eyebrow="Stay in flow" width={560} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
      <div className="settings-card">
        {rows.map(([label, key]) => (
          <div className="settings-row" key={label}><div className="settings-copy"><strong>{label}</strong></div><div className="settings-control">{key.split(" ").map((part, index) => part === "then" ? <span key={index} style={{ margin: "0 3px", color: "var(--faint)", fontSize: 10 }}>then</span> : <span className="kbd" key={index} style={{ marginLeft: 3 }}>{part}</span>)}</div></div>
        ))}
        <label className="settings-row" style={{ cursor: "pointer" }}>
          <div className="settings-copy">
            <strong>Single-key shortcuts</strong>
            <p className="field-hint">C, /, ? and G sequences. Turn off if they conflict with assistive technology or another tool.</p>
          </div>
          <div className="settings-control">
            <input
              type="checkbox"
              checked={singleKeyShortcuts}
              onChange={(event) => onToggleSingleKey(event.target.checked)}
              aria-label="Enable single-key shortcuts"
            />
          </div>
        </label>
      </div>
      <p className="field-hint" style={{ marginTop: 12 }}>Shortcuts are ignored while typing in a field. Everything also works with a keyboard only.</p>
    </Modal>
  );
}
