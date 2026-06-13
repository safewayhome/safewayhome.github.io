/**
 * Datalager + realtid för Idea Web (/idea): Supabase Postgres som SANNINGSKÄLLA.
 *
 *   idea_nodes / idea_edges (Postgres)  ·  Supabase Realtime (postgres_changes + presence)  ·  localStorage-cache
 *
 * Medvetet samma modell som team-tavlans Nätet ([[team-board]] collab.js), trimmad för kartan:
 *   - En ändring skrivs DIREKT till databasen och syns för alla, även om ingen annan är online
 *     (FigJam-modellen). Stänger man fliken finns idéerna kvar.
 *   - KOLUMN-SCOPADE skrivningar: ett drag rör bara x/y, en titeländring bara title. Två personer
 *     som flyttar olika block, eller rör olika fält på samma block, krockar därför aldrig.
 *   - Lokalt ändrade fält markeras "dirty" och skyddas mot inkommande realtime-eko tills DB:n
 *     bekräftar samma värde (eller en TTL löper ut): din pågående släpning/skrift rycks inte bort
 *     medan en kollegas ändring på ett ANNAT fält ändå syns direkt.
 *   - Trådar (edges) är oföränderliga: bara insert/delete. En nods radering tar dess trådar via
 *     FK ON DELETE CASCADE i DB:n; lokalt självläker vi samma sak.
 *
 * Bilder: laddas upp till Storage-bucketen idea-images och BARA den korta publika URL:en sparas i
 * raden. Aldrig en base64-dataURL i kolumnen: Realtime (replica identity full) skulle annars
 * broadcasta megabyte vid varje positionsskrivning.
 *
 * Tre realtidsspår: 1) noder (postgres_changes), 2) trådar (postgres_changes), 3) presence + live-
 * pekare (broadcast, lagras ej).
 *
 * Auth: LÄS är öppen, SKRIV kräver inloggning (RLS). canWrite() är grinden; UI:t ber om login i
 * stället för att göra en optimistisk ändring som RLS sen nekar (divergens).
 *
 * Mjuk degradering: når vi inte Supabase (eller saknas tabellerna) faller allt tillbaka till ett
 * LOKALT läge (localStorage + seed). Skapas något lokalt synkas det UPP när DB:n svarar.
 * FORMAT: aldrig AI-tankestreck som separator, alltid kolon (:).
 */
import { supabase, supabaseEnabled } from '../supabaseClient'
import { canWrite, authStore } from '../auth'

// --------------------------------------------------------------------------- config
const params = new URLSearchParams(location.search)
const boardParam = params.get('board')
if (boardParam) { try { localStorage.setItem('lm.idea.board', boardParam) } catch { /* ignore */ } }
export const BOARD_ID = boardParam || (() => { try { return localStorage.getItem('lm.idea.board') } catch { return null } })() || 'ledmig-ideas-v1'

const CACHE_KEY = 'lm.idea.cache.' + BOARD_ID
const SYNC_KEY = 'lm.idea.synced.' + BOARD_ID
const DIRTY_TTL = 10000        // ms innan vi slutar vänta på DB-bekräftelse på ett fält
const POS_THROTTLE = 70        // ms mellan positionsskrivningar under ett drag
const TEXT_DEBOUNCE = 450      // ms efter sista tangenttryck innan titeln skrivs
const IMG_MAX_BYTES = 4 * 1024 * 1024

// Presence-pekarfärger: en liten distinkt palett (kartan har sin egen rosa familj, så vi håller
// dessa fristående från tavlans theme för att inte dra in den i idé-bundlen).
const CURSOR_COLORS = ['#d6336c', '#9c4a1f', '#48618a', '#5f7040', '#7d4ea8', '#1f8a8a', '#b3873f']

const rnd = () => Math.random().toString(36).slice(2, 9)
const uid = () => (globalThis.crypto?.randomUUID?.() || (rnd() + rnd() + Date.now().toString(36)))
const perfNow = () => (globalThis.performance?.now?.() ?? Date.now())

