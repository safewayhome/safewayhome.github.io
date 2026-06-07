/**
 * Datalager + realtid för team-boarden: Supabase Postgres som SANNINGSKÄLLA.
 *
 *   board_tasks (Postgres)  ·  Supabase Realtime (postgres_changes + presence)  ·  localStorage-cache
 *
 * Skillnaden mot den gamla P2P-tavlan: en ändring skrivs DIREKT till databasen och syns för
 * alla, även om ingen annan är online just nu (FigJam/MS Whiteboard-modellen). Varje redigering
 * loggas dessutom som en rad i board_activity (historik per kort), och vem som skapade ett kort
 * sparas i created_by.
 *
 * Konfliktmodell (viktig): kolumn-scopade skrivningar + optimistisk per-fält-bekräftelse.
 *   - En ändring skriver BARA de kolumner som ändrades (.update), aldrig hela raden. Två personer
 *     som rör OLIKA fält på samma kort krockar därför aldrig.
 *   - Lokalt ändrade fält markeras "dirty". Ett inkommande realtime-eko mergas in fält för fält:
 *     fält vi har osparade lokala ändringar på behålls tills DB:n bekräftar samma värde (eller en
 *     TTL löper ut). Så en kollegas diskreta ändring (status/position) syns direkt även MEDAN man
 *     skriver i fritext, utan att vår text rycks bort eller deras ändring klottras över.
 *
 * Tre realtidsspår: 1) data (postgres_changes), 2) presence (online + vem redigerar), 3) cursors
 * (högfrekvent broadcast, lagras ej).
 *
 * Mjuk degradering: når vi inte Supabase (eller saknas tabellerna) faller allt tillbaka till ett
 * LOKALT läge (localStorage). Kort som skapas lokalt synkas UPP till DB:n så fort den svarar
 * (de raderas alltså inte). Därför kan sajten deployas innan schema.sql körts.
 *
 * Publika API:t (createTask/updateTask/.../stores/presence) är medvetet identiskt med den gamla
 * modulen så att vyerna (App/Whiteboard/TaskEditor) inte behövde skrivas om.
 */
import { supabase, supabaseEnabled } from './supabaseClient'
import { canWrite, authStore, currentUid } from './auth'
import { PRESENCE_COLORS, DEFAULT_DIFFICULTY, STATUS, DIFF, CAT } from './theme'

// --------------------------------------------------------------------------- config
const params = new URLSearchParams(location.search)
// Ett team = en board. ?board=... låter er köra en separat (privat) tavla; sparas lokalt.
const boardParam = params.get('board')
if (boardParam) { try { localStorage.setItem('lm.board', boardParam) } catch { /* ignore */ } }
export const BOARD_ID = boardParam || (() => { try { return localStorage.getItem('lm.board') } catch { return null } })() || 'ledmig-team-v1'
export const ROOM = BOARD_ID // bakåtkompatibelt namn (används som etikett i UI:t)

const CACHE_KEY = 'lm.board.cache.' + BOARD_ID    // speglar DB:n lokalt -> direkt paint + offline-tålighet
const ACT_KEY = 'lm.board.act.' + BOARD_ID        // historik-cache (lokalt läge + snabb omladdning)
const SYNC_KEY = 'lm.board.synced.' + BOARD_ID     // id:n som någon gång round-trippat genom DB:n
const ACT_CAP = 40                                // tak på cachade historikrader per kort
const DIRTY_TTL = 10000                           // ms innan vi ger upp att vänta på DB-bekräftelse på ett fält

const rnd = () => Math.random().toString(36).slice(2, 9)
const uuid = () => (globalThis.crypto?.randomUUID?.() || (rnd() + rnd() + Date.now().toString(36)))
const perfNow = () => (globalThis.performance?.now?.() ?? Date.now())
function eq(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i])
  return false
}

// --------------------------------------------------------------------------- minimal external store
// Liten store för useSyncExternalStore: ny snapshot-referens bara när vi faktiskt sätter värde
// (vi anropar set() enbart vid riktiga ändringar), annars samma referens => inga onödiga renders.
function createStore(initial) {
  let snap = initial
  const listeners = new Set()
  return {
    set(v) { snap = v; listeners.forEach((l) => l()) },
    get: () => snap,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb) },
  }
}

export const tasksStore = createStore([])
export const peopleStore = createStore([])
export const cursorsStore = createStore([])
export const connStore = createStore({ peers: 0, online: false, synced: false })
// Ångra-/gör-om-tillstånd för UI:t (knapparnas av/på + globalt läge + pågående global körning).
export const undoStore = createStore({ canUndo: false, canRedo: false, global: false, busy: false, opsAvailable: false })

// --------------------------------------------------------------------------- in-memory state
const tasks = new Map()        // id -> task (app-formad, camelCase)
let dbMode = false             // true = Supabase nås och tabellerna finns
const pushTasks = () => tasksStore.set([...tasks.values()])

// dirty: fält vi ändrat lokalt men ännu inte fått DB-bekräftelse på. id -> Map(field -> {val, ts}).
const dirty = new Map()
// id:n som round-trippat DB:n (persistent) resp. rörts denna session (in-memory). Skiljer
// "raderad på annan enhet medan jag var borta" från "skapad lokalt, aldrig synkad".
const syncedIds = new Set()
const sessionIds = new Set()
const realtimeDeleted = new Set() // id:n som raderats via realtime denna session (så initialladdningen inte återuppväcker dem)
const createPromises = new Map() // id -> promise: gate:ar board_activity-insert tills task-raden finns (FK)

