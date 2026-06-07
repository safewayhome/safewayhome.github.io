import { useEffect, useMemo, useState } from 'react'
import { T, CATEGORIES, PRESENCE_COLORS } from './theme'
import { useTasks, usePeople, useConnection, useAuth } from './store'
import {
  identity, setIdentity, createTask, maybeSeed, clearCursor, allTasks, BOARD_ID,
} from './collab'
import { signIn, signUp, signOut } from './auth'
import { SEED } from './seed'
import Whiteboard from './views/Whiteboard.jsx'
import Timeline from './views/Timeline.jsx'
import Progress from './views/Progress.jsx'
import Changelog from './views/Changelog.jsx'
import Data from './views/Data.jsx'
import Chat from './views/Chat.jsx'
import TaskEditor from './components/TaskEditor.jsx'
import { Avatar, initials } from './components/Avatar.jsx'

// localStorage-backed UI state (per person: your filters/view are yours, not synced)
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
  { key: 'chat', label: 'Utvecklingschatt', glyph: '💬' },
]

export default function App() {
  const tasks = useTasks()
  const people = usePeople()
  const conn = useConnection()
  const auth = useAuth()
  const canEdit = !!auth.user // redigering kräver inloggning (RLS: skriv = authenticated)

  const [showLogin, setShowLogin] = useState(false)
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
    if (!canEdit) { setShowLogin(true); return } // ej inloggad: be om login i stället för att skapa
    const firstVisibleCat = CATEGORIES.find((c) => cats[c.key])?.key || 'dev'
    const id = createTask({ category: firstVisibleCat, title: 'Ny uppgift' })
    if (id) setEditingId(id)
  }

  // press "n" to add a task (when not typing in a field / modal)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (showName || showSettings || editingId || !canEdit) return
      e.preventDefault()
      addTask()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showName, showSettings, editingId, cats, canEdit])

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
        canEdit={canEdit} email={auth.user?.email}
        onLogin={() => setShowLogin(true)} onLogout={signOut}
      />

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {view === 'board' && (
          <Whiteboard tasks={tasks} visibleTasks={visibleTasks} cats={cats} onOpenTask={setEditingId} paused={!!editingId} canEdit={canEdit} onRequireLogin={() => setShowLogin(true)} />
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
        {view === 'chat' && (
          <Chat onRequireLogin={() => setShowLogin(true)} />
        )}
      </div>

      {editing && (
        <TaskEditor task={editing} allTasks={tasks} onClose={() => setEditingId(null)} canEdit={canEdit} onRequireLogin={() => setShowLogin(true)} />
      )}
      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} />
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
    canEdit, email, onLogin, onLogout,
  } = props
  // Undertiteln under "LedMig" speglar aktuell flik: Nätet behåller whiteboard-texten, övriga flikar
  // visar sitt eget namn (Tidslinje, Framsteg, Changelog, Data, Utvecklingschatt).
  const brandSub = view === 'board' ? 'Utvecklings whiteboard · realtid' : (VIEWS.find((v) => v.key === view)?.label || '')
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '10px 18px',
      background: T.panel, borderBottom: `1px solid ${T.line}`, boxShadow: T.shadowSoft, zIndex: 30,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 210 }}>
        <span style={{ fontSize: 22 }}>🛡️</span>
        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: T.ink }}>LedMig</div>
          <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 600 }}>{brandSub}</div>
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

      {/* category visibility checkboxes (irrelevanta i changelog-/data-/chat-vyn) */}
      {view !== 'changelog' && view !== 'data' && view !== 'chat' && (
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
      <AuthChip canEdit={canEdit} email={email} onLogin={onLogin} onLogout={onLogout} />

      <a href="/app/" title="Öppna säkerhetsappen" style={{
        textDecoration: 'none', border: `1px solid ${T.line}`, background: T.panel, color: T.ink,
        fontWeight: 800, fontSize: 13, padding: '8px 12px', borderRadius: 11,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>🛡️ Appen ↗</a>
      <button onClick={onAdd} title={canEdit ? 'Nytt kort (n)' : 'Logga in för att lägga till kort'} style={{
        border: 'none', background: canEdit ? T.rose : T.todo, color: '#fff', fontWeight: 800, fontSize: 13.5,
        padding: '9px 14px', borderRadius: 11, boxShadow: T.shadowSoft,
      }}>{canEdit ? '＋ Uppgift' : '🔒 Uppgift'}</button>
      <button onClick={onSettings} title="Inställningar" style={{
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

// Statusen speglar nu DATABASEN, inte P2P-peers: "synkad" = allt sparas i Supabase och syns för
// alla (även när man är ensam). "lokalt läge" = DB ej ansluten ännu (sparas lokalt, synkas sen).
function ConnChip({ conn }) {
  const synced = conn.synced
  const color = synced ? T.done : T.doing
  const label = !synced ? 'lokalt läge' : (conn.online ? `${conn.peers + 1} online` : 'synkad')
  const title = !synced
    ? 'Databasen är inte ansluten: ändringar sparas lokalt och synkas så fort DB:n svarar.'
    : (conn.online
      ? `${conn.peers} andra online · allt sparas direkt i databasen`
      : 'Sparat i databasen · syns för alla, även när ingen annan är online')
  return (
    <div title={title} style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999,
      background: color + '1e', color: T.ink, fontWeight: 700, fontSize: 12.5, border: `1px solid ${color}55`,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, animation: synced ? 'none' : 'lm-pulse 1.4s infinite' }} />
      {label}
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

// Inloggad: visa vem + logga ut. Utloggad: en "Logga in"-knapp (redigering kräver konto).
function AuthChip({ canEdit, email, onLogin, onLogout }) {
  if (canEdit) {
    const short = (email || '').split('@')[0]
    return (
      <div title={email} style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 999,
        background: T.doneSoft, border: `1px solid ${T.done}55`, fontWeight: 700, fontSize: 12.5, color: T.ink,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: T.done }} />
        <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{short}</span>
        <button onClick={onLogout} title="Logga ut" style={{ border: 'none', background: 'transparent', color: T.inkSoft, fontWeight: 800, fontSize: 12, cursor: 'pointer', padding: 0 }}>logga ut</button>
      </div>
    )
  }
  return (
    <button onClick={onLogin} title="Logga in för att redigera tavlan" style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
      border: `1.5px solid ${T.line}`, background: T.panel, color: T.ink, fontWeight: 800, fontSize: 12.5, cursor: 'pointer',
    }}>🔒 Logga in</button>
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

function LoginModal({ onClose }) {
  const [mode, setMode] = useState('in') // 'in' = logga in, 'up' = skapa konto
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit() {
    if (!email.trim() || !pwd || busy) return
    setBusy(true); setErr('')
    const { error } = mode === 'in' ? await signIn(email, pwd) : await signUp(email, pwd)
    setBusy(false)
    if (error) { setErr(error.message || 'Något gick fel'); return }
    onClose()
  }
  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontWeight: 800, fontSize: 18, color: T.ink, marginBottom: 4 }}>{mode === 'in' ? 'Logga in' : 'Skapa konto'}</div>
      <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 16 }}>
        Bara inloggade i teamet kan redigera tavlan. Andra kan fortfarande titta.
      </div>
      <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-post"
        onKeyDown={(e) => e.key === 'Enter' && submit()} style={loginInp} />
      <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Lösenord"
        onKeyDown={(e) => e.key === 'Enter' && submit()} style={{ ...loginInp, marginBottom: err ? 6 : 16 }} />
      {err && <div style={{ fontSize: 12.5, color: T.roseDeep, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <button onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr('') }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: T.inkSoft, padding: 0 }}>
          {mode === 'in' ? 'Inget konto? Skapa ett' : 'Har redan konto? Logga in'}
        </button>
        <button disabled={busy || !email.trim() || !pwd} onClick={submit} style={{ ...btnPrimary, opacity: (busy || !email.trim() || !pwd) ? 0.5 : 1 }}>
          {busy ? '…' : (mode === 'in' ? 'Logga in' : 'Skapa konto')}
        </button>
      </div>
    </ModalShell>
  )
}
const loginInp = { width: '100%', padding: '11px 13px', borderRadius: 11, border: `1.5px solid ${T.line}`, fontSize: 15, marginBottom: 12, boxSizing: 'border-box' }

function SettingsModal({ onClose }) {
  const isCustom = BOARD_ID !== 'ledmig-team-v1'
  const link = `${location.origin}${location.pathname}${isCustom ? `?board=${encodeURIComponent(BOARD_ID)}` : ''}`
  const [copied, setCopied] = useState(false)
  return (
    <ModalShell onClose={onClose} width={520}>
      <div style={{ fontWeight: 800, fontSize: 18, color: T.ink, marginBottom: 14 }}>Inställningar</div>
      <Field label="Tavla (board-id)">
        <code style={codeBox}>{BOARD_ID}</code>
      </Field>
      <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5, margin: '6px 0 16px' }}>
        Allt sparas direkt i en delad databas (Supabase) och synkas i realtid: en ändring syns för
        hela teamet med en gång, även när ingen annan är online. Varje kort har en redigeringshistorik
        och visar vem som skapat det. Vill ni köra en separat, privat tavla: lägg till
        <code style={inlineCode}>?board=…</code> i URL:en (sparas lokalt).
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
  const payload = { exportedAt: new Date().toISOString(), board: BOARD_ID, tasks: allTasks() }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ledmig-board-${BOARD_ID}.json`
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
