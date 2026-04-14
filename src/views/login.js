import {
  signInWithGoogle, signInAnonymously, signOut,
  createSession, getSessionByCode, joinSession,
  saveSessionLocal, loadRecentSessions, removeSessionLocal,
  sb,
} from '../supabase.js';
import { confirm as modalConfirm } from '../modal.js';

export function renderLogin(user, onNavigate) {
  const app = document.getElementById('app');

  // ── Logged in as Google user ───────────────────────────────────────────────
  if (user && !user.is_anonymous) {
    const avatarUrl = user.user_metadata?.avatar_url ?? '';
    const fullName  = user.user_metadata?.full_name ?? user.email;
    const recent    = loadRecentSessions();

    app.innerHTML = `
      <div class="q-page">
        <div class="q-hero">
          <div class="q-logo">🍽️ Makan Vote</div>
          <p class="q-sub">Where are we eating today?</p>
        </div>

        ${recent.length > 0 ? `
        <div class="q-recent-wrap">
          <div class="q-recent-label">Recent Sessions</div>
          <div class="q-recent-list">
            ${recent.map(s => `
              <div class="q-recent-card" data-sid="${s.sessionId}">
                <div class="q-recent-info">
                  <span class="q-recent-code">${s.code}</span>
                  <span class="q-recent-status" id="status-${s.sessionId}"></span>
                </div>
                <div class="q-recent-actions">
                  <button class="v-btn v-btn--secondary q-rejoin-btn" data-code="${s.code}" style="width:auto;padding:7px 16px;font-size:13px">Rejoin</button>
                  <button class="q-link-btn danger q-forget-btn" data-id="${s.sessionId}">✕</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

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
            <button id="join-btn" class="q-btn q-btn--secondary">Join</button>
            <p class="q-err hidden" id="join-err"></p>
          </div>
        </div>
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

    // Recent session actions
    document.querySelectorAll('.q-rejoin-btn').forEach(btn => {
      btn.addEventListener('click', () => handleRejoin(btn.dataset.code, user, onNavigate));
    });
    document.querySelectorAll('.q-forget-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await modalConfirm('Remove this session from your recent list?', { confirmText: 'Remove', danger: false })) return;
        removeSessionLocal(btn.dataset.id);
        renderLogin(user, onNavigate);
      });
    });

    // Live session status badges
    subscribeRecentStatus(loadRecentSessions());
    return;
  }

  // ── Guest / not logged in ──────────────────────────────────────────────────
  const recent = user ? loadRecentSessions() : [];

  app.innerHTML = `
    <div class="q-page">
      <div class="q-hero">
        <div class="q-logo">🍽️ Makan Vote</div>
        <p class="q-sub">Where are we eating today?</p>
      </div>

      ${recent.length > 0 ? `
      <div class="q-recent-wrap">
        <div class="q-recent-label">Recent Sessions</div>
        <div class="q-recent-list">
          ${recent.map(s => `
            <div class="q-recent-card">
              <div class="q-recent-info">
                <span class="q-recent-code">${s.code}</span>
              </div>
              <div class="q-recent-actions">
                <button class="v-btn v-btn--secondary q-rejoin-btn" data-code="${s.code}" style="width:auto;padding:7px 16px;font-size:13px">Rejoin</button>
                <button class="q-link-btn danger q-forget-btn" data-id="${s.sessionId}">✕</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="q-cards">
        <div class="q-card q-card--creator">
          <div class="q-card__icon">✨</div>
          <h2>Create Session</h2>
          <p>Sign in with Google to start a new vote session.</p>
          <button id="google-btn" class="q-btn q-btn--google">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" />
            Continue with Google
          </button>
          <p class="q-err hidden" id="auth-err"></p>
        </div>

        <div class="q-card q-card--joiner">
          <div class="q-card__icon">🚀</div>
          <h2>Join Session</h2>
          <p>No account needed — enter a code and your name.</p>
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

  document.getElementById('join-btn').addEventListener('click', () => handleGuestJoin(user, onNavigate));
  document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleGuestJoin(user, onNavigate); });
  document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleGuestJoin(user, onNavigate); });
  document.getElementById('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

  document.querySelectorAll('.q-rejoin-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRejoin(btn.dataset.code, user, onNavigate));
  });
  document.querySelectorAll('.q-forget-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await modalConfirm('Remove this session from your recent list?', { confirmText: 'Remove', danger: false })) return;
      removeSessionLocal(btn.dataset.id);
      renderLogin(user, onNavigate);
    });
  });

  // Live session status badges
  if (recent.length > 0) subscribeRecentStatus(recent);
}

