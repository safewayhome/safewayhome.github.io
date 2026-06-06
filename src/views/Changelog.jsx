import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../theme'
import { SYSTEM_DESC, ARCHITECTURE, CHANGELOG, AREA } from '../changelogData'

const STATUS_META = {
  done: { label: 'Klart', color: T.done, glyph: '✓' },
  'in-progress': { label: 'Pågår', color: T.doing, glyph: '◐' },
  planned: { label: 'Planerat', color: T.todo, glyph: '○' },
}

// distinkt accentfärg per arkitekturlager (uppifrån och ner)
const LAYER_ACCENT = ['#fb7185', '#6aa9f4', '#7c6cf0', '#3fb5a3', '#9b8cf0']

/* Lugn "tona in när den scrollas in"-wrapper (respekterar reducerad rörelse). */
function Reveal({ children, delay = 0, style }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect() } })
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{
      ...style,
      opacity: shown ? 1 : 0,
      transform: shown ? 'none' : 'translateY(18px)',
      transition: `opacity .75s cubic-bezier(.22,.61,.36,1) ${delay}ms, transform .75s cubic-bezier(.22,.61,.36,1) ${delay}ms`,
      willChange: 'opacity, transform',
    }}>{children}</div>
  )
}

export default function Changelog() {
  // gruppera changelog per period i kronologisk ordning
  const groups = useMemo(() => {
    const g = []
    CHANGELOG.slice().sort((a, b) => a.order - b.order).forEach((e) => {
      let bucket = g.find((x) => x.period === e.period)
      if (!bucket) { bucket = { period: e.period, items: [] }; g.push(bucket) }
      bucket.items.push(e)
    })
    return g
  }, [])

  const doneN = CHANGELOG.filter((e) => e.status === 'done').length
  const progN = CHANGELOG.filter((e) => e.status === 'in-progress').length
  const planN = CHANGELOG.filter((e) => e.status === 'planned').length

  return (
    <div style={{ height: '100%', overflow: 'auto', background: T.bg, scrollBehavior: 'smooth' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '34px 24px 90px' }}>

        {/* ───────── Vad är LedMig? (mänsklig beskrivning) ───────── */}
        <Reveal>
          <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5, color: T.rose, textTransform: 'uppercase', marginBottom: 10 }}>
            Vad är LedMig?
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: T.ink, lineHeight: 1.25, margin: '0 0 18px', maxWidth: 760 }}>
            {SYSTEM_DESC.tagline}
          </h1>
        </Reveal>

        <Reveal delay={60}>
          <div style={{ display: 'grid', gap: 14, maxWidth: 760, marginBottom: 26 }}>
            {SYSTEM_DESC.paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 15, lineHeight: 1.72, color: T.ink, margin: 0 }}>{p}</p>
            ))}
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 46 }}>
            {SYSTEM_DESC.principles.map((pr) => (
              <div key={pr.title} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, padding: '16px 18px', boxShadow: T.shadowSoft }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{pr.icon}</div>
                <div style={{ fontSize: 14.5, fontWeight: 900, color: T.ink, marginBottom: 5 }}>{pr.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: T.inkSoft }}>{pr.text}</div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* ───────── Hur systemet hänger ihop (visualisering) ───────── */}
        <Reveal>
          <h2 style={{ fontSize: 21, fontWeight: 900, color: T.ink, margin: '0 0 6px' }}>🗺️ Hur systemet hänger ihop</h2>
          <p style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.6, margin: '0 0 20px', maxWidth: 720 }}>
            {ARCHITECTURE.intro}
          </p>
        </Reveal>

        <div style={{ marginBottom: 18 }}>
          {ARCHITECTURE.layers.map((layer, li) => {
            const accent = LAYER_ACCENT[li % LAYER_ACCENT.length]
            return (
              <Reveal key={layer.id} delay={li * 40}>
                <div style={{
                  background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16,
                  boxShadow: T.shadowSoft, padding: '16px 18px', borderLeft: `5px solid ${accent}`,
                  display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: '0 0 168px', minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: 999, background: accent, color: '#fff',
                        display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13, flex: '0 0 auto',
                      }}>{li + 1}</span>
                      <span style={{ fontSize: 16, fontWeight: 900, color: T.ink }}>{layer.title}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.45, marginTop: 7 }}>{layer.subtitle}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 220, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {layer.nodes.map((node) => {
                      const a = AREA[node.cat] || AREA.dev
                      return (
                        <div key={node.label} title={node.sub} style={{
                          background: a.color + '14', border: `1px solid ${a.color}40`,
                          borderLeft: `3px solid ${a.color}`, borderRadius: 10, padding: '7px 10px', minWidth: 132,
                        }}>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: T.ink, lineHeight: 1.2 }}>{node.label}</div>
                          <div style={{ fontSize: 11, color: T.inkSoft, lineHeight: 1.3, marginTop: 2 }}>{node.sub}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {li < ARCHITECTURE.layers.length - 1 && (
                  <div style={{ display: 'grid', placeItems: 'center', height: 26, color: T.todo, fontSize: 16, lineHeight: 1 }}>▼</div>
                )}
              </Reveal>
            )
          })}
        </div>

        <Reveal>
          <div style={{ background: T.roseSoft, borderRadius: 14, padding: '15px 18px', fontSize: 13.5, lineHeight: 1.6, color: T.ink, marginBottom: 50 }}>
            <b>Så flödar det:</b> {ARCHITECTURE.flowNote}
          </div>
        </Reveal>

        {/* ───────── Changelog (kronologisk) ───────── */}
        <Reveal>
          <h2 style={{ fontSize: 21, fontWeight: 900, color: T.ink, margin: '0 0 6px' }}>📜 Changelog</h2>
          <p style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.6, margin: '0 0 16px', maxWidth: 720 }}>
            Allt vi har byggt och allt som ligger framför oss, i kronologisk ordning.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
            <Tally color={T.done} glyph="✓" n={doneN} label="klart" />
            <Tally color={T.doing} glyph="◐" n={progN} label="pågår" />
            <Tally color={T.todo} glyph="○" n={planN} label="planerat" />
          </div>
        </Reveal>

        <div style={{ position: 'relative', paddingLeft: 4 }}>
          {/* ryggrad */}
          <div style={{ position: 'absolute', left: 13, top: 6, bottom: 6, width: 2, background: T.line }} />
          {groups.map((g) => (
            <div key={g.period} style={{ marginBottom: 6 }}>
              <Reveal>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px', position: 'relative' }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 999, background: T.panel, border: `2px solid ${T.rose}`,
                    display: 'grid', placeItems: 'center', fontSize: 13, zIndex: 1, flex: '0 0 auto',
                  }}>🗓️</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: T.ink }}>{g.period}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: T.inkSoft }}>· {g.items.length} {g.items.length === 1 ? 'punkt' : 'punkter'}</span>
                </div>
              </Reveal>
              {g.items.map((e) => {
                const a = AREA[e.area] || AREA.dev
                const st = STATUS_META[e.status] || STATUS_META.planned
                const muted = e.status === 'planned'
                return (
                  <Reveal key={e.order} style={{ marginBottom: 12, marginLeft: 38, position: 'relative' }}>
                    {/* nod på ryggraden */}
                    <span style={{
                      position: 'absolute', left: -32, top: 16, width: 18, height: 18, borderRadius: 999,
                      background: T.panel, border: `2px solid ${st.color}`, display: 'grid', placeItems: 'center',
                      fontSize: 10, fontWeight: 900, color: st.color, zIndex: 1,
                    }}>{st.glyph}</span>
                    <div style={{
                      background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '13px 16px',
                      boxShadow: T.shadowSoft, opacity: muted ? 0.92 : 1,
                      borderLeft: `4px solid ${a.color}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10.5, fontWeight: 800, color: a.color, background: a.color + '18',
                          padding: '2px 8px', borderRadius: 999,
                        }}>{a.glyph} {a.label}</span>
                        <span style={{
                          fontSize: 10.5, fontWeight: 800, color: st.color, background: st.color + '1c',
                          padding: '2px 8px', borderRadius: 999,
                        }}>{st.glyph} {st.label}</span>
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: T.ink, lineHeight: 1.25, marginBottom: 4 }}>{e.title}</div>
                      <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55 }}>{e.desc}</div>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          ))}
        </div>

        <Reveal>
          <div style={{ textAlign: 'center', color: T.inkSoft, fontSize: 12.5, marginTop: 30, lineHeight: 1.6 }}>
            LedMig · trygg gångnavigering hem.<br />
            Bara lagliga, avidentifierade datakällor: integritet i grunden.
          </div>
        </Reveal>
      </div>
    </div>
  )
}

function Tally({ color, glyph, n, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, background: T.panel, border: `1px solid ${T.line}`,
      borderRadius: 999, padding: '7px 14px', boxShadow: T.shadowSoft,
    }}>
      <span style={{ color, fontWeight: 900, fontSize: 14 }}>{glyph}</span>
      <span style={{ fontSize: 14, fontWeight: 900, color: T.ink }}>{n}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.inkSoft }}>{label}</span>
    </div>
  )
}
