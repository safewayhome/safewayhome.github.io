import { useMemo } from 'react'
import { T } from '../theme'
import { computeProgress, progressByCategory, round1 } from '../util'

export default function Progress({ visibleTasks }) {
  const overall = useMemo(() => computeProgress(visibleTasks), [visibleTasks])
  // only show categories that actually have visible tasks (respects the top-bar filters)
  const byCat = useMemo(() => progressByCategory(visibleTasks).filter((r) => r.n > 0), [visibleTasks])

  const spentHours = round1(overall.spent)        // hours actually logged
  const remainHours = round1(overall.remaining)   // estimate − spent, for not-yet-done work
  const projHours = round1(overall.projected)     // spent + remaining (these reconcile)
  const estHours = round1(overall.estTotal)       // original sum of estimates

  return (
    <div style={{ height: '100%', overflow: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px 60px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.ink, margin: '0 0 4px' }}>📊 Hur långt har vi kommit?</h2>
        <p style={{ fontSize: 13.5, color: T.inkSoft, margin: '0 0 22px' }}>
          Grov uppskattning, viktad efter hur lång tid varje sak beräknas ta (inte bara antal uppgifter).
        </p>

        {/* big overall bar */}
        <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 18, padding: 22, boxShadow: T.shadowSoft, marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 52, fontWeight: 900, color: T.rose, lineHeight: 0.9 }}>{overall.pct}%</div>
            <div style={{ fontSize: 13, color: T.inkSoft, fontWeight: 700, paddingBottom: 6 }}>
              {overall.counts.done} klara · {overall.counts.doing} pågår · {overall.counts.todo} kvar
              <br />({overall.n} uppgifter totalt)
            </div>
          </div>
          <Bar pct={overall.pct} big segments={overall} />
        </div>

        {/* narrative — the "text on the page" the progress bar links to */}
        <div style={{ background: T.roseSoft, borderRadius: 16, padding: '18px 20px', marginBottom: 26, lineHeight: 1.65, fontSize: 14, color: T.ink }}>
          <b>Sammanfattning.</b> Teamet har hittills lagt <b>~{spentHours} h</b>, och uppskattar att{' '}
          <b>~{remainHours} h</b> återstår — alltså <b>~{projHours} h</b> projicerat totalt
          {Math.abs(projHours - estHours) >= 1 ? <> (ursprunglig estimering: ~{estHours} h)</> : null}.
          Det ger <b>≈{overall.pct}%</b> färdigt, viktat efter hur lång tid varje sak uppskattas ta.{' '}
          {overall.counts.todo === 0 && overall.counts.doing === 0
            ? 'Allt i nuvarande vy är klart — snyggt jobbat! 🎉'
            : `Närmast återstår ${overall.counts.doing} pågående och ${overall.counts.todo} ej påbörjade uppgifter. `}
          {remainHours > 0 && (
            <>Med <b>3 personer</b>, och om man grovt antar ~15 fokus­timmar/person och vecka,
              motsvarar de {remainHours} h kvar ungefär <b>~{Math.max(1, Math.ceil(remainHours / (3 * 15)))} veckor</b> kalendertid
              (mycket grov fingervisning — justera estimaten per uppgift för en bättre siffra).</>
          )}
        </div>

        {/* per-category */}
        <h3 style={{ fontSize: 15, fontWeight: 800, color: T.ink, margin: '0 0 12px' }}>Per område</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {byCat.map((row) => (
            <div key={row.cat.key} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '14px 16px', boxShadow: T.shadowSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{row.cat.glyph}</span>
                <span style={{ fontWeight: 800, color: row.cat.color, fontSize: 14 }}>{row.cat.label}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{row.pct}%</span>
              </div>
              <Bar pct={row.pct} color={row.cat.color} segments={row} />
              <div style={{ display: 'flex', gap: 16, marginTop: 9, fontSize: 12, color: T.inkSoft, fontWeight: 700, flexWrap: 'wrap' }}>
                <span>{row.counts.done}/{row.n} uppgifter klara</span>
                <span>~{round1(row.spent)} h lagt</span>
                <span>~{round1(row.remaining)} h kvar</span>
                <span>~{round1(row.estTotal)} h totalt</span>
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 22, lineHeight: 1.5 }}>
          Hur det räknas: en <i>klar</i> uppgift räknas som 100 %, en <i>pågående</i> som spenderad tid ÷ uppskattad tid
          (max 95 %), en <i>att göra</i> som 0 %. Procenten är summan av detta viktat med varje uppgifts uppskattade timmar.
          Ändra <b>uppskattat</b>/<b>spenderat</b> i en uppgift för att förfina siffran.
        </p>
      </div>
    </div>
  )
}

function Bar({ pct, big, color = T.rose, segments }) {
  // optional stacked done/doing/todo composition using estimate weights
  return (
    <div style={{ height: big ? 18 : 12, borderRadius: 999, background: T.todoSoft, overflow: 'hidden', position: 'relative' }}>
      <div style={{
        height: '100%', width: `${pct}%`, borderRadius: 999,
        background: `linear-gradient(90deg, ${color}, ${color}cc)`, transition: 'width .4s ease',
      }} />
      {big && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: pct > 55 ? '#fff' : T.ink, mixBlendMode: pct > 55 ? 'normal' : 'normal',
        }}>{pct}% klart</div>
      )}
    </div>
  )
}
