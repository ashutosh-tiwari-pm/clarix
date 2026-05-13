const SUPABASE_URL = 'https://adsjiigutipfrnvdgrwx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-I7rBj-UJCVkwivJAnGy7g_5LsvFMvk';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
