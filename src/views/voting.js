import {
  getOptions, getMembers, getVotes,
  addOption, removeOption, removeMember,
  submitVotes, lockSession,
  subscribeToOptions, subscribeToMembers, subscribeToVotes, subscribeToSession,
  signOut, clearSessionLocal,
} from '../supabase.js';
import { TOTAL_CAPITAL } from '../config.js';
import { escHtml } from './login.js';

let _subs = [];

// ── localStorage draft votes ──────────────────────────────────────────────────
function draftKey(sessionId, userId) { return `mv_draft_${sessionId}_${userId}`; }

function loadDraft(sessionId, userId) {
  try { return JSON.parse(localStorage.getItem(draftKey(sessionId, userId))) || {}; }
  catch { return {}; }
}

function saveDraft(sessionId, userId, alloc) {
  localStorage.setItem(draftKey(sessionId, userId), JSON.stringify(alloc));
}

// ── Main render ───────────────────────────────────────────────────────────────
export async function renderVoting(user, session, onNavigate) {
  const app = document.getElementById('app');
  const isCreator = session.creator_id === user.id;

  app.innerHTML = `<div class="loading">Loading session…</div>`;

  let [options, members, allVotes] = await Promise.all([
    getOptions(session.id),
    getMembers(session.id),
    getVotes(session.id),
  ]);

  // Draft: start from saved localStorage, fall back to DB votes
  let draft = loadDraft(session.id, user.id);
  if (Object.keys(draft).length === 0) {
    allVotes.filter(v => v.user_id === user.id).forEach(v => { draft[v.option_id] = v.amount; });
  }

  // Full initial render
  fullRender();

  // ── Realtime: targeted updates, no full re-render ────────────────────────
  cleanupVoting();

  _subs.push(subscribeToOptions(session.id, async () => {
    options = await getOptions(session.id);
    fullRender(); // options change requires full re-render (list structure changed)
  }));

  _subs.push(subscribeToMembers(session.id, async () => {
    members = await getMembers(session.id);
    patchSidebar();
  }));

  _subs.push(subscribeToVotes(session.id, async () => {
    allVotes = await getVotes(session.id);
    patchSidebar(); // only member vote-status dots change
  }));

  _subs.push(subscribeToSession(session.id, async (payload) => {
    if (payload.new?.locked) { session.locked = true; onNavigate('results', session); }
  }));

  // ── Patch: update only sidebar without rebuilding options list ────────────
  function patchSidebar() {
    const voterIds = [...new Set(allVotes.map(v => v.user_id))];
    const memberListEl = document.getElementById('member-list');
    if (memberListEl) memberListEl.innerHTML = buildMemberChips(members, voterIds, isCreator, user);
    bindMemberRemove();
  }

  // ── Full render ───────────────────────────────────────────────────────────
  function fullRender() {
    const voterIds = [...new Set(allVotes.map(v => v.user_id))];
    const spent = Object.values(draft).reduce((a, b) => a + (parseInt(b) || 0), 0);
    const remaining = TOTAL_CAPITAL - spent;

    app.innerHTML = `
      <div class="v-layout">

        <!-- ── Sidebar ─────────────────────────────────────────────── -->
        <aside class="v-sidebar">
          <div class="v-sidebar-inner">

            <div class="v-brand">🍽️ Makan Vote</div>

            <!-- Room code -->
            <div class="v-section-block">
              <div class="v-label">Room Code</div>
              <div class="v-room-code" id="room-code-display" title="Click to copy">${session.code}</div>
              <div class="v-copy-hint" id="copy-hint">Click to copy</div>
            </div>

            <!-- Capital gauge -->
            <div class="v-section-block">
              <div class="v-label">Your Capital</div>
              <div class="v-capital-ring-wrap">
                <svg class="v-capital-ring" viewBox="0 0 80 80">
                  <circle class="v-ring-bg" cx="40" cy="40" r="32"/>
                  <circle class="v-ring-fill ${remaining < 0 ? 'over' : remaining === 0 ? 'zero' : ''}"
                    id="ring-fill" cx="40" cy="40" r="32"
                    stroke-dasharray="${ringDash(spent)} ${ringCirc()}"
                    stroke-dashoffset="${ringCirc() / 4}"/>
                </svg>
                <div class="v-capital-text">
                  <span class="v-capital-num ${remaining < 0 ? 'over' : ''}" id="capital-remaining">${remaining}</span>
                  <span class="v-capital-sub">left</span>
                </div>
              </div>
              <div class="v-capital-status ${remaining < 0 ? 'over' : remaining === 0 ? 'ok' : 'under'}" id="capital-status">
                ${capitalStatusText(remaining)}
              </div>
              <div class="v-capital-guide">
                Distribute up to <strong>${TOTAL_CAPITAL}</strong> points across options. More points = stronger preference.
              </div>
            </div>

            <!-- Members -->
            <div class="v-section-block">
              <div class="v-label">Members <span class="v-voted-count">(${voterIds.length}/${members.length} saved)</span></div>
              <div id="member-list">${buildMemberChips(members, voterIds, isCreator, user)}</div>
            </div>

            <!-- Actions -->
            <div class="v-section-block v-actions">
              <button id="results-btn" class="v-btn v-btn--ghost">📊 Results</button>
              ${isCreator && !session.locked ? `<button id="lock-btn" class="v-btn v-btn--danger">🔒 Finalize</button>` : ''}
              ${session.locked ? `<div class="v-locked-badge">🔒 Finalized</div>` : ''}
              <button id="signout-btn" class="v-btn v-btn--link">Sign out</button>
            </div>

          </div>
        </aside>

        <!-- ── Mobile top bar ───────────────────────────────────────── -->
        <div class="v-mobile-bar">
          <div class="v-brand small">🍽️ Makan Vote</div>
          <div class="v-mobile-bar-right">
            <span class="v-room-code-sm" id="room-code-sm" title="Click to copy">${session.code}</span>
            <button id="sidebar-toggle" class="v-icon-btn">☰</button>
          </div>
        </div>

        <!-- ── Mobile drawer ────────────────────────────────────────── -->
        <div class="v-drawer-overlay hidden" id="drawer-overlay"></div>
        <div class="v-drawer hidden" id="mobile-drawer">
          <div class="v-drawer-header">
            <span>Session Info</span>
            <button id="drawer-close" class="v-icon-btn">✕</button>
          </div>
          <div class="v-drawer-body">
            <div class="v-label">Room Code</div>
            <div class="v-room-code" style="font-size:28px;margin-bottom:8px">${session.code}</div>
            <div class="v-label" style="margin-top:12px">Capital Remaining</div>
            <div class="v-capital-big" id="drawer-capital">${remaining} / ${TOTAL_CAPITAL}</div>
            <div class="v-label" style="margin-top:12px">Members</div>
            <div id="drawer-members">${buildMemberChips(members, voterIds, isCreator, user)}</div>
            <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
              <button id="drawer-results-btn" class="v-btn v-btn--ghost">📊 Results</button>
              ${isCreator && !session.locked ? `<button id="drawer-lock-btn" class="v-btn v-btn--danger">🔒 Finalize</button>` : ''}
              <button id="drawer-signout-btn" class="v-btn v-btn--link">Sign out</button>
            </div>
          </div>
        </div>

        <!-- ── Main content ─────────────────────────────────────────── -->
        <main class="v-main">
          ${buildOptionsArea(options, draft, session.locked)}
        </main>

      </div>
    `;

    bindAll();
  }

  // ── Build options area ────────────────────────────────────────────────────
  function buildOptionsArea(opts, draft, locked) {
    if (opts.length === 0) {
      return `
        <div class="v-empty-state">
          <div class="v-empty-icon">🗺️</div>
          <h2>No options yet</h2>
          <p>Add your first food destination below. Organise by <strong>meal type</strong> (e.g. Breakfast, Lunch) and <strong>area</strong> (e.g. Georgetown, USM).</p>
          ${buildAddForm()}
        </div>
      `;
    }

    // Group by meal → area
    const grouped = {};
    opts.forEach(opt => {
      if (!grouped[opt.meal]) grouped[opt.meal] = {};
      if (!grouped[opt.meal][opt.area]) grouped[opt.meal][opt.area] = [];
      grouped[opt.meal][opt.area].push(opt);
    });

    let html = `<div class="v-options-wrap">`;

    for (const [meal, areas] of Object.entries(grouped)) {
      html += `<div class="v-meal-section">
        <h2 class="v-meal-heading">
          <span class="v-meal-pill">${meal}</span>
        </h2>`;
      for (const [area, areaOpts] of Object.entries(areas)) {
        html += `<div class="v-area-group">
          <h3 class="v-area-heading">${area}</h3>
          <div class="v-options-list">`;
        areaOpts.forEach(opt => {
          const val = draft[opt.id] ?? 0;
          html += `
            <div class="v-option-row" data-oid="${opt.id}">
              <span class="v-option-name">${escHtml(opt.name)}</span>
              <div class="v-option-right">
                ${!locked ? `<button class="v-remove-opt q-link-btn danger" data-oid="${opt.id}">✕</button>` : ''}
                <div class="v-stepper">
                  ${!locked ? `<button class="v-step-btn v-step-down" data-id="${opt.id}">−</button>` : ''}
                  <input class="v-alloc-input" type="number" min="0" max="${TOTAL_CAPITAL}"
                    step="1" data-id="${opt.id}" value="${val}" ${locked ? 'disabled' : ''} />
                  ${!locked ? `<button class="v-step-btn v-step-up" data-id="${opt.id}">+</button>` : ''}
                </div>
              </div>
            </div>`;
        });
        html += `</div></div>`;
      }
      html += `</div>`;
    }

    if (!locked) html += buildAddForm();
    html += `</div>`;
    return html;
  }

  function buildAddForm() {
    return `
      <div class="v-add-card">
        <div class="v-add-header">
          <span class="v-add-icon">＋</span>
          <div>
            <div class="v-label">Add Option</div>
            <div class="v-add-guide">Pick a meal type and area, then name the place.</div>
          </div>
        </div>
        <div class="v-add-row">
          <select id="add-meal" class="q-input v-add-select">
            <option value="Breakfast">🌅 Breakfast</option>
            <option value="Lunch">☀️ Lunch</option>
            <option value="Dinner">🌙 Dinner</option>
            <option value="Supper">🌃 Supper</option>
          </select>
          <input id="add-area" class="q-input" type="text" placeholder="Area (e.g. Georgetown)" maxlength="40" />
          <input id="add-name" class="q-input" type="text" placeholder="Place name (e.g. Lagenda Cafe)" maxlength="80" />
          <button id="add-option-btn" class="v-btn v-btn--add">Add</button>
        </div>
        <p class="q-err hidden" id="add-err"></p>
      </div>`;
  }

  // ── Bind all events ───────────────────────────────────────────────────────
  function bindAll() {
    // Room code copy
    ['room-code-display', 'room-code-sm'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        navigator.clipboard.writeText(session.code).then(() => {
          const hint = document.getElementById('copy-hint');
          if (hint) { hint.textContent = 'Copied!'; setTimeout(() => { hint.textContent = 'Click to copy'; }, 2000); }
        });
      });
    });

    // Alloc inputs: auto-save on change
    bindInputs();

    // Stepper buttons
    document.querySelectorAll('.v-step-up').forEach(btn => {
      btn.addEventListener('click', () => nudge(btn.dataset.id, 1));
    });
    document.querySelectorAll('.v-step-down').forEach(btn => {
      btn.addEventListener('click', () => nudge(btn.dataset.id, -1));
    });

    // Add option
    document.getElementById('add-option-btn')?.addEventListener('click', handleAddOption);
    document.getElementById('add-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleAddOption(); });

    // Remove option
    document.querySelectorAll('.v-remove-opt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const oid = btn.dataset.oid;
        const opt = options.find(o => o.id === oid);
        if (!confirm(`Remove "${opt?.name ?? 'this option'}"?`)) return;
        delete draft[oid];
        saveDraft(session.id, user.id, draft);
        try { await removeOption(session.id, oid); } catch (e) { alert('Error: ' + e.message); }
      });
    });

    // Sidebar actions
    document.getElementById('results-btn')?.addEventListener('click', () => onNavigate('results', session));
    document.getElementById('lock-btn')?.addEventListener('click', handleLock);
    document.getElementById('signout-btn')?.addEventListener('click', () => { clearSessionLocal(); signOut(); });

    // Mobile drawer
    document.getElementById('sidebar-toggle')?.addEventListener('click', openDrawer);
    document.getElementById('drawer-overlay')?.addEventListener('click', closeDrawer);
    document.getElementById('drawer-close')?.addEventListener('click', closeDrawer);
    document.getElementById('drawer-results-btn')?.addEventListener('click', () => { closeDrawer(); onNavigate('results', session); });
    document.getElementById('drawer-lock-btn')?.addEventListener('click', () => { closeDrawer(); handleLock(); });
    document.getElementById('drawer-signout-btn')?.addEventListener('click', () => { clearSessionLocal(); signOut(); });

    // Members remove
    bindMemberRemove();
  }

  let _pushTimer = null;
  function debouncedPush() {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      const allocations = Object.entries(draft)
        .map(([option_id, amount]) => ({ option_id, amount: parseInt(amount) || 0 }));
      submitVotes(session.id, user.id, allocations).catch(() => {});
    }, 800);
  }

  function bindInputs() {
    document.querySelectorAll('.v-alloc-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const val = Math.max(0, Math.floor(Number(inp.value) || 0));
        inp.value = val;
        draft[inp.dataset.id] = val;
        saveDraft(session.id, user.id, draft);
        updateCapitalUI();
        debouncedPush();
      });
    });
  }

  function bindMemberRemove() {
    document.querySelectorAll('.v-remove-member').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const m = members.find(x => x.user_id === uid);
        if (!confirm(`Remove ${m?.display_name ?? 'this person'}?`)) return;
        try { await removeMember(session.id, uid); } catch (e) { alert('Error: ' + e.message); }
      });
    });
  }

  function nudge(optId, delta) {
    const inp = document.querySelector(`.v-alloc-input[data-id="${optId}"]`);
    if (!inp) return;
    const val = Math.max(0, (parseInt(inp.value) || 0) + delta);
    inp.value = val;
    draft[optId] = val;
    saveDraft(session.id, user.id, draft);
    updateCapitalUI();
    debouncedPush();
  }

  // ── Capital UI: patch in-place ────────────────────────────────────────────
  function updateCapitalUI() {
    const spent = Object.values(draft).reduce((a, b) => a + (parseInt(b) || 0), 0);
    const remaining = TOTAL_CAPITAL - spent;

    const remEl   = document.getElementById('capital-remaining');
    const statEl  = document.getElementById('capital-status');
    const ringEl  = document.getElementById('ring-fill');
    const drawerC = document.getElementById('drawer-capital');

    if (remEl) {
      remEl.textContent = remaining;
      remEl.className = `v-capital-num ${remaining < 0 ? 'over' : ''}`;
    }
    if (statEl) {
      statEl.textContent = capitalStatusText(remaining);
      statEl.className = `v-capital-status ${remaining < 0 ? 'over' : remaining === 0 ? 'ok' : 'under'}`;
    }
    if (ringEl) {
      ringEl.setAttribute('stroke-dasharray', `${ringDash(spent)} ${ringCirc()}`);
      ringEl.className.baseVal = `v-ring-fill ${remaining < 0 ? 'over' : remaining === 0 ? 'zero' : ''}`;
    }
    if (drawerC) drawerC.textContent = `${remaining} / ${TOTAL_CAPITAL}`;

    // Update voter status in sidebar (this user)
    const voterIds = [...new Set(allVotes.map(v => v.user_id))];
    const myHasSaved = allVotes.some(v => v.user_id === user.id);
    const countEl = document.querySelector('.v-voted-count');
    if (countEl) countEl.textContent = `(${voterIds.length}/${members.length} saved)`;
  }

  async function handleAddOption() {
    const meal  = document.getElementById('add-meal')?.value;
    const area  = document.getElementById('add-area')?.value.trim();
    const name  = document.getElementById('add-name')?.value.trim();
    const errEl = document.getElementById('add-err');
    if (!area) { showErr(errEl, 'Enter an area.'); return; }
    if (!name) { showErr(errEl, 'Enter a place name.'); return; }
    const btn = document.getElementById('add-option-btn');
    if (btn) btn.disabled = true;
    try {
      await addOption(session.id, meal, area, name);
      if (document.getElementById('add-area')) document.getElementById('add-area').value = '';
      if (document.getElementById('add-name')) document.getElementById('add-name').value = '';
      if (errEl) errEl.classList.add('hidden');
    } catch (e) {
      showErr(errEl, 'Error: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function handleLock() {
    if (!confirm('Finalize voting? Everyone\'s current capital allocation will be saved and voting will close.')) return;
    // Push all drafts — only current user's draft is accessible client-side
    // Each user's draft gets pushed when they're active; on lock we push ours
    try {
      await pushDraftToSupabase();
      await lockSession(session.id);
    } catch (e) { alert('Error: ' + e.message); }
  }

  async function pushDraftToSupabase() {
    const allocations = Object.entries(draft)
      .map(([option_id, amount]) => ({ option_id, amount: parseInt(amount) || 0 }));
    await submitVotes(session.id, user.id, allocations);
  }

  function openDrawer() {
    document.getElementById('mobile-drawer')?.classList.remove('hidden');
    document.getElementById('drawer-overlay')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    document.getElementById('mobile-drawer')?.classList.add('hidden');
    document.getElementById('drawer-overlay')?.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildMemberChips(members, voterIds, isCreator, user) {
  return members.map(m => {
    const hasVoted = voterIds.includes(m.user_id);
    const isMe = m.user_id === user.id;
    const removeBtn = isCreator && !isMe
      ? `<button class="v-remove-member q-link-btn danger" data-uid="${m.user_id}">✕</button>` : '';
    return `
      <div class="v-member-row">
        <span class="v-member-dot ${hasVoted ? 'saved' : ''}"></span>
        <span class="v-member-name">${escHtml(m.display_name)}${isMe ? ' (you)' : ''}</span>
        ${removeBtn}
      </div>`;
  }).join('');
}

function capitalStatusText(remaining) {
  if (remaining < 0) return `${Math.abs(remaining)} over limit`;
  if (remaining === 0) return '✓ All spent';
  return `${remaining} remaining`;
}

function ringCirc() { return 2 * Math.PI * 32; } // circumference for r=32
function ringDash(spent) {
  const pct = Math.min(spent / TOTAL_CAPITAL, 1);
  return (pct * ringCirc()).toFixed(2);
}

function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden'); } }

export function cleanupVoting() {
  _subs.forEach(s => s.unsubscribe?.());
  _subs = [];
}
