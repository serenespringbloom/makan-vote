/**
 * Show a styled confirmation modal.
 * Returns a Promise<boolean> — true if confirmed, false if cancelled.
 */
export function confirm(message, { confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise(resolve => {
    // Remove any existing modal
    document.getElementById('mv-modal')?.remove();

    const el = document.createElement('div');
    el.id = 'mv-modal';
    el.className = 'mv-modal-overlay';
    el.innerHTML = `
      <div class="mv-modal-box">
        <p class="mv-modal-msg">${message}</p>
        <div class="mv-modal-actions">
          <button class="v-btn v-btn--ghost mv-cancel">${cancelText}</button>
          <button class="v-btn ${danger ? 'v-btn--danger' : 'v-btn--primary'} mv-confirm">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    // Animate in
    requestAnimationFrame(() => el.classList.add('show'));

    const close = (result) => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      resolve(result);
    };

    el.querySelector('.mv-confirm').addEventListener('click', () => close(true));
    el.querySelector('.mv-cancel').addEventListener('click', () => close(false));
    el.addEventListener('click', e => { if (e.target === el) close(false); });
  });
}
