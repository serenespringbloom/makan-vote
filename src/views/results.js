import {
  getOptions, getMembers, getVotes,
  subscribeToOptions, subscribeToMembers, subscribeToVotes,
  signOut, clearSessionLocal,
} from '../supabase.js';
import { escHtml } from './login.js';

let _subs = [];

export async function renderResults(user, session, onNavigate) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="loading">Loading results…</div>`;

  let [options, members, allVotes] = await Promise.all([
    getOptions(session.id),
    getMembers(session.id),
    getVotes(session.id),
  ]);

  render();

  cleanupResults();
  _subs.push(subscribeToOptions(session.id, async () => { options = await getOptions(session.id); render(); }));
  _subs.push(subscribeToMembers(session.id, async () => { members = await getMembers(session.id); render(); }));
  _subs.push(subscribeToVotes(session.id,   async () => { allVotes = await getVotes(session.id); render(); }));

  function render() {
    const voterIds = [...new Set(allVotes.map(v => v.user_id))];
    const scoreMap = {};
    options.forEach(o => { scoreMap[o.id] = 0; });
    allVotes.forEach(v => { scoreMap[v.option_id] = (scoreMap[v.option_id] ?? 0) + v.amount; });
    const grandTotal = Object.values(scoreMap).reduce((a, b) => a + b, 0);

    const grouped = {};
    options.forEach(opt => {
      if (!grouped[opt.meal]) grouped[opt.meal] = {};
      if (!grouped[opt.meal][opt.area]) grouped[opt.meal][opt.area] = [];
      grouped[opt.meal][opt.area].push({ ...opt, score: scoreMap[opt.id] ?? 0 });
    });
    for (const meal of Object.values(grouped))
      for (const areaOpts of Object.values(meal))
        areaOpts.sort((a, b) => b.score - a.score);

    const voterNameMap = {};
    members.forEach(m => { voterNameMap[m.user_id] = m.display_name; });
    const voterBreakdown = {};
    allVotes.forEach(v => {
      if (!voterBreakdown[v.option_id]) voterBreakdown[v.option_id] = [];
      voterBreakdown[v.option_id].push({ name: voterNameMap[v.user_id] ?? 'Unknown', amount: v.amount });
    });

    let resultsHtml = '';
    for (const [meal, areas] of Object.entries(grouped)) {
      const topScore = Math.max(...Object.values(areas).flat().map(o => o.score), 0);
      resultsHtml += `<div class="q-meal-section"><h2 class="q-meal-heading">${meal}</h2>`;
      for (const [area, opts] of Object.entries(areas)) {
        resultsHtml += `<div class="q-area-group"><h3 class="q-area-heading">${area}</h3><div class="q-results-list">`;
        opts.forEach(opt => {
          const pct    = grandTotal > 0 ? ((opt.score / grandTotal) * 100).toFixed(1) : '0.0';
          const barPct = topScore > 0   ? ((opt.score / topScore)   * 100).toFixed(1) : '0';
          const isTop  = opt.score > 0 && opt.score === topScore;
          const breakdown = (voterBreakdown[opt.id] ?? [])
            .sort((a, b) => b.amount - a.amount)
            .map(v => `<span class="q-voter-chip">${escHtml(v.name)}: ${v.amount}</span>`)
            .join('');
          resultsHtml += `
            <div class="q-result-row ${isTop ? 'top-pick' : ''}">
              <div class="q-result-top">
                <span class="q-result-name">${isTop ? '👑 ' : ''}${escHtml(opt.name)}</span>
                <span class="q-result-score">${opt.score} pts <span class="q-result-pct">(${pct}%)</span></span>
              </div>
              <div class="q-bar-wrap"><div class="q-bar" style="width:${barPct}%"></div></div>
              ${breakdown ? `<div class="q-voter-breakdown">${breakdown}</div>` : ''}
            </div>`;
        });
        resultsHtml += `</div></div>`;
      }
      resultsHtml += `</div>`;
    }

    app.innerHTML = `
      <div class="q-shell">
        <header class="q-header">
          <div class="q-header-left">
            <div class="q-logo">🍽️ Makan Vote</div>
            <span class="q-room-badge">${session.code}</span>
            ${session.locked ? `<span class="q-locked-tag">🔒 Finalized</span>` : `<span class="q-live-tag">● Live</span>`}
          </div>
          <div class="q-header-right">
            <button id="back-vote-btn" class="q-tab-btn">← Voting</button>
            <button id="signout-results-btn" class="q-link-btn">Sign out</button>
          </div>
        </header>

        <div class="q-content">
          <div class="q-results-meta">
            <strong>${voterIds.length} / ${members.length}</strong> member${members.length !== 1 ? 's' : ''} voted
            · ${grandTotal} total capital cast
          </div>
          ${resultsHtml || '<p style="color:var(--text-muted);padding:20px 0">No options yet.</p>'}
        </div>
      </div>
    `;

    document.getElementById('back-vote-btn')?.addEventListener('click', () => onNavigate('vote', session));
    document.getElementById('signout-results-btn')?.addEventListener('click', () => { clearSessionLocal(); signOut(); });
  }
}

export function cleanupResults() {
  _subs.forEach(s => s.unsubscribe?.());
  _subs = [];
}