// ── Recent session live status ────────────────────────────────────────────────
let _recentSubs = [];

function subscribeRecentStatus(recent) {
  // Unsubscribe previous
  _recentSubs.forEach(s => s.unsubscribe?.());
  _recentSubs = [];

  recent.forEach(s => {
    const badgeEl = document.getElementById(`status-${s.sessionId}`);
    if (!badgeEl) return;

    // Fetch current status immediately
    sb.from('sessions').select('locked').eq('id', s.sessionId).single()
      .then(({ data }) => {
        if (data) setBadge(badgeEl, data.locked);
      });

    // Subscribe to updates
    const sub = sb
      .channel(`home-session:${s.sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${s.sessionId}` }, payload => {
        setBadge(badgeEl, payload.new.locked);
      })
      .subscribe();
    _recentSubs.push(sub);
  });
}

function setBadge(el, locked) {
  el.textContent = locked ? '🔒 Finalized' : '● Live';
  el.className = `q-recent-status ${locked ? 'finalized' : 'live'}`;
}

// ── Join handlers ─────────────────────────────────────────────────────────────

async function handleJoin(user, onNavigate) {
  const code  = document.getElementById('join-code')?.value.trim().toUpperCase();
  const errEl = document.getElementById('join-err');
  if (!code) { showErr(errEl, 'Enter the room code.'); return; }
  setLoading('join-btn', true);
  try {
    const session = await getSessionByCode(code);
    if (session.locked) { showErr(errEl, 'This session is locked.'); return; }
    await joinSession(session.id, user);
    saveSessionLocal(session.id, session.code);
    onNavigate('vote', session);
  } catch (e) {
    showErr(errEl, 'Could not join: ' + e.message);
  } finally {
    setLoading('join-btn', false);
  }
}

async function handleGuestJoin(user, onNavigate) {
  const code  = document.getElementById('join-code')?.value.trim().toUpperCase();
  const name  = document.getElementById('join-name')?.value.trim();
  const errEl = document.getElementById('join-err');
  if (!code) { showErr(errEl, 'Enter the room code.'); return; }
  if (!name) { showErr(errEl, 'Enter your name.'); return; }
  setLoading('join-btn', true);
  try {
    // Sign in first so the sessions RLS policy (authenticated read) allows the lookup
    let authUser = user;
    if (!authUser) {
      authUser = await signInAnonymously(name);
    } else {
      // Update display name for returning guest
      const { sb } = await import('../supabase.js');
      await sb.auth.updateUser({ data: { full_name: name } });
      authUser = { ...authUser, user_metadata: { ...authUser.user_metadata, full_name: name } };
    }

    const session = await getSessionByCode(code);
    if (session.locked) { showErr(errEl, 'This session is locked.'); return; }

    await joinSession(session.id, { ...authUser, user_metadata: { full_name: name, is_guest: true } });
    saveSessionLocal(session.id, session.code);
    onNavigate('vote', session);
  } catch (e) {
    showErr(errEl, 'Could not join: ' + e.message);
  } finally {
    setLoading('join-btn', false);
  }
}

async function handleRejoin(code, user, onNavigate) {
  try {
    const session = await getSessionByCode(code);
    if (session.locked) {
      saveSessionLocal(session.id, session.code);
      onNavigate('results', session);
      return;
    }
    if (user) {
      await joinSession(session.id, user);
    }
    saveSessionLocal(session.id, session.code);
    onNavigate('vote', session);
  } catch (e) {
    alert('Could not rejoin: ' + e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden'); } }
function setLoading(id, val) { const b = document.getElementById(id); if (b) b.disabled = val; }
export function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
