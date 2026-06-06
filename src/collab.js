/**
 * Realtime backbone — serverless, no backend, no accounts.
 *
 *   Yjs (CRDT)  ·  Trystero over Nostr relays (peer-to-peer WebRTC)  ·  y-indexeddb (offline)
 *
 * Trystero brokers the WebRTC handshake over public Nostr relays (redundant + maintained — the
 * old y-webrtc public signaling servers are dead), then the actual task data + awareness flow
 * directly peer-to-peer and are encrypted with the room password. Edits merge conflict-free
 * (CRDT), and each client keeps a local copy in IndexedDB so the board works offline and reloads.
 *
 * Room / password / relays are overridable so a team can run privately:
 *   ?room=...   ?pass=...   ?relays=wss://a,wss://b   (also persisted in localStorage)
 */
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { joinRoom } from 'trystero/nostr'
import {
  Awareness, encodeAwarenessUpdate, applyAwarenessUpdate,
} from 'y-protocols/awareness'
import { PRESENCE_COLORS, DEFAULT_DIFFICULTY } from './theme'

// --------------------------------------------------------------------------- config
const params = new URLSearchParams(location.search)
// Persist invite-link overrides so they actually "stick" across reloads — otherwise an
// invited teammate would silently drop back to the default room on the next refresh.
;['room', 'pass', 'relays'].forEach((k) => {
  const v = params.get(k)
  if (v != null && v !== '') { try { localStorage.setItem('lm.' + k, v) } catch { /* ignore */ } }
})
const cfg = (key, fallback) =>
  params.get(key) || localStorage.getItem('lm.' + key) || fallback

// Security model: this is a *shared secret / hard-to-guess room*, not per-user auth. The
// room+password ship in the public bundle, so treat the board as internal-but-not-confidential.
// For a private room, share an invite link with a custom ?room=&pass= (persisted above).
export const ROOM = cfg('room', 'ledmig-team-v1')
export const ROOM_PASSWORD = cfg('pass', 'getsafehome-2026') // E2E-encrypts the P2P payload
const APP_ID = 'ledmig-team-board' // namespaces the app across all teammates

// Verified-reachable public Nostr relays (used only for signaling; data stays P2P).
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
  'wss://nostr-pub.wellorder.net',
]
const relaysRaw = cfg('relays', '')
export const RELAYS = (relaysRaw ? relaysRaw.split(',') : DEFAULT_RELAYS)
  .map((s) => s.trim())
  .filter((s) => /^wss:\/\//i.test(s))
if (RELAYS.length === 0) RELAYS.push(...DEFAULT_RELAYS)

// --------------------------------------------------------------------------- document + transport
export const ydoc = new Y.Doc()
export const yTasks = ydoc.getMap('tasks') // id -> Y.Map(fields)
export const yMeta = ydoc.getMap('meta')
export const awareness = new Awareness(ydoc)

export const persistence = new IndexeddbPersistence('lm-team-board::' + ROOM, ydoc)

const room = joinRoom(
  { appId: APP_ID, password: ROOM_PASSWORD, relayConfig: { urls: RELAYS, redundancy: Math.min(5, RELAYS.length) } },
  ROOM,
)

const docAction = room.makeAction('ydoc')
const awrAction = room.makeAction('awr')

const toU8 = (d) =>
  d instanceof Uint8Array ? d
    : d instanceof ArrayBuffer ? new Uint8Array(d)
      : new Uint8Array(d.buffer, d.byteOffset, d.byteLength)

// outgoing/incoming Yjs document updates
ydoc.on('update', (update, origin) => {
  if (origin === 'remote') return // don't echo updates we just applied from a peer
  docAction.send(update).catch(() => {})
})
docAction.onMessage = (data) => Y.applyUpdate(ydoc, toU8(data), 'remote')

// outgoing/incoming awareness (cursors / editing / typing / identity)
awareness.on('update', ({ added, updated, removed }, origin) => {
  if (origin === 'remote') return
  const mine = added.concat(updated, removed).includes(awareness.clientID)
  if (mine) awrAction.send(encodeAwarenessUpdate(awareness, [awareness.clientID])).catch(() => {})
})
awrAction.onMessage = (data) => applyAwarenessUpdate(awareness, toU8(data), 'remote')

// --------------------------------------------------------------------------- identity
function loadIdentity() {
  let id = localStorage.getItem('lm.clientId')
  if (!id) {
    id = Math.random().toString(36).slice(2, 10)
    localStorage.setItem('lm.clientId', id)
  }
  let colorIdx = parseInt(localStorage.getItem('lm.colorIdx') ?? '', 10)
  if (Number.isNaN(colorIdx)) {
    colorIdx = Math.floor(Math.random() * PRESENCE_COLORS.length)
    localStorage.setItem('lm.colorIdx', String(colorIdx))
  }
  return {
    id,
    name: localStorage.getItem('lm.name') || '',
    colorIdx,
    color: PRESENCE_COLORS[colorIdx % PRESENCE_COLORS.length],
  }
}
export let identity = loadIdentity()

function publishUser() {
  awareness.setLocalStateField('user', {
    id: identity.id,
    name: identity.name || 'Gäst',
    color: identity.color,
  })
}
publishUser()

export function setIdentity(patch) {
  identity = { ...identity, ...patch }
  if (patch.name !== undefined) localStorage.setItem('lm.name', patch.name)
  if (patch.colorIdx !== undefined) {
    localStorage.setItem('lm.colorIdx', String(patch.colorIdx))
    identity.color = PRESENCE_COLORS[patch.colorIdx % PRESENCE_COLORS.length]
  }
  publishUser()
}

// --------------------------------------------------------------------------- presence (cursor / editing / typing)
let lastCursorTs = 0
export function setCursor(view, x, y) {
  const now = performance.now()
  if (now - lastCursorTs < 40) return // throttle ~25fps
  lastCursorTs = now
  awareness.setLocalStateField('cursor', { view, x, y, t: Date.now() })
}
export function clearCursor() {
  awareness.setLocalStateField('cursor', null)
}
export function setEditing(taskId) {
  awareness.setLocalStateField('editing', taskId || null)
}
let typingTimer = null
export function pingTyping() {
  awareness.setLocalStateField('typing', true)
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => awareness.setLocalStateField('typing', false), 1500)
}

