// ── Supabase client ───────────────────────────────────────────────────────────
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth ──────────────────────────────────────────────────────────────────────

async function signInWithGoogle() {
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

async function signOut() {
  const { error } = await _sb.auth.signOut();
  if (error) throw error;
}

async function getUser() {
  const { data: { user } } = await _sb.auth.getUser();
  return user; // null if not logged in
}

function onAuthStateChange(callback) {
  return _sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ── Sessions ──────────────────────────────────────────────────────────────────

async function createSession(user) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { data, error } = await _sb
    .from('sessions')
    .insert({ code, creator_id: user.id, locked: false })
    .select()
    .single();
  if (error) throw error;

  // Seed food options for this session
  const options = SEED_OPTIONS.map(o => ({
    session_id: data.id,
    meal: o.meal,
    area: o.area,
    name: o.name,
  }));
  const { error: optErr } = await _sb.from('options').insert(options);
  if (optErr) throw optErr;

  // Creator auto-joins
  await joinSession(data.id, user);

  return data;
}

async function getSessionByCode(code) {
  const { data, error } = await _sb
    .from('sessions')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();
  if (error) throw error;
  return data;
}

async function lockSession(sessionId) {
  const { error } = await _sb
    .from('sessions')
    .update({ locked: true })
    .eq('id', sessionId);
  if (error) throw error;
}

function subscribeToSession(sessionId, callback) {
  return _sb
    .channel(`session:${sessionId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, callback)
    .subscribe();
}

// ── Members ───────────────────────────────────────────────────────────────────

async function joinSession(sessionId, user) {
  const { data, error } = await _sb
    .from('members')
    .upsert(
      { session_id: sessionId, user_id: user.id, display_name: user.user_metadata?.full_name ?? user.email },
      { onConflict: 'session_id,user_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMembers(sessionId) {
  const { data, error } = await _sb
    .from('members')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at');
  if (error) throw error;
  return data;
}

async function removeMember(sessionId, userId) {
  // Delete votes first
  const { error: vErr } = await _sb
    .from('votes')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (vErr) throw vErr;

  const { error } = await _sb
    .from('members')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}

function subscribeToMembers(sessionId, callback) {
  return _sb
    .channel(`members:${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
}

// ── Options ───────────────────────────────────────────────────────────────────

async function getOptions(sessionId) {
  const { data, error } = await _sb
    .from('options')
    .select('*')
    .eq('session_id', sessionId)
    .order('meal')
    .order('area')
    .order('name');
  if (error) throw error;
  return data;
}

async function addOption(sessionId, meal, area, name) {
  const { data, error } = await _sb
    .from('options')
    .insert({ session_id: sessionId, meal, area, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeOption(sessionId, optionId) {
  // Wipe votes for this option first
  const { error: vErr } = await _sb
    .from('votes')
    .delete()
    .eq('option_id', optionId);
  if (vErr) throw vErr;

  const { error } = await _sb
    .from('options')
    .delete()
    .eq('id', optionId)
    .eq('session_id', sessionId);
  if (error) throw error;
}

function subscribeToOptions(sessionId, callback) {
  return _sb
    .channel(`options:${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'options', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
}

// ── Votes ─────────────────────────────────────────────────────────────────────

async function submitVotes(sessionId, userId, allocations) {
  // allocations: [{ option_id, amount }]
  const { error: delErr } = await _sb
    .from('votes')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (delErr) throw delErr;

  const rows = allocations
    .filter(a => a.amount > 0)
    .map(a => ({ session_id: sessionId, user_id: userId, option_id: a.option_id, amount: a.amount }));

  if (rows.length > 0) {
    const { error } = await _sb.from('votes').insert(rows);
    if (error) throw error;
  }
}

async function getVotes(sessionId) {
  const { data, error } = await _sb
    .from('votes')
    .select('*')
    .eq('session_id', sessionId);
  if (error) throw error;
  return data;
}

function subscribeToVotes(sessionId, callback) {
  return _sb
    .channel(`votes:${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
}
