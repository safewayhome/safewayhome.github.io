/**
 * Inloggning för team-boarden (Supabase Auth, email + lösen).
 *
 * Varför: RLS-policyn säger att bara INLOGGADE får skapa/ändra/radera kort (läsning är öppen),
 * så utomstående kan titta men inte kladda. För att det ska funka måste teamet kunna logga in
 * här på tavlan. Samma Supabase-projekt som appens auth (Confirm email är AV, så registrering
 * funkar direkt utan mejlbekräftelse).
 *
 * authStore speglar { user, ready } till React via useSyncExternalStore (se store.js). canWrite()
 * är den enkla grinden som collab.js och UI:t frågar: får jag redigera? supabase-js fäster den
 * inloggades JWT på alla efterföljande anrop automatiskt, så själva skrivningarna behöver inget
 * extra: RLS släpper igenom dem när en session finns.
 */
import { supabase, supabaseEnabled } from './supabaseClient'

function createStore(initial) {
  let snap = initial
  const listeners = new Set()
  return {
    set(v) { snap = v; listeners.forEach((l) => l()) },
    get: () => snap,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

// ready=false tills vi vet om det finns en sparad session (undviker att UI:t blinkar "utloggad" först).
export const authStore = createStore({ user: null, ready: !supabaseEnabled })

let currentUser = null
export const canWrite = () => !!currentUser
export const currentEmail = () => currentUser?.email || ''

function apply(session) {
  currentUser = session?.user || null
  // Håll realtime-anslutningens roll i synk med inloggningen (anon -> authenticated och tillbaka).
  try { supabase?.realtime?.setAuth(session?.access_token ?? null) } catch { /* ignore */ }
  authStore.set({ user: currentUser, ready: true })
}

if (supabaseEnabled) {
  supabase.auth.getSession().then(({ data }) => apply(data?.session || null)).catch(() => apply(null))
  supabase.auth.onAuthStateChange((_event, session) => apply(session || null))
}

export async function signIn(email, password) {
  if (!supabase) return { error: { message: 'Supabase ej konfigurerat' } }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return { error }
}

// Confirm email är AV i projektet, så ett nytt konto blir direkt inloggat (ingen mejlbekräftelse).
export async function signUp(email, password) {
  if (!supabase) return { error: { message: 'Supabase ej konfigurerat' } }
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
  if (error) return { error }
  // Om projektet ändå kräver bekräftelse skapas ingen session: försök logga in direkt ändå.
  if (!data.session) return signIn(email, password)
  return { error: null }
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}