// drop our presence cleanly on tab close; hide our cursor when the tab is backgrounded
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { try { awareness.setLocalState(null) } catch { /* ignore */ } })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearCursor()
  })
}

// --------------------------------------------------------------------------- task helpers
const plain = (ymap) => {
  const o = {}
  ymap.forEach((v, k) => (o[k] = v))
  return o
}

export function allTasks() {
  const arr = []
  yTasks.forEach((ymap, id) => arr.push({ id, ...plain(ymap) }))
  return arr
}

function nextOrder() {
  let max = 0
  yTasks.forEach((m) => {
    const o = m.get('order') || 0
    if (o > max) max = o
  })
  return max + 1
}

const TASK_DEFAULTS = () => ({
  title: 'Ny uppgift',
  description: '',
  approach: '',
  category: 'dev',
  sub: '',
  status: 'todo',
  difficulty: DEFAULT_DIFFICULTY,
  order: nextOrder(),
  x: null,
  y: null,
  deps: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  updatedBy: identity.name || 'någon',
})

export function createTask(fields = {}, id = null) {
  const tid = id || 't_' + Math.random().toString(36).slice(2, 9)
  ydoc.transact(() => {
    const m = new Y.Map()
    Object.entries({ ...TASK_DEFAULTS(), ...fields }).forEach(([k, v]) => m.set(k, v))
    yTasks.set(tid, m)
  })
  return tid
}

export function updateTask(id, patch) {
  const m = yTasks.get(id)
  if (!m) return
  ydoc.transact(() => {
    Object.entries(patch).forEach(([k, v]) => m.set(k, v))
    m.set('updatedAt', Date.now())
    m.set('updatedBy', identity.name || 'någon')
  })
}

export function deleteTask(id) {
  ydoc.transact(() => {
    yTasks.forEach((m) => {
      const deps = m.get('deps') || []
      if (deps.includes(id)) m.set('deps', deps.filter((d) => d !== id))
    })
    yTasks.delete(id)
  })
}

/** Seed once, with STABLE ids so two peers seeding concurrently converge (no duplicates). */
export function seedIfEmpty(seedTasks) {
  if (yMeta.get('seeded') || yTasks.size > 0) return false
  ydoc.transact(() => {
    seedTasks.forEach((t, i) => {
      const m = new Y.Map()
      Object.entries({ ...TASK_DEFAULTS(), order: i + 1, ...t }).forEach(([k, v]) => m.set(k, v))
      yTasks.set(t.id, m)
    })
    yMeta.set('seeded', true)
    yMeta.set('schema', 1)
  })
  return true
}

