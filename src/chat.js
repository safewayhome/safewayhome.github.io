/**
 * Datalager för Team Chat (flerspelarchatt + molnhostad LLM-pipeline).
 *
 * Två datavägar, medvetet uppdelade:
 *   1) Meddelanden (människor + AI-svar) ligger i Supabase-tabellen chat_messages. Vi läser historik
 *      en gång och prenumererar sedan på Realtime (postgres_changes INSERT) så att allt syns live för
 *      hela teamet. Dedup sker på radens id (en lokalt insatt rad får sitt riktiga id direkt och
 *      ignoreras därför när realtime-ekot kommer tillbaka).
 *   2) Själva AI-körningen streamas från FastAPI-backenden (/api/chat/message) som Server-Sent Events.
 *      Den strömmen är EFEMÄR: den driver bara forsknings-UI:t (steg, framstegsindikator, rullande
 *      tänkande-process). Det persisterade AI-svaret kommer separat via Realtime (backend sparar det).
 *
 * RLS: både läsning och skrivning kräver inloggning, så allt här antar en aktiv session (vyn visar en
 * låsvy annars). supabase-js fäster automatiskt JWT:n på REST-, Storage- och Realtime-anrop.
 */
import { supabase } from './supabaseClient'
import { authStore } from './auth'
import { PRESENCE_COLORS } from './theme'

// Backend-bas. Samma Cloud Run-tjänst som appen; publik URL (ok i klartext). Override via VITE_API_BASE.
export const API_BASE = (import.meta.env.VITE_API_BASE || 'https://ledmig-65580962936.europe-north1.run.app').replace(/\/$/, '')

// Liten extern store (samma mönster som auth.js) -> kopplas till React via useSyncExternalStore.
function createStore(initial) {
  let snap = initial
  const listeners = new Set()
  return {
    set(v) { snap = v; listeners.forEach((l) => l()) },
    update(patch) { snap = { ...snap, ...patch }; listeners.forEach((l) => l()) },
    get: () => snap,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

export const messagesStore = createStore([])         // hela chatt-loggen, kronologiskt
// live = pågående AI-körning. active styr om forsknings-UI:t visas.
export const liveStore = createStore({ active: false, mode: '', steps: [], step: 0, progress: 0, label: '', model: '', thinking: '', answer: '', error: '' })

// ── Tokenmätare: hur mycket av gratis-modellernas budget vi använt (session + idag) ──
// Vi mäter FAKTISKA tokens (rapporterade per anrop av OpenRouter/Gemini, summerade i backend och
// skickade som ett 'usage'-event) och jämför mot en mjuk dagsbudget. Gratis-nivåns dagsfönster
// återställs vid UTC-midnatt. DAILY_TOKEN_BUDGET är en rimlig uppskattning av fönstret (justerbar),
// inte ett hårt API-tak: providern exponerar inget exakt token-kvarvarande.
export const DAILY_TOKEN_BUDGET = 200000
const USAGE_KEY = 'lm.chat.usage'   // { date:'YYYY-MM-DD'(UTC), tokens:N } -> nollställs per dygn

function utcDateKey() { return new Date().toISOString().slice(0, 10) }
function loadTodayTokens() {
  try {
    const r = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')
    return r.date === utcDateKey() ? (r.tokens || 0) : 0
  } catch { return 0 }
}
function saveTodayTokens(t) {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ date: utcDateKey(), tokens: t })) } catch { /* ignore */ }
}
// session = denna flik sedan laddning. today = sedan senaste UTC-midnatt (delas mellan flikar via localStorage).
export const usageStore = createStore({ session: 0, today: loadTodayTokens() })

const knownIds = new Set()   // dedup: rad-id vi redan visar (lokala insert + realtime + done)

function addMessage(row) {
  if (!row || !row.id || knownIds.has(row.id)) return
  let list = messagesStore.get()
  // Om detta är den RIKTIGA DB-raden för ett AI-svar vi redan visat optimistiskt (id 'local-ai-…' när
  // backend hann svara utan message_id), ersätt den lokala raden i stället för att lägga till en dubblett.
  if (row.is_ai && !String(row.id).startsWith('local-ai-')) {
    const dupIdx = list.findIndex((m) => m.is_ai && String(m.id).startsWith('local-ai-') && m.message_text === row.message_text)
    if (dupIdx >= 0) {
      knownIds.delete(list[dupIdx].id)
      list = list.filter((_, i) => i !== dupIdx)
    }
  }
  knownIds.add(row.id)
  const next = [...list, row]
  next.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  messagesStore.set(next)
}

// En stabil, vänlig färg per avsändare (avatarer) härledd ur mejlen: samma person -> samma färg.
export function colorForEmail(email) {
  const s = email || ''
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]
}

let started = false
let channel = null

// Idempotent: ladda historik + starta realtime EN gång (när man är inloggad). Säkert att kalla i en
// effect varje render: andra anropet är en no-op.
export async function startChat() {
  if (started || !supabase) return
  started = true
  try {
    const { data, error } = await supabase
      .from('chat_messages').select('*').order('created_at', { ascending: true }).limit(500)
    if (!error && data) data.forEach(addMessage)
  } catch { /* lokalt läge: ingen DB -> tom logg */ }

  channel = supabase.channel('chat-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => addMessage(payload.new))
    .subscribe()
}

export function stopChat() {
  if (channel) { try { supabase.removeChannel(channel) } catch { /* ignore */ } channel = null }
  started = false
}

// Bilduppladdning -> publik URL i bucketen 'chat-images' (RLS: insert kräver inloggning).
async function uploadImage(file) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase()
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('chat-images').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('chat-images').getPublicUrl(path).data.publicUrl
}