// --------------------------------------------------------------------------- minimal external store
function createStore(initial) {
  let snap = initial
  const listeners = new Set()
  return {
    set(v) { snap = v; listeners.forEach((l) => l()) },
    get: () => snap,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

export const nodesStore = createStore([])
export const edgesStore = createStore([])
export const peopleStore = createStore([])
export const cursorsStore = createStore([])
export const connStore = createStore({ peers: 0, online: false, synced: false, dbMode: false })

// --------------------------------------------------------------------------- in-memory state
const nodes = new Map()   // id -> { id, x, y, title, category, imageUrl }
const edges = new Map()   // id -> { id, from, to }
let dbMode = false
const pushNodes = () => nodesStore.set([...nodes.values()])
const pushEdges = () => edgesStore.set([...edges.values()])

// dirty: fält ändrade lokalt men ännu obekräftade av DB:n. id -> Map(field -> {val, ts}).
const dirty = new Map()
const syncedIds = new Set()       // node-id:n som round-trippat DB:n (persistent)
const sessionIds = new Set()      // sett denna session (skiljer "raderad på annan enhet" från "aldrig synkad")
const realtimeDeleted = new Set() // node-id:n raderade via realtime denna session
const createPromises = new Map()  // node-id -> Promise<boolean>: gate:ar FK-beroende edge-insert

// --------------------------------------------------------------------------- identity
function loadIdentity() {
  let id = localStorage.getItem('lm.idea.clientId') || localStorage.getItem('lm.clientId')
  if (!id) { id = rnd(); try { localStorage.setItem('lm.idea.clientId', id) } catch { /* ignore */ } }
  let colorIdx = parseInt(localStorage.getItem('lm.idea.colorIdx') ?? '', 10)
  if (Number.isNaN(colorIdx)) {
    colorIdx = Math.floor(Math.random() * CURSOR_COLORS.length)
    try { localStorage.setItem('lm.idea.colorIdx', String(colorIdx)) } catch { /* ignore */ }
  }
  // Återanvänd tavlans namn om det finns (samma team, samma webbläsare).
  const name = localStorage.getItem('lm.idea.name') || localStorage.getItem('lm.name') || ''
  return { id, name, color: CURSOR_COLORS[colorIdx % CURSOR_COLORS.length] }
}
export let identity = loadIdentity()
export function setName(name) {
  identity = { ...identity, name }
  try { localStorage.setItem('lm.idea.name', name) } catch { /* ignore */ }
  trackPresence()
}

// --------------------------------------------------------------------------- row <-> model
function rowToNode(r) {
  return { id: r.id, x: r.x ?? 0, y: r.y ?? 0, title: r.title ?? '', category: r.category ?? 'core', imageUrl: r.image_url ?? null }
}
function nodeToRow(n) {
  return { id: n.id, board_id: BOARD_ID, x: n.x ?? 0, y: n.y ?? 0, title: n.title ?? '', category: n.category ?? 'core', image_url: n.imageUrl ?? null }
}
const NODE_COL = { imageUrl: 'image_url' }
function nodeSubset(n, fields) {
  const out = {}
  fields.forEach((k) => { out[NODE_COL[k] || k] = n[k] })
  return out
}

// --------------------------------------------------------------------------- caches
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ nodes: [...nodes.values()], edges: [...edges.values()] })) } catch { /* ignore */ }
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    if (Array.isArray(c.nodes)) c.nodes.forEach((n) => n && n.id && nodes.set(n.id, n))
    if (Array.isArray(c.edges)) c.edges.forEach((e) => e && e.id && edges.set(e.id, e))
  } catch { /* ignore */ }
}
function loadSynced() {
  try { const a = JSON.parse(localStorage.getItem(SYNC_KEY) || '[]'); if (Array.isArray(a)) a.forEach((id) => syncedIds.add(id)) } catch { /* ignore */ }
}
let syncSaveTimer = null
function saveSynced() {
  clearTimeout(syncSaveTimer)
  syncSaveTimer = setTimeout(() => { try { localStorage.setItem(SYNC_KEY, JSON.stringify([...syncedIds])) } catch { /* ignore */ } }, 300)
}
function markSynced(id) { if (!syncedIds.has(id)) { syncedIds.add(id); saveSynced() } }

// --------------------------------------------------------------------------- dirty tracking
function markDirty(id, fields, n) {
  let d = dirty.get(id)
  if (!d) { d = new Map(); dirty.set(id, d) }
  const now = Date.now()
  fields.forEach((f) => d.set(f, { val: n[f], ts: now }))
}

