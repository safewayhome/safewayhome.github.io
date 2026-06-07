import { useEffect, useMemo, useState } from 'react'
import { T } from '../theme'
import { computeProgress, progressByCategory, progressByDifficulty, ago } from '../util'
import { SYSTEM_DESC } from '../changelogData'
import { API_BASE } from '../chat'

// Visas tills GitHub-statistiken hämtats: de tre utvecklarna med nollor (så sektionen aldrig är tom).
const DEV_PLACEHOLDER = [
  { name: 'Tobias', commits: 0, net_lines: 0, last_active: 0 },
  { name: 'Max', commits: 0, net_lines: 0, last_active: 0 },
  { name: 'Hampus', commits: 0, net_lines: 0, last_active: 0 },
]
const fmtInt = (n) => (Number(n) || 0).toLocaleString('sv-SE')   // tusentalsavgränsning: 3 450

export default function Progress({ visibleTasks }) {
  const overall = useMemo(() => computeProgress(visibleTasks), [visibleTasks])
  const byDiff = useMemo(() => progressByDifficulty(visibleTasks), [visibleTasks])
  // bara områden som faktiskt har synliga uppgifter (respekterar toppfiltren)
  const byCat = useMemo(() => progressByCategory(visibleTasks).filter((r) => r.n > 0), [visibleTasks])

  const { done, n, counts } = overall

  // GitHub-bidrag per utvecklare (commits + nettorader kod) från FastAPI-backenden (15-min cachad där).
  const [gh, setGh] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/dev/github-stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setGh(d) })
      .catch(() => { /* mjuk degradering: behåll placeholder */ })
      .finally(() => { if (alive) setLoading(false) })   // sluta visa "Hämtar…" även om anropet misslyckas
    return () => { alive = false }
  }, [])
  const devs = (gh && Array.isArray(gh.devs) && gh.devs.length) ? gh.devs : DEV_PLACEHOLDER

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

        {/* Vad är LedMig? — den mänskliga beskrivningen i stället för en torr sifferrad */}
        <div style={{ background: T.roseSoft, borderRadius: 16, padding: '20px 22px', marginBottom: 26 }}>
          <div style={{ fontSize: 16.5, fontWeight: 900, color: T.ink, lineHeight: 1.4, marginBottom: 12 }}>
            {SYSTEM_DESC.tagline}
          </div>
          {SYSTEM_DESC.paragraphs.map((p, i) => (
            <p key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: T.ink, margin: i ? '11px 0 0' : 0 }}>{p}</p>
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

        {/* Per utvecklare: GitHub-bidrag = commits + NETTORADER kod implementerat (aldrig "uppladdat":
            vi skriver kod, inte laddar upp filer). Datan kommer cachad från /api/dev/github-stats. */}
        <h3 style={{ fontSize: 15, fontWeight: 800, color: T.ink, margin: '26px 0 12px' }}>👥 Per utvecklare</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {devs.map((dev) => (
            <div key={dev.name} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '14px 16px', boxShadow: T.shadowSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 999, background: T.rose, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{(dev.name || '?')[0]}</span>
                <span style={{ fontWeight: 800, color: T.ink, fontSize: 14 }}>{dev.name}</span>
                <div style={{ flex: 1 }} />
                {dev.last_active ? <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 700 }}>senast aktiv {ago(dev.last_active * 1000)}</span> : null}
              </div>
              <div style={{ marginTop: 9, fontSize: 13.5, color: T.ink, fontWeight: 800 }}>
                {fmtInt(dev.commits)} commits : <span style={{ color: T.roseDeep }}>{fmtInt(dev.net_lines)} rader kod implementerat</span>
              </div>
            </div>
          ))}
        </div>
        {loading && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, fontWeight: 700 }}>Hämtar GitHub-statistik…</div>}
        {!loading && gh === null && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, fontWeight: 700 }}>Kunde inte hämta GitHub-statistik just nu.</div>}
        {!loading && gh && gh.computing && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, fontWeight: 700 }}>GitHub beräknar statistiken just nu, ladda om sidan om en liten stund.</div>}

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
