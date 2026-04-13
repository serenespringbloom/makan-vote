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

  // Restore session from localStorage after OAuth redirect
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

  navigate(currentSession ? 'vote' : 'login');
});
