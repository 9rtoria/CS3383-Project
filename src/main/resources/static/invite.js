(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const token = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) || "");

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message || `Request failed (${response.status})`);
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  function maskedEmail(value) {
    const email = String(value || "");
    const at = email.indexOf("@");
    if (at <= 1) return email;
    return `${email[0]}•••${email.slice(at)}`;
  }

  function fail(message) {
    $("inviteTitle").textContent = "This invitation cannot be used";
    $("inviteCopy").textContent = message;
    $("inviteError").textContent = message;
    $("inviteError").classList.remove("hidden");
    $("inviteAccept").classList.add("hidden");
    $("inviteSignIn").classList.add("hidden");
    $("inviteMeta").replaceChildren();
  }

  async function load() {
    if (!token) {
      fail("The invitation link is incomplete.");
      return;
    }
    let preview;
    try {
      preview = await api(`/api/invites/${encodeURIComponent(token)}`);
    } catch (error) {
      fail(error.message);
      return;
    }
    const invite = preview.invite || {};
    const workspace = invite.workspace || {};
    $("inviteTitle").textContent = `Join ${workspace.name || "this workspace"}`;
    $("inviteCopy").textContent = `You were invited as ${String(invite.role || "MEMBER").toLowerCase()}.`;
    const meta = $("inviteMeta");
    meta.replaceChildren();
    const workspaceRow = document.createElement("div");
    workspaceRow.className = "invite-meta-row";
    workspaceRow.innerHTML = "<span>Workspace</span>";
    const workspaceValue = document.createElement("strong");
    workspaceValue.textContent = workspace.name || "Workspace";
    workspaceRow.append(workspaceValue);
    const emailRow = document.createElement("div");
    emailRow.className = "invite-meta-row";
    emailRow.innerHTML = "<span>Invited email</span>";
    const emailValue = document.createElement("strong");
    emailValue.textContent = maskedEmail(invite.email);
    emailRow.append(emailValue);
    const roleRow = document.createElement("div");
    roleRow.className = "invite-meta-row";
    roleRow.innerHTML = "<span>Role</span>";
    const roleValue = document.createElement("strong");
    roleValue.textContent = String(invite.role || "MEMBER").toLowerCase();
    roleRow.append(roleValue);
    meta.append(workspaceRow, emailRow, roleRow);

    let boot = null;
    try {
      boot = await api("/api/auth/guest", { method: "POST" });
    } catch {
      // The invite preview is still useful without a session.
    }
    const user = boot?.user || null;
    const guest = !user || Number(user.isGuest) === 1;
    const matches = user?.email && String(user.email).toLowerCase() === String(invite.email).toLowerCase();
    const signIn = $("inviteSignIn");
    signIn.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
    if (matches && !guest) {
      $("inviteAccept").classList.remove("hidden");
      $("inviteCopy").textContent = "This invitation matches your signed-in account.";
    } else {
      signIn.classList.remove("hidden");
      $("inviteCopy").textContent = guest
        ? "Sign in or create an account with the invited email address to accept."
        : `Sign in as ${maskedEmail(invite.email)} to accept this invitation.`;
      if (user?.email && !matches) {
        $("inviteError").textContent = "You are signed in as " + maskedEmail(user.email) + ".";
        $("inviteError").classList.remove("hidden");
      }
    }
  }

  $("inviteAccept").addEventListener("click", async () => {
    const button = $("inviteAccept");
    button.disabled = true;
    try {
      await api(`/api/invites/${encodeURIComponent(token)}`, { method: "POST" });
      $("inviteTitle").textContent = "You are in";
      $("inviteCopy").textContent = "The workspace was added to your account. Opening Drift…";
      $("inviteMeta").replaceChildren();
      $("inviteError").classList.add("hidden");
      $("inviteSignIn").classList.add("hidden");
      button.classList.add("hidden");
      window.setTimeout(() => window.location.assign("/"), 900);
    } catch (error) {
      $("inviteError").textContent = error.message;
      $("inviteError").classList.remove("hidden");
      button.disabled = false;
    }
  });

  void load();
})();
