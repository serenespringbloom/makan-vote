// ── App state ─────────────────────────────────────────────────────────────────
const App = {
  user: null,
  session: null,
  currentView: null,

  async init() {
    // Listen for auth changes (handles redirect back from Google OAuth)
    onAuthStateChange(async (user) => {
      App.user = user;

      if (!user) {
        App.session = null;
        App.render('login');
        return;
      }

      // Try to restore session from localStorage
      const stored = loadSessionLocal();
      if (stored && !App.session) {
        try {
          const session = await getSessionByCode(stored.code);
          App.session = session;
        } catch {
          clearSessionLocal();
        }
      }

      if (App.session) {
        App.render(App.currentView === 'results' ? 'results' : 'vote');
      } else {
        App.render('login');
      }
    });
  },

  go(view) {
    App.currentView = view;
    App.render(view);
  },

  render(view) {
    // Cleanup subscriptions from previous view
    if (view !== 'vote') cleanupVoting?.();
    if (view !== 'results') cleanupResults?.();

    switch (view) {
      case 'login':
        renderLogin(App.user);
        break;

      case 'vote':
        if (!App.user) { renderLogin(null); return; }
        if (!App.session) { renderLogin(App.user); return; }
        renderVoting(App.user, App.session);
        break;

      case 'results':
        if (!App.user) { renderLogin(null); return; }
        if (!App.session) { renderLogin(App.user); return; }
        renderResults(App.user, App.session);
        break;

      default:
        renderLogin(App.user);
    }
  },
};

// Make session available globally after login/join (used by login.js)
const _origSaveSessionLocal = saveSessionLocal;

// Patch App.go so login.js can set session before navigating
const _origGo = App.go.bind(App);
App.go = async function (view) {
  if ((view === 'vote' || view === 'results') && !App.session) {
    const stored = loadSessionLocal();
    if (stored) {
      try {
        App.session = await getSessionByCode(stored.code);
      } catch {
        clearSessionLocal();
        App.render('login');
        return;
      }
    }
  }
  App.currentView = view;
  App.render(view);
};

// ── Boot ──────────────────────────────────────────────────────────────────────
App.init();