// --------------------------------------------------------------------------- DB writes (nodes)
function writeNodeCols(id, fields) {
  if (!dbMode || !fields.length) return
  const n = nodes.get(id); if (!n) return
  const row = { ...nodeSubset(n, fields), updated_by: identity.name || 'någon', updated_at: new Date().toISOString() }
  sessionIds.add(id)
  supabase.from('idea_nodes').update(row).eq('id', id)
    .then(({ error }) => { if (error) console.warn('node update', error.message); else markSynced(id) })
}
function writeNodeFull(id) {
  if (!dbMode) return Promise.resolve(false)
  const n = nodes.get(id); if (!n) return Promise.resolve(false)
  const row = { ...nodeToRow(n), created_by: identity.name || null, updated_by: identity.name || 'någon' }
  sessionIds.add(id)
  return supabase.from('idea_nodes').upsert(row)
    .then(({ error }) => { if (error) { console.warn('node upsert', error.message); return false } markSynced(id); return true })
}

// Positionsskrivning under drag: leading + trailing throttle per nod (släng inte sista läget).
const posTimers = new Map()  // id -> { timer, last }
function schedulePosWrite(id) {
  let e = posTimers.get(id)
  const now = perfNow()
  if (!e) {
    writeNodeCols(id, ['x', 'y'])
    posTimers.set(id, { timer: null, last: now })
    return
  }
  if (now - e.last >= POS_THROTTLE) {
    clearTimeout(e.timer); e.timer = null
    e.last = now
    writeNodeCols(id, ['x', 'y'])
  } else if (!e.timer) {
    e.timer = setTimeout(() => { e.timer = null; e.last = perfNow(); writeNodeCols(id, ['x', 'y']) }, POS_THROTTLE - (now - e.last))
  }
}

// Titel-skrivning: debounce (annars en skrivning per tangenttryck).
const textTimers = new Map()
function scheduleTextWrite(id) {
  clearTimeout(textTimers.get(id))
  textTimers.set(id, setTimeout(() => { textTimers.delete(id); writeNodeCols(id, ['title']) }, TEXT_DEBOUNCE))
}
function clearNodeTimers(id) {
  const p = posTimers.get(id); if (p) { clearTimeout(p.timer); posTimers.delete(id) }
  clearTimeout(textTimers.get(id)); textTimers.delete(id)
}

// --------------------------------------------------------------------------- public API: nodes
export function allNodes() { return [...nodes.values()] }
export function allEdges() { return [...edges.values()] }

export function createNode(fields = {}) {
  if (!canWrite()) return null   // skapa kräver inloggning (RLS nekar annars)
  const id = fields.id || ('n_' + rnd())
  const n = { id, x: 0, y: 0, title: '', category: 'core', imageUrl: null, ...fields, id }
  nodes.set(id, n); pushNodes(); saveCache(); sessionIds.add(id)
  if (dbMode) {
    const p = writeNodeFull(id)
    createPromises.set(id, p)
    p.finally(() => createPromises.delete(id))
  }
  return id
}

// Flytta en nod (under drag): lokalt direkt + dirty + throttlad skrivning.
export function moveNode(id, x, y) {
  const n = nodes.get(id); if (!n) return
  const next = { ...n, x, y }
  nodes.set(id, next); pushNodes()
  if (!dbMode) { saveCache(); return }
  markDirty(id, ['x', 'y'], next)
  schedulePosWrite(id)
}
// Slut på drag: spara cachen + skriv slutläget säkert.
export function commitNode(id) {
  saveCache()
  if (dbMode) writeNodeCols(id, ['x', 'y'])
}

export function setNodeTitle(id, title) {
  const n = nodes.get(id); if (!n) return
  const next = { ...n, title }
  nodes.set(id, next); pushNodes(); saveCache()
  if (!dbMode) return
  markDirty(id, ['title'], next)
  scheduleTextWrite(id)
}

export function setNodeCategory(id, category) {
  const n = nodes.get(id); if (!n) return
  const next = { ...n, category }
  nodes.set(id, next); pushNodes(); saveCache()
  if (!dbMode) return
  markDirty(id, ['category'], next)
  writeNodeCols(id, ['category'])   // diskret: skriv nu
}

