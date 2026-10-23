"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ClipboardList,
  Code2,
  Database,
  Download,
  FileKey2,
  Globe2,
  History,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Lock,
  Mail,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { Avatar, EmptyState, InlineError, LoadingButton, Menu, Modal, Spinner, Toggle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, formatApiError, newIdempotencyKey } from "@/lib/client";
import { formatDate, roleLabel } from "@/lib/format";
import type { Bootstrap, UserSettings, Workspace } from "@/lib/types";

type SectionId =
  | "account"
  | "appearance"
  | "notifications"
  | "security"
  | "workspace"
  | "members"
  | "policies"
  | "automations"
  | "integrations"
  | "audit"
  | "data"
  | "about";

type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  metadata: unknown;
  ipHash?: string | null;
  actor?: { id: string; name: string; email: string | null } | null;
};

type MfaStatus = {
  mfaEnabled: boolean;
  sessions: { id: string; createdAt: string; lastUsedAt: string; userAgent: string | null; current: boolean }[];
};

type AutomationsPayload = {
  rules: {
    id: string;
    name: string;
    enabled: boolean;
    trigger: string;
    conditionsJson: string;
    actionType: string;
    actionValue: string;
    boardId: string | null;
    lastRunAt: string | null;
  }[];
  preview: { ruleId: string; ruleName: string; title: string; change: string }[];
};

type AutomationDraftPreview = {
  total: number;
  truncated: boolean;
  matches: { taskId: string; title: string; boardName: string; before: string; after: string }[];
  skipped: string[];
};

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode; group: string }[] = [
  { id: "account", label: "Account", icon: <UserRound size={15} />, group: "You" },
  { id: "appearance", label: "Appearance", icon: <Palette size={15} />, group: "You" },
  { id: "notifications", label: "Notifications", icon: <Bell size={15} />, group: "You" },
  { id: "security", label: "Security", icon: <ShieldCheck size={15} />, group: "You" },
  { id: "workspace", label: "Workspace", icon: <LayoutGrid size={15} />, group: "Workspace" },
  { id: "members", label: "People", icon: <UsersRound size={15} />, group: "Workspace" },
  { id: "policies", label: "Policies", icon: <Lock size={15} />, group: "Workspace" },
  { id: "automations", label: "Automations", icon: <Workflow size={15} />, group: "Workspace" },
  { id: "integrations", label: "Integrations", icon: <Code2 size={15} />, group: "Workspace" },
  { id: "audit", label: "Audit log", icon: <History size={15} />, group: "Workspace" },
  { id: "data", label: "Data & export", icon: <Database size={15} />, group: "Workspace" },
  { id: "about", label: "About Drift", icon: <BookOpen size={15} />, group: "Workspace" },
];

const TRIGGERS = [
  { value: "task.created", label: "When a task is created" },
  { value: "task.moved", label: "When a task moves" },
  { value: "task.completed", label: "When a task is completed" },
];

const ACTIONS = [
  { value: "set_priority", label: "Set priority" },
  { value: "add_label", label: "Add a label" },
  { value: "move_to_column", label: "Move to a column" },
  { value: "notify", label: "Notify the assignee" },
];

function sectionFromLocation(): SectionId {
  if (typeof window === "undefined") return "account";
  const hash = window.location.hash.replace("#", "");
  const query = new URLSearchParams(window.location.search).get("section") ?? "";
  const candidate = (hash || query) as SectionId;
  return SECTIONS.some((section) => section.id === candidate) ? candidate : "account";
}

