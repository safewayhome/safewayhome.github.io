import { useEffect, useMemo, useState } from 'react'
import { T, CATEGORIES, PRESENCE_COLORS } from './theme'
import { useTasks, usePeople, useConnection } from './store'
import {
  identity, setIdentity, createTask, maybeSeed, clearCursor, allTasks,
  ROOM, ROOM_PASSWORD, RELAYS,
} from './collab'
import { SEED } from './seed'
import Whiteboard from './views/Whiteboard.jsx'
import Timeline from './views/Timeline.jsx'
import Progress from './views/Progress.jsx'
import Changelog from './views/Changelog.jsx'
import Data from './views/Data.jsx'
import TaskEditor from './components/TaskEditor.jsx'
import { Avatar, initials } from './components/Avatar.jsx'

// localStorage-backed UI state (per person — your filters/view are yours, not synced)
function usePersistentState(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
  }, [key, v])
  return [v, setV]
}

const VIEWS = [
  { key: 'board', label: 'Nätet', glyph: '🧩' },
  { key: 'timeline', label: 'Tidslinje', glyph: '🗓️' },
  { key: 'progress', label: 'Framsteg', glyph: '📊' },
  { key: 'changelog', label: 'Changelog', glyph: '📜' },
  { key: 'data', label: 'Data', glyph: '🛰️' },
]