const MAPPABLE = new Set(['title', 'description', 'approach', 'category', 'sub', 'status', 'difficulty', 'order', 'x', 'y', 'deps', 'createdBy'])

// --------------------------------------------------------------------------- identity
function loadIdentity() {
  let id = localStorage.getItem('lm.clientId')
  if (!id) { id = rnd(); localStorage.setItem('lm.clientId', id) }
  let colorIdx = parseInt(localStorage.getItem('lm.colorIdx') ?? '', 10)
  if (Number.isNaN(colorIdx)) {
    colorIdx = Math.floor(Math.random() * PRESENCE_COLORS.length)
    localStorage.setItem('lm.colorIdx', String(colorIdx))
  }
  return { id, name: localStorage.getItem('lm.name') || '', colorIdx, color: PRESENCE_COLORS[colorIdx % PRESENCE_COLORS.length] }
}
export let identity = loadIdentity()

export function setIdentity(patch) {
  identity = { ...identity, ...patch }
  if (patch.name !== undefined) localStorage.setItem('lm.name', patch.name)
  if (patch.colorIdx !== undefined) {
    localStorage.setItem('lm.colorIdx', String(patch.colorIdx))
    identity.color = PRESENCE_COLORS[patch.colorIdx % PRESENCE_COLORS.length]
  }
  trackPresence() // republicera namn/färg till de andra direkt
}

// --------------------------------------------------------------------------- row <-> task mapping
// DB:n är snake_case (sort_order/created_by/...), appen camelCase (order/createdBy/...).
const COL = { order: 'sort_order', createdBy: 'created_by' }
const col = (k) => COL[k] || k
function rowToTask(r) {
  return {
    id: r.id,
    title: r.title ?? '', description: r.description ?? '', approach: r.approach ?? '',
    category: r.category ?? 'dev', sub: r.sub ?? '',
    status: r.status ?? 'todo', difficulty: r.difficulty ?? DEFAULT_DIFFICULTY,
    order: r.sort_order ?? 0,
    x: r.x ?? null, y: r.y ?? null,
    deps: Array.isArray(r.deps) ? r.deps : (r.deps ?? []),
    createdBy: r.created_by ?? null, updatedBy: r.updated_by ?? null,
    createdAt: r.created_at ? Date.parse(r.created_at) : null,
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now(),
  }
}
function taskToRow(t) {
  const row = {
    id: t.id, title: t.title, description: t.description, approach: t.approach,
    category: t.category, sub: t.sub, status: t.status, difficulty: t.difficulty,
    sort_order: t.order ?? 0, x: t.x ?? null, y: t.y ?? null,
    deps: t.deps ?? [], created_by: t.createdBy ?? null,
    updated_by: t.updatedBy ?? (identity.name || 'någon'),
  }
  // Ta med tidsstämplarna NÄR de finns, så global ångra/gör om (upsert av before/after-blobben)
  // återställer ursprunglig skapad-/ändrad-tid i stället för now(). Utelämnas när de saknas
  // (t.ex. seed-rader) så att NOT NULL-defaulten now() gäller då i stället för en null-krock.
  if (t.createdAt) row.created_at = new Date(t.createdAt).toISOString()
  if (t.updatedAt) row.updated_at = new Date(t.updatedAt).toISOString()
  return row
}
// Plocka ut en delmängd kolumner ur en task för en kolumn-scopad .update().
function rowSubset(t, fields) {
  const out = {}
  fields.forEach((k) => { out[col(k)] = (k === 'deps' ? (t.deps ?? []) : t[k]) })
  return out
}

