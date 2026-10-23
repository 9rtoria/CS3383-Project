"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, LogOut, Mail, UsersRound } from "lucide-react";
import { LoadingButton, InlineError } from "@/components/ui";
import { api, formatApiError } from "@/lib/client";

export function InviteAccept({ token, valid, workspaceName, workspaceType, role, maskedEmail, viewerEmail, isGuest, canAccept }: {
  token: string;
  valid: boolean;
  workspaceName: string;
  workspaceType: string;
  role: string;
  maskedEmail: string;
  viewerEmail: string | null;
  isGuest: boolean;
  canAccept: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ accepted: boolean; workspaceId: string }>(`/api/invites/${encodeURIComponent(token)}`, { method: "POST", body: {} });
      setAccepted(true);
      localStorage.setItem("drift-workspace", result.workspaceId);
      setTimeout(() => window.location.assign("/"), 500);
    } catch (acceptError) {
      setError(formatApiError(acceptError));
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    await api("/api/auth/signout", { method: "DELETE" }).catch(() => undefined);
    window.location.assign(`/auth?next=/invite/${encodeURIComponent(token)}`);
  }

  return (
    <main id="main" className="auth-page" style={{ gridTemplateColumns: "1fr" }}>
      <section className="auth-main">
        <div className="auth-card">
          <Link className="brand" href="/" style={{ marginBottom: 28 }}>
            <span className="brand-mark" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h12a5 5 0 0 1 0 10H9" /><circle cx="5" cy="18" r="1.6" fill="currentColor" stroke="none" /></svg>
            </span>
            Drift
          </Link>
          <div className="eyebrow"><UsersRound size={12} /> Workspace invitation</div>
          <h1 className="auth-title">{valid ? `Join ${workspaceName}` : "This invitation is unavailable"}</h1>
          <p className="auth-sub">
            {valid
              ? `You were invited as ${role.toLowerCase()} to a ${workspaceType} workspace. This is a separate space from your personal boards.`
              : "The link may have expired or already been used. Ask a workspace admin for a fresh invitation."}
          </p>

          {valid ? (
            <div className="settings-card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="settings-row" style={{ border: 0, padding: 0 }}><Mail size={18} aria-hidden style={{ color: "var(--faint)" }} /><div className="settings-copy"><strong>{maskedEmail}</strong><span>Invitation expires after seven days.</span></div><span className="badge accent">{role}</span></div>
            </div>
          ) : null}

          {accepted ? (
            <div className="auth-guest-banner" role="status"><Check size={15} /> You are in. Opening the workspace…</div>
          ) : canAccept ? (
            <LoadingButton loading={busy} className="btn primary block" onClick={() => void accept()}><Check size={15} /> Accept invitation</LoadingButton>
          ) : valid && viewerEmail && !isGuest ? (
            <>
              <div className="auth-guest-banner"><Mail size={15} /><span>You are signed in as {viewerEmail}, but this invitation is for {maskedEmail}.</span></div>
              <button type="button" className="btn block" onClick={() => void switchAccount()}><LogOut size={14} /> Sign in as the invited account</button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <a className="btn primary block" href={`/auth?next=/invite/${encodeURIComponent(token)}&mode=signin`}><ArrowRight size={14} /> Sign in to accept</a>
              <a className="btn block" href={`/auth?next=/invite/${encodeURIComponent(token)}&mode=magic`}>Email me a sign-in link</a>
              <a className="btn ghost block" href={`/auth?next=/invite/${encodeURIComponent(token)}&mode=signup`}>Create an account</a>
              <p className="field-hint" style={{ textAlign: "center" }}>Use the email address that received this invitation. Your current guest work stays in its own workspace.</p>
            </div>
          )}
          {error ? <InlineError>{error}</InlineError> : null}
          <p className="auth-footer-note"><Link href="/">Return to Drift</Link></p>
        </div>
      </section>
    </main>
  );
}