export default function App() {
  const tasks = useTasks()
  const people = usePeople()
  const conn = useConnection()

  const [view, setView] = usePersistentState('lm.view', 'board')
  const [cats, setCats] = usePersistentState(
    'lm.filter.cats',
    Object.fromEntries(CATEGORIES.map((c) => [c.key, true])),
  )
  const [hiddenSubs, setHiddenSubs] = usePersistentState('lm.filter.subs', [])
  const [filterOpen, setFilterOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showName, setShowName] = useState(!identity.name)
  const [showSettings, setShowSettings] = useState(false)

  // seed once, safely — maybeSeed waits for peer sync and never resurrects deleted tasks
  useEffect(() => { maybeSeed(SEED) }, [])

  // don't leave a frozen cursor behind when switching away from the whiteboard
  useEffect(() => { if (view !== 'board') clearCursor() }, [view])

  const hiddenSubSet = useMemo(() => new Set(hiddenSubs), [hiddenSubs])
  const isVisible = (t) => cats[t.category] && !hiddenSubSet.has(t.category + ':' + t.sub)
  const visibleTasks = useMemo(() => tasks.filter(isVisible), [tasks, cats, hiddenSubSet])

  // per-category done/total for the filter chips
  const catStats = useMemo(() => {
    const s = {}
    for (const c of CATEGORIES) s[c.key] = { done: 0, total: 0 }
    for (const t of tasks) {
      if (!s[t.category]) continue
      s[t.category].total++
      if (t.status === 'done') s[t.category].done++
    }
    return s
  }, [tasks])

  const editing = editingId ? tasks.find((t) => t.id === editingId) || null : null

  function toggleCat(key) {
    setCats((c) => ({ ...c, [key]: !c[key] }))
  }
  function toggleSub(catKey, sub) {
    const id = catKey + ':' + sub
    setHiddenSubs((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]))
  }
  function addTask() {
    const firstVisibleCat = CATEGORIES.find((c) => cats[c.key])?.key || 'dev'
    const id = createTask({ category: firstVisibleCat, title: 'Ny uppgift' })
    setEditingId(id)
  }

  // press "n" to add a task (when not typing in a field / modal)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (showName || showSettings || editingId) return
      e.preventDefault()
      addTask()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showName, showSettings, editingId, cats])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>
      <TopBar
        view={view} setView={setView}
        cats={cats} toggleCat={toggleCat} catStats={catStats}
        filterOpen={filterOpen} setFilterOpen={setFilterOpen}
        hiddenSubSet={hiddenSubSet} toggleSub={toggleSub}
        people={people} conn={conn}
        onAdd={addTask}
        onName={() => setShowName(true)}
        onSettings={() => setShowSettings(true)}
      />

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {view === 'board' && (
          <Whiteboard tasks={tasks} visibleTasks={visibleTasks} cats={cats} onOpenTask={setEditingId} />
        )}
        {view === 'timeline' && (
          <Timeline tasks={tasks} visibleTasks={visibleTasks} onOpenTask={setEditingId} />
        )}
        {view === 'progress' && (
          <Progress tasks={tasks} visibleTasks={visibleTasks} cats={cats} />
        )}
        {view === 'changelog' && (
          <Changelog tasks={tasks} />
        )}
        {view === 'data' && (
          <Data />
        )}
      </div>

      {editing && (
        <TaskEditor task={editing} allTasks={tasks} onClose={() => setEditingId(null)} />
      )}
      {showName && (
        <NameModal
          onSave={(name, colorIdx) => { setIdentity({ name, colorIdx }); setShowName(false) }}
          canCancel={!!identity.name}
          onCancel={() => setShowName(false)}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

/* ───────────────────────────── Top bar ───────────────────────────── */
function TopBar(props) {
  const {
    view, setView, cats, toggleCat, catStats, filterOpen, setFilterOpen,
    hiddenSubSet, toggleSub, people, conn, onAdd, onName, onSettings,
  } = props
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '10px 18px',
      background: T.panel, borderBottom: `1px solid ${T.line}`, boxShadow: T.shadowSoft, zIndex: 30,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 210 }}>
        <span style={{ fontSize: 22 }}>🛡️</span>
        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: T.ink }}>LedMig</div>
          <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 600 }}>Team Board · realtid</div>
        </div>
      </div>

      {/* view tabs */}
      <div style={{ display: 'flex', gap: 4, background: T.panelSoft, padding: 4, borderRadius: 12 }}>
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} style={{
            border: 'none', borderRadius: 9, padding: '7px 14px', fontWeight: 700, fontSize: 13.5,
            background: view === v.key ? T.panel : 'transparent',
            color: view === v.key ? T.ink : T.inkSoft,
            boxShadow: view === v.key ? T.shadowSoft : 'none',
          }}>
            <span style={{ marginRight: 6 }}>{v.glyph}</span>{v.label}
          </button>
        ))}
      </div>

      {/* category visibility checkboxes (irrelevanta i changelog-/data-vyn) */}
      {view !== 'changelog' && view !== 'data' && (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {CATEGORIES.map((c) => {
          const on = cats[c.key]
          const st = (catStats && catStats[c.key]) || { done: 0, total: 0 }
          return (
            <button key={c.key} onClick={() => toggleCat(c.key)} title={`Visa/dölj ${c.label} (${st.done}/${st.total} klara)`} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999,
              border: `1.5px solid ${on ? c.color : T.line}`,
              background: on ? c.color + '22' : T.panel, color: on ? T.ink : T.inkSoft,
              fontWeight: 700, fontSize: 12.5, opacity: on ? 1 : 0.6,
            }}>
              <span style={{
                width: 13, height: 13, borderRadius: 4, display: 'grid', placeItems: 'center',
                background: on ? c.color : 'transparent', border: `1.5px solid ${on ? c.color : T.todo}`,
                color: '#fff', fontSize: 10, fontWeight: 900,
              }}>{on ? '✓' : ''}</span>
              <span>{c.glyph} {c.label}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: on ? c.color : T.inkSoft, opacity: 0.9 }}>{st.done}/{st.total}</span>
            </button>
          )
        })}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setFilterOpen((o) => !o)} title="Detaljfilter (underkategorier)" style={{
            padding: '6px 10px', borderRadius: 999, border: `1.5px solid ${T.line}`,
            background: hiddenSubSet.size ? T.roseSoft : T.panel, color: T.inkSoft, fontWeight: 700, fontSize: 12.5,
          }}>⛃ Filter{hiddenSubSet.size ? ` (${hiddenSubSet.size})` : ''}</button>
          {filterOpen && (
            <SubFilterPopover cats={cats} hiddenSubSet={hiddenSubSet} toggleSub={toggleSub} onClose={() => setFilterOpen(false)} />
          )}
        </div>
      </div>
      )}

      <div style={{ flex: 1 }} />

      <ConnChip conn={conn} />
      <PresenceBar people={people} onName={onName} />

      <a href="/app/" title="Öppna säkerhetsappen" style={{
        textDecoration: 'none', border: `1px solid ${T.line}`, background: T.panel, color: T.ink,
        fontWeight: 800, fontSize: 13, padding: '8px 12px', borderRadius: 11,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>🛡️ Appen ↗</a>
      <button onClick={onAdd} style={{
        border: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 13.5,
        padding: '9px 14px', borderRadius: 11, boxShadow: T.shadowSoft,
      }}>＋ Uppgift</button>
      <button onClick={onSettings} title="Inställningar (rum / signaling)" style={{
        border: `1px solid ${T.line}`, background: T.panel, borderRadius: 10, padding: '8px 10px', fontSize: 15,
      }}>⚙️</button>
    </header>
  )
}

