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
  _subs.push(subscribeToOptions(session.id, async () => { options = await getOptions(session.id); render(); }, ':results'));
  _subs.push(subscribeToMembers(session.id, async () => { members = await getMembers(session.id); render(); }, ':results'));
  _subs.push(subscribeToVotes(session.id,   async () => { allVotes = await getVotes(session.id); render(); }, ':results'));

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

    // Global pie — all options with votes
    const allScoredOpts = Object.values(grouped).flatMap(areas => Object.values(areas).flat()).filter(o => o.score > 0);
    const globalPie = allScoredOpts.length > 0 && grandTotal > 0
      ? `<div class="q-pie-wrap">${buildPie(allScoredOpts, grandTotal)}</div>` : '';

    let resultsHtml = globalPie;
    for (const [meal, areas] of Object.entries(grouped)) {
      const topScore = Math.max(...Object.values(areas).flat().map(o => o.score), 0);
      resultsHtml += `<div class="q-meal-section"><h2 class="q-meal-heading"><span class="v-meal-pill">${meal}</span></h2>`;
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
            <button id="leave-results-btn" class="q-tab-btn">🏠 Home</button>
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
    document.getElementById('leave-results-btn')?.addEventListener('click', () => onNavigate('home'));
    document.getElementById('signout-results-btn')?.addEventListener('click', () => { clearSessionLocal(); signOut(); });
  }
}

// Palette cycles through purple/magenta/teal/gold/green/red shades
const PIE_COLORS = [
  '#7c3aed','#ff319f','#0891b2','#f59e0b','#059669','#e11d48',
  '#a855f7','#ec4899','#06b6d4','#d97706','#10b981','#f43f5e',
  '#6d28d9','#db2777','#0e7490','#b45309','#047857','#be123c',
];

function buildPie(opts, total) {
  const cx = 100, cy = 100, r = 80;
  const labelR = 108; // radius for legend dots
  let segments = '';
  let angle = -Math.PI / 2; // start at top

  opts.forEach((opt, i) => {
    const slice = (opt.score / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + slice);
    const y2 = cy + r * Math.sin(angle + slice);
    const large = slice > Math.PI ? 1 : 0;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    segments += `<path class="q-pie-slice" d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}" data-label="${escHtml(opt.name)}" />`;
    angle += slice;
  });

  // Legend
  const legend = opts.map((opt, i) => {
    const pct = ((opt.score / total) * 100).toFixed(1);
    const color = PIE_COLORS[i % PIE_COLORS.length];
    return `<div class="q-pie-legend-item"><span class="q-pie-dot" style="background:${color}"></span><span class="q-pie-legend-name">${escHtml(opt.name)}</span><span class="q-pie-legend-pct">${pct}%</span></div>`;
  }).join('');

  return `
    <div class="q-pie-chart">
      <svg class="q-pie-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        ${segments}
        <circle cx="${cx}" cy="${cy}" r="40" fill="white"/>
      </svg>
      <div class="q-pie-legend">${legend}</div>
    </div>`;
}

export function cleanupResults() {
  _subs.forEach(s => s.unsubscribe?.());
  _subs = [];
}