export function deleteNode(id) {
  if (!nodes.has(id)) return
  clearNodeTimers(id)
  nodes.delete(id); dirty.delete(id)
  // självläk: ta bort trådar till/från noden lokalt (DB:n gör samma via FK cascade)
  ;[...edges.values()].forEach((e) => { if (e.from === id || e.to === id) edges.delete(e.id) })
  pushNodes(); pushEdges(); saveCache()
  if (dbMode) supabase.from('idea_nodes').delete().eq('id', id).then(({ error }) => { if (error) console.warn('node delete', error.message) })
}

// --------------------------------------------------------------------------- public API: edges
export function addEdge(from, to) {
  if (!canWrite()) return
  if (from === to) return
  // ingen dubblett (oavsett riktning)
  for (const e of edges.values()) {
    if ((e.from === from && e.to === to) || (e.from === to && e.to === from)) return
  }
  const id = 'e_' + rnd()
  edges.set(id, { id, from, to }); pushEdges(); saveCache()
  if (!dbMode) return
  const row = { id, board_id: BOARD_ID, from_id: from, to_id: to, created_by: identity.name || null }
  // FK: båda noderna måste finnas i DB:n. Vänta in ev. pågående skapande av endpoint-noderna.
  const gate = Promise.all([createPromises.get(from), createPromises.get(to)].filter(Boolean))
  gate.then(() => supabase.from('idea_edges').insert(row).then(({ error }) => { if (error) console.warn('edge insert', error.message) }))
}

export function deleteEdge(id) {
  if (!edges.has(id)) return
  edges.delete(id); pushEdges(); saveCache()
  if (dbMode) supabase.from('idea_edges').delete().eq('id', id).then(({ error }) => { if (error) console.warn('edge delete', error.message) })
}

// --------------------------------------------------------------------------- images (Storage)
// Validerar och laddar upp till bucketen idea-images; sätter den korta publika URL:en på noden.
// Returnerar { error } så UI:t kan visa ett meddelande.
export async function uploadNodeImage(id, file) {
  if (!canWrite()) return { error: 'Logga in för att ladda upp en bild.' }
  if (!file) return { error: null }
  if (!file.type?.startsWith('image/')) return { error: 'Only image files can be placed in a block' }
  if (file.size > IMG_MAX_BYTES) return { error: 'Image too large: keep it under 4 MB' }
  if (!dbMode) {
    // Lokalt läge (ingen DB/Storage): falla tillbaka till en dataURL så verktyget funkar ändå.
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => { applyImage(id, reader.result); resolve({ error: null }) }
      reader.onerror = () => resolve({ error: 'Could not read the image' })
      reader.readAsDataURL(file)
    })
  }
  try {
    const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `${BOARD_ID}/${id}-${Date.now()}-${rnd()}.${ext}`
    const up = await supabase.storage.from('idea-images').upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) return { error: up.error.message }
    const url = supabase.storage.from('idea-images').getPublicUrl(path).data.publicUrl
    applyImage(id, url)
    return { error: null }
  } catch (e) {
    return { error: e.message || 'Upload failed' }
  }
}
export function removeNodeImage(id) {
  applyImage(id, null)   // bara nolla kolumnen; ev. fil i Storage lämnas (samma som chat-images)
}
function applyImage(id, url) {
  const n = nodes.get(id); if (!n) return
  const next = { ...n, imageUrl: url }
  nodes.set(id, next); pushNodes(); saveCache()
  if (!dbMode) return
  markDirty(id, ['imageUrl'], next)
  writeNodeCols(id, ['imageUrl'])
}

// --------------------------------------------------------------------------- remote apply (merge)
function applyRemoteNode(r) {
  if (r.board_id && r.board_id !== BOARD_ID) return
  markSynced(r.id); sessionIds.add(r.id)
  const incoming = rowToNode(r)
  const d = dirty.get(r.id)
  if (d && d.size) {
    const local = nodes.get(r.id) || {}
    const now = Date.now()
    d.forEach((rec, field) => {
      if (now - rec.ts > DIRTY_TTL) { d.delete(field); return }          // gett upp -> ta emot fjärr
      if (incoming[field] === rec.val) { d.delete(field); return }        // bekräftat -> ta emot fjärr
      incoming[field] = (local[field] !== undefined ? local[field] : rec.val) // behåll osparad lokal ändring
    })
    if (d.size === 0) dirty.delete(r.id)
  }
  nodes.set(r.id, incoming); pushNodes(); saveCache()
}
function applyRemoteNodeDelete(id) {
  clearNodeTimers(id)
  realtimeDeleted.add(id)
  let changed = nodes.delete(id)
  dirty.delete(id)
  ;[...edges.values()].forEach((e) => { if (e.from === id || e.to === id) { edges.delete(e.id); changed = true } })
  if (changed) { pushNodes(); pushEdges(); saveCache() }
}
function applyRemoteEdge(r) {
  if (r.board_id && r.board_id !== BOARD_ID) return
  edges.set(r.id, { id: r.id, from: r.from_id, to: r.to_id }); pushEdges(); saveCache()
}
function applyRemoteEdgeDelete(id) {
  if (edges.delete(id)) { pushEdges(); saveCache() }
}