// --------------------------------------------------------------------------- external stores (for React)
// keyOf (optional): if the derived key is unchanged, keep the previous snapshot ref and DON'T
// notify — this stops high-frequency cursor ticks from re-rendering people/avatar consumers.
function makeStore(getValue, subscribeRaw, keyOf) {
  const listeners = new Set()
  let snapshot = getValue()
  let key = keyOf ? keyOf(snapshot) : null
  const recompute = () => {
    const next = getValue()
    if (keyOf) {
      const nk = keyOf(next)
      if (nk === key) return
      key = nk
    }
    snapshot = next
    listeners.forEach((l) => l())
  }
  subscribeRaw(recompute)
  return {
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    get: () => snapshot,
  }
}

export const tasksStore = makeStore(allTasks, (cb) => yTasks.observeDeep(cb))

// people = avatars + editing/typing flags. Low-frequency: keyed so cursor moves don't churn it.
export const peopleStore = makeStore(
  () => {
    const out = []
    awareness.getStates().forEach((st, clientId) => {
      if (clientId !== awareness.clientID && st.user)
        out.push({ clientId, user: st.user, editing: st.editing || null, typing: !!st.typing })
    })
    return out
  },
  (cb) => awareness.on('change', cb),
  (arr) => arr.map((p) => `${p.clientId}:${p.user.name}:${p.user.color}:${p.editing}:${p.typing}`).sort().join('|'),
)

// cursors = high-frequency stream, consumed only by the lightweight cursor overlay.
export const cursorsStore = makeStore(
  () => {
    const out = []
    awareness.getStates().forEach((st, clientId) => {
      if (clientId !== awareness.clientID && st.user && st.cursor)
        out.push({ clientId, user: st.user, cursor: st.cursor, typing: !!st.typing })
    })
    return out
  },
  (cb) => awareness.on('change', cb),
)

// --------------------------------------------------------------------------- connection state
let connEmit = () => {}
const connState = { peers: 0, online: false, synced: false }

export const connStore = makeStore(
  () => ({ peers: connState.peers, online: connState.online, synced: connState.synced }),
  (cb) => { connEmit = cb },
)

function updateConn() {
  connState.peers = Object.keys(room.getPeers()).length
  connState.online = connState.peers > 0
  if (connState.peers > 0) connState.synced = true
  connEmit()
}

room.onPeerJoin = (peerId) => {
  // hand the newcomer our full document + awareness so they catch up immediately
  docAction.send(Y.encodeStateAsUpdate(ydoc), { target: peerId }).catch(() => {})
  if (awareness.getLocalState()) {
    awrAction.send(encodeAwarenessUpdate(awareness, [awareness.clientID]), { target: peerId }).catch(() => {})
  }
  updateConn()
}
room.onPeerLeave = () => updateConn()

// --------------------------------------------------------------------------- safe first-run seeding
/**
 * Seed on first run WITHOUT resurrecting deleted tasks: never seed while data/seeded-flag exists,
 * and wait for peer sync before deciding. New room → seed; peers exist → lowest-clientId elects.
 * Stable ids make any residual race converge without loss.
 */
let seedAttempted = false
export function maybeSeed(seedTasks) {
  if (seedAttempted) return // guard StrictMode's double-invoke
  seedAttempted = true
  const FLAG = 'lm.seeded.' + ROOM
  const remember = () => { try { localStorage.setItem(FLAG, '1') } catch { /* ignore */ } }
  const hasData = () => yTasks.size > 0 || !!yMeta.get('seeded')
  if (localStorage.getItem(FLAG) || hasData()) { remember(); return }

  let settled = false
  const finish = (doSeed) => {
    if (settled) return
    settled = true
    cleanup()
    if (!hasData() && doSeed) seedIfEmpty(seedTasks)
    remember()
  }
  const decide = () => {
    if (hasData()) return finish(false)
    if (connState.peers === 0) return finish(true) // truly alone → we must seed
    const ids = [awareness.clientID, ...awareness.getStates().keys()]
    finish(awareness.clientID === Math.min(...ids)) // elected (lowest id) seeds
  }
  const onData = () => { if (hasData()) finish(false) }
  const unsub = connStore.subscribe(() => { if (connState.peers > 0) setTimeout(decide, 1500) })
  yTasks.observeDeep(onData)
  yMeta.observe(onData)
  const timer = setTimeout(decide, 6000) // fallback if no peer ever connects
  function cleanup() {
    yTasks.unobserveDeep(onData)
    yMeta.unobserve(onData)
    unsub()
    clearTimeout(timer)
  }
}

// Dev only: tear down singletons on hot-reload so we don't leak relay sockets / duplicate peers.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    try { room.leave() } catch { /* ignore */ }
    try { persistence.destroy() } catch { /* ignore */ }
  })
}