// --------------------------------------------------------------------------- caches
function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify([...tasks.values()])) } catch { /* ignore */ } }
function loadCache() {
  try {
    const arr = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
    if (Array.isArray(arr)) arr.forEach((t) => t && t.id && tasks.set(t.id, t))
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

function defaults() {
  return {
    title: 'Ny uppgift', description: '', approach: '', category: 'dev', sub: '',
    status: 'todo', difficulty: DEFAULT_DIFFICULTY, order: nextOrder(),
    x: null, y: null, deps: [], createdBy: null, updatedBy: identity.name || 'någon',
  }
}
function nextOrder() {
  let max = 0
  tasks.forEach((t) => { if ((t.order || 0) > max) max = t.order || 0 })
  return max + 1
}

// --------------------------------------------------------------------------- dirty tracking
function markDirty(id, fields, t) {
  let d = dirty.get(id)
  if (!d) { d = new Map(); dirty.set(id, d) }
  const now = Date.now()
  fields.forEach((f) => d.set(f, { val: f === 'deps' ? [...(t.deps || [])] : t[f], ts: now }))
}

// --------------------------------------------------------------------------- DB writes
// Kolumn-scopad skrivning: rör bara de fält som ändrats (krockar inte med andras fält).
function writeCols(id, fields) {
  if (!dbMode || !fields.length) return Promise.resolve()
  const t = tasks.get(id); if (!t) return Promise.resolve()
  const row = { ...rowSubset(t, fields), updated_by: identity.name || 'någon', updated_at: new Date().toISOString() }
  sessionIds.add(id)
  return supabase.from('board_tasks').update(row).eq('id', id)
    .then(({ error }) => { if (error) { console.warn('update', error.message); return false } markSynced(id); return true })
}
// Hela raden: bara vid skapande och vid "synka upp" av ett kort som DB:n inte känner till.
// Resolvar till true/false (lyckades raden faktiskt skrivas?) så att FK-beroende activity-insert
// kan vänta in att raden VERKLIGEN finns, inte bara att anropet återvänt.
function writeRowFull(id) {
  if (!dbMode) return Promise.resolve(false)
  const t = tasks.get(id); if (!t) return Promise.resolve(false)
  const row = { ...taskToRow(t), updated_by: identity.name || 'någon', updated_at: new Date().toISOString() }
  sessionIds.add(id)
  return supabase.from('board_tasks').upsert(row)
    .then(({ error }) => { if (error) { console.warn('upsert', error.message); return false } markSynced(id); return true })
}

const textWriteTimers = new Map() // id -> {timer, fields:Set} (debounce fritext-skrivning)
function scheduleTextWrite(id, fields) {
  let e = textWriteTimers.get(id)
  if (!e) { e = { fields: new Set(), timer: null }; textWriteTimers.set(id, e) }
  fields.forEach((f) => e.fields.add(f))
  clearTimeout(e.timer)
  e.timer = setTimeout(() => { const fs = [...e.fields]; textWriteTimers.delete(id); writeCols(id, fs) }, 500)
}

// --------------------------------------------------------------------------- task helpers (public API)
export function allTasks() { return [...tasks.values()] }

export function createTask(fields = {}, id = null) {
  if (!canWrite()) return null // redigering kräver inloggning (RLS skulle ändå neka); UI:t gate:ar också
  const tid = id || 't_' + rnd()
  const now = Date.now()
  const t = {
    ...defaults(), ...fields, id: tid,
    createdBy: { id: identity.id, name: identity.name || 'Gäst', color: identity.color },
    updatedBy: identity.name || 'någon', createdAt: now, updatedAt: now,
  }
  tasks.set(tid, t); pushTasks(); saveCache(); sessionIds.add(tid)
  if (dbMode) {
    const p = writeRowFull(tid)
    createPromises.set(tid, p)
    p.finally(() => createPromises.delete(tid))
  }
  logActivity(tid, 'created', 'skapade kortet') // insert gate:as internt tills task-raden finns (FK)
  // Ångra-historik: lokalt (delete inverterar) + global op-logg.
  recordOp('create', tid, null, taskToRow(t))
  pushUndo({ undo: [{ kind: 'delete', id: tid }], redo: [{ kind: 'recreate', snapshot: { ...t } }], at: Date.now() })
  return tid
}

export function updateTask(id, patch) {
  if (!canWrite()) return // ej inloggad: gör inget (annars optimistisk ändring som RLS sen nekar -> divergens)
  const cur = tasks.get(id)
  if (!cur) return
  const next = { ...cur, ...patch, updatedAt: Date.now(), updatedBy: identity.name || 'någon' }
  tasks.set(id, next); pushTasks(); saveCache()

  // Ångra-historik: spela bara in fält som FAKTISKT ändrade värde (inga no-op-steg). Görs före
  // ev. lokalt-läge-utgång så ångra funkar även utan DB. Enstaka textfält slås ihop till ett pass.
  const changedKeys = Object.keys(patch).filter((k) => !eq(cur[k], next[k]))
  if (changedKeys.length && !applyingHistory) {
    const beforeC = {}, afterC = {}
    changedKeys.forEach((k) => { beforeC[k] = cur[k]; afterC[k] = next[k] })
    const single = changedKeys.length === 1 ? changedKeys[0] : null
    pushUndo({
      undo: [{ kind: 'update', id, patch: beforeC }],
      redo: [{ kind: 'update', id, patch: afterC }],
      at: Date.now(),
      _coalesceKey: (single && (single in TEXT_FIELDS)) ? `${id}:${single}` : null,
    })
  }

  // historik: diskreta ändringar loggas direkt, fritext debouncas (annars en rad per tangenttryck)
  const discrete = describeDiscrete(patch)
  if (discrete.length) logActivity(id, 'update', cap(discrete.join(', ')))
  const textActKeys = Object.keys(patch).filter((k) => k in TEXT_FIELDS)
  if (textActKeys.length) scheduleTextActivity(id, textActKeys)

  if (!dbMode) return
  // Global op-logg: buffra ändrade, mappbara fält (before/after) -> en op-rad per skrivpass.
  const changedM = changedKeys.filter((k) => MAPPABLE.has(k))
  if (changedM.length) {
    const bef = {}, aft = {}
    changedM.forEach((k) => { bef[k] = cur[k]; aft[k] = next[k] })
    recordOpUpdate(id, bef, aft)
  }
  // Markera ändrade fält dirty direkt (skyddar mot att ett eko backar dem), skriv sen. Vi använder
  // changedM (fält som FAKTISKT ändrade värde): no-op-anrop ska varken bli dirty eller en DB-skrivning.
  const changed = changedM
  if (!changed.length) return
  markDirty(id, changed, next)
  const textChanged = changed.filter((k) => k in TEXT_FIELDS)
  const otherChanged = changed.filter((k) => !(k in TEXT_FIELDS))
  if (otherChanged.length) writeCols(id, otherChanged)     // diskret/positionsändring: skriv nu
  if (textChanged.length) scheduleTextWrite(id, textChanged) // fritext: debounce
}

export function deleteTask(id) {
  if (!canWrite()) return // ej inloggad: radering kräver login
  const existing = tasks.get(id)
  if (!existing) return
  const snap = { ...existing }            // fullständig kopia för lokal ångra (återskapa exakt)
  const beforeRow = taskToRow(existing)   // rad-form för global op-logg
  clearTaskTimers(id)
  const dependents = []                   // { id, oldDeps }: korten som pekar på det raderade
  tasks.forEach((t) => {
    const deps = t.deps || []
    if (deps.includes(id)) { dependents.push({ id: t.id, oldDeps: [...deps] }); t.deps = deps.filter((d) => d !== id) }
  })
  tasks.delete(id); dirty.delete(id); pushTasks(); saveCache()
  if (dbMode) {
    supabase.from('board_tasks').delete().eq('id', id).then(({ error }) => { if (error) console.warn('delete', error.message) })
    // markera deps dirty på beroende-korten så ett stalet eko inte tillfälligt ritar tillbaka den döda pilen
    dependents.forEach((d) => { markDirty(d.id, ['deps'], tasks.get(d.id)); writeCols(d.id, ['deps']) })
    recordOp('delete', id, beforeRow, null)
  }
  // Ångra-historik (lokalt): återskapa kortet OCH återställ beroende-kortens gamla pilar.
  if (!applyingHistory) {
    const undoOps = [{ kind: 'recreate', snapshot: snap }]
    dependents.forEach((d) => undoOps.push({ kind: 'update', id: d.id, patch: { deps: d.oldDeps } }))
    pushUndo({ undo: undoOps, redo: [{ kind: 'delete', id }], at: Date.now() })
  }
  // board_activity för kortet städas bort via ON DELETE CASCADE i DB:n.
}

function clearTaskTimers(id) {
  const w = textWriteTimers.get(id); if (w) { clearTimeout(w.timer); textWriteTimers.delete(id) }
  const a = textActTimers.get(id); if (a) { clearTimeout(a.timer); textActTimers.delete(id) }
}

// --------------------------------------------------------------------------- ångra / gör om (undo/redo)
/**
 * Två lager ångra:
 *   1) LOKALT (per användare, ingen extra tabell): varje egen handling (skapa/redigera/radera kort,
 *      ändra beroenden) lagras som ett par {undo, redo} av operationsbeskrivningar i en stack. Ctrl/Cmd+Z
 *      backar din senaste handling, Ctrl/Cmd+Shift+Z gör om. Snabba textändringar slås ihop (coalesce)
 *      så ett "skrivpass" blir ETT ångra-steg, inte ett per tangenttryck.
 *   2) GLOBALT (togglas i UI:t): backar i stället teamets senaste DB-ändring (board_ops-loggen), flera
 *      steg bakåt. Eftersom board_tasks är delad syns ångringen direkt hos ALLA via Realtime.
 *
 * applyingHistory: sant medan vi applicerar en invers lokalt -> spela inte in en ny lokal post (men
 * skrivningen blir ändå en genuin ändring i den globala loggen). applyingGlobal: sant medan vi skriver
 * en global ångring rakt mot board_tasks -> spela INTE in en ny board_ops-rad (annars oändlig loop).
 */
const UNDO_CAP = 80
const COALESCE_MS = 700
const undoStack = []   // { undo:[op], redo:[op], at, _coalesceKey? }
const redoStack = []
let applyingHistory = false
let applyingGlobal = false
let opsAvailable = false   // sätts true om board_ops-tabellen finns (annars: bara lokal ångra)

const GLOBAL_UNDO_KEY = 'lm.undo.global.' + BOARD_ID
let globalUndoMode = (() => { try { return localStorage.getItem(GLOBAL_UNDO_KEY) === '1' } catch { return false } })()
export const isGlobalUndo = () => globalUndoMode
export function setGlobalUndo(on) {
  globalUndoMode = !!on
  try { localStorage.setItem(GLOBAL_UNDO_KEY, on ? '1' : '0') } catch { /* ignore */ }
  refreshUndoStore()
}
refreshUndoStore() // spegla persisterat globalt läge direkt vid laddning (opsAvailable sätts av probeOps)

function refreshUndoStore() {
  const cur = undoStore.get()
  undoStore.set({
    // Globalt läge: knapparna är på så länge tabellen finns (vi vet inte synkront hur många op:ar
    // som återstår -> tomt fall hanteras tyst i globalUndo/globalRedo). Lokalt: spegla stackarna.
    canUndo: globalUndoMode ? opsAvailable : undoStack.length > 0,
    canRedo: globalUndoMode ? opsAvailable : redoStack.length > 0,
    global: globalUndoMode, busy: cur.busy || false, opsAvailable,
  })
}
function setBusy(b) { undoStore.set({ ...undoStore.get(), busy: b }) }

// Spela in en lokal ångra-post (med coalescing av textpass på samma kort/fält).
function pushUndo(entry) {
  if (applyingHistory) return
  const last = undoStack[undoStack.length - 1]
  if (last && entry._coalesceKey && last._coalesceKey === entry._coalesceKey && (entry.at - last.at) < COALESCE_MS) {
    last.redo = entry.redo            // behåll äldsta "före", ta nyaste "efter"
    last.at = entry.at
  } else {
    undoStack.push(entry)
    if (undoStack.length > UNDO_CAP) undoStack.shift()
  }
  redoStack.length = 0               // en ny handling nollställer gör-om
  refreshUndoStore()
}

// Applicera en lista operationsbeskrivningar utan att spela in nya lokala poster.
function applyOps(ops) {
  applyingHistory = true
  try {
    ops.forEach((op) => {
      if (op.kind === 'update') updateTask(op.id, op.patch)
      else if (op.kind === 'delete') deleteTask(op.id)
      else if (op.kind === 'recreate') restoreTask(op.snapshot)
    })
  } finally { applyingHistory = false }
}

// Återställ ett raderat kort (lokal ångra av en delete): sätt tillbaka raden + logga + global op.
function restoreTask(snap) {
  if (!canWrite() || !snap || !snap.id) return
  const t = { ...snap, updatedAt: Date.now(), updatedBy: identity.name || 'någon' }
  tasks.set(t.id, t); pushTasks(); saveCache(); sessionIds.add(t.id)
  if (dbMode) {
    const p = writeRowFull(t.id)
    createPromises.set(t.id, p); p.finally(() => createPromises.delete(t.id))
    recordOp('create', t.id, null, taskToRow(t))
  }
  logActivity(t.id, 'created', 'återställde kortet')
}

export function undo() {
  if (globalUndoMode) return globalUndo()
  if (!canWrite()) return { error: 'Logga in för att ångra.' }
  const entry = undoStack.pop()
  if (!entry) return { error: 'Inget mer att ångra.' }
  applyOps(entry.undo)
  redoStack.push(entry); refreshUndoStore()
  return { error: null }
}
export function redo() {
  if (globalUndoMode) return globalRedo()
  if (!canWrite()) return { error: 'Logga in för att göra om.' }
  const entry = redoStack.pop()
  if (!entry) return { error: 'Inget att göra om.' }
  applyOps(entry.redo)
  undoStack.push(entry); refreshUndoStore()
  return { error: null }
}

// --------------------------------------------------------------------------- global op-logg (board_ops)
const opBuffer = new Map() // id -> { before, after, timer }: slår ihop ett skrivpass till EN op-rad
function recordOp(kind, taskId, before, after) {
  if (!dbMode || applyingGlobal) return
  insertOp({ op_kind: kind, task_id: taskId, before: before ?? null, after: after ?? null })
}
// Update-op:ar buffras + debounce:as (precis som DB-skrivningen) så att text inte blir en op per tecken.
function recordOpUpdate(id, before, after) {
  if (!dbMode || applyingGlobal) return
  let e = opBuffer.get(id)
  if (!e) { e = { before: {}, after: {}, timer: null }; opBuffer.set(id, e) }
  Object.keys(before).forEach((k) => { if (!(k in e.before)) e.before[k] = before[k] }) // behåll äldsta "före"
  Object.assign(e.after, after)
  clearTimeout(e.timer)
  e.timer = setTimeout(() => { opBuffer.delete(id); flushOpUpdate(id, e.before, e.after) }, 700)
}
function flushOpUpdate(id, before, after) {
  const beforeRow = {}, afterRow = {}
  Object.keys(after).forEach((k) => {
    if (!MAPPABLE.has(k)) return
    beforeRow[col(k)] = (k === 'deps' ? (before[k] ?? []) : (before[k] ?? null))
    afterRow[col(k)] = (k === 'deps' ? (after[k] ?? []) : (after[k] ?? null))
  })
  if (!Object.keys(afterRow).length) return
  insertOp({ op_kind: 'update', task_id: id, before: beforeRow, after: afterRow })
}
function insertOp(p) {
  if (!dbMode || applyingGlobal) return
  const row = {
    board_id: BOARD_ID, op_kind: p.op_kind, task_id: p.task_id,
    before: p.before ?? null, after: p.after ?? null,
    // actor_id binds raden till den inloggade (auth.uid()) -> RLS hindrar spoofing (OWASP A01).
    // actor_name är bara en denormaliserad visningsetikett (samma mönster som trådarnas created_by_name).
    actor_id: currentUid(), actor_name: identity.name || 'någon',
  }
  supabase.from('board_ops').insert(row).then(({ error }) => {
    if (error) { opsAvailable = false; refreshUndoStore() } // tabell saknas -> global ångra ej tillgänglig
  })
}

// Skriv en invers (global ångra) rakt mot board_tasks. applyingGlobal hindrar att detta blir en ny op.
async function invertOp(op) {
  applyingGlobal = true
  try {
    if (op.op_kind === 'create') await supabase.from('board_tasks').delete().eq('id', op.task_id)
    else if (op.op_kind === 'delete') { if (op.before) await supabase.from('board_tasks').upsert(op.before) }
    else if (op.op_kind === 'update') { if (op.before) await supabase.from('board_tasks').update(op.before).eq('id', op.task_id) }
  } finally { applyingGlobal = false }
}
async function applyOpForward(op) {
  applyingGlobal = true
  try {
    if (op.op_kind === 'create') { if (op.after) await supabase.from('board_tasks').upsert(op.after) }
    else if (op.op_kind === 'delete') await supabase.from('board_tasks').delete().eq('id', op.task_id)
    else if (op.op_kind === 'update') { if (op.after) await supabase.from('board_tasks').update(op.after).eq('id', op.task_id) }
  } finally { applyingGlobal = false }
}

export async function globalUndo() {
  if (!dbMode || !opsAvailable) return { error: 'Global ångra kräver att migrationen (board_ext_schema.sql) körts.' }
  if (!canWrite()) return { error: 'Logga in för att ångra.' }
  setBusy(true)
  try {
    const { data, error } = await supabase.from('board_ops')
      .select('*').eq('board_id', BOARD_ID).eq('undone', false)
      .order('seq', { ascending: false }).limit(1)
    if (error) return { error: error.message }
    const op = data && data[0]
    if (!op) return { error: 'Inget mer att ångra globalt.' }
    await invertOp(op)
    await supabase.from('board_ops').update({ undone: true, undone_at: new Date().toISOString(), undone_by: identity.name || 'någon' }).eq('id', op.id)
    return { error: null }
  } catch (e) { return { error: e.message } } finally { setBusy(false) }
}
export async function globalRedo() {
  if (!dbMode || !opsAvailable) return { error: 'Global gör-om kräver att migrationen (board_ext_schema.sql) körts.' }
  if (!canWrite()) return { error: 'Logga in för att göra om.' }
  setBusy(true)
  try {
    // Gör om den senast ångrade (lägsta seq bland undone=true): backar undo i omvänd ordning.
    const { data, error } = await supabase.from('board_ops')
      .select('*').eq('board_id', BOARD_ID).eq('undone', true)
      .order('seq', { ascending: true }).limit(1)
    if (error) return { error: error.message }
    const op = data && data[0]
    if (!op) return { error: 'Inget att göra om globalt.' }
    await applyOpForward(op)
    await supabase.from('board_ops').update({ undone: false, undone_at: null, undone_by: null }).eq('id', op.id)
    return { error: null }
  } catch (e) { return { error: e.message } } finally { setBusy(false) }
}

// Probe: finns board_ops-tabellen? Avgör om global ångra är tillgänglig (annars degraderar UI:t).
async function probeOps() {
  if (!dbMode) return
  try { const { error } = await supabase.from('board_ops').select('id').limit(1); opsAvailable = !error }
  catch { opsAvailable = false }
  refreshUndoStore()
}

// --------------------------------------------------------------------------- remote apply (merge)
function applyRemoteRow(r) {
  markSynced(r.id)
  sessionIds.add(r.id) // sett via realtime denna session -> reconcile får aldrig reapa det (boot-fönster-insert)
  const incoming = rowToTask(r)
  const d = dirty.get(r.id)
  if (d && d.size) {
    const local = tasks.get(r.id) || {}
    const now = Date.now()
    d.forEach((rec, field) => {
      if (now - rec.ts > DIRTY_TTL) { d.delete(field); return }      // gett upp att vänta -> ta emot fjärr
      if (eq(incoming[field], rec.val)) { d.delete(field); return }  // bekräftat (== vårt) -> ta emot fjärr
      incoming[field] = (local[field] !== undefined ? local[field] : rec.val) // behåll vår osparade ändring
    })
    if (d.size === 0) dirty.delete(r.id)
  }
  tasks.set(r.id, incoming); pushTasks(); saveCache()
}
function applyRemoteDelete(id) {
  clearTaskTimers(id)
  realtimeDeleted.add(id) // så initialladdningens select inte återuppväcker ett kort som just raderats
  let changed = tasks.delete(id)
  dirty.delete(id)
  // självläk: ta bort det döda id:t ur alla kvarvarande beroenden (annars dinglande pilar)
  tasks.forEach((t) => { if ((t.deps || []).includes(id)) { t.deps = t.deps.filter((x) => x !== id); changed = true } })
  if (changed) { pushTasks(); saveCache() }
}

// --------------------------------------------------------------------------- activity (edit history)
const actByTask = new Map() // taskId -> rader, nyast först
const actSeen = new Set()   // cid:n vi redan har (dedup mellan optimistisk lokal rad och DB-eko)
const actListeners = new Map() // taskId -> Set(cb)

export function getActivity(taskId) { return actByTask.get(taskId) || [] }
export function onActivity(taskId, cb) {
  let s = actListeners.get(taskId)
  if (!s) { s = new Set(); actListeners.set(taskId, s) }
  s.add(cb)
  return () => { s.delete(cb); if (s.size === 0) actListeners.delete(taskId) }
}
function emitActivity(taskId) { const s = actListeners.get(taskId); if (s) s.forEach((cb) => cb(getActivity(taskId))) }

function pushActivityLocal(row) {
  if (row.cid && actSeen.has(row.cid)) return // redan sedd (vårt eget eko)
  if (row.cid) actSeen.add(row.cid)
  const arr = actByTask.get(row.task_id) || []
  arr.push(row)
  arr.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) // nyast först (parsad tid: 'Z' och '+00:00' likvärdiga)
  if (arr.length > ACT_CAP) arr.length = ACT_CAP
  actByTask.set(row.task_id, arr)
  saveActivityCache()
  emitActivity(row.task_id)
}
function saveActivityCache() {
  try {
    const flat = []
    actByTask.forEach((arr) => arr.forEach((r) => flat.push(r)))
    localStorage.setItem(ACT_KEY, JSON.stringify(flat.slice(0, 600)))
  } catch { /* ignore */ }
}
function loadActivityCache() {
  try {
    const flat = JSON.parse(localStorage.getItem(ACT_KEY) || '[]')
    if (Array.isArray(flat)) flat.forEach((r) => r && r.task_id && pushActivityLocal(r))
  } catch { /* ignore */ }
}

function logActivity(taskId, kind, summary) {
  const row = {
    cid: uuid(), task_id: taskId, at: new Date().toISOString(),
    actor_id: identity.id, actor_name: identity.name || 'någon', actor_color: identity.color,
    kind, summary,
  }
  pushActivityLocal(row) // optimistiskt: syns direkt i öppen editor
  if (!dbMode) return
  const insert = () => supabase.from('board_activity').insert(row).then(({ error }) => { if (error) console.warn('activity', error.message) })
  const gate = createPromises.get(taskId) // vänta in att task-raden VERKLIGEN skrevs (gate resolvar till ok)
  if (gate) gate.then((ok) => { if (ok !== false) insert() }); else insert() // misslyckad create -> hoppa över (annars FK-krock)
}

/** Hämta historik för ett kort från DB:n (merge in i lokala cachen, dedupas på cid). */
export async function fetchActivity(taskId) {
  if (dbMode) {
    const { data, error } = await supabase.from('board_activity')
      .select('cid,task_id,at,actor_id,actor_name,actor_color,kind,summary')
      .eq('task_id', taskId).order('at', { ascending: false }).limit(ACT_CAP)
    if (!error && data) data.forEach((r) => pushActivityLocal(r))
  }
  return getActivity(taskId)
}

// Människoläsbara historik-sammanfattningar (svenska, inget AI-tankestreck som separator).
const TEXT_FIELDS = { title: 'titeln', description: 'beskrivningen', approach: 'lösningsidén' }
function describeDiscrete(patch) {
  const parts = []
  if ('status' in patch) parts.push(`flyttade till "${(STATUS[patch.status] || {}).label || patch.status}"`)
  if ('difficulty' in patch) parts.push(`satte svårighet "${(DIFF[patch.difficulty] || {}).short || patch.difficulty}"`)
  if ('category' in patch) parts.push(`bytte kategori till "${(CAT[patch.category] || {}).label || patch.category}"`)
  if ('sub' in patch && !('category' in patch) && patch.sub) parts.push(`satte underkategori "${patch.sub}"`)
  if ('deps' in patch) parts.push('ändrade beroenden')
  return parts
}
const textActTimers = new Map() // taskId -> {timer, fields:Set} (debounce fritext-historik)
function scheduleTextActivity(id, fields) {
  let e = textActTimers.get(id)
  if (!e) { e = { fields: new Set(), timer: null }; textActTimers.set(id, e) }
  fields.forEach((f) => e.fields.add(f))
  clearTimeout(e.timer)
  e.timer = setTimeout(() => {
    const names = [...e.fields].map((f) => TEXT_FIELDS[f])
    textActTimers.delete(id)
    logActivity(id, 'edit', cap('redigerade ' + humanList(names)))
  }, 3500)
}
function humanList(xs) {
  if (xs.length <= 1) return xs[0] || ''
  return xs.slice(0, -1).join(', ') + ' och ' + xs[xs.length - 1]
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

// --------------------------------------------------------------------------- presence (online / editing / typing)
let presenceChannel = null
let myEditing = null
let myTyping = false
let typingTimer = null
const cursorMap = {} // clientId -> {clientId, user, cursor, typing}

function localPresence() {
  return { user: { id: identity.id, name: identity.name || 'Gäst', color: identity.color }, editing: myEditing, typing: myTyping }
}
const channelJoined = () => presenceChannel && presenceChannel.state === 'joined'
function trackPresence() { if (channelJoined()) presenceChannel.track(localPresence()).catch(() => {}) }

export function setEditing(taskId) { myEditing = taskId || null; trackPresence() }
export function pingTyping() {
  myTyping = true; trackPresence()
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => { myTyping = false; trackPresence() }, 1500)
}

let lastCursorTs = 0
export function setCursor(view, x, y) {
  const now = perfNow()
  if (now - lastCursorTs < 40) return // strypning ~25 fps
  lastCursorTs = now
  if (!channelJoined()) return // skicka inte innan kanalen är ansluten (undviker REST-fallback)
  presenceChannel.send({
    type: 'broadcast', event: 'cursor',
    payload: { clientId: identity.id, user: localPresence().user, cursor: { view, x, y, t: Date.now() }, typing: myTyping },
  })
}
export function clearCursor() {
  if (!channelJoined()) return
  presenceChannel.send({ type: 'broadcast', event: 'cursor', payload: { clientId: identity.id, user: localPresence().user, cursor: null } })
}

function recomputePeople() {
  if (!presenceChannel) return
  const state = presenceChannel.presenceState()
  const out = []
  Object.entries(state).forEach(([key, metas]) => {
    if (key === identity.id) return
    const m = (metas && metas[0]) || {}
    if (m.user) out.push({ clientId: key, user: m.user, editing: m.editing || null, typing: !!m.typing })
  })
  peopleStore.set(out)
  setConn({ peers: out.length, online: out.length > 0 })
}
function ingestCursor(p) {
  if (!p || p.clientId === identity.id) return
  cursorMap[p.clientId] = p
  cursorsStore.set(Object.values(cursorMap))
}

// --------------------------------------------------------------------------- connection state
const connState = { peers: 0, online: false, synced: false }
function setConn(patch) { Object.assign(connState, patch); connStore.set({ ...connState }) }

// --------------------------------------------------------------------------- realtime subscriptions
function startData() {
  supabase.channel('board-data:' + BOARD_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_tasks' }, (payload) => {
      if (payload.eventType === 'DELETE') { const id = payload.old?.id; if (id) applyRemoteDelete(id); return }
      if (payload.new) applyRemoteRow(payload.new) // mergas fält för fält mot ev. lokala dirty-fält
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_activity' }, (payload) => {
      if (payload.new) pushActivityLocal(payload.new)
    })
    .subscribe()
}
function startPresence() {
  presenceChannel = supabase.channel('board-presence:' + BOARD_ID, {
    config: { presence: { key: identity.id }, broadcast: { self: false } },
  })
  presenceChannel.on('presence', { event: 'sync' }, recomputePeople)
  presenceChannel.on('presence', { event: 'join' }, recomputePeople)
  presenceChannel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    recomputePeople();
    (leftPresences || []).forEach((p) => { const k = p.user?.id; if (k) delete cursorMap[k] })
    cursorsStore.set(Object.values(cursorMap))
  })
  presenceChannel.on('broadcast', { event: 'cursor' }, ({ payload }) => ingestCursor(payload))
  presenceChannel.subscribe((status) => { if (status === 'SUBSCRIBED') trackPresence() })
}

