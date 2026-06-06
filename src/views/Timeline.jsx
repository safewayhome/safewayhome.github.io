import { useMemo } from 'react'
import { T, CAT, STATUS } from '../theme'
import { updateTask } from '../collab'
import { fraction, ago, diffOf } from '../util'

export default function Timeline({ visibleTasks, onOpenTask }) {
  const ordered = useMemo(
    () => visibleTasks.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    [visibleTasks],
  )

  // swap order values with the neighbour (reorders within the *visible* sequence)
  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= ordered.length) return
    const a = ordered[i]
    const b = ordered[j]
    const ao = a.order ?? i
    const bo = b.order ?? j
    updateTask(a.id, { order: bo })
    updateTask(b.id, { order: ao })
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px 60px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.ink, margin: '0 0 4px' }}>🗓️ Ordningsföljd</h2>
        <p style={{ fontSize: 13.5, color: T.inkSoft, margin: '0 0 22px' }}>
          I vilken ordning vi vill få saker gjorda. Varje kort: vad som ska göras och hur vi tänker lösa det.
          Använd ↑/↓ för att ändra ordning (synkas direkt till teamet).
        </p>

        {ordered.length === 0 && <Empty />}

        <div style={{ position: 'relative' }}>
          {/* spine */}
          {ordered.length > 0 && (
            <div style={{ position: 'absolute', left: 19, top: 8, bottom: 8, width: 2, background: T.line }} />
          )}
          {ordered.map((t, i) => (
            <Row key={t.id} t={t} i={i} last={i === ordered.length - 1}
              onOpen={() => onOpenTask(t.id)} onUp={() => move(i, -1)} onDown={() => move(i, +1)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ t, i, last, onOpen, onUp, onDown }) {
  const cat = CAT[t.category] || {}
  const s = STATUS[t.status] || STATUS.todo
  const d = diffOf(t)
  const done = t.status === 'done'
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 14, position: 'relative' }}>
      {/* node */}
      <div style={{ flex: '0 0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 999, background: T.panel, border: `2px solid ${done ? T.done : s.color}`,
          display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14, color: done ? T.done : T.ink, boxShadow: T.shadowSoft,
        }}>{done ? '✓' : i + 1}</div>
      </div>

      {/* card */}
      <div onClick={onOpen} style={{
        flex: 1, background: done ? T.doneSoft : T.panel, border: `1.5px solid ${done ? T.done + '66' : T.line}`,
        borderRadius: 14, padding: '13px 16px', boxShadow: T.shadowSoft, cursor: 'pointer', opacity: done ? 0.82 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: cat.color,
            background: cat.color + '1c', padding: '2px 8px', borderRadius: 999,
          }}>{cat.glyph} {cat.label}{t.sub ? ` · ${t.sub}` : ''}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: s.color, background: s.soft, padding: '2px 8px', borderRadius: 999 }}>{s.label}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: d.text, background: d.soft, padding: '2px 8px', borderRadius: 999 }}>{d.short}</span>
          <div style={{ flex: 1 }} />
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
            <button onClick={onUp} disabled={i === 0} style={{ ...arrow, opacity: i === 0 ? 0.3 : 1 }}>↑</button>
            <button onClick={onDown} disabled={last} style={{ ...arrow, opacity: last ? 0.3 : 1 }}>↓</button>
          </div>
        </div>

        <div style={{ fontSize: 15.5, fontWeight: 800, color: T.ink, margin: '8px 0 2px', textDecoration: done ? 'line-through' : 'none' }}>{t.title}</div>
        {t.description && <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.5, marginBottom: t.approach ? 8 : 0 }}>{t.description}</div>}
        {t.approach && (
          <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5, background: T.panelSoft, borderRadius: 9, padding: '8px 10px', borderLeft: `3px solid ${cat.color}` }}>
            <b style={{ color: cat.color }}>Lösning:</b> {t.approach}
          </div>
        )}

        {/* progress sliver */}
        <div style={{ height: 4, borderRadius: 999, background: T.line, overflow: 'hidden', marginTop: 10 }}>
          <div style={{ height: '100%', width: `${Math.round(fraction(t) * 100)}%`, background: done ? T.done : s.color }} />
        </div>
        {t.updatedBy && <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 6 }}>Senast {ago(t.updatedAt)} · {t.updatedBy}</div>}
      </div>
    </div>
  )
}

const arrow = { border: `1px solid ${T.line}`, background: T.panel, borderRadius: 7, width: 26, height: 24, fontSize: 13, color: T.inkSoft, fontWeight: 800 }

const Empty = () => (
  <div style={{ textAlign: 'center', color: T.inkSoft, padding: 50, fontSize: 14 }}>
    Inga uppgifter i nuvarande filter. Slå på fler kategorier högst upp, eller lägg till en uppgift.
  </div>
)
