let _votingSubs = [];

async function renderVoting(user, session) {
  const app = document.getElementById('app');
  const isCreator = session.creator_id === user.id;

  app.innerHTML = `<div class="loading">Loading session…</div>`;

  // Fetch initial data
  let [options, members, votes, allVotes] = await Promise.all([
    getOptions(session.id),
    getMembers(session.id),
    getVotes(session.id),  // all votes in session
    Promise.resolve([]),
  ]);
  allVotes = votes;

  // Build my current allocation map: option_id → amount
  const myVotes = {};
  allVotes.filter(v => v.user_id === user.id).forEach(v => { myVotes[v.option_id] = v.amount; });

  render();

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  _votingSubs.forEach(s => s.unsubscribe?.());
  _votingSubs = [];

  _votingSubs.push(subscribeToOptions(session.id, async () => {
    options = await getOptions(session.id);
    render();
  }));

  _votingSubs.push(subscribeToMembers(session.id, async () => {
    members = await getMembers(session.id);
    render();
  }));

  _votingSubs.push(subscribeToVotes(session.id, async () => {
    allVotes = await getVotes(session.id);
    render();
  }));

  _votingSubs.push(subscribeToSession(session.id, async (payload) => {
    if (payload.new?.locked) {
      session.locked = true;
      App.go('results');
    }
  }));

  // ── Render function ────────────────────────────────────────────────────────
  function render() {
    const myAlloc = {}; // option_id → current input value (from DOM or saved votes)
    // Preserve existing input values if DOM already exists
    document.querySelectorAll('.alloc-input').forEach(inp => {
      myAlloc[inp.dataset.id] = parseInt(inp.value, 10) || 0;
    });

    const voterIds = [...new Set(allVotes.map(v => v.user_id))];
    const votedCount = voterIds.length;
    const myVotesInDb = {};
    allVotes.filter(v => v.user_id === user.id).forEach(v => { myVotesInDb[v.option_id] = v.amount; });

    // Group options by meal → area
    const grouped = {};
    options.forEach(opt => {
      if (!grouped[opt.meal]) grouped[opt.meal] = {};
      if (!grouped[opt.meal][opt.area]) grouped[opt.meal][opt.area] = [];
      grouped[opt.meal][opt.area].push(opt);
    });

    const lockedBanner = session.locked
      ? `<div class="banner banner-locked">🔒 Voting is locked. <button id="see-results-btn" class="link-btn">See results →</button></div>`
      : '';

    const memberList = members.map(m => {
      const hasVoted = voterIds.includes(m.user_id);
      const isMe = m.user_id === user.id;
      const removeBtn = isCreator && !isMe
        ? `<button class="remove-member link-btn danger" data-uid="${m.user_id}" title="Remove">✕</button>`
        : '';
      return `<span class="member-chip ${hasVoted ? 'voted' : ''}">${escHtml(m.display_name)}${hasVoted ? ' ✓' : ''}${removeBtn}</span>`;
    }).join('');

    const creatorControls = isCreator && !session.locked ? `
      <div class="creator-controls">
        <button id="lock-btn" class="danger-btn">🔒 Lock &amp; Finalize</button>
      </div>` : '';

    // Build options HTML
    let optionsHtml = '';
    for (const [meal, areas] of Object.entries(grouped)) {
      optionsHtml += `<div class="meal-section"><h2 class="meal-heading">${meal}</h2>`;
      for (const [area, opts] of Object.entries(areas)) {
        optionsHtml += `<div class="area-group"><h3 class="area-heading">${area}</h3><div class="options-list">`;
        opts.forEach(opt => {
          const savedVal = myAlloc[opt.id] !== undefined ? myAlloc[opt.id] : (myVotesInDb[opt.id] ?? 0);
          const removeOptBtn = !session.locked
            ? `<button class="remove-option link-btn danger" data-oid="${opt.id}" title="Remove option">✕</button>`
            : '';
          optionsHtml += `
            <div class="option-row">
              <span class="option-name">${escHtml(opt.name)}</span>
              <div class="option-right">
                ${removeOptBtn}
                <input
                  class="alloc-input"
                  type="number"
                  min="0"
                  max="${TOTAL_CAPITAL}"
                  step="1"
                  data-id="${opt.id}"
                  value="${savedVal}"
                  ${session.locked ? 'disabled' : ''}
                />
              </div>
            </div>`;
        });
        optionsHtml += `</div></div>`;
      }
      optionsHtml += `</div>`;
    }

    const addOptionForm = !session.locked ? `
      <div class="card add-option-card">
        <h3>Add Option</h3>
        <div class="add-option-row">
          <select id="add-meal">
            <option value="Breakfast">Breakfast</option>
            <option value="Lunch">Lunch</option>
          </select>
          <input id="add-area" type="text" placeholder="Area (e.g. Georgetown)" maxlength="40" />
          <input id="add-name" type="text" placeholder="Place name" maxlength="80" />
          <button id="add-option-btn">Add</button>
        </div>
        <p class="err hidden" id="add-err"></p>
      </div>` : '';

    app.innerHTML = `
      <div class="vote-wrap">
        ${lockedBanner}

        <header class="vote-header">
          <div class="header-left">
            <h1 class="logo small">🍽️ Makan Vote</h1>
            <span class="room-code">Room: <strong>${session.code}</strong></span>
          </div>
          <div class="header-right">
            <button id="results-tab-btn" class="tab-btn">Results</button>
            <button id="signout-header-btn" class="link-btn">Sign out</button>
          </div>
        </header>

        <div class="members-bar">
          <span class="members-label">Members (${votedCount}/${members.length} voted):</span>
          ${memberList}
        </div>

        ${creatorControls}

        <div class="capital-bar">
          <span>Capital: <strong id="capital-used">0</strong> / ${TOTAL_CAPITAL}</span>
          <span id="capital-status" class="capital-ok">✓ ready to submit</span>
        </div>

        <div class="options-container">
          ${optionsHtml}
        </div>

        ${addOptionForm}

        ${!session.locked ? `<div class="submit-row"><button id="submit-btn" disabled>Submit Votes</button></div>` : ''}
      </div>
    `;

    // ── Wire inputs ──────────────────────────────────────────────────────────
    updateCapital();

    document.querySelectorAll('.alloc-input').forEach(inp => {
      inp.addEventListener('input', () => {
        // Enforce integer
        inp.value = Math.max(0, Math.floor(Number(inp.value) || 0));
        updateCapital();
      });
    });

    function updateCapital() {
      const inputs = document.querySelectorAll('.alloc-input');
      let total = 0;
      inputs.forEach(inp => { total += parseInt(inp.value, 10) || 0; });
      const usedEl = document.getElementById('capital-used');
      const statusEl = document.getElementById('capital-status');
      const submitBtn = document.getElementById('submit-btn');
      if (usedEl) usedEl.textContent = total;
      if (statusEl) {
        if (total === TOTAL_CAPITAL) {
          statusEl.textContent = '✓ ready to submit';
          statusEl.className = 'capital-ok';
        } else if (total > TOTAL_CAPITAL) {
          statusEl.textContent = `over by ${total - TOTAL_CAPITAL}`;
          statusEl.className = 'capital-over';
        } else {
          statusEl.textContent = `${TOTAL_CAPITAL - total} unspent`;
          statusEl.className = 'capital-under';
        }
      }
      if (submitBtn) submitBtn.disabled = total !== TOTAL_CAPITAL;
    }

    // ── Submit ───────────────────────────────────────────────────────────────
    document.getElementById('submit-btn')?.addEventListener('click', async () => {
      const inputs = document.querySelectorAll('.alloc-input');
      const allocations = [];
      inputs.forEach(inp => {
        allocations.push({ option_id: inp.dataset.id, amount: parseInt(inp.value, 10) || 0 });
      });
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        await submitVotes(session.id, user.id, allocations);
        btn.textContent = 'Submitted ✓';
        setTimeout(() => { btn.textContent = 'Submit Votes'; updateCapital(); }, 2000);
      } catch (e) {
        alert('Error submitting: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Submit Votes';
      }
    });

    // ── Lock ─────────────────────────────────────────────────────────────────
    document.getElementById('lock-btn')?.addEventListener('click', async () => {
      if (!confirm('Lock voting and show final results? This cannot be undone.')) return;
      try {
        await lockSession(session.id);
        // subscribeToSession will handle navigation
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });

    // ── Results tab ──────────────────────────────────────────────────────────
    document.getElementById('results-tab-btn')?.addEventListener('click', () => App.go('results'));

    // ── Sign out ─────────────────────────────────────────────────────────────
    document.getElementById('signout-header-btn')?.addEventListener('click', async () => {
      clearSessionLocal();
      await signOut();
    });

    // ── Remove member ────────────────────────────────────────────────────────
    document.querySelectorAll('.remove-member').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const member = members.find(m => m.user_id === uid);
        if (!confirm(`Remove ${member?.display_name ?? 'this person'} from the session?`)) return;
        try {
          await removeMember(session.id, uid);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      });
    });

    // ── Remove option ────────────────────────────────────────────────────────
    document.querySelectorAll('.remove-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const oid = btn.dataset.oid;
        const opt = options.find(o => o.id === oid);
        if (!confirm(`Remove "${opt?.name ?? 'this option'}"? All votes for it will be deleted.`)) return;
        try {
          await removeOption(session.id, oid);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      });
    });

    // ── Add option ───────────────────────────────────────────────────────────
    document.getElementById('add-option-btn')?.addEventListener('click', async () => {
      const meal = document.getElementById('add-meal').value;
      const area = document.getElementById('add-area').value.trim();
      const name = document.getElementById('add-name').value.trim();
      const errEl = document.getElementById('add-err');
      if (!area) { showVoteErr(errEl, 'Enter an area.'); return; }
      if (!name) { showVoteErr(errEl, 'Enter a place name.'); return; }
      try {
        await addOption(session.id, meal, area, name);
        document.getElementById('add-area').value = '';
        document.getElementById('add-name').value = '';
        errEl.classList.add('hidden');
      } catch (e) {
        showVoteErr(errEl, 'Error: ' + e.message);
      }
    });

    // ── See results (locked banner) ──────────────────────────────────────────
    document.getElementById('see-results-btn')?.addEventListener('click', () => App.go('results'));
  }
}

function showVoteErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function cleanupVoting() {
  _votingSubs.forEach(s => s.unsubscribe?.());
  _votingSubs = [];
}
