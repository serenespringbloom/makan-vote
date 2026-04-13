import { signInWithGoogle, signInAnonymously, signOut, createSession, getSessionByCode, joinSession, saveSessionLocal } from '../supabase.js';

export function renderLogin(user, onNavigate) {
  const app = document.getElementById('app');

  // ── Logged in as Google user: show create + join ───────────────────────────
  if (user && !user.is_anonymous) {
    const avatarUrl = user.user_metadata?.avatar_url ?? '';
    const fullName  = user.user_metadata?.full_name ?? user.email;

    app.innerHTML = `
      <div class="q-page">
        <div class="q-hero">
          <div class="q-logo">🍽️ Makan Vote</div>
          <p class="q-sub">Where are we eating today?</p>
        </div>

        <div class="q-cards">
          <div class="q-card q-card--creator">
            <div class="q-card__icon">✨</div>
            <h2>Create Session</h2>
            <p>Start a new vote and invite your friends.</p>
            <div class="q-user-pill">
              ${avatarUrl ? `<img class="q-avatar" src="${avatarUrl}" alt="" />` : ''}
              <span>${escHtml(fullName)}</span>
              <button id="signout-btn" class="q-link-btn">Sign out</button>
            </div>
            <button id="create-btn" class="q-btn q-btn--primary">Create Session</button>
            <p class="q-err hidden" id="create-err"></p>
          </div>

          <div class="q-card q-card--joiner">
            <div class="q-card__icon">🚀</div>
            <h2>Join Session</h2>
            <p>Enter a room code to join your friends.</p>
            <input id="join-code" class="q-input" type="text" maxlength="6" placeholder="Room code" autocomplete="off" />
            <input id="join-name" class="q-input" type="text" maxlength="20" placeholder="Your name" autocomplete="off" />
            <button id="join-btn" class="q-btn q-btn--secondary">Join</button>
            <p class="q-err hidden" id="join-err"></p>
          </div>
        </div>

        <button id="guest-switch-btn" class="q-link-btn q-center-link">Join as guest instead</button>
      </div>
    `;

    document.getElementById('signout-btn').addEventListener('click', () => signOut());

    document.getElementById('create-btn').addEventListener('click', async () => {
      const errEl = document.getElementById('create-err');
      setLoading('create-btn', true);
      try {
        const session = await createSession(user);
        saveSessionLocal(session.id, session.code);
        onNavigate('vote', session);
      } catch (e) {
        showErr(errEl, 'Could not create session: ' + e.message);
      } finally {
        setLoading('create-btn', false);
      }
    });

    document.getElementById('join-btn').addEventListener('click', () => handleJoin(user, onNavigate));
    document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleJoin(user, onNavigate); });
    document.getElementById('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
    document.getElementById('guest-switch-btn').addEventListener('click', () => renderGuestJoin(onNavigate));
    return;
  }

  // ── Not logged in: show sign-in + guest join ───────────────────────────────
  app.innerHTML = `
    <div class="q-page">
      <div class="q-hero">
        <div class="q-logo">🍽️ Makan Vote</div>
        <p class="q-sub">Where are we eating today?</p>
      </div>

      <div class="q-cards">
        <div class="q-card q-card--creator">
          <div class="q-card__icon">✨</div>
          <h2>Create Session</h2>
          <p>Sign in with Google to start a vote.</p>
          <button id="google-btn" class="q-btn q-btn--google">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" />
            Continue with Google
          </button>
          <p class="q-err hidden" id="auth-err"></p>
        </div>

        <div class="q-card q-card--joiner">
          <div class="q-card__icon">🚀</div>
          <h2>Join Session</h2>
          <p>No account needed — just enter a code and your name.</p>
          <input id="join-code" class="q-input" type="text" maxlength="6" placeholder="Room code" autocomplete="off" />
          <input id="join-name" class="q-input" type="text" maxlength="20" placeholder="Your name" autocomplete="off" />
          <button id="join-btn" class="q-btn q-btn--secondary">Join</button>
          <p class="q-err hidden" id="join-err"></p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('google-btn').addEventListener('click', async () => {
    try { await signInWithGoogle(); }
    catch (e) { showErr(document.getElementById('auth-err'), e.message); }
  });

  document.getElementById('join-btn').addEventListener('click', () => handleGuestJoin(onNavigate));
  document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleGuestJoin(onNavigate); });
  document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleGuestJoin(onNavigate); });
  document.getElementById('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
}

function renderGuestJoin(onNavigate) {
  // Reuse the guest join section — just scroll/focus
  const joinCode = document.getElementById('join-code');
  if (joinCode) { joinCode.focus(); return; }
  // Fallback: re-render as logged-out state
  renderLogin(null, onNavigate);
}

async function handleJoin(user, onNavigate) {
  const code  = document.getElementById('join-code')?.value.trim().toUpperCase();
  const name  = document.getElementById('join-name')?.value.trim() || user?.user_metadata?.full_name;
  const errEl = document.getElementById('join-err');
  if (!code) { showErr(errEl, 'Enter the room code.'); return; }
  setLoading('join-btn', true);
  try {
    const session = await getSessionByCode(code);
    if (session.locked) { showErr(errEl, 'This session is locked.'); return; }
    await joinSession(session.id, { ...user, user_metadata: { ...user.user_metadata, full_name: name || user.user_metadata?.full_name } });
    saveSessionLocal(session.id, session.code);
    onNavigate('vote', session);
  } catch (e) {
    showErr(errEl, 'Could not join: ' + e.message);
  } finally {
    setLoading('join-btn', false);
  }
}

async function handleGuestJoin(onNavigate) {
  const code  = document.getElementById('join-code')?.value.trim().toUpperCase();
  const name  = document.getElementById('join-name')?.value.trim();
  const errEl = document.getElementById('join-err');
  if (!code) { showErr(errEl, 'Enter the room code.'); return; }
  if (!name) { showErr(errEl, 'Enter your name.'); return; }
  setLoading('join-btn', true);
  try {
    const session = await getSessionByCode(code);
    if (session.locked) { showErr(errEl, 'This session is locked.'); return; }
    // Sign in anonymously then join
    const guestUser = await signInAnonymously(name);
    await joinSession(session.id, { ...guestUser, user_metadata: { full_name: name, is_guest: true } });
    saveSessionLocal(session.id, session.code);
    onNavigate('vote', session);
  } catch (e) {
    showErr(errEl, 'Could not join: ' + e.message);
  } finally {
    setLoading('join-btn', false);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden'); } }
function setLoading(id, val) { const b = document.getElementById(id); if (b) b.disabled = val; }
export function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
