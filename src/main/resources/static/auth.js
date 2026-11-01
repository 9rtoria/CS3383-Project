(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  const ERROR_MESSAGES = {
    magic_state: "This sign-in link was opened in a different browser. Request a new link.",
    magic_invalid: "This sign-in link is invalid, expired, or has already been used.",
    provider_unavailable: "That sign-in provider is not configured.",
    access_denied: "The provider sign-in was cancelled.",
    missing_code: "The provider did not return a sign-in code.",
    state_mismatch: "This provider sign-in was opened in a different browser. Try again.",
    state_invalid: "This provider sign-in expired. Try again.",
    oauth_failed: "The provider sign-in could not be completed. Try again or use email.",
    sso_unavailable: "Single sign-on is not enabled for that workspace.",
    sso_discovery_failed: "The workspace identity provider could not be reached.",
    sso_failed: "Single sign-on could not be completed. Contact your workspace admin.",
    domain_not_allowed: "That email domain is not allowed for this workspace.",
    email_required: "The identity provider did not share an email address.",
    email_unverified: "The identity provider did not verify this email address.",
    account_link_required: "This email already belongs to an account. Sign in with your existing method.",
    account_unavailable: "That account is no longer available.",
  };

  const state = {
    mode: "signin",
    next: safeNext(query.get("next") || "/"),
    challenge: query.get("mfa") === "1" ? (query.get("challenge") || "") : "",
    claim: false,
    busy: false,
  };

  const forms = {
    signin: $("signinForm"),
    signup: $("signupForm"),
    magic: $("magicForm"),
    mfa: $("mfaForm"),
  };
  const tabs = $("authTabs");

  function safeNext(value) {
    if (!value) return "/";
    return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.code;
      throw error;
    }
    return payload;
  }

  function showError(message) {
    const box = $("authError");
    if (!message) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.textContent = message;
    box.classList.remove("hidden");
  }

  function titles() {
    if (state.challenge) {
      return ["One more check", "Enter the six-digit code from your authenticator, or one of your backup codes."];
    }
    if (state.claim) {
      return ["Keep this workspace", "Your guest tasks and boards are already here. Add an email and password to keep them across devices."];
    }
    if (state.mode === "signup") {
      return ["Create your account", "An account keeps your boards, settings, and reminders in sync."];
    }
    if (state.mode === "magic") {
      return ["A link, not a password", "We will email a one-time sign-in link. No password to remember."];
    }
    return ["Welcome back", "Sign in to pick up where you left off."];
  }

  function render() {
    const [title, subtitle] = titles();
    $("authTitle").textContent = title;
    $("authSubtitle").textContent = subtitle;
    $("authGuestBanner").classList.toggle("hidden", !state.claim || Boolean(state.challenge));
    $("magicSent").classList.add("hidden");
    for (const [mode, form] of Object.entries(forms)) {
      form.classList.toggle("hidden", Boolean(state.challenge) ? mode !== "mfa" : mode !== state.mode);
    }
    tabs.classList.toggle("hidden", Boolean(state.challenge));
    tabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
    $("tabSignin").classList.toggle("hidden", state.claim);
    $("signupSubmit").lastChild.textContent = state.claim ? " Save my workspace" : " Create account";
    const active = state.challenge ? forms.mfa : forms[state.mode];
    const focus = active?.querySelector("input");
    if (focus) window.setTimeout(() => focus.focus(), 40);
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll(".auth-form button[type=submit]").forEach((button) => {
      button.disabled = busy;
    });
  }

  function goHome() {
    location.assign(state.next || "/");
  }

  function setMode(mode) {
    if (state.busy) return;
    state.mode = mode;
    state.challenge = "";
    showError("");
    render();
  }

  async function signIn(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const email = form.querySelector("[data-auth-email]").value.trim();
    const password = form.querySelector("[data-auth-password]").value;
    showError("");
    setBusy(true);
    try {
      const result = await api("/api/auth/signin", { method: "POST", body: { email, password } });
      if (result?.mfaRequired) {
        state.challenge = result.challenge || "";
        render();
        return;
      }
      goHome();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signUp(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const name = form.querySelector("[data-auth-name]").value.trim();
    const email = form.querySelector("[data-auth-email]").value.trim();
    const password = form.querySelector("[data-auth-password]").value;
    showError("");
    setBusy(true);
    try {
      await api("/api/auth/signup", { method: "POST", body: { name, email, password } });
      goHome();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestMagic(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const email = form.querySelector("[data-auth-email]").value.trim();
    showError("");
    setBusy(true);
    try {
      const result = await api("/api/auth/magic", { method: "POST", body: { email, next: state.next } });
      $("magicSentCopy").textContent = `If ${email} can receive mail, a one-time link is on its way. It expires in 15 minutes.`;
      const devLink = $("authDevLink");
      devLink.replaceChildren();
      if (result?.devUrl) {
        devLink.classList.remove("hidden");
        const label = document.createElement("span");
        label.textContent = "Local development link: ";
        const anchor = document.createElement("a");
        anchor.href = result.devUrl;
        anchor.textContent = result.devUrl;
        devLink.append(label, anchor);
      } else {
        devLink.classList.add("hidden");
      }
      for (const formNode of Object.values(forms)) formNode.classList.add("hidden");
      $("magicSent").classList.remove("hidden");
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event) {
    event.preventDefault();
    if (state.busy) return;
    const code = $("mfaForm").querySelector("[data-auth-code]").value.trim();
    if (!code) {
      showError("Enter a code to continue.");
      return;
    }
    showError("");
    setBusy(true);
    try {
      await api("/api/auth/mfa/challenge", {
        method: "POST",
        body: { challenge: state.challenge, code },
      });
      goHome();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function wire() {
    $("signinForm").addEventListener("submit", signIn);
    $("signupForm").addEventListener("submit", signUp);
    $("magicForm").addEventListener("submit", requestMagic);
    $("mfaForm").addEventListener("submit", verifyMfa);
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });
    document.querySelectorAll("[data-toggle-password]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = button.closest(".field").querySelector("input");
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        button.textContent = showing ? (input.autocomplete === "new-password" ? "Show" : "Show password") : "Hide password";
      });
    });
    $("magicReset").addEventListener("click", () => {
      setMode("magic");
    });
    $("mfaReset").addEventListener("click", () => {
      state.challenge = "";
      state.mode = "signin";
      showError("");
      history.replaceState({}, "", "/auth");
      render();
    });
  }

  async function loadProviders() {
    try {
      const result = await api("/api/auth/providers");
      const providers = result?.providers ?? [];
      const section = $("oauthSection");
      const row = $("oauthProviders");
      if (!providers.length) return;
      row.replaceChildren();
      for (const provider of providers) {
        const link = document.createElement("a");
        link.className = "oauth-button";
        link.href = `/api/auth/oauth/${encodeURIComponent(provider.id)}?next=${encodeURIComponent(state.next || "/")}`;
        link.textContent = `Continue with ${provider.label || provider.id}`;
        row.append(link);
      }
      section.classList.remove("hidden");
    } catch {
      // Provider sign-in is optional; password, magic link, and guest access still work.
    }
  }

  async function init() {
    wire();
    void loadProviders();
    const initialError = query.get("error");
    if (initialError) showError(ERROR_MESSAGES[initialError] || "Sign-in could not be completed. Please try again.");
    try {
      const boot = await api("/api/auth/me");
      const guest = boot?.user?.isGuest === 1 || boot?.user?.isGuest === true;
      if (guest && !state.challenge) {
        state.claim = true;
        state.mode = query.get("mode") === "magic" ? "magic" : query.get("mode") === "signin" ? "signin" : "signup";
        const nameInput = $("signupForm").querySelector("[data-auth-name]");
        if (boot?.user?.name && boot.user.name !== "Guest") nameInput.value = boot.user.name;
      } else if (!guest && !state.challenge) {
        goHome();
        return;
      }
    } catch (error) {
      if (error.status !== 401) {
        // A signed-out visitor is expected here; other failures remain visible below.
      }
    }
    if (query.get("mode") === "magic") state.mode = "magic";
    if (query.get("mode") === "signup") state.mode = "signup";
    if (state.challenge) showError("");
    render();
  }

  void init();
})();
