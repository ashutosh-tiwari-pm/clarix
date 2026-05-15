const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DEMO MODE: replace .from() with a no-op chain immediately ──
if (new URLSearchParams(location.search).get('demo') === 'true') {
  const _noopChain = {};
  ['select','insert','update','upsert','delete','eq','neq','in','not','is',
   'order','limit','range','single','maybeSingle','match','filter','overlaps'
  ].forEach(m => { _noopChain[m] = () => _noopChain; });
  _noopChain.then = (fn) => Promise.resolve({ data: null, error: null }).then(fn);
  supabaseClient.from = () => _noopChain;
  supabaseClient.auth.getSession = async () => ({ data: { session: null }, error: null });
  supabaseClient.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } });
}

async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}