function SubFilterPopover({ cats, hiddenSubSet, toggleSub, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 300, maxHeight: 420,
        overflow: 'auto', background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14,
        boxShadow: T.shadow, padding: 12,
      }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: T.ink, marginBottom: 8 }}>Underkategorier</div>
        {CATEGORIES.filter((c) => cats[c.key]).map((c) => (
          <div key={c.key} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: c.color, marginBottom: 4 }}>{c.glyph} {c.label}</div>
            {c.subs.map((s) => {
              const hidden = hiddenSubSet.has(c.key + ':' + s)
              return (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', cursor: 'pointer', fontSize: 12.5, color: T.ink }}>
                  <input type="checkbox" checked={!hidden} onChange={() => toggleSub(c.key, s)} />
                  {s}
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

function ConnChip({ conn }) {
  const people = conn.peers
  const color = conn.online ? T.done : T.doing
  return (
    <div title={conn.online ? `${people} peer(s) anslutna` : 'Väntar på andra (du jobbar offline tills någon ansluter)'} style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999,
      background: color + '1e', color: T.ink, fontWeight: 700, fontSize: 12.5, border: `1px solid ${color}55`,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, animation: conn.online ? 'none' : 'lm-pulse 1.4s infinite' }} />
      {conn.online ? `${people + 1} online` : 'offline'}
    </div>
  )
}

function PresenceBar({ people, onName }) {
  const others = people.filter((p) => p.user)
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex' }}>
        {others.slice(0, 5).map((p, i) => (
          <div key={p.clientId} style={{ position: 'relative', marginLeft: i ? -8 : 0 }}>
            <Avatar name={p.user.name} color={p.user.color} title={p.user.name + (p.typing ? ' · skriver…' : p.editing ? ' · redigerar' : '')} />
            {p.typing && (
              <span style={{ position: 'absolute', right: -2, bottom: -2, fontSize: 10, background: T.panel, borderRadius: 999, lineHeight: 1, padding: 1 }}>✍️</span>
            )}
          </div>
        ))}
      </div>
      <button onClick={onName} title="Ditt namn & färg" style={{
        marginLeft: others.length ? 8 : 0, border: `2px solid ${T.panel}`, outline: `2px solid ${identity.color}`,
        background: identity.color, color: '#fff', width: 32, height: 32, borderRadius: 999,
        fontWeight: 800, fontSize: 13, display: 'grid', placeItems: 'center',
      }}>{initials(identity.name) || '🙂'}</button>
    </div>
  )
}

/* ───────────────────────────── Modals ───────────────────────────── */
function ModalShell({ children, onClose, width = 420 }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(63,54,64,0.28)',
      display: 'grid', placeItems: 'center', animation: 'lm-fade-in .12s ease',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width, maxWidth: '92vw', background: T.panel, borderRadius: 18, boxShadow: T.shadow, padding: 22,
      }}>{children}</div>
    </div>
  )
}

