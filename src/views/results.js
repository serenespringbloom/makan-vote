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
  _subs.push(subscribeToVotes(session.id, async () => { allVotes = await getVotes(session.id); render(); }));

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
      resultsHtml += `<div class="meal-section"><h2 class="meal-heading">${meal}</h2>`;
      for (const [area, opts] of Object.entries(areas)) {
        resultsHtml += `<div class="area-group"><h3 class="area-heading">${area}</h3><div class="results-list">`;
        opts.forEach(opt => {
          const pct = grandTotal > 0 ? ((opt.score / grandTotal) * 100).toFixed(1) : '0.0';
          const barPct = topScore > 0 ? ((opt.score / topScore) * 100).toFixed(1) : '0';
          const isTop = opt.score > 0 && opt.score === topScore;
          const breakdown = (voterBreakdown[opt.id] ?? [])
            .sort((a, b) => b.amount - a.amount)
            .map(v => `<span class="voter-chip">${escHtml(v.name)}: ${v.amount}</span>`)
            .join('');
          resultsHtml += `
            <div class="result-row ${isTop ? 'top-pick' : ''}">
              <div class="result-top">
                <span class="result-name">${isTop ? '👑 ' : ''}${escHtml(opt.name)}</span>
                <span class="result-score">${opt.score} pts <span class="result-pct">(${pct}%)</span></span>
              </div>
              <div class="result-bar-wrap"><div class="result-bar" style="width:${barPct}%"></div></div>
              ${breakdown ? `<div class="voter-breakdown">${breakdown}</div>` : ''}
            </div>`;
        });
        resultsHtml += `</div></div>`;
      }
      resultsHtml += `</div>`;
    }

    app.innerHTML = `
      <div class="results-wrap">
        <header class="vote-header">
          <div class="header-left">
            <h1 class="logo small">🍽️ Makan Vote</h1>
            <span class="room-code">Room: <strong>${session.code}</strong></span>
            ${session.locked ? `<span class="locked-tag">🔒 Finalized</span>` : `<span class="live-tag">● Live</span>`}
          </div>
          <div class="header-right">
            <button id="back-vote-btn" class="tab-btn">← Voting</button>
            <button id="signout-results-btn" class="link-btn">Sign out</button>
          </div>
        </header>
        <div class="results-meta">
          <strong>${voterIds.length} / ${members.length}</strong> member${members.length !== 1 ? 's' : ''} voted
          &nbsp;·&nbsp; ${grandTotal} total capital cast
        </div>
        <div class="options-container">${resultsHtml || '<p class="empty">No options yet.</p>'}</div>
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
