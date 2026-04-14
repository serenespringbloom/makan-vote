const ERR_MAP = [
  [/row.level security|rls|policy/i,          'You don\'t have permission to do that.'],
  [/not found|406|PGRST116/i,                 'Session not found. Check the room code.'],
  [/anonymous sign.ins are disabled/i,         'Guest sign-in is not enabled. Contact the host.'],
  [/duplicate|unique.*violation|23505/i,       'That already exists.'],
  [/network|failed to fetch|load resource/i,  'Network error. Check your connection.'],
  [/locked/i,                                 'This session is locked.'],
];

export function friendlyError(e) {
  const msg = e?.message ?? String(e);
  for (const [pattern, friendly] of ERR_MAP) {
    if (pattern.test(msg)) return friendly;
  }
  return 'Something went wrong. Please try again.';
}

export function showToast(msg, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}
