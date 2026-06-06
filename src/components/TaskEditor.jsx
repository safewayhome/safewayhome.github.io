import { useEffect, useState } from 'react'
import { T, CATEGORIES, CAT, STATUS, DIFFICULTIES } from '../theme'
import { updateTask, deleteTask, setEditing, pingTyping } from '../collab'
import { usePeople } from '../store'
import { ago, diffKey } from '../util'
import { Avatar } from './Avatar.jsx'

// Fritextfält använder ett LOKALT utkast medan editorn är öppen, så en kollegas fjärr-
// redigering inte rycker din markör mitt i en tangenttryckning. Diskreta kontroller
// (status / kategori / svårighetsgrad / beroenden) skrivs rakt igenom — de har ingen markör att störa.
const seedDraft = (t) => ({
  title: t.title ?? '',
  description: t.description ?? '',
  approach: t.approach ?? '',
})

export default function TaskEditor({ task, allTasks, onClose }) {
  const people = usePeople()
  const [draft, setDraft] = useState(() => seedDraft(task))

  // tell the team you're editing this task; re-seed the draft when switching to another task
  useEffect(() => {
    setEditing(task.id)
    setDraft(seedDraft(task))
    return () => setEditing(null)
  }, [task.id])

  const cat = CAT[task.category] || CATEGORIES[0]
  const commit = (patch) => updateTask(task.id, patch)
  const deps = task.deps || []
  const othersEditing = people.filter((p) => p.editing === task.id && p.user)

  const curDiff = diffKey(task)

  // text field: keep raw in draft, mirror to Yjs live
  const onText = (key, raw) => {
    setDraft((d) => ({ ...d, [key]: raw }))
    pingTyping()
    commit({ [key]: raw })
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(63,54,64,0.18)' }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, height: '100%', width: 440, maxWidth: '94vw', zIndex: 51,
        background: T.panel, boxShadow: '-10px 0 30px rgba(63,54,64,0.16)', display: 'flex', flexDirection: 'column',
        animation: 'lm-fade-in .14s ease',
      }}>
        {/* header */}
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: cat.color }} />
          <div style={{ fontSize: 12.5, fontWeight: 800, color: cat.color }}>{cat.glyph} {cat.label}{task.sub ? ` · ${task.sub}` : ''}</div>
          <div style={{ flex: 1 }} />
          {othersEditing.map((p) => (
            <div key={p.clientId} style={{ position: 'relative' }} title={`${p.user.name}${p.typing ? ' skriver…' : ' redigerar också'}`}>
              <Avatar name={p.user.name} color={p.user.color} />
              {p.typing && <span style={{ position: 'absolute', right: -2, bottom: -2, fontSize: 9 }}>✍️</span>}
            </div>
          ))}
          <button onClick={onClose} style={iconBtn}>✕</button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {/* NOTE: task/presence fields are peer-supplied — render only as React text (never dangerouslySetInnerHTML). */}
          <textarea
            value={draft.title} onChange={(e) => onText('title', e.target.value)} rows={2}
            placeholder="Titel" style={{ ...inp, fontSize: 18, fontWeight: 800, resize: 'none', marginBottom: 14 }}
          />

          {/* status segmented */}
          <Label>Status</Label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {Object.entries(STATUS).map(([key, s]) => (
              <button key={key} onClick={() => commit({ status: key })} style={{
                flex: 1, padding: '8px 0', borderRadius: 10, fontWeight: 800, fontSize: 13,
                border: `1.5px solid ${task.status === key ? s.color : T.line}`,
                background: task.status === key ? s.color + '22' : T.panel,
                color: task.status === key ? T.ink : T.inkSoft,
              }}>{s.label}</button>
            ))}
          </div>

          {/* category + sub */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <Label>Kategori</Label>
              <select value={task.category} onChange={(e) => commit({ category: e.target.value, sub: '' })} style={inp}>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.glyph} {c.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <Label>Underkategori</Label>
              <select value={task.sub || ''} onChange={(e) => commit({ sub: e.target.value })} style={inp}>
                <option value="">—</option>
                {cat.subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* svårighetsgrad — fyra fasta, färgkodade nivåer */}
          <Label>Svårighetsgrad</Label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
            {DIFFICULTIES.map((d) => {
              const on = curDiff === d.key
              return (
                <button key={d.key} onClick={() => commit({ difficulty: d.key })} title={d.label} style={{
                  flex: 1, padding: '8px 4px', borderRadius: 10, fontWeight: 800, fontSize: 12,
                  border: `1.5px solid ${on ? d.color : T.line}`,
                  background: on ? d.color + '22' : T.panel,
                  color: on ? d.text : T.inkSoft,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, lineHeight: 1.1,
                }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: d.color, opacity: on ? 1 : 0.55 }} />
                  {d.short}
                </button>
              )
            })}
          </div>

          <Label>Vad ska göras (beskrivning)</Label>
          <textarea value={draft.description} onChange={(e) => onText('description', e.target.value)} rows={3}
            placeholder="Koncist: vad uppgiften innebär." style={{ ...inp, marginBottom: 16, resize: 'vertical' }} />

          <Label>Hur vi tänker lösa det (om vi har ett hum)</Label>
          <textarea value={draft.approach} onChange={(e) => onText('approach', e.target.value)} rows={3}
            placeholder="Översiktlig lösningsidé / verktyg." style={{ ...inp, marginBottom: 16, resize: 'vertical' }} />

          <Label>Beror på (ritas som pilar mellan korten i Nätet)</Label>
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 8, maxHeight: 150, overflow: 'auto', marginBottom: 8 }}>
            {allTasks.filter((t) => t.id !== task.id).length === 0 && (
              <div style={{ fontSize: 12.5, color: T.inkSoft, padding: 4 }}>Inga andra uppgifter ännu.</div>
            )}
            {allTasks.filter((t) => t.id !== task.id).map((t) => {
              const on = deps.includes(t.id)
              return (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', cursor: 'pointer', fontSize: 12.5 }}>
                  <input type="checkbox" checked={on} onChange={() => commit({ deps: on ? deps.filter((d) => d !== t.id) : [...deps, t.id] })} />
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: (CAT[t.category] || {}).color || T.todo }} />
                  <span style={{ color: T.ink }}>{t.title}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11.5, color: T.inkSoft, flex: 1 }}>
            {task.updatedBy ? `Senast ${ago(task.updatedAt)} · ${task.updatedBy}` : ''}
          </div>
          <button onClick={() => { if (confirm('Ta bort uppgiften?')) { deleteTask(task.id); onClose() } }} style={{
            border: `1.5px solid ${T.roseSoft}`, background: T.roseSoft, color: T.roseDeep, fontWeight: 800,
            fontSize: 13, padding: '9px 14px', borderRadius: 11,
          }}>Ta bort</button>
          <button onClick={onClose} style={{ border: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 13, padding: '9px 16px', borderRadius: 11 }}>Klar</button>
        </div>
      </aside>
    </>
  )
}

const Label = ({ children }) => (
  <div style={{ fontSize: 11.5, fontWeight: 800, color: T.inkSoft, marginBottom: 5 }}>{children}</div>
)
const inp = { width: '100%', padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${T.line}`, fontSize: 14, color: T.ink, background: T.panel, outline: 'none' }
const iconBtn = { border: `1px solid ${T.line}`, background: T.panel, borderRadius: 9, width: 32, height: 32, fontSize: 14, color: T.inkSoft }
