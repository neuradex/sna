export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SNA Admin</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f4; color: #202124; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px 56px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { font-size: 28px; line-height: 1.15; margin: 0; font-weight: 720; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0 0 12px; font-weight: 680; letter-spacing: 0; }
    .status { display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px; border-radius: 6px; background: #e6f3ed; color: #12633d; font-size: 13px; font-weight: 650; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .panel { border: 1px solid #deded8; border-radius: 8px; background: #ffffff; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    input { flex: 1 1 320px; min-width: 0; height: 36px; border: 1px solid #c9c9c0; border-radius: 6px; padding: 0 10px; font: inherit; background: #fff; color: #202124; }
    button { height: 36px; border: 1px solid #202124; border-radius: 6px; background: #202124; color: #fff; padding: 0 12px; font: inherit; font-weight: 650; cursor: pointer; }
    button.secondary { background: #fff; color: #202124; border-color: #c9c9c0; }
    dl { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px 14px; margin: 0; font-size: 14px; }
    dt { color: #626258; }
    dd { margin: 0; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; border-bottom: 1px solid #ecece7; padding: 9px 8px; vertical-align: top; }
    th { color: #626258; font-weight: 650; }
    .muted { color: #6f6f66; font-size: 13px; }
    .error { color: #9b1c1c; }
    @media (prefers-color-scheme: dark) {
      body { background: #171713; color: #f4f1e8; }
      .panel { background: #20201b; border-color: #393930; }
      input { background: #171713; color: #f4f1e8; border-color: #4b4b41; }
      button.secondary { background: #20201b; color: #f4f1e8; border-color: #4b4b41; }
      button { background: #f4f1e8; color: #171713; border-color: #f4f1e8; }
      th, td { border-bottom-color: #33332b; }
      .status { background: #173729; color: #8ce0b5; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>SNA Admin</h1>
      <div id="status" class="status">Checking</div>
    </header>

    <div class="grid">
      <section class="panel">
        <h2>Connection</h2>
        <div class="row">
          <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Auth token">
          <button id="save">Save</button>
          <button id="clear" class="secondary">Clear</button>
          <button id="refresh" class="secondary">Refresh</button>
        </div>
      </section>

      <section class="panel">
        <h2>Server</h2>
        <dl id="server"><dt>State</dt><dd class="muted">Loading</dd></dl>
      </section>

      <section class="panel">
        <h2>Authorization Requests</h2>
        <div id="auth-requests" class="muted">Loading</div>
      </section>

      <section class="panel">
        <h2>Sessions</h2>
        <div id="sessions" class="muted">Loading</div>
      </section>
    </div>
  </main>

  <script>
    const tokenInput = document.querySelector("#token");
    const statusEl = document.querySelector("#status");
    const serverEl = document.querySelector("#server");
    const sessionsEl = document.querySelector("#sessions");
    const authRequestsEl = document.querySelector("#auth-requests");
    const storageKey = "sna.admin.authToken";

    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const tokenFromUrl = hashParams.get("token") || url.searchParams.get("token");
    if (tokenFromUrl) {
      localStorage.setItem(storageKey, tokenFromUrl);
      hashParams.delete("token");
      url.searchParams.delete("token");
      url.hash = hashParams.toString();
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    tokenInput.value = localStorage.getItem(storageKey) || "";

    document.querySelector("#save").addEventListener("click", () => {
      localStorage.setItem(storageKey, tokenInput.value.trim());
      refresh();
    });
    document.querySelector("#clear").addEventListener("click", () => {
      localStorage.removeItem(storageKey);
      tokenInput.value = "";
      refresh();
    });
    document.querySelector("#refresh").addEventListener("click", refresh);
    authRequestsEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-auth-action]");
      if (!button) return;
      if (button.disabled) return;
      button.disabled = true;
      try {
        await postJson("/auth/pkce/requests/" + encodeURIComponent(button.dataset.requestId) + "/" + button.dataset.authAction, token());
        await refresh();
      } catch (err) {
        authRequestsEl.innerHTML = '<span class="error">' + escapeHtml(err.message || String(err)) + '</span>';
      }
    });

    function token() {
      return tokenInput.value.trim() || localStorage.getItem(storageKey) || "";
    }

    async function getJson(path, auth) {
      const headers = auth ? { Authorization: "Bearer " + auth } : {};
      const res = await fetch(path, { headers });
      let body = null;
      try { body = await res.json(); } catch {}
      if (!res.ok) throw new Error(body?.message || res.status + " " + res.statusText);
      return body;
    }

    async function postJson(path, auth) {
      const headers = auth ? { Authorization: "Bearer " + auth } : {};
      const res = await fetch(path, { method: "POST", headers });
      let body = null;
      try { body = await res.json(); } catch {}
      if (!res.ok) throw new Error(body?.message || res.status + " " + res.statusText);
      return body;
    }

    async function refresh() {
      statusEl.textContent = "Checking";
      sessionsEl.textContent = "Loading";
      authRequestsEl.textContent = "Loading";
      try {
        const health = await getJson("/health");
        serverEl.innerHTML = [
          ["Name", health.name || "unknown"],
          ["Version", health.version || "unknown"],
          ["Auth", token() ? "token set" : "token required"],
          ["URL", location.origin],
        ].map(([k, v]) => "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd>").join("");

        if (!token()) {
          statusEl.textContent = "Token Required";
          sessionsEl.textContent = "Enter an auth token to load sessions.";
          authRequestsEl.textContent = "Enter an auth token to manage authorization requests.";
          return;
        }

        const authData = await getJson("/auth/pkce/requests", token());
        renderAuthRequests(authData.requests || []);
        const data = await getJson("/agent/sessions", token());
        renderSessions(data.sessions || []);
        statusEl.textContent = "Connected";
      } catch (err) {
        statusEl.textContent = "Error";
        sessionsEl.innerHTML = '<span class="error">' + escapeHtml(err.message || String(err)) + '</span>';
      }
    }

    function renderAuthRequests(requests) {
      if (!requests.length) {
        authRequestsEl.textContent = "No pending requests";
        return;
      }
      authRequestsEl.innerHTML = '<table><thead><tr><th>Client</th><th>Scopes</th><th>State</th><th></th></tr></thead><tbody>' +
        requests.map((r) => '<tr><td>' + escapeHtml(r.displayName || r.clientId) + '<div class="muted">' + escapeHtml(r.clientId) +
          '</div></td><td>' + escapeHtml((r.scopes || []).join(", ")) + '</td><td>' + escapeHtml(r.status) +
          '</td><td>' + renderAuthRequestActions(r) + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function renderAuthRequestActions(request) {
      if (request.status !== "pending") return "";
      return '<button data-auth-action="approve" data-request-id="' + escapeHtml(request.requestId) + '">Approve</button> ' +
        '<button class="secondary" data-auth-action="deny" data-request-id="' + escapeHtml(request.requestId) + '">Deny</button>';
    }

    function renderSessions(sessions) {
      if (!sessions.length) {
        sessionsEl.textContent = "No sessions";
        return;
      }
      sessionsEl.innerHTML = '<table><thead><tr><th>ID</th><th>State</th><th>Provider</th><th>CWD</th></tr></thead><tbody>' +
        sessions.map((s) => '<tr><td>' + escapeHtml(s.id) + '</td><td>' + escapeHtml(s.state || "") + '</td><td>' +
          escapeHtml(s.config?.provider || "") + '</td><td>' + escapeHtml(s.cwd || "") + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[ch]);
    }

    refresh();
  </script>
</body>
</html>`;
}
