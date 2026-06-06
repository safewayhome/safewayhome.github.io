import { useMemo } from 'react'
import { T } from '../theme'
import { computeProgress, progressByCategory, progressByDifficulty } from '../util'

export default function Progress({ visibleTasks }) {
  const overall = useMemo(() => computeProgress(visibleTasks), [visibleTasks])
  const byDiff = useMemo(() => progressByDifficulty(visibleTasks), [visibleTasks])
  // bara områden som faktiskt har synliga uppgifter (respekterar toppfiltren)
  const byCat = useMemo(() => progressByCategory(visibleTasks).filter((r) => r.n > 0), [visibleTasks])

  const { done, n, counts } = overall

  return (
    <div style={{ height: '100%', overflow: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px 60px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.ink, margin: '0 0 4px' }}>📊 Hur långt har vi kommit?</h2>
        <p style={{ fontSize: 13.5, color: T.inkSoft, margin: '0 0 22px' }}>
          Antal utförda uppdrag av totalen — och hur långt vi kommit inom varje svårighetsgrad.
        </p>

        {/* huvud-progressbar: utförda uppdrag av totalen */}
        <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 18, padding: 22, boxShadow: T.shadowSoft, marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 52, fontWeight: 900, color: T.rose, lineHeight: 0.9 }}>{overall.pct}%</div>
            <div style={{ fontSize: 14, color: T.ink, fontWeight: 800, paddingBottom: 4 }}>
              {done} av {n} uppdrag klara
              <div style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700, marginTop: 2 }}>
                {counts.done} klara · {counts.doing} pågår · {counts.todo} kvar
              </div>
            </div>
          </div>
          <Bar big seg={overall} color={T.rose} />
        </div>

        {/* fyra svårighets-progressbars (en per färg) */}
        <h3 style={{ fontSize: 15, fontWeight: 800, color: T.ink, margin: '0 0 12px' }}>Per svårighetsgrad</h3>
        <div style={{ display: 'grid', gap: 12, marginBottom: 26 }}>
          {byDiff.map((row) => (
            <div key={row.diff.key} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '13px 16px', boxShadow: T.shadowSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 13, height: 13, borderRadius: 4, background: row.diff.color }} />
                <span style={{ fontWeight: 800, color: row.diff.text, fontSize: 14 }}>{row.diff.label}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{row.n ? `${row.pct}%` : '—'}</span>
              </div>
              <Bar seg={row} color={row.diff.color} />
              <div style={{ marginTop: 8, fontSize: 12, color: T.inkSoft, fontWeight: 700 }}>
                {row.n === 0 ? 'Inga uppdrag i den här graden' : `${row.done} av ${row.n} klara · ${row.counts.doing} pågår · ${row.counts.todo} kvar`}
              </div>
            </div>
          ))}
        </div>

        {/* narrativ — den mänskliga texten progressbaren hänger ihop med */}
        <div style={{ background: T.roseSoft, borderRadius: 16, padding: '18px 20px', marginBottom: 26, lineHeight: 1.65, fontSize: 14, color: T.ink }}>
          <b>Sammanfattning.</b> Teamet har gjort klart <b>{done} av {n}</b> uppdrag
          (<b>≈{overall.pct}%</b>).{' '}
          {counts.todo === 0 && counts.doing === 0
            ? 'Allt i nuvarande vy är klart — snyggt jobbat! 🎉'
            : <>Just nu pågår <b>{counts.doing}</b> uppdrag och <b>{counts.todo}</b> är ännu inte påbörjade.</>}
          {' '}Svårighetsgraden visar var den tyngsta jobbet finns:{' '}
          {byDiff.filter((r) => r.n > 0).map((r, i, arr) => (
            <span key={r.diff.key}>
              <b style={{ color: r.diff.text }}>{r.diff.label.toLowerCase()}</b> {r.done}/{r.n}{i < arr.length - 1 ? ', ' : '.'}
            </span>
          ))}
        </div>

        {/* per område (team) */}
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
              <Bar seg={row} color={row.cat.color} />
              <div style={{ marginTop: 9, fontSize: 12, color: T.inkSoft, fontWeight: 700 }}>
                {row.done} av {row.n} uppdrag klara · {row.counts.doing} pågår · {row.counts.todo} kvar
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 22, lineHeight: 1.5 }}>
          Hur det räknas: framstegen är rent <b>antal klara uppdrag delat med totalen</b> — en uppgift räknas
          som klar när dess status är <i>Klar</i>. Den ljusare delen av varje stapel visar uppdrag som <i>pågår</i>.
          Sätt en uppgifts status och svårighetsgrad i kortet för att uppdatera siffrorna.
        </p>
      </div>
    </div>
  )
}

// Stapel: solid fyllning = andel KLARA, ljusare påbyggnad = andel som PÅGÅR (resten = kvar).
function Bar({ seg, big, color = T.rose }) {
  const n = seg.n || 0
  const donePct = n > 0 ? (seg.counts.done / n) * 100 : 0
  const doingPct = n > 0 ? (seg.counts.doing / n) * 100 : 0
  return (
    <div style={{ height: big ? 18 : 12, borderRadius: 999, background: T.todoSoft, overflow: 'hidden', position: 'relative', display: 'flex' }}>
      <div style={{ width: `${donePct}%`, background: color, transition: 'width .4s ease' }} />
      <div style={{ width: `${doingPct}%`, background: color, opacity: 0.34, transition: 'width .4s ease' }} />
      {big && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: donePct > 55 ? '#fff' : T.ink,
        }}>{Math.round(donePct)}% klart</div>
      )}
    </div>
  )
}