// släpp presence rent när fliken stängs
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { try { presenceChannel && presenceChannel.untrack() } catch { /* ignore */ } })
}

// --------------------------------------------------------------------------- bootstrap
let readyResolve
const ready = new Promise((r) => { readyResolve = r })

async function init() {
  // 1) Måla direkt från lokal cache (känns snabbt, funkar offline).
  loadSynced(); loadCache(); loadActivityCache(); pushTasks()

  // 2) Ingen Supabase konfigurerad -> rent lokalt läge.
  if (!supabaseEnabled) { setConn({ synced: false }); readyResolve(); return }

  // 3) Finns tabellerna? En billig probe avgör DB-läge vs lokalt läge.
  let probeErr = null
  try { const { error } = await supabase.from('board_tasks').select('id').limit(1); probeErr = error } catch (e) { probeErr = e }
  dbMode = !probeErr

  // Presence funkar via realtime-kanaler även om tabellerna saknas -> starta alltid.
  startPresence()

  if (!dbMode) { setConn({ synced: false }); readyResolve(); return }

  // 4) DB-läge: prenumerera FÖRST (så inserts under boot fångas), ladda sen hela tavlan.
  startData()
  try {
    const { data } = await supabase.from('board_tasks').select('*')
    const dbIds = new Set((data || []).map((r) => r.id))
    // hoppa över rader som redan raderats via realtime under boot (annars återuppväcker snapshoten dem)
    ;(data || []).forEach((r) => { if (!realtimeDeleted.has(r.id)) applyRemoteRow(r) })
    // Reconcilea cachade kort som INTE finns i DB:n:
    ;[...tasks.keys()].forEach((id) => {
      if (dbIds.has(id)) return
      if (syncedIds.has(id) && !sessionIds.has(id)) {
        // tidigare synkat men borta nu = raderat på annan enhet medan vi var borta -> ta bort
        tasks.delete(id); syncedIds.delete(id)
      } else {
        // aldrig synkat (skapat i lokalt läge / under boot) -> synka UPP, radera inte
        writeRowFull(id)
      }
    })
    saveSynced(); pushTasks(); saveCache()
  } catch (e) { console.warn('initial load', e.message) }

  setConn({ synced: true })
  probeOps() // avgör om global ångra (board_ops) är tillgänglig
  readyResolve()
}
;(async () => { try { await init() } catch (e) { console.warn('board init', e?.message); readyResolve() } })()