function NameModal({ onSave, canCancel, onCancel }) {
  const [name, setName] = useState(identity.name || '')
  const [colorIdx, setColorIdx] = useState(identity.colorIdx ?? 0)
  return (
    <ModalShell onClose={canCancel ? onCancel : () => {}}>
      <div style={{ fontWeight: 800, fontSize: 18, color: T.ink, marginBottom: 4 }}>Vem är du?</div>
      <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 16 }}>
        Ditt namn och din färg visas för teamet (muspekare, avatarer, “vem redigerar”).
      </div>
      <input
        autoFocus value={name} onChange={(e) => setName(e.target.value)}
        placeholder="T.ex. Tobias" onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim(), colorIdx)}
        style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: `1.5px solid ${T.line}`, fontSize: 15, marginBottom: 16 }}
      />
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {PRESENCE_COLORS.map((c, i) => (
          <button key={c} onClick={() => setColorIdx(i)} style={{
            width: 34, height: 34, borderRadius: 999, background: c, border: i === colorIdx ? `3px solid ${T.ink}` : `3px solid ${c}`,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {canCancel && <button onClick={onCancel} style={btnGhost}>Avbryt</button>}
        <button disabled={!name.trim()} onClick={() => onSave(name.trim(), colorIdx)} style={{ ...btnPrimary, opacity: name.trim() ? 1 : 0.5 }}>Spara</button>
      </div>
    </ModalShell>
  )
}

function SettingsModal({ onClose }) {
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(ROOM)}&pass=${encodeURIComponent(ROOM_PASSWORD)}`
  const [copied, setCopied] = useState(false)
  return (
    <ModalShell onClose={onClose} width={520}>
      <div style={{ fontWeight: 800, fontSize: 18, color: T.ink, marginBottom: 14 }}>Inställningar</div>
      <Field label="Rum (alla i teamet måste ha samma)">
        <code style={codeBox}>{ROOM}</code>
      </Field>
      <Field label="Lösenord (krypterar datan mellan er)">
        <code style={codeBox}>{ROOM_PASSWORD}</code>
      </Field>
      <Field label="Nostr-rellän (kopplar ihop er; datan går peer-to-peer & krypterat)">
        <code style={{ ...codeBox, fontSize: 11.5 }}>{RELAYS.join('\n')}</code>
      </Field>
      <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5, margin: '6px 0 16px' }}>
        Bjud in teamet med länken nedan. Vill ni byta rum eller köra privat: lägg till
        <code style={inlineCode}>?room=…&amp;pass=…</code> i URL:en (sparas lokalt). Relälistan kan
        bytas med <code style={inlineCode}>?relays=wss://a,wss://b</code>. Inga konton, ingen server —
        relläna kopplar bara ihop er, själva datan går direkt mellan era webbläsare.
      </div>
      <Field label="Inbjudningslänk">
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={link} style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${T.line}`, fontSize: 12 }} />
          <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1400) }} style={btnPrimary}>
            {copied ? 'Kopierad!' : 'Kopiera'}
          </button>
        </div>
      </Field>
      <Field label="Säkerhetskopia">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={exportBoard} style={btnGhost}>⤓ Exportera tavlan (JSON)</button>
          <span style={{ fontSize: 11.5, color: T.inkSoft }}>Laddar ner alla uppgifter som en fil.</span>
        </div>
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onClose} style={btnPrimary}>Stäng</button>
      </div>
    </ModalShell>
  )
}

function exportBoard() {
  const payload = { exportedAt: new Date().toISOString(), room: ROOM, tasks: allTasks() }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ledmig-board-${ROOM}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.inkSoft, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

const btnPrimary = { border: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 13.5, padding: '9px 16px', borderRadius: 11 }
const btnGhost = { border: `1.5px solid ${T.line}`, background: T.panel, color: T.inkSoft, fontWeight: 700, fontSize: 13.5, padding: '9px 16px', borderRadius: 11 }
const codeBox = { display: 'block', background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 9, padding: '8px 11px', fontSize: 12.5, color: T.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
const inlineCode = { background: T.panelSoft, borderRadius: 6, padding: '1px 5px', margin: '0 3px', fontSize: 11.5 }
