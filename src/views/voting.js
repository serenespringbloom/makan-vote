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

export async function renderVoting(user, session, onNavigate) {
  const app = document.getElementById('app');
  const isCreator = session.creator_id === user.id;
  app.innerHTML = `<div class="loading">Loading session…</div>`;

  let [options, members, allVotes] = await Promise.all([
    getOptions(session.id),
    getMembers(session.id),
    getVotes(session.id),
  ]);

  render();

  cleanupVoting();
  _subs.push(subscribeToOptions(session.id, async () => { options = await getOptions(session.id); render(); }));
  _subs.push(subscribeToMembers(session.id, async () => { members = await getMembers(session.id); render(); }));
  _subs.push(subscribeToVotes(session.id,   async () => { allVotes = await getVotes(session.id); render(); }));
  _subs.push(subscribeToSession(session.id, async (payload) => {
    if (payload.new?.locked) { session.locked = true; onNavigate('results', session); }
  }));

  function render() {
    // Preserve existing input values across re-renders
    const existingAlloc = {};
    document.querySelectorAll('.q-alloc-input').forEach(inp => {
      existingAlloc[inp.dataset.id] = parseInt(inp.value, 10) || 0;
    });

    const voterIds = [...new Set(allVotes.map(v => v.user_id))];
    const myVotesInDb = {};
    allVotes.filter(v => v.user_id === user.id).forEach(v => { myVotesInDb[v.option_id] = v.amount; });

    // Group by meal → area
    const grouped = {};
    options.forEach(opt => {
      if (!grouped[opt.meal]) grouped[opt.meal] = {};
      if (!grouped[opt.meal][opt.area]) grouped[opt.meal][opt.area] = [];
      grouped[opt.meal][opt.area].push(opt);
    });

    // Members strip
    const memberChips = members.map(m => {
      const hasVoted = voterIds.includes(m.user_id);
      const isMe = m.user_id === user.id;
      const removeBtn = isCreator && !isMe
        ? `<button class="q-link-btn danger remove-member" data-uid="${m.user_id}" title="Remove">✕</button>` : '';
      return `<span class="q-chip ${hasVoted ? 'voted' : ''}">${escHtml(m.display_name)}${hasVoted ? ' ✓' : ''}${removeBtn}</span>`;
    }).join('');

    // Options HTML
    let optionsHtml = '';
    for (const [meal, areas] of Object.entries(grouped)) {
      optionsHtml += `<div class="q-meal-section"><h2 class="q-meal-heading">${meal}</h2>`;
      for (const [area, opts] of Object.entries(areas)) {
        optionsHtml += `<div class="q-area-group"><h3 class="q-area-heading">${area}</h3><div class="q-options-list">`;
        opts.forEach(opt => {
          const val = existingAlloc[opt.id] !== undefined ? existingAlloc[opt.id] : (myVotesInDb[opt.id] ?? 0);
          const removeBtn = !session.locked
            ? `<button class="q-link-btn danger remove-option" data-oid="${opt.id}" title="Remove option">✕</button>` : '';
          optionsHtml += `
            <div class="q-option-row">
              <span class="q-option-name">${escHtml(opt.name)}</span>
              <div class="q-option-right">
                ${removeBtn}
                <input class="q-alloc-input" type="number" min="0" max="${TOTAL_CAPITAL}" step="1"
                  data-id="${opt.id}" value="${val}" ${session.locked ? 'disabled' : ''} />
              </div>
            </div>`;
        });
        optionsHtml += `</div></div>`;
      }
      optionsHtml += `</div>`;
    }

    const addOptionForm = !session.locked ? `
      <div class="q-add-card">
        <h3>Add Option</h3>
        <div class="q-add-row">
          <select id="add-meal">
            <option value="Breakfast">Breakfast</option>
            <option value="Lunch">Lunch</option>
          </select>
          <input id="add-area" class="q-input" type="text" placeholder="Area (e.g. Georgetown)" maxlength="40" />
          <input id="add-name" class="q-input" type="text" placeholder="Place name" maxlength="80" />
          <button id="add-option-btn" class="q-btn q-btn--ghost" style="width:auto">Add</button>
        </div>
        <p class="q-err hidden" id="add-err"></p>
      </div>` : '';

    app.innerHTML = `
      <div class="q-shell">
        <header class="q-header">
          <div class="q-header-left">
            <div class="q-logo">🍽️ Makan Vote</div>
            <span class="q-room-badge">${session.code}</span>
          </div>
          <div class="q-header-right">
            <button id="results-tab-btn" class="q-tab-btn">Results</button>
            <button id="signout-header-btn" class="q-link-btn">Sign out</button>
          </div>
        </header>

        <div class="q-members-strip">
          <span class="q-members-label">${voterIds.length}/${members.length} voted ·</span>
          ${memberChips}
        </div>

        ${isCreator && !session.locked ? `
          <div style="background:var(--surface);border-bottom:2px solid var(--border);padding:10px 24px;display:flex;justify-content:flex-end;">
            <button id="lock-btn" class="q-btn q-btn--danger" style="width:auto;padding:8px 20px;font-size:13px;">🔒 Lock &amp; Finalize</button>
          </div>` : ''}

        <div class="q-capital-bar">
          <span class="q-capital-label">Capital: <strong id="capital-used">0</strong> / ${TOTAL_CAPITAL}</span>
          <div class="q-capital-track"><div class="q-capital-fill under" id="capital-fill" style="width:0%"></div></div>
          <span class="q-capital-status under" id="capital-status">${TOTAL_CAPITAL} unspent</span>
        </div>

        ${session.locked ? `<div class="q-content"><div class="q-banner">🔒 Voting is locked. <button id="see-results-btn" class="q-link-btn" style="margin-left:8px">See results →</button></div></div>` : ''}

        <div class="q-content">
          ${optionsHtml}
          ${addOptionForm}
        </div>

        ${!session.locked ? `<div class="q-submit-row"><button id="submit-btn" class="q-btn q-btn--submit" disabled>Submit Votes</button></div>` : ''}
      </div>
    `;

    updateCapital();

    document.querySelectorAll('.q-alloc-input').forEach(inp => {
      inp.addEventListener('input', () => {
        inp.value = Math.max(0, Math.floor(Number(inp.value) || 0));
        updateCapital();
      });
    });

    function updateCapital() {
      let total = 0;
      document.querySelectorAll('.q-alloc-input').forEach(inp => { total += parseInt(inp.value, 10) || 0; });
      const pct = Math.min((total / TOTAL_CAPITAL) * 100, 100).toFixed(1);
      const usedEl    = document.getElementById('capital-used');
      const fillEl    = document.getElementById('capital-fill');
      const statusEl  = document.getElementById('capital-status');
      const submitBtn = document.getElementById('submit-btn');

      if (usedEl) usedEl.textContent = total;

      if (fillEl) {
        fillEl.style.width = pct + '%';
        fillEl.className = `q-capital-fill ${total > TOTAL_CAPITAL ? 'over' : total === TOTAL_CAPITAL ? 'ok' : 'under'}`;
      }
      if (statusEl) {
        if (total === TOTAL_CAPITAL) {
          statusEl.textContent = '✓ Ready to submit';
          statusEl.className = 'q-capital-status ok';
        } else if (total > TOTAL_CAPITAL) {
          statusEl.textContent = `Over by ${total - TOTAL_CAPITAL}`;
          statusEl.className = 'q-capital-status over';
        } else {
          statusEl.textContent = `${TOTAL_CAPITAL - total} unspent`;
          statusEl.className = 'q-capital-status under';
        }
      }
      if (submitBtn) submitBtn.disabled = total !== TOTAL_CAPITAL;
    }

    document.getElementById('submit-btn')?.addEventListener('click', async () => {
      const allocations = [...document.querySelectorAll('.q-alloc-input')].map(inp => ({
        option_id: inp.dataset.id, amount: parseInt(inp.value, 10) || 0,
      }));
      const btn = document.getElementById('submit-btn');
      btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        await submitVotes(session.id, user.id, allocations);
        btn.textContent = '✓ Submitted!';
        setTimeout(() => { btn.textContent = 'Submit Votes'; updateCapital(); }, 2500);
      } catch (e) {
        alert('Error: ' + e.message);
        btn.disabled = false; btn.textContent = 'Submit Votes';
      }
    });

    document.getElementById('lock-btn')?.addEventListener('click', async () => {
      if (!confirm('Lock voting and show final results? This cannot be undone.')) return;
      try { await lockSession(session.id); } catch (e) { alert('Error: ' + e.message); }
    });

    document.getElementById('results-tab-btn')?.addEventListener('click', () => onNavigate('results', session));
    document.getElementById('see-results-btn')?.addEventListener('click', () => onNavigate('results', session));
    document.getElementById('signout-header-btn')?.addEventListener('click', () => { clearSessionLocal(); signOut(); });

    document.querySelectorAll('.remove-member').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const m = members.find(x => x.user_id === uid);
        if (!confirm(`Remove ${m?.display_name ?? 'this person'}?`)) return;
        try { await removeMember(session.id, uid); } catch (e) { alert('Error: ' + e.message); }
      });
    });

    document.querySelectorAll('.remove-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const oid = btn.dataset.oid;
        const opt = options.find(o => o.id === oid);
        if (!confirm(`Remove "${opt?.name ?? 'this option'}"? All votes for it will be deleted.`)) return;
        try { await removeOption(session.id, oid); } catch (e) { alert('Error: ' + e.message); }
      });
    });

    document.getElementById('add-option-btn')?.addEventListener('click', async () => {
      const meal  = document.getElementById('add-meal').value;
      const area  = document.getElementById('add-area').value.trim();
      const name  = document.getElementById('add-name').value.trim();
      const errEl = document.getElementById('add-err');
      if (!area) { showErr(errEl, 'Enter an area.'); return; }
      if (!name) { showErr(errEl, 'Enter a place name.'); return; }
      try {
        await addOption(session.id, meal, area, name);
        document.getElementById('add-area').value = '';
        document.getElementById('add-name').value = '';
        errEl.classList.add('hidden');
      } catch (e) { showErr(errEl, 'Error: ' + e.message); }
    });
  }
}

export function cleanupVoting() {
  _subs.forEach(s => s.unsubscribe?.());
  _subs = [];
}

function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden'); } }
