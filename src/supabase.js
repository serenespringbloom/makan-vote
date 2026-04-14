import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SEED_OPTIONS } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signInAnonymously(displayName) {
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  // Store display name in user metadata
  await sb.auth.updateUser({ data: { full_name: displayName, is_guest: true } });
  return data.user;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

export function onAuthStateChange(callback) {
  return sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(user) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const { data, error } = await sb
    .from('sessions')
    .insert({ code, creator_id: user.id, locked: false })
    .select()
    .single();
  if (error) throw error;

  await joinSession(data.id, user);
  return data;
}

export async function getSessionByCode(code) {
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw new Error('Session not found. Check the room code and try again.');
    throw error;
  }
  return data;
}

export async function lockSession(sessionId) {
  const { error } = await sb.from('sessions').update({ locked: true }).eq('id', sessionId);
  if (error) throw error;
}

export async function deleteSession(sessionId) {
  const { error } = await sb.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

export function subscribeToSession(sessionId, callback) {
  return sb
    .channel(`session:${sessionId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, payload => callback({ ...payload, eventType: 'UPDATE' }))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, payload => callback({ ...payload, eventType: 'DELETE' }))
    .subscribe();
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function joinSession(sessionId, user) {
  const display_name = user.user_metadata?.full_name ?? user.email ?? 'Guest';

  // Try insert; if already a member (unique conflict) that's fine
  const { error: insertErr } = await sb
    .from('members')
    .insert({ session_id: sessionId, user_id: user.id, display_name });

  if (insertErr && insertErr.code !== '23505') throw insertErr;
  // 23505 = unique_violation (already a member) — not an error for us
}

export async function getMembers(sessionId) {
  const { data, error } = await sb.from('members').select('*').eq('session_id', sessionId).order('joined_at');
  if (error) throw error;
  return data;
}

export async function removeMember(sessionId, userId) {
  const { error: vErr } = await sb.from('votes').delete().eq('session_id', sessionId).eq('user_id', userId);
  if (vErr) throw vErr;
  const { error } = await sb.from('members').delete().eq('session_id', sessionId).eq('user_id', userId);
  if (error) throw error;
}

export function subscribeToMembers(sessionId, callback, suffix = '') {
  return sb
    .channel(`members:${sessionId}${suffix}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
}

// ── Options ───────────────────────────────────────────────────────────────────

export async function getOptions(sessionId) {
  const { data, error } = await sb
    .from('options').select('*').eq('session_id', sessionId).order('meal').order('area').order('name');
  if (error) throw error;
  return data;
}

export async function addOption(sessionId, meal, area, name) {
  const { data, error } = await sb.from('options').insert({ session_id: sessionId, meal, area, name }).select().single();
  if (error) throw error;
  return data;
}

export async function removeOption(sessionId, optionId) {
  const { error: vErr } = await sb.from('votes').delete().eq('option_id', optionId);
  if (vErr) throw vErr;
  const { error } = await sb.from('options').delete().eq('id', optionId).eq('session_id', sessionId);
  if (error) throw error;
}

export function subscribeToOptions(sessionId, callback, suffix = '') {
  return sb
    .channel(`options:${sessionId}${suffix}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'options', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
}

// ── Votes ─────────────────────────────────────────────────────────────────────

export async function submitVotes(sessionId, userId, allocations) {
  const { error: delErr } = await sb.from('votes').delete().eq('session_id', sessionId).eq('user_id', userId);
  if (delErr) throw delErr;
  const rows = allocations.filter(a => a.amount > 0).map(a => ({ session_id: sessionId, user_id: userId, option_id: a.option_id, amount: a.amount }));
  if (rows.length > 0) {
    const { error } = await sb.from('votes').insert(rows);
    if (error) throw error;
  }
}

export async function getVotes(sessionId) {
  const { data, error } = await sb.from('votes').select('*').eq('session_id', sessionId);
  if (error) throw error;
  return data;
}

export function subscribeToVotes(sessionId, callback, suffix = '') {
  return sb
    .channel(`votes:${sessionId}${suffix}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
}

// ── LocalStorage — recent sessions list ───────────────────────────────────────
const LS_KEY = 'makan_vote_sessions';

export function saveSessionLocal(sessionId, code) {
  const sessions = loadRecentSessions().filter(s => s.sessionId !== sessionId);
  sessions.unshift({ sessionId, code, joinedAt: Date.now() });
  localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(0, 5))); // keep last 5
}

export function loadSessionLocal() {
  const sessions = loadRecentSessions();
  return sessions[0] ?? null; // most recent
}

export function loadRecentSessions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}

export function removeSessionLocal(sessionId) {
  const sessions = loadRecentSessions().filter(s => s.sessionId !== sessionId);
  localStorage.setItem(LS_KEY, JSON.stringify(sessions));
}

export function clearSessionLocal() {
  localStorage.removeItem(LS_KEY);
}