export function SettingsClient() {
  const toast = useToast();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [section, setSection] = useState<SectionId>("account");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [members, setMembers] = useState<Workspace["members"]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string; role: string; expiresAt: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [policies, setPolicies] = useState<Workspace["policies"] | null>(null);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceType, setNewWorkspaceType] = useState<"team" | "org">("team");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [automations, setAutomations] = useState<AutomationsPayload | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationName, setAutomationName] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState("task.created");
  const [automationAction, setAutomationAction] = useState("set_priority");
  const [automationValue, setAutomationValue] = useState("high");
  const [automationBoard, setAutomationBoard] = useState("");
  const [automationConditionPriority, setAutomationConditionPriority] = useState("");
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [automationDryRun, setAutomationDryRun] = useState<AutomationDraftPreview | null>(null);
  const [previewingAutomation, setPreviewingAutomation] = useState(false);
  const [tokens, setTokens] = useState<{ id: string; name: string; prefix: string; lastUsedAt: string | null; expiresAt: string | null }[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [webhooks, setWebhooks] = useState<{ id: string; kind: string; url: string; events: string[]; lastStatus: number | null; lastDeliveryAt: string | null }[]>([]);
  const [webhookKind, setWebhookKind] = useState("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [sso, setSso] = useState<{ issuer: string; clientId: string; allowedDomains: string; enabled: boolean; enforceSso: boolean } | null>(null);
  const [ssoIssuer, setSsoIssuer] = useState("");
  const [ssoClientId, setSsoClientId] = useState("");
  const [ssoSecret, setSsoSecret] = useState("");
  const [ssoDomains, setSsoDomains] = useState("");
  const [importBoard, setImportBoard] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importFormat, setImportFormat] = useState<"json" | "csv">("csv");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteWorkspaceConfirm, setDeleteWorkspaceConfirm] = useState("");
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [health, setHealth] = useState<{ status: string; version: string; latencyMs: number } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setSection(sectionFromLocation());
    const onHash = () => setSection(sectionFromLocation());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const next = SECTIONS.find((item) => item.id === section)?.id ?? "account";
    window.history.replaceState(null, "", `#${next}`);
    document.getElementById(next)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<Bootstrap>("/api/bootstrap");
      setData(payload);
      setSettings(payload.settings);
      setName(payload.user.name === "You" ? "" : payload.user.name);
      setTimezone(payload.user.timezone);
      const stored = localStorage.getItem("drift-workspace");
      const selected = payload.workspaces.find((workspace) => workspace.id === stored) ?? payload.workspaces[0];
      if (selected) {
        setWorkspaceId(selected.id);
        localStorage.setItem("drift-workspace", selected.id);
        setWorkspaceName(selected.name);
        setPolicies(selected.policies);
        setMembers(selected.members);
      }
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
      setError("");
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (section === "security") void loadMfa();
    if ((section === "members" || section === "automations" || section === "integrations" || section === "audit") && workspaceId) {
      void loadWorkspaceTools();
    }
    if (section === "about" && !health) {
      api<{ status: string; version: string; latencyMs: number }>("/api/health").then(setHealth).catch(() => setHealth(null));
    }
  }, [section, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAutomationDryRun(null);
  }, [automationName, automationTrigger, automationAction, automationValue, automationBoard, automationConditionPriority, automationOpen]);

  const workspace = useMemo(() => data?.workspaces.find((item) => item.id === workspaceId) ?? data?.workspaces[0], [data, workspaceId]);
  const isAdmin = workspace?.role === "OWNER" || workspace?.role === "ADMIN";
  const isOwner = workspace?.role === "OWNER";
  const enterprise = workspace?.type === "team" || workspace?.type === "org";
  const user = data?.user;

  useEffect(() => {
    if (!workspace) return;
    setWorkspaceName(workspace.name);
    setPolicies(workspace.policies);
    setMembers(workspace.members);
  }, [workspace]);

  function switchWorkspace(nextId: string) {
    if (!data) return;
    const next = data.workspaces.find((item) => item.id === nextId);
    if (!next) return;
    setWorkspaceId(next.id);
    localStorage.setItem("drift-workspace", next.id);
    setWorkspaceName(next.name);
    setPolicies(next.policies);
    setMembers(next.members);
    setInvites([]);
    setAudit([]);
    setAutomations(null);
    setTokens([]);
    setWebhooks([]);
    setSso(null);
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (savingAccount) return;
    setSavingAccount(true);
    try {
      await api("/api/account", { method: "PATCH", body: { name: name.trim() || user?.name, timezone } });
      toast.success("Account updated.");
      await load();
    } catch (saveError) {
      toast.error(formatApiError(saveError));
    } finally {
      setSavingAccount(false);
    }
  }

  async function patchSettings(input: Partial<UserSettings> & { timezone?: string }) {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      const result = await api<{ settings: UserSettings; user: Bootstrap["user"] }>("/api/settings", { method: "PATCH", body: input });
      setSettings(result.settings);
      setData((current) => current ? { ...current, settings: result.settings, user: { ...current.user, timezone: result.user.timezone } } : current);
      toast.success("Preference saved.");
    } catch (saveError) {
      toast.error(formatApiError(saveError));
    } finally {
      setSavingSettings(false);
    }
  }

  function applyTheme(next: "light" | "dark") {
    setTheme(next);
    localStorage.setItem("drift-theme", next);
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event("drift-theme-change"));
    void patchSettings({ theme: next });
  }

  async function loadMfa() {
    try {
      setMfa(await api<MfaStatus>("/api/security/mfa"));
    } catch (mfaError) {
      toast.error(formatApiError(mfaError));
    }
  }

  async function startMfa() {
    try {
      const result = await api<{ qrDataUrl: string; secret: string; uri: string }>("/api/security/mfa", { method: "POST", body: { action: "setup" } });
      setMfaSetup(result);
      setMfaSecret(result.secret);
      setBackupCodes([]);
    } catch (mfaError) {
      toast.error(formatApiError(mfaError));
    }
  }

  async function enableMfa(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ backupCodes: string[] }>("/api/security/mfa", {
        method: "POST",
        body: { action: "enable", secret: mfaSecret, code: mfaCode },
        workspaceId,
      });
      setBackupCodes(result.backupCodes);
      setMfaSetup(null);
      setMfaCode("");
      toast.success("Two-factor authentication enabled.");
      await loadMfa();
    } catch (mfaError) {
      toast.error(formatApiError(mfaError));
    }
  }

  async function disableMfa() {
    if (!mfaCode.trim()) { toast.error("Enter a valid authenticator code to turn off two-factor."); return; }
    try {
      await api("/api/security/mfa", { method: "POST", body: { action: "disable", code: mfaCode }, workspaceId });
      setMfaCode("");
      toast.success("Two-factor authentication disabled.");
      await loadMfa();
    } catch (mfaError) {
      toast.error(formatApiError(mfaError));
    }
  }

  async function revokeSession(sessionId: string) {
    try {
      await api("/api/security/mfa", { method: "DELETE", body: { sessionId } });
      await loadMfa();
      toast.success("Session revoked.");
    } catch (revokeError) {
      toast.error(formatApiError(revokeError));
    }
  }

  async function loadWorkspaceTools() {
    try {
      const [auditPayload, invitesPayload, automationPayload, tokensPayload, hooksPayload] = await Promise.all([
        isAdmin && enterprise ? api<{ events: AuditEvent[]; nextCursor: string | null }>(`/api/audit?workspaceId=${encodeURIComponent(workspaceId)}&limit=40`, { workspaceId }).catch(() => ({ events: [], nextCursor: null })) : Promise.resolve({ events: [], nextCursor: null }),
        enterprise ? api<{ invites: typeof invites }>(`/api/workspaces/${workspaceId}/invites`, { workspaceId }).catch(() => ({ invites: [] })) : Promise.resolve({ invites: [] }),
        api<AutomationsPayload>(`/api/automations?workspaceId=${encodeURIComponent(workspaceId)}`, { workspaceId }).catch(() => null),
        isAdmin ? api<{ tokens: typeof tokens }>(`/api/tokens?workspaceId=${encodeURIComponent(workspaceId)}`, { workspaceId }).catch(() => ({ tokens: [] })) : Promise.resolve({ tokens: [] }),
        isAdmin ? api<{ webhooks: typeof webhooks }>(`/api/webhooks?workspaceId=${encodeURIComponent(workspaceId)}`, { workspaceId }).catch(() => ({ webhooks: [] })) : Promise.resolve({ webhooks: [] }),
      ]);
      setAudit(auditPayload.events);
      setAuditCursor(auditPayload.nextCursor);
      setInvites(invitesPayload.invites);
      setAutomations(automationPayload);
      setTokens(tokensPayload.tokens);
      setWebhooks(hooksPayload.webhooks);
      if (workspace?.type === "org" && isAdmin) {
        const ssoPayload = await api<{ config: typeof sso }>(`/api/workspaces/${workspaceId}/sso`, { workspaceId }).catch(() => ({ config: null }));
        setSso(ssoPayload.config);
        if (ssoPayload.config) {
          setSsoIssuer(ssoPayload.config.issuer);
          setSsoClientId(ssoPayload.config.clientId);
          setSsoDomains(ssoPayload.config.allowedDomains);
        }
      }
    } catch (toolsError) {
      toast.error(formatApiError(toolsError));
    }
  }

  async function loadMoreAudit() {
    if (!auditCursor || loadingAudit) return;
    setLoadingAudit(true);
    try {
      const payload = await api<{ events: AuditEvent[]; nextCursor: string | null }>(`/api/audit?workspaceId=${encodeURIComponent(workspaceId)}&limit=40&cursor=${encodeURIComponent(auditCursor)}`, { workspaceId });
      setAudit((current) => [...current, ...payload.events]);
      setAuditCursor(payload.nextCursor);
    } catch (auditError) {
      toast.error(formatApiError(auditError));
    } finally {
      setLoadingAudit(false);
    }
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    if (!workspace || inviting) return;
    setInviting(true);
    try {
      await api(`/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        workspaceId,
        idempotencyKey: newIdempotencyKey("invite"),
        body: { email: inviteEmail, role: inviteRole },
      });
      setInviteEmail("");
      toast.success("Invitation sent.");
      await loadWorkspaceTools();
    } catch (inviteError) {
      toast.error(formatApiError(inviteError));
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      await api(`/api/workspaces/${workspaceId}/members`, { method: "PATCH", workspaceId, body: { userId, role } });
      await load();
      toast.success("Role updated.");
    } catch (roleError) {
      toast.error(formatApiError(roleError));
    }
  }

  async function removeMember(userId: string, leaving = false) {
    if (!window.confirm(leaving ? "Leave this workspace?" : "Remove this person from the workspace?")) return;
    try {
      await api(`/api/workspaces/${workspaceId}/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE", workspaceId });
      if (leaving) window.location.assign("/");
      else { await load(); toast.success("Member removed."); }
    } catch (removeError) {
      toast.error(formatApiError(removeError));
    }
  }

  async function revokeInvite(inviteId: string) {
    try {
      await api(`/api/workspaces/${workspaceId}/invites?inviteId=${encodeURIComponent(inviteId)}`, { method: "DELETE", workspaceId });
      await loadWorkspaceTools();
      toast.success("Invite revoked.");
    } catch (inviteError) {
      toast.error(formatApiError(inviteError));
    }
  }

  async function saveWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !policies || savingWorkspace) return;
    setSavingWorkspace(true);
    try {
      await api(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        workspaceId,
        body: { name: workspaceName.trim(), ...policies, version: workspace.policies.version },
      });
      await load();
      toast.success("Workspace settings saved.");
    } catch (saveError) {
      toast.error(formatApiError(saveError));
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    if (creatingWorkspace || newWorkspaceName.trim().length < 2) return;
    setCreatingWorkspace(true);
    try {
      const result = await api<{ workspace: Workspace }>("/api/workspaces", {
        method: "POST",
        idempotencyKey: newIdempotencyKey("workspace"),
        body: { name: newWorkspaceName.trim(), type: newWorkspaceType, seedTemplate: true },
      });
      setNewWorkspaceName("");
      toast.success("Workspace created.");
      const payload = await api<Bootstrap>("/api/bootstrap");
      setData(payload);
      switchWorkspace(result.workspace.id);
    } catch (createError) {
      toast.error(formatApiError(createError));
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function previewAutomation() {
    if (!workspace || previewingAutomation) return;
    if (!automationValue.trim()) {
      toast.error("Choose an action value before previewing.");
      return;
    }
    if (automationAction === "move_to_column" && !automationBoard) {
      toast.error("Choose a board scope before previewing a column move.");
      return;
    }
    setPreviewingAutomation(true);
    try {
      const result = await api<AutomationDraftPreview>("/api/automations/preview", {
        method: "POST",
        workspaceId,
        body: {
          workspaceId,
          boardId: automationBoard || null,
          trigger: automationTrigger,
          actionType: automationAction,
          actionValue: automationValue.trim(),
          conditionsJson: JSON.stringify(automationConditionPriority ? { priority: automationConditionPriority } : {}),
        },
      });
      setAutomationDryRun(result);
    } catch (automationError) {
      toast.error(formatApiError(automationError));
    } finally {
      setPreviewingAutomation(false);
    }
  }

  async function saveAutomation(event: FormEvent) {
    event.preventDefault();
    if (!workspace || savingAutomation) return;
    setSavingAutomation(true);
    try {
      await api("/api/automations", {
        method: "POST",
        workspaceId,
        idempotencyKey: newIdempotencyKey("automation"),
        body: {
          workspaceId,
          name: automationName.trim(),
          trigger: automationTrigger,
          actionType: automationAction,
          actionValue: automationValue,
          boardId: automationBoard || null,
          conditionsJson: JSON.stringify(automationConditionPriority ? { priority: automationConditionPriority } : {}),
          enabled: true,
        },
      });
      setAutomationOpen(false);
      setAutomationName("");
      setAutomationDryRun(null);
      toast.success("Automation created.");
      await loadWorkspaceTools();
    } catch (automationError) {
      toast.error(formatApiError(automationError));
    } finally {
      setSavingAutomation(false);
    }
  }

  async function toggleAutomation(id: string, enabled: boolean) {
    try {
      await api(`/api/automations/${id}`, { method: "PATCH", workspaceId, body: { workspaceId, enabled } });
      setAutomations((current) => current ? { ...current, rules: current.rules.map((rule) => rule.id === id ? { ...rule, enabled } : rule) } : current);
    } catch (automationError) {
      toast.error(formatApiError(automationError));
    }
  }

  async function deleteAutomation(id: string) {
    if (!window.confirm("Delete this automation?")) return;
    try {
      await api(`/api/automations/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE", workspaceId });
      await loadWorkspaceTools();
      toast.success("Automation deleted.");
    } catch (automationError) {
      toast.error(formatApiError(automationError));
    }
  }

  async function createToken(event: FormEvent) {
    event.preventDefault();
    if (!tokenName.trim() || !isAdmin) return;
    try {
      const result = await api<{ token: string; record: { id: string; name: string; prefix: string; expiresAt: string } }>("/api/tokens", {
        method: "POST",
        workspaceId,
        idempotencyKey: newIdempotencyKey("token"),
        body: { workspaceId, name: tokenName.trim(), expiresInDays: 90 },
      });
      setCreatedToken(result.token);
      setTokenName("");
      await loadWorkspaceTools();
    } catch (tokenError) {
      toast.error(formatApiError(tokenError));
    }
  }

  async function revokeToken(id: string) {
    try {
      await api(`/api/tokens/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE", workspaceId });
      await loadWorkspaceTools();
      toast.success("Token revoked.");
    } catch (tokenError) {
      toast.error(formatApiError(tokenError));
    }
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault();
    if (!webhookUrl.trim() || !isAdmin) return;
    try {
      await api("/api/webhooks", {
        method: "POST",
        workspaceId,
        idempotencyKey: newIdempotencyKey("webhook"),
        body: { workspaceId, kind: webhookKind, url: webhookUrl.trim(), events: ["task.created", "task.moved", "task.completed", "task.deleted"] },
      });
      setWebhookUrl("");
      await loadWorkspaceTools();
      toast.success("Webhook added.");
    } catch (webhookError) {
      toast.error(formatApiError(webhookError));
    }
  }

  async function deleteWebhook(id: string) {
    try {
      await api(`/api/webhooks/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE", workspaceId });
      await loadWorkspaceTools();
      toast.success("Webhook removed.");
    } catch (webhookError) {
      toast.error(formatApiError(webhookError));
    }
  }

  async function saveSso(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    try {
      await api(`/api/workspaces/${workspace.id}/sso`, {
        method: "PUT",
        workspaceId,
        body: { workspaceId, issuer: ssoIssuer.trim(), clientId: ssoClientId.trim(), clientSecret: ssoSecret, allowedDomains: ssoDomains, enabled: true, enforceSso: false },
      });
      setSsoSecret("");
      await loadWorkspaceTools();
      toast.success("SSO configuration saved.");
    } catch (ssoError) {
      toast.error(formatApiError(ssoError));
    }
  }

  async function removeSso() {
    if (!window.confirm("Remove the SSO configuration?")) return;
    try {
      await api(`/api/workspaces/${workspaceId}/sso`, { method: "DELETE", workspaceId });
      setSso(null);
      toast.success("SSO configuration removed.");
    } catch (ssoError) {
      toast.error(formatApiError(ssoError));
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFormat(file.name.endsWith(".json") ? "json" : "csv");
    setImportContent(await file.text());
  }

  async function runImport() {
    if (!workspace || !importBoard || !importContent) return;
    try {
      const result = await api<{ imported: number; skipped: number }>("/api/import", {
        method: "POST",
        workspaceId,
        idempotencyKey: newIdempotencyKey("import"),
        body: { workspaceId, boardId: importBoard, format: importFormat, content: importContent },
      });
      toast.success(`Imported ${result.imported} tasks${result.skipped ? `; skipped ${result.skipped}` : ""}.`);
      setImportContent("");
      await load();
    } catch (importError) {
      toast.error(formatApiError(importError));
    }
  }

  function download(format: "json" | "csv") {
    window.location.assign(`/api/export?workspaceId=${encodeURIComponent(workspaceId)}&format=${format}`);
  }

  async function deleteWorkspace() {
    if (!workspace || deleteWorkspaceConfirm !== workspace.name) return;
    try {
      await api(`/api/workspaces/${workspace.id}`, { method: "DELETE", workspaceId });
      toast.success("Workspace deleted.");
      window.location.assign("/");
    } catch (deleteError) {
      toast.error(formatApiError(deleteError));
    }
  }

  async function deleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    try {
      await api("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
      window.location.assign("/auth");
    } catch (deleteError) {
      toast.error(formatApiError(deleteError));
    }
  }

  if (loading && !data) {
    return (
      <main className="settings-shell" id="main">
        <aside className="settings-nav"><div className="skeleton" style={{ height: 34, margin: "4px 6px 22px" }} />{[0, 1, 2, 3, 4].map((item) => <div className="skeleton" key={item} style={{ height: 34, margin: "4px 6px" }} />)}</aside>
        <div className="settings-content"><Spinner label="Loading settings" /></div>
      </main>
    );
  }

  if (!data || !workspace || !settings || !user) {
    return (
      <main className="settings-content" id="main">
        <EmptyState icon={<LifeBuoy size={22} />} title="Settings could not load" description={error || "Your session may have expired."} action={<a className="btn primary" href="/auth?next=/settings">Sign in again</a>} />
      </main>
    );
  }

  const visibleSections = SECTIONS.filter((item) => {
    if (item.id === "members" || item.id === "policies" || item.id === "automations") return enterprise;
    if (item.id === "audit") return enterprise && isAdmin;
    if (item.id === "integrations") return isAdmin;
    return true;
  });
  const grouped = ["You", "Workspace"];

  return (
    <div className="settings-shell">
      <aside className="settings-nav" aria-label="Settings navigation">
        <Link className="brand" href="/" style={{ margin: "4px 6px 22px" }}>
          <span className="brand-mark" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h12a5 5 0 0 1 0 10H9" /><circle cx="5" cy="18" r="1.6" fill="currentColor" stroke="none" /></svg>
          </span>
          Drift
        </Link>
        <Link className="nav-item" href="/"><ArrowLeft size={15} /> Back to app</Link>
        <div style={{ margin: "12px 6px" }}>
          {data.workspaces.length > 1 ? (
            <Menu
              trigger={<><span className="workspace-avatar" style={{ width: 24, height: 24, fontSize: 9 }}>{workspace.name.slice(0, 2).toUpperCase()}</span><span className="workspace-copy"><strong>{workspace.name}</strong><span>{roleLabel(workspace.role)}</span></span><ChevronDown size={13} /></>}
              triggerLabel="Switch workspace in settings"
              triggerClassName="workspace-button"
              align="left"
              width={240}
            >
              {(close) => (
                <>
                  <div className="menu-label">Workspaces</div>
                  {data.workspaces.map((item) => <button type="button" key={item.id} className={`menu-item${item.id === workspace.id ? " active" : ""}`} onClick={() => { close(); switchWorkspace(item.id); }}><span className="workspace-avatar" style={{ width: 20, height: 20, fontSize: 8 }}>{item.name.slice(0, 2).toUpperCase()}</span>{item.name}</button>)}
                </>
              )}
            </Menu>
          ) : (
            <div className="workspace-button" style={{ cursor: "default" }}>
              <span className="workspace-avatar" style={{ width: 24, height: 24, fontSize: 9 }}>{workspace.name.slice(0, 2).toUpperCase()}</span>
              <span className="workspace-copy"><strong>{workspace.name}</strong><span>{roleLabel(workspace.role)}</span></span>
            </div>
          )}
        </div>
        {grouped.map((group) => {
          const items = visibleSections.filter((item) => item.group === group);
          if (!items.length) return null;
          return (
            <div className="nav-section" key={group}>
              <div className="nav-label">{group}</div>
              {items.map((item) => (
                <a key={item.id} href={`#${item.id}`} className={`nav-item${section === item.id ? " active" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
                  {item.icon} {item.label}
                </a>
              ))}
            </div>
          );
        })}
        <div className="sidebar-spacer" />
        <div className="sidebar-foot">
          <div className="user-button" style={{ cursor: "default" }}>
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            <span className="user-copy"><strong>{user.name}</strong><span>{user.email ?? "Guest session"}</span></span>
          </div>
        </div>
      </aside>

      <main className="settings-content" id="main">
        <header className="inline" style={{ justifyContent: "space-between", marginBottom: 24 }}>
          <div><div className="eyebrow"><Sparkles size={12} /> Account & workspace</div><h1 className="settings-title">Settings</h1><p className="settings-sub">Quiet controls for how Drift works for you.</p></div>
          <button type="button" className="icon-btn" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}</button>
        </header>

        {error ? <InlineError>{error}</InlineError> : null}

        {/* Account */}
        <section className="settings-section" id="account" aria-labelledby="account-title">
          <h2 id="account-title">Account</h2>
          <p>Your identity in this workspace. Email changes are intentionally not self-service in v1.</p>
          <form className="settings-card" onSubmit={saveAccount}>
            <div className="settings-row"><div className="settings-copy"><strong>Display name</strong><span>Shown on tasks, comments, and mentions.</span></div><div className="settings-control"><input className="input" style={{ width: 240 }} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" maxLength={80} aria-label="Display name" /></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Email</strong><span>{user.email ?? "No email yet. Save this guest workspace to add one."}</span></div><div className="settings-control">{user.isGuest ? <a className="btn sm primary" href="/auth?claim=1">Save workspace</a> : <span className="badge slate">{user.email}</span>}</div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Time zone</strong><span>Used for Today, reminders, digests, and recurrence.</span></div><div className="settings-control"><input className="input" style={{ width: 240 }} value={timezone} onChange={(event) => setTimezone(event.target.value)} list="timezones" aria-label="Time zone" /><datalist id="timezones">{["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney"].map((zone) => <option key={zone} value={zone} />)}</datalist></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Account status</strong><span>{user.isGuest ? "Guest, not yet claimable across devices." : "Verified account."} {user.mfaEnabled ? "Two-factor is on." : "Two-factor is off."}</span></div><div className="settings-control inline"><span className={`badge ${user.isGuest ? "amber" : "accent"}`}>{user.isGuest ? "Guest" : "Account"}</span><LoadingButton loading={savingAccount} className="btn primary sm" type="submit"><Check size={13} /> Save</LoadingButton></div></div>
          </form>
        </section>

        {/* Appearance */}
        <section className="settings-section" id="appearance" aria-labelledby="appearance-title">
          <h2 id="appearance-title">Appearance</h2>
          <p>Calm by default. Compact when you need more on screen.</p>
          <div className="settings-card">
            <div className="settings-row"><div className="settings-copy"><strong>Theme</strong><span>Follows your system unless you choose.</span></div><div className="settings-control inline"><button type="button" className={`btn sm${theme === "light" ? " primary" : ""}`} onClick={() => applyTheme("light")}><SunMedium size={13} /> Light</button><button type="button" className={`btn sm${theme === "dark" ? " primary" : ""}`} onClick={() => applyTheme("dark")}><Moon size={13} /> Dark</button></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Density</strong><span>Compact reduces row height in list views.</span></div><div className="settings-control"><select className="select" aria-label="Density" value={settings.density} onChange={(event) => void patchSettings({ density: event.target.value as UserSettings["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Week starts on</strong><span>Calendar and weekly rhythms.</span></div><div className="settings-control"><select className="select" aria-label="Week starts on" value={settings.weekStartsOn} onChange={(event) => void patchSettings({ weekStartsOn: Number(event.target.value) })}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select></div></div>
          </div>
        </section>

        {/* Notifications */}
        <section className="settings-section" id="notifications" aria-labelledby="notifications-title">
          <h2 id="notifications-title">Notifications</h2>
          <p>In-app notifications are the source of truth. Email is delivered when SMTP is configured.</p>
          <div className="settings-card">
            <div className="settings-row"><div className="settings-copy"><strong>In-app notifications</strong><span>Assignments, comments, reminders, and automations.</span></div><div className="settings-control"><Toggle label="In-app notifications" checked={notificationsPrefs(settings).inApp} onChange={(next) => void patchSettings({ notificationsJson: JSON.stringify({ ...notificationsPrefs(settings), inApp: next }) })} /></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Mentions and assignments</strong><span>Only notify me when someone needs my attention.</span></div><div className="settings-control"><Toggle label="Mentions and assignment notifications" checked={notificationsPrefs(settings).mentions} onChange={(next) => void patchSettings({ notificationsJson: JSON.stringify({ ...notificationsPrefs(settings), mentions: next }) })} /></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Daily email digest</strong><span>A short morning plan. Requires SMTP in production.</span></div><div className="settings-control"><Toggle label="Daily email digest" checked={settings.emailDigest} onChange={(next) => void patchSettings({ emailDigest: next })} /></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Digest hour</strong><span>Local time, 0–23.</span></div><div className="settings-control"><select className="select" aria-label="Digest hour" value={settings.digestHour} onChange={(event) => void patchSettings({ digestHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Quiet hours</strong><span>In-app still records; email and digests pause.</span></div><div className="settings-control inline"><select className="select" aria-label="Quiet hours start" value={settings.quietStart ?? ""} onChange={(event) => void patchSettings({ quietStart: event.target.value ? Number(event.target.value) : null })}><option value="">Off</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}</option>)}</select><span style={{ color: "var(--faint)" }}>to</span><select className="select" aria-label="Quiet hours end" value={settings.quietEnd ?? ""} onChange={(event) => void patchSettings({ quietEnd: event.target.value ? Number(event.target.value) : null })}><option value="">Off</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}</option>)}</select></div></div>
          </div>
        </section>

        {/* Security */}
        <section className="settings-section" id="security" aria-labelledby="security-title">
          <h2 id="security-title">Security</h2>
          <p>Two-factor authentication is TOTP. Sessions are opaque, hashed, and revocable.</p>
          <div className="settings-card">
            <div className="settings-row"><div className="settings-copy"><strong>Two-factor authentication</strong><span>{mfa?.mfaEnabled ? "Enabled with an authenticator app." : "Add a second factor for password and magic-link sign-in."}</span></div><div className="settings-control inline">{mfa?.mfaEnabled ? <span className="badge accent"><ShieldCheck size={11} /> On</span> : <span className="badge slate">Off</span>}{mfa?.mfaEnabled ? null : <button type="button" className="btn sm primary" onClick={() => void startMfa()}><KeyRound size={12} /> Set up</button>}</div></div>
            {mfaSetup ? (
              <div className="settings-row" style={{ display: "block", background: "var(--surface-2)" }}>
                <form onSubmit={enableMfa} className="form-grid" style={{ maxWidth: 520 }}>
                  <div className="inline" style={{ alignItems: "flex-start", gap: 18 }}>
                    <img src={mfaSetup.qrDataUrl} alt="QR code for authenticator app" width={170} height={170} style={{ borderRadius: 12, background: "#fff", padding: 8 }} />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 12 }}>Scan with your authenticator</strong>
                      <p className="field-hint">Or enter this secret manually:</p>
                      <code style={{ display: "block", wordBreak: "break-all", fontSize: 10.5, background: "var(--surface)", border: "1px solid var(--border)", padding: 8, borderRadius: 7 }}>{mfaSetup.secret}</code>
                    </div>
                  </div>
                  <label className="field"><span>Six-digit code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="123456" /></label>
                  <div className="inline"><button type="submit" className="btn primary">Verify and enable</button><button type="button" className="btn ghost" onClick={() => { setMfaSetup(null); setMfaCode(""); }}>Cancel</button></div>
                </form>
              </div>
            ) : null}
            {backupCodes.length ? (
              <div className="settings-row" style={{ display: "block", background: "var(--warning-soft)" }}>
                <strong style={{ fontSize: 12 }}>Save these backup codes now</strong>
                <p className="field-hint">Each code works once. They will not be shown again.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>{backupCodes.map((code) => <code key={code} style={{ fontSize: 11 }}>{code}</code>)}</div>
                <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => { void navigator.clipboard?.writeText(backupCodes.join("\n")); toast.success("Backup codes copied."); }}><ClipboardList size={12} /> Copy codes</button>
              </div>
            ) : null}
            {mfa?.mfaEnabled ? (
              <div className="settings-row"><div className="settings-copy"><strong>Disable two-factor</strong><span>Not allowed while an organization requires it.</span></div><div className="settings-control inline"><input className="input" style={{ width: 150 }} placeholder="Code or backup" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /><button type="button" className="btn danger sm" onClick={() => void disableMfa()}>Disable</button></div></div>
            ) : null}
            <div className="settings-row" style={{ alignItems: "flex-start", display: "block" }}>
              <div className="inline" style={{ justifyContent: "space-between" }}><div className="settings-copy"><strong>Active sessions</strong><span>Revoke anything you do not recognize. The current session stays.</span></div><button type="button" className="btn ghost sm" onClick={() => void loadMfa()}><RefreshCw size={12} /> Refresh</button></div>
              <div style={{ marginTop: 10 }}>
                {(mfa?.sessions ?? []).map((session) => (
                  <div key={session.id} className="inline" style={{ padding: "8px 0", borderTop: "1px solid var(--border)", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11 }}>{session.current ? <strong>This device</strong> : session.userAgent ?? "Unknown device"}<span className="field-hint" style={{ display: "block" }}>Last used {formatDate(session.lastUsedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
                    {session.current ? <span className="badge accent">Current</span> : <button type="button" className="btn ghost sm" onClick={() => void revokeSession(session.id)}>Revoke</button>}
                  </div>
                ))}
                {!mfa?.sessions.length ? <p className="field-hint">Open Security to load active sessions.</p> : null}
              </div>
            </div>
          </div>
        </section>

        {/* Workspace */}
        <section className="settings-section" id="workspace" aria-labelledby="workspace-title">
          <h2 id="workspace-title">Workspace</h2>
          <p>Personal by default. Add a team only when collaboration earns its weight.</p>
          <form className="settings-card" onSubmit={saveWorkspace}>
            <div className="settings-row"><div className="settings-copy"><strong>Name</strong><span>{workspace.type === "personal" ? "Your private space." : `${enterprise ? "Shared" : "Personal"} workspace`}</span></div><div className="settings-control"><input className="input" style={{ width: 260 }} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={80} disabled={!isAdmin} aria-label="Workspace name" /></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Type</strong><span>Type is fixed in v1 to preserve policy semantics.</span></div><div className="settings-control"><span className="badge slate">{workspace.type === "personal" ? "Personal" : workspace.type === "team" ? "Team" : "Organization"}</span></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Your role</strong><span>Role is enforced server-side, not hidden only in the UI.</span></div><div className="settings-control"><span className={`badge ${isOwner ? "amber" : isAdmin ? "accent" : "slate"}`}>{roleLabel(workspace.role)}</span></div></div>
            {isAdmin ? <div className="settings-row"><div className="settings-copy"><strong>Save workspace name</strong><span>Policy controls below are saved separately.</span></div><div className="settings-control"><LoadingButton loading={savingWorkspace} className="btn primary sm" type="submit">Save</LoadingButton></div></div> : null}
          </form>

          <div className="section-head" style={{ marginTop: 26 }}><div><h3 className="section-title">Create a workspace</h3><p className="section-subtitle">A fresh team space with a starter board. You will be the owner.</p></div></div>
          <form className="settings-card" onSubmit={createWorkspace}>
            <div className="settings-row"><div className="settings-copy"><strong>Workspace name</strong><span>At least two characters.</span></div><div className="settings-control"><input className="input" style={{ width: 260 }} value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder="Acme product" aria-label="New workspace name" /></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Type</strong><span>Organizations unlock SSO configuration and stricter policy defaults.</span></div><div className="settings-control"><select className="select" aria-label="New workspace type" value={newWorkspaceType} onChange={(event) => setNewWorkspaceType(event.target.value as "team" | "org")}><option value="team">Team</option><option value="org">Organization</option></select></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Start from a template</strong><span>Creates a shared board with backlog, in progress, review, and done.</span></div><div className="settings-control"><LoadingButton loading={creatingWorkspace} className="btn primary sm" type="submit" disabled={newWorkspaceName.trim().length < 2}><Plus size={13} /> Create workspace</LoadingButton></div></div>
          </form>
        </section>

        {enterprise ? (
          <section className="settings-section" id="members" aria-labelledby="members-title">
            <h2 id="members-title">People</h2>
            <p>{members.length} member{members.length === 1 ? "" : "s"} in {workspace.name}. Roles are workspace-scoped.</p>
            <div className="settings-card">
              {members.map((member) => (
                <div className="member-row" key={member.id}>
                  <Avatar name={member.name} src={member.avatarUrl} size="sm" />
                  <div className="member-copy"><strong>{member.name} {member.id === user.id ? <span className="field-hint">(you)</span> : null}</strong><span>{member.email ?? "No email"} · joined {formatDate((member as any).joinedAt ?? undefined)}</span></div>
                  {isAdmin && member.id !== user.id ? (
                    <select className="select" aria-label={`Role for ${member.name}`} value={member.role ?? "MEMBER"} onChange={(event) => void changeRole(member.id, event.target.value)} style={{ width: 110 }}>
                      <option value="ADMIN">Admin</option><option value="MEMBER">Member</option><option value="GUEST">Guest</option>
                    </select>
                  ) : <span className="badge slate">{roleLabel(member.role ?? "MEMBER")}</span>}
                  {isAdmin && member.id !== user.id ? <button type="button" className="icon-btn sm" aria-label={`Remove ${member.name}`} onClick={() => void removeMember(member.id)}><X size={13} /></button> : null}
                </div>
              ))}
              {isAdmin ? (
                <>
                  <form className="settings-row" onSubmit={inviteMember} style={{ background: "var(--surface-2)" }}>
                    <Mail size={16} aria-hidden style={{ color: "var(--faint)" }} />
                    <input className="input" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@company.com" style={{ flex: 1 }} aria-label="Invite email" />
                    <select className="select" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} aria-label="Invite role" style={{ width: 105 }}><option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="GUEST">Guest</option></select>
                    <LoadingButton loading={inviting} className="btn primary sm" type="submit"><Plus size={12} /> Invite</LoadingButton>
                  </form>
                  {invites.length ? <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}><div className="field-hint" style={{ marginBottom: 6 }}>Pending invitations</div>{invites.map((invite) => <div key={invite.id} className="inline" style={{ justifyContent: "space-between", padding: "5px 0", fontSize: 11 }}><span>{invite.email} · {roleLabel(invite.role)}</span><button type="button" className="btn ghost sm" onClick={() => void revokeInvite(invite.id)}>Revoke</button></div>)}</div> : null}
                </>
              ) : null}
            </div>
            {workspace.role !== "OWNER" ? <button type="button" className="btn danger sm" style={{ marginTop: 12 }} onClick={() => void removeMember(user.id, true)}>Leave workspace</button> : null}
          </section>
        ) : null}

        {enterprise ? (
          <section className="settings-section" id="policies" aria-labelledby="policies-title">
            <h2 id="policies-title">Policies</h2>
            <p>{isAdmin ? "Workspace-level controls. Changes are audited and versioned." : "A workspace admin controls these settings."}</p>
            {policies ? (
              <div className="settings-card">
                <div className="settings-row"><div className="settings-copy"><strong>Require two-factor authentication</strong><span>Members without MFA are locked out of workspace data.</span></div><div className="settings-control"><Toggle label="Require MFA" checked={policies.requireMfa} disabled={!isAdmin} onChange={(next) => setPolicies({ ...policies, requireMfa: next })} /></div></div>
                <div className="settings-row"><div className="settings-copy"><strong>Assistant suggestions</strong><span>Local capacity and quick-add heuristics. No customer data leaves Drift.</span></div><div className="settings-control"><Toggle label="Enable assistant suggestions" checked={policies.aiEnabled} disabled={!isAdmin} onChange={(next) => setPolicies({ ...policies, aiEnabled: next })} /></div></div>
                <div className="settings-row"><div className="settings-copy"><strong>Automations</strong><span>Allow rules for this workspace.</span></div><div className="settings-control"><Toggle label="Enable automations" checked={policies.automationsEnabled} disabled={!isAdmin} onChange={(next) => setPolicies({ ...policies, automationsEnabled: next })} /></div></div>
                <div className="settings-row"><div className="settings-copy"><strong>Attachments</strong><span>Files up to 10 MB, type-allowlisted, local storage.</span></div><div className="settings-control"><Toggle label="Enable attachments" checked={policies.attachmentsEnabled} disabled={!isAdmin} onChange={(next) => setPolicies({ ...policies, attachmentsEnabled: next })} /></div></div>
                <div className="settings-row"><div className="settings-copy"><strong>Public share links</strong><span>Read-only board links. Disable to revoke all sharing immediately.</span></div><div className="settings-control"><Toggle label="Enable public sharing" checked={policies.publicSharingEnabled} disabled={!isAdmin} onChange={(next) => setPolicies({ ...policies, publicSharingEnabled: next })} /></div></div>
                <div className="settings-row"><div className="settings-copy"><strong>Archived task retention</strong><span>Soft-deleted content is purged by the jobs worker.</span></div><div className="settings-control"><input className="input" type="number" min={1} max={3650} style={{ width: 100 }} value={policies.retentionDays} disabled={!isAdmin} onChange={(event) => setPolicies({ ...policies, retentionDays: Number(event.target.value) })} /></div></div>
                <div className="settings-row"><div className="settings-copy"><strong>Audit retention</strong><span>Audit events are retained separately for compliance.</span></div><div className="settings-control"><input className="input" type="number" min={30} max={3650} style={{ width: 100 }} value={policies.auditRetentionDays} disabled={!isAdmin} onChange={(event) => setPolicies({ ...policies, auditRetentionDays: Number(event.target.value) })} /></div></div>
                {isAdmin ? <div className="settings-row"><div className="settings-copy"><strong>Save policies</strong><span>Versioned: stale saves are rejected with a conflict.</span></div><div className="settings-control"><LoadingButton loading={savingWorkspace} className="btn primary sm" type="button" onClick={(event) => void saveWorkspace(event as unknown as FormEvent)}>Save policies</LoadingButton></div></div> : null}
              </div>
            ) : <Spinner label="Loading policies" />}
          </section>
        ) : null}

        {enterprise ? (
          <section className="settings-section" id="automations" aria-labelledby="automations-title">
            <h2 id="automations-title">Automations</h2>
            <p>Explicit rules, previews, and undo. No autonomous mutation.</p>
            <div className="inline" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
              {isAdmin ? <button type="button" className="btn primary sm" onClick={() => setAutomationOpen(true)}><Plus size={13} /> New rule</button> : <span className="badge slate">Admin managed</span>}
            </div>
            {automations?.rules.length ? (
              <div className="settings-card">
                {automations.rules.map((rule) => (
                  <div className="settings-row" key={rule.id}>
                    <div className="settings-copy"><strong>{rule.name}</strong><span>{TRIGGERS.find((trigger) => trigger.value === rule.trigger)?.label ?? rule.trigger} → {ACTIONS.find((action) => action.value === rule.actionType)?.label ?? rule.actionType}: {rule.actionValue}{rule.lastRunAt ? ` · last ran ${formatDate(rule.lastRunAt, { month: "short", day: "numeric" })}` : ""}</span></div>
                    <div className="settings-control inline"><Toggle label={`Enable ${rule.name}`} checked={rule.enabled} disabled={!isAdmin} onChange={(next) => void toggleAutomation(rule.id, next)} />{isAdmin ? <button type="button" className="icon-btn sm" aria-label={`Delete ${rule.name}`} onClick={() => void deleteAutomation(rule.id)}><Trash2 size={13} /></button> : null}</div>
                  </div>
                ))}
              </div>
            ) : <div className="settings-card"><div className="settings-row"><div className="settings-copy"><strong>No automations yet</strong><span>A rule is a quiet, explainable helper — never a surprise.</span></div></div></div>}
            {automations?.preview.length ? <div style={{ marginTop: 14 }}><div className="field-hint">Preview against current tasks</div>{automations.preview.slice(0, 6).map((preview) => <div key={`${preview.ruleId}-${preview.title}`} className="inline" style={{ fontSize: 11, padding: "5px 0", color: "var(--muted)" }}><Check size={11} style={{ color: "var(--accent)" }} /> {preview.title}: {preview.change}</div>)}</div> : null}
            <Modal
              open={automationOpen}
              onClose={() => setAutomationOpen(false)}
              title="New automation"
              eyebrow={workspace.name}
              footer={<>
                <button type="button" className="btn ghost" onClick={() => setAutomationOpen(false)}>Cancel</button>
                <LoadingButton loading={previewingAutomation} className="btn" type="button" onClick={() => void previewAutomation()} disabled={!automationValue.trim()}>Preview impact</LoadingButton>
                <LoadingButton loading={savingAutomation} type="submit" form="automation-form" disabled={!automationName.trim() || !automationValue.trim()}>Apply rule</LoadingButton>
              </>}
            >
              <form id="automation-form" className="form-grid" onSubmit={saveAutomation}>
                <label className="field"><span>Name</span><input className="input" value={automationName} onChange={(event) => setAutomationName(event.target.value)} placeholder="Flag urgent work" /></label>
                <label className="field"><span>When</span><select className="select" value={automationTrigger} onChange={(event) => setAutomationTrigger(event.target.value)}>{TRIGGERS.map((trigger) => <option key={trigger.value} value={trigger.value}>{trigger.label}</option>)}</select></label>
                <label className="field"><span>Only when priority is</span><select className="select" value={automationConditionPriority} onChange={(event) => setAutomationConditionPriority(event.target.value)}><option value="">Any priority</option>{["urgent", "high", "medium", "low", "none"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
                <label className="field"><span>Do</span><select className="select" value={automationAction} onChange={(event) => { setAutomationAction(event.target.value); setAutomationValue(event.target.value === "set_priority" ? "high" : event.target.value === "notify" ? "A task needs attention" : ""); }}>{ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}</select></label>
                {automationAction === "set_priority" ? <label className="field"><span>Priority</span><select className="select" value={automationValue} onChange={(event) => setAutomationValue(event.target.value)}>{["urgent", "high", "medium", "low", "none"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
                  : automationAction === "move_to_column" ? <label className="field"><span>Column</span><select className="select" value={automationValue} onChange={(event) => setAutomationValue(event.target.value)} disabled={!automationBoard}><option value="">{automationBoard ? "Choose column" : "Choose a board scope first"}</option>{workspace.boards.find((board) => board.id === automationBoard)?.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
                  : <label className="field"><span>{automationAction === "add_label" ? "Label name" : "Notification message"}</span><input className="input" value={automationValue} onChange={(event) => setAutomationValue(event.target.value)} placeholder={automationAction === "add_label" ? "Needs review" : "A task needs your attention"} /></label>}
                <label className="field"><span>Board scope</span><select className="select" value={automationBoard} onChange={(event) => setAutomationBoard(event.target.value)}><option value="">Every board</option>{workspace.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
                {automationDryRun ? (
                  <div className="automation-preview" role="status" aria-live="polite">
                    <strong>{automationDryRun.total === 0 ? "No current tasks would change." : `${automationDryRun.total} task${automationDryRun.total === 1 ? "" : "s"} would change.`}</strong>
                    {automationDryRun.matches.map((match) => (
                      <div key={match.taskId} className="automation-preview-row">
                        <span>{match.title}<span className="field-hint"> · {match.boardName}</span></span>
                        <span className="automation-diff"><del>{match.before}</del> → <ins>{match.after}</ins></span>
                      </div>
                    ))}
                    {automationDryRun.truncated ? <span className="field-hint">Showing the first {automationDryRun.matches.length}. The rule applies to every match when it runs.</span> : null}
                    {automationDryRun.skipped.map((reason) => <span className="field-hint" key={reason}>{reason}</span>)}
                    <span className="field-hint">Dry run only. Nothing changes until a matching event occurs; each run is logged and undoable for 60 seconds.</span>
                  </div>
                ) : null}
                <InlineError>{automationName.trim() && automationValue.trim() ? "" : "Give the rule a name and an action value."}</InlineError>
              </form>
            </Modal>
          </section>
        ) : null}

        <section className="settings-section" id="integrations" aria-labelledby="integrations-title">
          <h2 id="integrations-title">Integrations</h2>
          <p>API tokens, webhooks, calendar feed, and organization SSO. Secrets are shown once.</p>
          <div className="settings-card">
            <div className="settings-row"><div className="settings-copy"><strong>Calendar feed</strong><span>An ICS subscription for every due task you can see.</span></div><div className="settings-control"><a className="btn sm" href={`/api/calendar/ics?workspaceId=${encodeURIComponent(workspaceId)}`}><Download size={12} /> Download .ics</a></div></div>
            {isAdmin ? (
              <>
                <div className="settings-row" style={{ display: "block" }}>
                  <div className="inline" style={{ justifyContent: "space-between" }}><div className="settings-copy"><strong>API tokens</strong><span>Scoped to this workspace and your account. Requires an Authorization bearer header.</span></div></div>
                  <form onSubmit={createToken} className="inline" style={{ marginTop: 10 }}><input className="input" value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="Token name" style={{ flex: 1 }} /><button type="submit" className="btn sm primary"><Plus size={12} /> Create</button></form>
                  {createdToken ? <div className="dev-link">Copy now, it will not be shown again: <code>{createdToken}</code></div> : null}
                  {tokens.map((token) => <div key={token.id} className="inline" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 11 }}><span>{token.name} <span className="field-hint">{token.prefix}… · expires {formatDate(token.expiresAt)}</span></span><button type="button" className="btn ghost sm" onClick={() => void revokeToken(token.id)}>Revoke</button></div>)}
                </div>
                <div className="settings-row" style={{ display: "block" }}>
                  <div className="settings-copy"><strong>Webhooks</strong><span>HTTPS only. Failures are recorded; requests never block task writes.</span></div>
                  <form onSubmit={createWebhook} className="inline" style={{ marginTop: 10 }}><select className="select" aria-label="Webhook destination" value={webhookKind} onChange={(event) => setWebhookKind(event.target.value)} style={{ width: 108 }}><option value="slack">Slack</option><option value="teams">Teams</option><option value="generic">Generic</option></select><input className="input" type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://hooks.example.com/…" style={{ flex: 1 }} /><button type="submit" className="btn sm primary"><Plus size={12} /> Add</button></form>
                  {webhooks.map((hook) => <div key={hook.id} className="inline" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 11 }}><span>{hook.kind} · {hook.url.slice(0, 55)}{hook.url.length > 55 ? "…" : ""} <span className="field-hint">{hook.lastStatus ? `last ${hook.lastStatus}` : "not delivered yet"}</span></span><button type="button" className="btn ghost sm" onClick={() => void deleteWebhook(hook.id)}>Remove</button></div>)}
                </div>
                {workspace.type === "org" ? (
                  <div className="settings-row" style={{ display: "block" }}>
                    <div className="inline" style={{ justifyContent: "space-between" }}><div className="settings-copy"><strong>Single sign-on (OIDC)</strong><span>Configuration is encrypted. End-to-end external provider verification requires deployment credentials.</span></div>{sso ? <button type="button" className="btn danger sm" onClick={() => void removeSso()}>Remove</button> : null}</div>
                    <form onSubmit={saveSso} className="form-grid" style={{ marginTop: 12, maxWidth: 640 }}>
                      <label className="field"><span>Issuer URL</span><input className="input" type="url" required value={ssoIssuer} onChange={(event) => setSsoIssuer(event.target.value)} placeholder="https://login.example.com" /></label>
                      <label className="field"><span>Client ID</span><input className="input" required value={ssoClientId} onChange={(event) => setSsoClientId(event.target.value)} /></label>
                      <label className="field"><span>Client secret</span><input className="input" type="password" required={!sso} value={ssoSecret} onChange={(event) => setSsoSecret(event.target.value)} placeholder={sso ? "Leave blank to keep current secret" : "Required"} /></label>
                      <label className="field"><span>Allowed email domains</span><input className="input" value={ssoDomains} onChange={(event) => setSsoDomains(event.target.value)} placeholder="example.com, example.org" /></label>
                      <div><button type="submit" className="btn primary sm">Save SSO configuration</button></div>
                    </form>
                    {sso ? (
                      <p className="field-hint" style={{ marginTop: 8 }}>
                        Members can start OIDC sign-in at <a href={`/api/auth/sso/${workspace.id}`}>{`/api/auth/sso/${workspace.id}`}</a>. Discovery and callback require the provider to allow this redirect URI.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : <div className="settings-row"><div className="settings-copy"><strong>Admin access required</strong><span>Ask a workspace owner or admin to manage tokens and webhooks.</span></div></div>}
          </div>
        </section>

        {enterprise && isAdmin ? (
          <section className="settings-section" id="audit" aria-labelledby="audit-title">
            <h2 id="audit-title">Audit log</h2>
            <p>Every policy and content mutation is attributable. Retained per workspace policy.</p>
            <div className="inline" style={{ justifyContent: "flex-end", marginBottom: 10 }}><button type="button" className="btn ghost sm" onClick={() => void loadWorkspaceTools()}><RefreshCw size={12} /> Refresh</button></div>
            <div className="settings-card">
              {audit.length ? audit.map((event) => (
                <div className="settings-row" key={event.id}>
                  <div className="settings-copy"><strong>{event.action.replace(/[._]/g, " ")}</strong><span>{event.actor?.name ?? "System"} · {event.entityType} · {formatDate(event.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{event.metadata ? ` · ${JSON.stringify(event.metadata).slice(0, 100)}` : ""}</span></div>
                  <div className="settings-control"><span className="badge slate">{event.entityId.slice(0, 8)}</span></div>
                </div>
              )) : <div className="settings-row"><div className="settings-copy"><strong>No audit events yet</strong><span>Changes in this workspace will appear here.</span></div></div>}
              {auditCursor ? <div className="settings-row"><div className="settings-copy" /><div className="settings-control"><LoadingButton loading={loadingAudit} className="btn ghost sm" onClick={() => void loadMoreAudit()}>Load more</LoadingButton></div></div> : null}
            </div>
          </section>
        ) : null}

        <section className="settings-section" id="data" aria-labelledby="data-title">
          <h2 id="data-title">Data & export</h2>
          <p>Your work is portable. Export the whole workspace as JSON or a task CSV, or import tasks into a board.</p>
          <div className="settings-card">
            <div className="settings-row"><div className="settings-copy"><strong>Export workspace</strong><span>Boards, columns, tasks, labels, checklist items, and comments. Private boards only if you can see them.</span></div><div className="settings-control inline"><button type="button" className="btn sm" onClick={() => download("json")}><Download size={12} /> JSON</button><button type="button" className="btn sm" onClick={() => download("csv")}><Download size={12} /> CSV</button></div></div>
            <div className="settings-row" style={{ display: "block" }}>
              <div className="settings-copy"><strong>Import tasks</strong><span>CSV columns: title, description, priority, column, dueDate, estimateMinutes, labels, assignee. JSON accepts an export or a tasks array.</span></div>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <div className="inline"><select className="select" aria-label="Import board" value={importBoard} onChange={(event) => setImportBoard(event.target.value)}><option value="">Choose a board</option>{workspace.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select><label className="btn sm"><Upload size={12} /> Choose file<input type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(event) => void handleImportFile(event)} /></label>{importContent ? <span className="badge accent">{importContent.length.toLocaleString()} chars ready</span> : null}</div>
                <div className="inline"><LoadingButton loading={false} className="btn primary sm" disabled={!importBoard || !importContent} onClick={() => void runImport()}>Import into board</LoadingButton>{importContent ? <button type="button" className="btn ghost sm" onClick={() => setImportContent("")}>Clear</button> : null}</div>
              </div>
            </div>
          </div>

          <div className="section-head" style={{ marginTop: 26 }}><div><h3 className="section-title">Danger zone</h3><p className="section-subtitle">These actions are intentionally difficult to reach.</p></div></div>
          <div className="settings-card" style={{ borderColor: "color-mix(in srgb, var(--danger) 32%, var(--border))" }}>
            <div className="settings-row"><div className="settings-copy"><strong>Delete this workspace</strong><span>{isOwner ? "Soft-deletes the workspace, revokes access, and leaves audit records. You must own another workspace." : "Only a workspace owner can delete it."}</span></div><div className="settings-control">{isOwner ? <div className="inline"><input className="input" style={{ width: 150 }} value={deleteWorkspaceConfirm} onChange={(event) => setDeleteWorkspaceConfirm(event.target.value)} placeholder={`Type ${workspace.name}`} /><button type="button" className="btn danger sm" disabled={deleteWorkspaceConfirm !== workspace.name} onClick={() => void deleteWorkspace()}>Delete</button></div> : <span className="badge slate">Owner only</span>}</div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Delete my account</strong><span>Soft-deletes your personal workspaces, revokes sessions, and removes credentials. Shared workspace ownership must be transferred first.</span></div><div className="settings-control"><button type="button" className="btn danger sm" onClick={() => setDeleteAccountOpen(true)}>Delete account</button></div></div>
          </div>
        </section>

        <section className="settings-section" id="about" aria-labelledby="about-title">
          <h2 id="about-title">About Drift</h2>
          <p>Version 1.0. Build with care. No third-party tracking scripts.</p>
          <div className="settings-card">
            <div className="settings-row"><div className="settings-copy"><strong>Runtime</strong><span>Next.js + React + Prisma. SQLite locally; PostgreSQL path documented.</span></div><div className="settings-control"><span className="badge accent">{health?.status ?? "checking…"}</span></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Health</strong><span>{health ? `${health.latencyMs} ms database latency · v${health.version}` : "Open this section to check /api/health."}</span></div><div className="settings-control"><a className="btn ghost sm" href="/api/health" target="_blank" rel="noreferrer"><BarChart3 size={12} /> API</a></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Keyboard</strong><span>Ctrl/⌘ K palette · C capture · G then T/U/C/A/S/B · ? shortcuts</span></div><div className="settings-control"><kbd className="kbd">?</kbd></div></div>
            <div className="settings-row"><div className="settings-copy"><strong>Support</strong><span>Documentation, operations, security, and data-processing notes ship with the project in docs/.</span></div><div className="settings-control"><span className="badge slate"><Globe2 size={10} /> Local-first</span></div></div>
          </div>
        </section>
      </main>

      <Modal open={deleteAccountOpen} onClose={() => { setDeleteAccountOpen(false); setDeleteConfirm(""); }} title="Delete your account?" eyebrow="This cannot be undone" width={480} footer={<><button type="button" className="btn ghost" onClick={() => { setDeleteAccountOpen(false); setDeleteConfirm(""); }}>Keep account</button><button type="button" className="btn danger solid" disabled={deleteConfirm !== "DELETE"} onClick={() => void deleteAccount()}>Delete forever</button></>}>
        <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>This soft-deletes your personal workspaces, removes your password, MFA secret, and sessions. Audit records may remain for retention. Type <strong>DELETE</strong> to confirm.</p>
        <label className="field"><span>Confirmation</span><input className="input" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" autoFocus /></label>
      </Modal>
    </div>
  );
}

function notificationsPrefs(settings: UserSettings): { inApp: boolean; email: boolean; mentions: boolean } {
  try {
    return { inApp: true, email: true, mentions: true, ...JSON.parse(settings.notificationsJson) };
  } catch {
    return { inApp: true, email: true, mentions: true };
  }
}
