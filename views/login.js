function renderLogin(user) {
  const app = document.getElementById('app');

  // ── Logged out: show sign-in ──────────────────────────────────────────────
  if (!user) {
    app.innerHTML = `
      <div class="login-wrap">
        <h1 class="logo">🍽️ Makan Vote</h1>
        <p class="tagline">Vote on where to eat, together.</p>
        <div class="card center">
          <p>Sign in to create or join a session.</p>
          <button id="google-btn" class="google-btn">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" />
            Continue with Google
          </button>
          <p class="err hidden" id="auth-err"></p>
        </div>
      </div>
    `;
    document.getElementById('google-btn').addEventListener('click', async () => {
      try {
        await signInWithGoogle();
        // Page will redirect to Google and back — nothing else needed here
      } catch (e) {
        const el = document.getElementById('auth-err');
        el.textContent = e.message;
        el.classList.remove('hidden');
      }
    });
    return;
  }

  // ── Logged in: show create / join ─────────────────────────────────────────
  const avatarUrl = user.user_metadata?.avatar_url ?? '';
  const fullName  = user.user_metadata?.full_name ?? user.email;

  app.innerHTML = `
    <div class="login-wrap">
      <h1 class="logo">🍽️ Makan Vote</h1>

      <div class="user-pill">
        ${avatarUrl ? `<img class="avatar" src="${avatarUrl}" alt="" />` : ''}
        <span>${escHtml(fullName)}</span>
        <button id="signout-btn" class="link-btn">Sign out</button>
      </div>

      <div class="card">
        <h2>Create Session</h2>
        <p class="hint">You'll get a room code to share with friends.</p>
        <button id="create-btn">Create Session</button>
        <p class="err hidden" id="create-err"></p>
      </div>

      <div class="divider">— or —</div>

      <div class="card">
        <h2>Join Session</h2>
        <input id="join-code" type="text" maxlength="6" placeholder="Room code (e.g. AB12CD)" autocomplete="off" />
        <button id="join-btn">Join</button>
        <p class="err hidden" id="join-err"></p>
      </div>
    </div>
  `;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
    // onAuthStateChange in app.js will re-render login
  });

  document.getElementById('create-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('create-err');
    setLoading('create-btn', true);
    try {
      const session = await createSession(user);
      saveSessionLocal(session.id, session.code);
      App.go('vote');
    } catch (e) {
      showErr(errEl, 'Could not create session: ' + e.message);
    } finally {
      setLoading('create-btn', false);
    }
  });

  document.getElementById('join-btn').addEventListener('click', async () => {
    const code  = document.getElementById('join-code').value.trim().toUpperCase();
    const errEl = document.getElementById('join-err');
    if (!code) { showErr(errEl, 'Enter the room code.'); return; }

    setLoading('join-btn', true);
    try {
      const session = await getSessionByCode(code);
      if (session.locked) {
        showErr(errEl, 'This session is locked — voting has ended.');
        return;
      }
      await joinSession(session.id, user);
      saveSessionLocal(session.id, session.code);
      App.go('vote');
    } catch (e) {
      showErr(errEl, 'Could not join: ' + e.message);
    } finally {
      setLoading('join-btn', false);
    }
  });

  document.getElementById('join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('join-btn').click();
  });
  document.getElementById('join-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = loading;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Session localStorage ──────────────────────────────────────────────────────
const LS_SESSION_KEY = 'makan_vote_session';

function saveSessionLocal(sessionId, code) {
  localStorage.setItem(LS_SESSION_KEY, JSON.stringify({ sessionId, code }));
}

function loadSessionLocal() {
  try { return JSON.parse(localStorage.getItem(LS_SESSION_KEY)); } catch { return null; }
}

function clearSessionLocal() {
  localStorage.removeItem(LS_SESSION_KEY);
}