// --------------------------------------------------------------------------- safe first-run seeding
/**
 * Seeda startinnehållet en gång, utan att återuppliva raderade kort:
 *   - lokalt läge: seeda bara om cachen är tom.
 *   - DB-läge: kräver inloggning (skriv = authenticated). DB-flaggan "seeded" finns -> gör inget;
 *     tom tabell -> seeda (upsert på stabila id:n, så två samtidiga seedare konvergerar); redan
 *     innehåll -> sätt bara flaggan. Är ingen inloggad än väntar vi: trySeed körs om vid login.
 */
let pendingSeed = null
let seedDone = false
let seedInFlight = false
export function maybeSeed(seedTasks) { pendingSeed = seedTasks; ready.then(trySeed) }
// Försök igen när någon loggar in (då först får vi skriva till DB:n).
if (supabaseEnabled) authStore.subscribe(() => { if (canWrite()) ready.then(trySeed) })

async function trySeed() {
  if (seedDone || seedInFlight || !pendingSeed) return
  seedInFlight = true
  try {
    if (!dbMode) {
      if (tasks.size === 0) {
        pendingSeed.forEach((t, i) => {
          const now = Date.now()
          tasks.set(t.id, { ...defaults(), order: i + 1, ...t, id: t.id, createdBy: null, createdAt: now, updatedAt: now })
        })
        pushTasks(); saveCache()
      }
      seedDone = true
      return
    }

    const { data: meta } = await supabase.from('board_meta').select('value').eq('key', 'seeded').maybeSingle()
    if (meta && meta.value) { seedDone = true; return }
    const { count } = await supabase.from('board_tasks').select('id', { count: 'exact', head: true })
    if ((count || 0) > 0) { // redan innehåll: sätt bara flaggan (kräver login) och sluta
      if (canWrite()) await supabase.from('board_meta').upsert({ key: 'seeded', value: true })
      seedDone = true
      return
    }

    // Tom tabell: själva seedningen är en skrivning -> kräver inloggning. Vänta annars in login.
    if (!canWrite()) return
    const rows = pendingSeed.map((t, i) => taskToRow({ ...defaults(), order: i + 1, ...t, id: t.id, createdBy: null }))
    await supabase.from('board_tasks').upsert(rows)
    await supabase.from('board_meta').upsert({ key: 'seeded', value: true })
    rows.forEach((r) => { tasks.set(r.id, rowToTask(r)); markSynced(r.id) })
    pushTasks(); saveCache()
    seedDone = true
  } catch (e) { console.warn('seed', e.message) } finally { seedInFlight = false }
}