// --------------------------------------------------------------------------- presence + live cursors
let presenceChannel = null
const cursorMap = {}   // clientId -> { clientId, user, x, y }

function localUser() { return { id: identity.id, name: identity.name || 'Gäst', color: identity.color } }
const channelJoined = () => presenceChannel && presenceChannel.state === 'joined'
function trackPresence() { if (channelJoined()) presenceChannel.track({ user: localUser() }).catch(() => {}) }

let lastCursorTs = 0
export function setCursorWorld(x, y) {
  const now = perfNow()
  if (now - lastCursorTs < 45) return   // ~22 fps
  lastCursorTs = now
  if (!channelJoined()) return
  presenceChannel.send({ type: 'broadcast', event: 'cursor', payload: { clientId: identity.id, user: localUser(), x, y } })
}
export function clearCursor() {
  if (!channelJoined()) return
  presenceChannel.send({ type: 'broadcast', event: 'cursor', payload: { clientId: identity.id, user: localUser(), x: null, y: null } })
}
function ingestCursor(p) {
  if (!p || p.clientId === identity.id) return
  if (p.x == null || p.y == null) { delete cursorMap[p.clientId] }
  else cursorMap[p.clientId] = p
  cursorsStore.set(Object.values(cursorMap))
}
function recomputePeople() {
  if (!presenceChannel) return
  const state = presenceChannel.presenceState()
  const out = []
  Object.entries(state).forEach(([key, metas]) => {
    if (key === identity.id) return
    const m = (metas && metas[0]) || {}
    if (m.user) out.push({ clientId: key, user: m.user })
  })
  peopleStore.set(out)
  setConn({ peers: out.length, online: out.length > 0 })
}

// --------------------------------------------------------------------------- connection state
const connState = { peers: 0, online: false, synced: false, dbMode: false }
function setConn(patch) { Object.assign(connState, patch); connStore.set({ ...connState }) }

// --------------------------------------------------------------------------- realtime
function startData() {
  supabase.channel('idea-data:' + BOARD_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'idea_nodes' }, (payload) => {
      if (payload.eventType === 'DELETE') { const id = payload.old?.id; if (id) applyRemoteNodeDelete(id); return }
      if (payload.new) applyRemoteNode(payload.new)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'idea_edges' }, (payload) => {
      if (payload.eventType === 'DELETE') { const id = payload.old?.id; if (id) applyRemoteEdgeDelete(id); return }
      if (payload.new) applyRemoteEdge(payload.new)
    })
    .subscribe()
}
function startPresence() {
  presenceChannel = supabase.channel('idea-presence:' + BOARD_ID, {
    config: { presence: { key: identity.id }, broadcast: { self: false } },
  })
  presenceChannel.on('presence', { event: 'sync' }, recomputePeople)
  presenceChannel.on('presence', { event: 'join' }, recomputePeople)
  presenceChannel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    recomputePeople()
    ;(leftPresences || []).forEach((p) => { const k = p.user?.id; if (k) delete cursorMap[k] })
    cursorsStore.set(Object.values(cursorMap))
  })
  presenceChannel.on('broadcast', { event: 'cursor' }, ({ payload }) => ingestCursor(payload))
  presenceChannel.subscribe((status) => { if (status === 'SUBSCRIBED') trackPresence() })
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { try { presenceChannel && presenceChannel.untrack() } catch { /* ignore */ } })
}

// --------------------------------------------------------------------------- bootstrap
let readyResolve
const ready = new Promise((r) => { readyResolve = r })

