"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, KeyRound, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { InlineError, LoadingButton } from "@/components/ui";
import { api, formatApiError } from "@/lib/client";

type Mode = "signin" | "signup" | "magic";

type Props = {
  initialClaim: boolean;
  initialMode: Mode;
  challenge: string;
  next: string;
  guestName: string;
  providers: { id: string; label: string; enabled: boolean }[];
  signupAvailable: boolean;
  initialError?: string;
};

function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function AuthClient({ initialClaim, initialMode, challenge, next, guestName, providers, signupAvailable, initialError = "" }: Props) {
  const [mode, setMode] = useState<Mode>(initialClaim ? "signup" : initialMode);
  const [name, setName] = useState(guestName && guestName !== "You" ? guestName : "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState(challenge);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (challenge) setMfaChallenge(challenge);
  }, [challenge]);

  const title = mfaChallenge ? "One more check" : initialClaim ? "Keep this workspace" : mode === "signup" ? "Create your account" : mode === "magic" ? "A link, not a password" : "Welcome back";
  const subtitle = mfaChallenge
    ? "Enter the six-digit code from your authenticator, or one of your backup codes."
    : initialClaim
      ? "Your guest tasks and boards are already here. Add an email and password to keep them across devices."
      : mode === "signup"
        ? "An account keeps your boards, settings, and reminders in sync."
        : mode === "magic"
          ? "We will email a one-time sign-in link. No password to remember."
          : "Sign in to pick up where you left off.";

  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ mfaRequired: boolean; challenge?: string }>("/api/auth/signin", {
        method: "POST",
        body: { email, password, totp: mfaChallenge ? code : undefined },
      });
      if (result.mfaRequired && result.challenge) {
        setMfaChallenge(result.challenge);
        setCode("");
      } else {
        window.location.assign(safeNext(next));
      }
    } catch (signInError) {
      setError(formatApiError(signInError));
    } finally {
      setBusy(false);
    }
  }

  async function signUp(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!signupAvailable) {
        await api("/api/auth/guest", { method: "POST" });
      }
      await api("/api/auth/signup", {
        method: "POST",
        body: { name: name.trim() || "You", email, password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      window.location.assign(safeNext(next));
    } catch (signUpError) {
      setError(formatApiError(signUpError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/mfa/challenge", { method: "POST", body: { challenge: mfaChallenge, code } });
      window.location.assign(safeNext(next));
    } catch (mfaError) {
      setError(formatApiError(mfaError));
    } finally {
      setBusy(false);
    }
  }

  async function requestMagic(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ sent: boolean; devUrl?: string }>("/api/auth/magic", {
        method: "POST",
        body: { email, next: safeNext(next) },
      });
      setSent(true);
      setDevUrl(result.devUrl ?? "");
    } catch (magicError) {
      setError(formatApiError(magicError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" id="main">
      <aside className="auth-aside" aria-label="About Drift">
        <Link className="brand" href="/" aria-label="Drift home">
          <span className="brand-mark" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h12a5 5 0 0 1 0 10H9" /><circle cx="5" cy="18" r="1.6" fill="currentColor" stroke="none" /></svg>
          </span>
          Drift
        </Link>
        <div>
          <p className="auth-quote">A calm place for the work that matters. No setup ceremony. No clutter.</p>
          <footer>Capture in seconds. Plan by capacity. Keep the keyboard if you like.</footer>
        </div>
        <div style={{ display: "grid", gap: 11, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Check size={13} aria-hidden style={{ color: "var(--accent)" }} /> Your guest board stays with you</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Check size={13} aria-hidden style={{ color: "var(--accent)" }} /> Full-text search and offline capture</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Check size={13} aria-hidden style={{ color: "var(--accent)" }} /> Export and delete your data anytime</span>
        </div>
      </aside>

      <section className="auth-main">
        <div className="auth-card">
          <Link className="btn ghost sm" href="/" style={{ marginBottom: 22 }}><ArrowLeft size={13} /> Back to the app</Link>
          {initialClaim && !mfaChallenge ? (
            <div className="auth-guest-banner">
              <Sparkles size={15} aria-hidden />
              <span>You started as a guest. Claiming is optional — your work is already saved in this session.</span>
            </div>
          ) : null}

          <h1 className="auth-title">{title}</h1>
          <p className="auth-sub">{subtitle}</p>

          {mfaChallenge ? (
            <form onSubmit={verifyMfa} className="form-grid">
              <label className="field">
                <span>Verification code</span>
                <input className="input" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456 or backup code" maxLength={20} />
              </label>
              {error ? <InlineError>{error}</InlineError> : null}
              <LoadingButton loading={busy} type="submit" block><ShieldCheck size={15} /> Verify and sign in</LoadingButton>
              <button type="button" className="btn ghost block" onClick={() => { setMfaChallenge(""); setCode(""); setError(""); }}>Use a different account</button>
            </form>
          ) : mode === "magic" ? (
            sent ? (
              <div>
                <div className="settings-card" style={{ padding: 18 }}>
                  <div className="inline" style={{ gap: 9 }}><Mail size={17} aria-hidden style={{ color: "var(--accent)" }} /><strong style={{ fontSize: 13 }}>Check your inbox</strong></div>
                  <p className="field-hint" style={{ marginTop: 8 }}>If {email} can receive mail, a one-time link is on its way. It expires in 15 minutes.</p>
                  {devUrl ? <div className="dev-link">Local development link: <a href={devUrl}>{devUrl}</a></div> : null}
                </div>
                <button type="button" className="btn ghost block" style={{ marginTop: 12 }} onClick={() => { setSent(false); setDevUrl(""); }}>Use another email</button>
              </div>
            ) : (
              <form onSubmit={requestMagic} className="form-grid">
                <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
                {error ? <InlineError>{error}</InlineError> : null}
                <LoadingButton loading={busy} type="submit" block><Mail size={15} /> Email me a sign-in link</LoadingButton>
              </form>
            )
          ) : mode === "signup" ? (
            <form onSubmit={signUp} className="form-grid">
              <label className="field"><span>Your name</span><input className="input" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" /></label>
              <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
              <label className="field">
                <span>Password</span>
                <input className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" />
                <span className="field-hint">Use 10+ characters with upper case, lower case, and a number. <button type="button" className="linkish" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span>
              </label>
              {error ? <InlineError>{error}</InlineError> : null}
              <LoadingButton loading={busy} type="submit" block><ArrowRight size={15} /> {initialClaim ? "Save my workspace" : "Create account"}</LoadingButton>
              <p className="field-hint" style={{ textAlign: "center" }}>Already have an account? <button type="button" className="linkish" onClick={() => setMode("signin")}>Sign in</button></p>
            </form>
          ) : (
            <form onSubmit={signIn} className="form-grid">
              <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
              <label className="field">
                <span>Password</span>
                <input className="input" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
                <span className="field-hint"><button type="button" className="linkish" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide password" : "Show password"}</button></span>
              </label>
              {error ? <InlineError>{error}</InlineError> : null}
              <LoadingButton loading={busy} type="submit" block><ArrowRight size={15} /> Sign in</LoadingButton>
              <div className="auth-divider">or</div>
              <button type="button" className="oauth-button" onClick={() => { setMode("magic"); setError(""); }}><Mail size={15} /> Email me a magic link</button>
              {!initialClaim ? <p className="field-hint" style={{ textAlign: "center" }}>New to Drift? <button type="button" className="linkish" onClick={() => setMode("signup")}>Create an account</button></p> : <p className="field-hint" style={{ textAlign: "center" }}>Signing in can merge this guest workspace into your account.</p>}
            </form>
          )}

          {enabledProviders.length && !mfaChallenge ? (
            <>
              <div className="auth-divider">or continue with</div>
              <div className="oauth-row">
                {enabledProviders.map((provider) => (
                  <a key={provider.id} className="oauth-button" href={`/api/auth/oauth/${provider.id}?next=${encodeURIComponent(safeNext(next))}`}>{provider.label}</a>
                ))}
              </div>
            </>
          ) : null}

          <div className="auth-tabs" style={{ marginTop: 26, marginBottom: 0 }}>
            {initialClaim ? null : <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); }}><KeyRound size={11} style={{ marginRight: 4 }} /> Password</button>}
            {signupAvailable && !initialClaim ? <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button> : null}
            <button type="button" className={mode === "magic" ? "active" : ""} onClick={() => { setMode("magic"); setSent(false); setError(""); }}>Magic link</button>
          </div>
          <p className="auth-footer-note">By continuing you agree to use Drift responsibly. Your data stays in this workspace until you export or delete it. <a href="/api/health">Status</a></p>
        </div>
      </section>
    </main>
  );
}