// Hämta registrerade konton till avsändar-filtret (backend -> GoTrue admin). Faller tillbaka på att
// härleda avsändare ur meddelandena om endpointen inte svarar.
export async function fetchUsers() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch(`${API_BASE}/api/chat/users`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
    if (r.ok) { const j = await r.json(); return (j.users || []).map((u) => u.email).filter(Boolean) }
  } catch { /* degradera tyst */ }
  return []
}

// Läser SSE-strömmen från pipelinen och driver liveStore (steg/framsteg/tänkande/svar) live.
async function streamPipeline(message, image_url, mode) {
  // Sätt mode direkt så forsknings-UI:t kan välja rätt vy (snabb vs tänkande) innan plan-eventet hinner fram.
  liveStore.set({ active: true, mode, steps: [], step: 0, progress: 2, label: mode === 'fast' ? 'Genererar snabbt svar...' : 'Startar…', model: '', thinking: '', answer: '', error: '' })
  let resp
  try {
    const { data: { session } } = await supabase.auth.getSession()
    resp = await fetch(`${API_BASE}/api/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ message, image_url, mode }),
    })
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
  } catch (e) {
    liveStore.update({ active: false, error: `Kunde inte nå AI-tjänsten (${e.message}).` })
    return
  }

  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      // SSE-händelser separeras av en blankrad. Plocka kompletta event ur bufferten.
      let sep
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep); buf = buf.slice(sep + 2)
        for (const ln of block.split('\n')) {
          if (!ln.startsWith('data:')) continue
          const data = ln.slice(5).trim()
          if (!data) continue
          let obj; try { obj = JSON.parse(data) } catch { continue }
          handleEvent(obj)
        }
      }
    }
  } catch (e) {
    liveStore.update({ error: `Strömmen avbröts (${e.message}).` })
  } finally {
    liveStore.update({ active: false })
  }
}

function handleEvent(obj) {
  const s = liveStore.get()
  if (obj.type === 'plan') {
    // Backend talar om läge (fast/thinking) + vilka steg-etiketter som gäller -> styr forsknings-UI:t.
    liveStore.update({ mode: obj.mode || s.mode || '', steps: Array.isArray(obj.steps) ? obj.steps : [] })
  } else if (obj.type === 'model') {
    // Vilken modell som FAKTISKT svarade (efter ev. fallback) -> uppdatera modell-badgen.
    liveStore.update({ model: obj.model || s.model })
  } else if (obj.type === 'status') {
    liveStore.update({ step: obj.step, progress: Math.max(s.progress, obj.progress || 0), label: obj.label || s.label, model: obj.model || s.model })
  } else if (obj.type === 'thinking') {
    // krypa framstegsindikatorn framåt inom stegets band så den känns levande mellan status-eventen
    liveStore.update({ thinking: s.thinking + (obj.delta || ''), progress: Math.min(s.progress + 0.25, obj.step === 1 ? 38 : 70) })
  } else if (obj.type === 'answer') {
    liveStore.update({ answer: s.answer + (obj.delta || ''), progress: Math.min(s.progress + 0.2, 99) })
  } else if (obj.type === 'done') {
    liveStore.update({ progress: 100 })
    // Visa svaret direkt (utan att vänta på realtime). message_id dedupar mot realtime-ekot.
    if (obj.final) {
      addMessage({
        id: obj.message_id || `local-ai-${Date.now()}`,
        message_text: obj.final, is_ai: true, user_email: 'LedMig AI',
        created_at: new Date().toISOString(),
      })
    }
  } else if (obj.type === 'usage') {
    // Tokenförbrukning för hela frågan -> lägg på session + dagssumma (UTC).
    const n = obj.total_tokens || 0
    if (n > 0) {
      const u = usageStore.get()
      const today = u.today + n
      saveTodayTokens(today)
      usageStore.set({ session: u.session + n, today })
    }
  } else if (obj.type === 'error') {
    liveStore.update({ error: obj.message || 'Något gick fel i pipelinen.' })
  }
}

// Skicka ett meddelande: ladda ev. bild -> spara människans rad (optimistiskt + persistent) -> kör kedjan.
// mode = 'fast' (snabbt svar) eller 'thinking' (full 3-stegs-kedja).
export async function sendMessage(text, imageFile, mode = 'fast') {
  text = (text || '').trim()
  if (!text && !imageFile) return { error: null }
  const me = authStore.get().user
  if (!me) return { error: { message: 'Du måste vara inloggad.' } }

  let image_url = null
  if (imageFile) {
    try { image_url = await uploadImage(imageFile) }
    catch (e) { return { error: { message: `Bilduppladdning misslyckades: ${e.message}` } } }
  }

  try {
    const { data, error } = await supabase.from('chat_messages')
      .insert({ message_text: text, image_url, is_ai: false, user_id: me.id, user_email: me.email })
      .select().single()
    if (error) return { error }
    addMessage(data)            // direkt eko för avsändaren; realtime-ekot dedupas på id
  } catch (e) {
    return { error: { message: e.message } }
  }

  streamPipeline(text, image_url, mode)   // kör vidare i bakgrunden (await:as ej: UI:t följer liveStore)
  return { error: null }
}
