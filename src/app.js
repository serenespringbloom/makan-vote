import { onAuthStateChange, getSessionByCode, clearSessionLocal, loadSessionLocal } from './supabase.js';
import { renderLogin } from './views/login.js';
import { renderVoting, cleanupVoting } from './views/voting.js';
import { renderResults, cleanupResults } from './views/results.js';
import './style.css';

let currentUser = null;
let currentSession = null;

function navigate(view, session) {
  if (session) currentSession = session;

  if (view !== 'vote') cleanupVoting();
  if (view !== 'results') cleanupResults();

  switch (view) {
    case 'vote':
      if (!currentUser || !currentSession) { renderLogin(currentUser, navigate); return; }
      renderVoting(currentUser, currentSession, navigate);
      break;
    case 'results':
      if (!currentUser || !currentSession) { renderLogin(currentUser, navigate); return; }
      renderResults(currentUser, currentSession, navigate);
      break;
    default:
      renderLogin(currentUser, navigate);
  }
}

onAuthStateChange(async (user) => {
  currentUser = user;

  if (!user) {
    currentSession = null;
    navigate('login');
    return;
  }

  // Restore session from localStorage after OAuth redirect or page refresh
  if (!currentSession) {
    const stored = loadSessionLocal();
    if (stored) {
      try {
        currentSession = await getSessionByCode(stored.code);
      } catch {
        clearSessionLocal();
      }
    }
  }

  // Anonymous users who haven't joined a session yet go to login
  if (user.is_anonymous && !currentSession) {
    navigate('login');
    return;
  }

  navigate(currentSession ? 'vote' : 'login');
});