async function init() {
  loadSynced(); loadCache(); pushNodes(); pushEdges()

  if (!supabaseEnabled) { setConn({ synced: false, dbMode: false }); readyResolve(); return }

  let probeErr = null
  try { const { error } = await supabase.from('idea_nodes').select('id').limit(1); probeErr = error } catch (e) { probeErr = e }
  dbMode = !probeErr
  setConn({ dbMode })

  startPresence()   // presence funkar även utan tabellerna

  if (!dbMode) { setConn({ synced: false }); readyResolve(); return }

  // DB-läge: prenumerera FÖRST (fånga ändringar under boot), ladda sen hela kartan.
  startData()
  try {
    const [{ data: nodeRows }, { data: edgeRows }] = await Promise.all([
      supabase.from('idea_nodes').select('*').eq('board_id', BOARD_ID),
      supabase.from('idea_edges').select('*').eq('board_id', BOARD_ID),
    ])
    const dbNodeIds = new Set((nodeRows || []).map((r) => r.id))
    ;(nodeRows || []).forEach((r) => { if (!realtimeDeleted.has(r.id)) applyRemoteNode(r) })
    ;(edgeRows || []).forEach((r) => applyRemoteEdge(r))
    // Reconcilea cachade noder som inte finns i DB:n.
    ;[...nodes.keys()].forEach((id) => {
      if (dbNodeIds.has(id)) return
      if (syncedIds.has(id) && !sessionIds.has(id)) { nodes.delete(id); syncedIds.delete(id) } // raderad på annan enhet
      else if (canWrite()) writeNodeFull(id)   // aldrig synkad -> synka upp (kräver login)
    })
    saveSynced(); pushNodes(); pushEdges(); saveCache()
  } catch (e) { console.warn('idea initial load', e.message) }

  setConn({ synced: true })
  readyResolve()
}
;(async () => { try { await init() } catch (e) { console.warn('idea init', e?.message); readyResolve() } })()

// --------------------------------------------------------------------------- seed (en gång)
/**
 * Seeda startväven en gång, utan att återuppliva raderade noder:
 *   - lokalt läge: seeda bara om cachen är tom.
 *   - DB-läge: kräver inloggning (skriv). Flagga i idea_meta finns -> gör inget; tom -> seeda
 *     (upsert på stabila id:n så två samtidiga seedare konvergerar); redan innehåll -> sätt flaggan.
 */
let pendingSeed = null
let seedDone = false
let seedInFlight = false
export function maybeSeed(seed) { pendingSeed = seed; ready.then(trySeed) }
if (supabaseEnabled) authStore.subscribe(() => { if (canWrite()) ready.then(trySeed) })

async function trySeed() {
  if (seedDone || seedInFlight || !pendingSeed) return
  seedInFlight = true
  try {
    if (!dbMode) {
      if (nodes.size === 0) {
        pendingSeed.nodes.forEach((n) => nodes.set(n.id, { ...n }))
        pendingSeed.edges.forEach((e) => edges.set(e.id, { ...e }))
        pushNodes(); pushEdges(); saveCache()
      }
      seedDone = true
      return
    }
    const { data: meta } = await supabase.from('idea_meta').select('value').eq('key', 'seeded').maybeSingle()
    if (meta && meta.value) { seedDone = true; return }
    const { count } = await supabase.from('idea_nodes').select('id', { count: 'exact', head: true })
    if ((count || 0) > 0) {
      if (canWrite()) await supabase.from('idea_meta').upsert({ key: 'seeded', value: true })
      seedDone = true
      return
    }
    if (!canWrite()) return   // tom + ej inloggad: vänta in login (authStore-subscribern kör om)
    const nodeRows = pendingSeed.nodes.map((n) => ({ ...nodeToRow(n), created_by: 'seed' }))
    await supabase.from('idea_nodes').upsert(nodeRows)
    const edgeRows = pendingSeed.edges.map((e) => ({ id: e.id, board_id: BOARD_ID, from_id: e.from, to_id: e.to, created_by: 'seed' }))
    await supabase.from('idea_edges').upsert(edgeRows)
    await supabase.from('idea_meta').upsert({ key: 'seeded', value: true })
    pendingSeed.nodes.forEach((n) => { nodes.set(n.id, { ...n }); markSynced(n.id) })
    pendingSeed.edges.forEach((e) => edges.set(e.id, { ...e }))
    pushNodes(); pushEdges(); saveCache()
    seedDone = true
  } catch (e) { console.warn('idea seed', e.message) } finally { seedInFlight = false }
}
