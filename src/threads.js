/**
 * Datalager för DISKUSSIONSTRÅDAR inuti ett kort på tavlan ("Nätet").
 *
 * En tråd (board_threads) hör till ETT kort och har en valfri titel/syfte samt en arkiveringsstatus.
 * Meddelandena (board_thread_messages) kan svara på varandra: parent_id pekar på originalet (Twitch-
 * /Discord-liknande reply). Vi laddar tavlans trådar + meddelanden en gång och prenumererar sedan på
 * Realtime (postgres_changes) så att nya trådar, svar och arkiveringar syns direkt för hela teamet.
 *
 * SÄKERHET: trådar är intern teamdiskussion -> RLS kräver inloggning för BÅDE läsning och skrivning,
 * och insert binds till den autentiserade sessionen (user_id/created_by_id = auth.uid()) i schemat, så
 * ingen kan posta i någon annans namn. supabase-js fäster JWT:n automatiskt.
 *
 * RESILIENS: saknas tabellerna (migrationen board_ext_schema.sql ej körd) sätts threadsAvailable=false
 * och vyn visar en lugn "kör migrationen"-ruta i stället för att krascha. Allt annat på tavlan påverkas ej.
 */
import { supabase } from './supabaseClient'
import { authStore } from './auth'
import { identity, BOARD_ID } from './collab'

function createStore(initial) {
  let snap = initial
  const listeners = new Set()
  return {
    set(v) { snap = v; listeners.forEach((l) => l()) },
    get: () => snap,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

export const threadsStore = createStore({})     // taskId -> [thread, ...] (kronologiskt)
export const threadMsgsStore = createStore({})  // threadId -> [message, ...] (kronologiskt)
export const threadsMetaStore = createStore({ available: true, started: false })

const threadsByTask = new Map()  // taskId -> Map(threadId -> thread)
const msgsByThread = new Map()   // threadId -> Map(msgId -> message)

const objFromMapOfMaps = (m) => {
  const out = {}
  m.forEach((inner, k) => { out[k] = [...inner.values()] })
  return out
}
function pushThreads() {
  // sortera trådar nyast först (aktiva diskussioner överst), arkiverade filtreras i UI:t
  const out = {}
  threadsByTask.forEach((inner, taskId) => {
    out[taskId] = [...inner.values()].sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
  })
  threadsStore.set(out)
}
function pushMsgs() {
  const out = {}
  msgsByThread.forEach((inner, threadId) => {
    out[threadId] = [...inner.values()].sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0))
  })
  threadMsgsStore.set(out)
}

function addThread(row) {
  if (!row || !row.id || !row.task_id) return
  let inner = threadsByTask.get(row.task_id)
  if (!inner) { inner = new Map(); threadsByTask.set(row.task_id, inner) }
  inner.set(row.id, row) // set = upsert (täcker både INSERT och UPDATE/arkivering)
  pushThreads()
}
function removeThread(id) {
  if (!id) return
  threadsByTask.forEach((inner) => { if (inner.delete(id)) pushThreads() })
  msgsByThread.delete(id); pushMsgs()
}
function addMsg(row) {
  if (!row || !row.id || !row.thread_id) return
  let inner = msgsByThread.get(row.thread_id)
  if (!inner) { inner = new Map(); msgsByThread.set(row.thread_id, inner) }
  if (inner.has(row.id)) return // dedup (lokalt eko + realtime)
  inner.set(row.id, row)
  pushMsgs()
}

let started = false
let channel = null

// Idempotent: ladda tavlans trådar + meddelanden EN gång och starta realtime. Säkert att kalla i en
// effect vid varje öppnad editor.
export async function startThreads() {
  if (started || !supabase) return
  started = true
  threadsMetaStore.set({ available: true, started: true })
  try {
    const { data: th, error } = await supabase.from('board_threads')
      .select('*').eq('board_id', BOARD_ID).order('created_at', { ascending: true })
    if (error) { started = false; threadsMetaStore.set({ available: false, started: false }); return }
    ;(th || []).forEach(addThread)
    const ids = (th || []).map((t) => t.id)
    if (ids.length) {
      const { data: ms } = await supabase.from('board_thread_messages')
        .select('*').in('thread_id', ids).order('created_at', { ascending: true })
      ;(ms || []).forEach(addMsg)
    }
  } catch { started = false; threadsMetaStore.set({ available: false, started: false }); return }

  channel = supabase.channel('board-threads:' + BOARD_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_threads' }, (p) => {
      if (p.eventType === 'DELETE') { removeThread(p.old?.id); return }
      if (p.new) addThread(p.new)
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_thread_messages' }, (p) => {
      if (p.new) addMsg(p.new)
    })
    .subscribe()
}

const displayName = (me) => identity.name || (me?.email || '').split('@')[0] || 'någon'

// Starta en ny tråd i ett kort (valfri titel/syfte).
export async function createThread(taskId, title) {
  const me = authStore.get().user
  if (!me) return { error: 'Logga in för att starta en tråd.' }
  if (!supabase) return { error: 'Ingen databasanslutning.' }
  const row = {
    board_id: BOARD_ID, task_id: taskId, title: (title || '').trim().slice(0, 200),
    created_by_id: me.id, created_by_name: displayName(me), created_by_color: identity.color,
  }
  const { data, error } = await supabase.from('board_threads').insert(row).select().single()
  if (error) return { error: error.message }
  addThread(data)
  return { error: null, thread: data }
}

// Posta ett meddelande i en tråd. parentId != null -> Twitch-liknande svar på ett specifikt meddelande.
export async function postThreadMessage(threadId, body, parentId = null) {
  const me = authStore.get().user
  if (!me) return { error: 'Logga in för att svara.' }
  body = (body || '').trim()
  if (!body) return { error: 'Tomt meddelande.' }
  const row = {
    thread_id: threadId, parent_id: parentId || null, user_id: me.id,
    user_name: displayName(me), user_color: identity.color, body: body.slice(0, 4000),
  }
  const { data, error } = await supabase.from('board_thread_messages').insert(row).select().single()
  if (error) return { error: error.message }
  addMsg(data)
  // bumpa trådens updated_at (best effort: påverkar inte resultatet om det misslyckas)
  supabase.from('board_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId).then(() => {}, () => {})
  return { error: null, message: data }
}

// Arkivera/avarkivera en tråd (löst/klar/död) -> döljs från huvudvyn men sparas kvar i DB:n.
export async function setThreadArchived(threadId, archived) {
  const me = authStore.get().user
  if (!me) return { error: 'Logga in.' }
  if (!supabase) return { error: 'Ingen databasanslutning.' }
  const { data, error } = await supabase.from('board_threads')
    .update({ archived: !!archived, updated_at: new Date().toISOString() }).eq('id', threadId).select().single()
  if (error) return { error: error.message }
  addThread(data)
  return { error: null }
}
