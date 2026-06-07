import { useEffect, useMemo, useState } from 'react'
import { T, DIFFICULTIES } from '../theme'
import { computeProgress, progressByCategory, progressByDifficulty, ago, diffKey } from '../util'
import { SYSTEM_DESC } from '../changelogData'
import { API_BASE } from '../chat'

// Visas tills GitHub-statistiken hämtats: de tre utvecklarna med nollor (så sektionen aldrig är tom).
const DEV_PLACEHOLDER = [
  { name: 'Tobias', commits: 0, net_lines: 0, last_active: 0 },
  { name: 'Max', commits: 0, net_lines: 0, last_active: 0 },
  { name: 'Hampus', commits: 0, net_lines: 0, last_active: 0 },
]
const fmtInt = (n) => (Number(n) || 0).toLocaleString('sv-SE')   // tusentalsavgränsning: 3 450
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

// En commit-rad: kort SHA-bricka · nedkokad ämnesrad · (ev. författare) · relativ tid.
// showAuthor=false i per-utvecklar-listan (det är redan den utvecklaren), true i den globala listan.
function CommitRow({ c, showAuthor }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 12, background: T.panel,
      border: `1px solid ${T.line}`, borderRadius: 12, padding: '10px 14px', boxShadow: T.shadowSoft,
    }}>
      <span style={{
        flex: '0 0 auto', fontFamily: MONO, fontSize: 11, color: T.roseDeep,
        background: T.roseSoft, border: `1px solid ${T.rose}33`, borderRadius: 6, padding: '2px 7px',
      }}>{c.sha}</span>
      <span style={{ flex: 1, fontSize: 13, color: T.ink, fontWeight: 600, overflowWrap: 'anywhere' }}>{c.summary}</span>
      <span style={{ flex: '0 0 auto', fontSize: 11.5, color: T.inkSoft, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {showAuthor && c.author ? c.author : ''}{showAuthor && c.author && c.date ? ' · ' : ''}{c.date ? ago(new Date(c.date).getTime()) : ''}
      </span>
    </div>
  )
}

// Commit-lista som en TIDSLINJE: en pulserande "gång" (animerad räls, .lm-commit-rail) löper mellan
// commit-noderna (.lm-commit-node pulserar) så historiken känns levande. Återanvänder CommitRow för korten.
function CommitTimeline({ items, showAuthor }) {
  return (
    <div style={{ position: 'relative', display: 'grid', gap: 8 }}>
      {/* den pulserande gången: en kontinuerlig flödande linje från första till sista noden */}
      {items.length > 1 && (
        <div className="lm-commit-rail" style={{ position: 'absolute', left: 8, top: 18, bottom: 18, width: 2, borderRadius: 2 }} />
      )}
      {items.map((c, i) => (
        <div key={`${c.sha}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, position: 'relative' }}>
          <span className="lm-commit-node" style={{
            flex: '0 0 auto', marginTop: 13, marginLeft: 3, width: 11, height: 11, borderRadius: 999,
            background: T.rose, border: '2px solid #fff', zIndex: 1,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}><CommitRow c={c} showAuthor={showAuthor} /></div>
        </div>
      ))}
    </div>
  )
}

export default function Progress({ tasks, visibleTasks }) {
  const overall = useMemo(() => computeProgress(visibleTasks), [visibleTasks])
  const byDiff = useMemo(() => progressByDifficulty(visibleTasks), [visibleTasks])
  // bara områden som faktiskt har synliga uppgifter (respekterar toppfiltren)
  const byCat = useMemo(() => progressByCategory(visibleTasks).filter((r) => r.n > 0), [visibleTasks])

  const { done, n, counts } = overall

  // ── GitHub-bidrag per utvecklare (commits + nettorader kod) ──
  // github-stats bygger på GitHubs /stats/contributors, som svarar 202 medan den beräknas och
  // åter-triggas av varje push. Vi POLLAR därför tills den är klar (max ~7 försök ≈ 50 s) så att
  // siffrorna dyker upp av sig själva utan manuell omladdning.
  const [gh, setGh] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    let tries = 0
    let timer = null
    const load = () => {
      fetch(`${API_BASE}/api/dev/github-stats`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return
          setGh(d)
          if (d && d.computing && tries < 7) {   // GitHub räknar fortfarande -> försök igen strax
            tries += 1
            timer = setTimeout(load, 7000)
          }
        })
        .catch(() => { /* mjuk degradering: behåll placeholder */ })
        .finally(() => { if (alive) setLoading(false) })
    }
    load()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  // Commit-historiken hämtas DIREKT (inte lazy): den ligger utrullad, driver per-utvecklar-listorna
  // och är en robust reserv för commit-ANTALET medan stats-beräkningen (/stats/contributors) släpar.
  const [commits, setCommits] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/dev/github-commits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setCommits(d && Array.isArray(d.commits) ? d.commits : []) })
      .catch(() => { if (alive) setCommits([]) })
    return () => { alive = false }
  }, [])

  // Vilken utvecklares commits som är utfällda (en i taget). null = ingen.
  const [openDev, setOpenDev] = useState(null)

  // Gruppera commits per utvecklarnamn: används av "Visa commits" och som robust antal när stats släpar.
  const commitsByDev = useMemo(() => {
    const m = {}
    for (const c of (commits || [])) (m[c.author] = m[c.author] || []).push(c)
    return m
  }, [commits])

  const statsDevs = (gh && Array.isArray(gh.devs) && gh.devs.length) ? gh.devs : DEV_PLACEHOLDER
  // Slå ihop källorna: commit-antalet tas som det STÖRSTA av stats och den hämtade listräkningen, så
  // det laddar direkt även medan GitHub räknar stats. net_lines kommer bara från stats (enda aggregat).
  const devs = statsDevs.map((d) => ({
    ...d,
    commits: Math.max(Number(d.commits) || 0, (commitsByDev[d.name] || []).length),
  }))
  const linesPending = !!(gh && gh.computing)   // rader kod beräknas fortfarande av GitHub

  // Avklarade uppgifter per utvecklare, grupperade på svårighetsgrad (tavlans kort). En "done"-uppgift
  // tillskrivs den som senast rörde den (updatedBy), matchat mot utvecklarnamnet (skiftlägesokänsligt).
  // Detta ger korten "hur många Enkla/Medel/Svåra/Extremt svåra man klarat", färgat enligt kategoriseringen.
  const doneByDiff = useMemo(() => {
    const names = DEV_PLACEHOLDER.map((d) => d.name)
    const m = {}
    for (const t of (tasks || [])) {
      if (t.status !== 'done') continue
      const who = String(t.updatedBy || (t.createdBy && t.createdBy.name) || '').toLowerCase()
      const name = names.find((n) => who.includes(n.toLowerCase()))
      if (!name) continue
      const bucket = (m[name] = m[name] || {})
      const k = diffKey(t)
      bucket[k] = (bucket[k] || 0) + 1
    }
    return m
  }, [tasks])

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
            vi skriver kod, inte laddar upp filer). Varje kort har en "Visa commits"-knapp som fäller ut
            just den utvecklarens commits. Datan: /api/dev/github-stats (rader) + github-commits (lista). */}
        <h3 style={{ fontSize: 15, fontWeight: 800, color: T.ink, margin: '26px 0 12px' }}>👥 Per utvecklare</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {devs.map((dev) => {
            const devCommits = commitsByDev[dev.name] || []
            const isOpen = openDev === dev.name
            return (
              <div key={dev.name} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '14px 16px', boxShadow: T.shadowSoft }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 999, background: T.rose, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{(dev.name || '?')[0]}</span>
                  <span style={{ fontWeight: 800, color: T.ink, fontSize: 14 }}>{dev.name}</span>
                  <div style={{ flex: 1 }} />
                  {dev.last_active ? <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 700 }}>senast aktiv {ago(dev.last_active * 1000)}</span> : null}
                </div>
                <div style={{ marginTop: 9, fontSize: 13.5, color: T.ink, fontWeight: 800 }}>
                  {fmtInt(dev.commits)} commits : <span style={{ color: T.roseDeep }}>{fmtInt(dev.net_lines)} rader kod implementerat</span>
                  {linesPending ? <span style={{ marginLeft: 8, fontSize: 11.5, color: T.inkSoft, fontWeight: 700 }}>(rader beräknas…)</span> : null}
                </div>
                {/* Avklarade uppgifter per svårighetsgrad (tavlans kategorisering), färgkodat: hur många
                    Enkla/Medel/Svåra/Extremt svåra den här utvecklaren har klarat. */}
                {(() => {
                  const bd = doneByDiff[dev.name] || {}
                  const total = DIFFICULTIES.reduce((s, d) => s + (bd[d.key] || 0), 0)
                  return (
                    <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 700 }}>Avklarat:</span>
                      {total === 0
                        ? <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 700 }}>inga uppgifter ännu</span>
                        : DIFFICULTIES.filter((d) => bd[d.key]).map((d) => (
                            <span key={d.key} title={d.label} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 800,
                              background: d.soft, color: d.text, border: `1px solid ${d.color}55`, borderRadius: 999, padding: '3px 9px',
                            }}>
                              <span>{d.glyph}</span>{bd[d.key]} {d.label}
                            </span>
                          ))}
                    </div>
                  )
                })()}
                {/* Per-utvecklar-knapp: fäller ut JUST den här utvecklarens commits (en i taget). */}
                {devCommits.length > 0 && (
                  <>
                    <button
                      onClick={() => setOpenDev(isOpen ? null : dev.name)}
                      aria-expanded={isOpen}
                      style={{
                        marginTop: 11, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                        background: T.roseSoft, border: `1px solid ${T.rose}33`, borderRadius: 999, padding: '6px 13px',
                        fontSize: 12.5, fontWeight: 800, color: T.roseDeep,
                      }}
                    >
                      <span style={{ fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
                      {isOpen ? 'Dölj commits' : `Visa commits (${devCommits.length})`}
                    </button>
                    {isOpen && (
                      <div style={{ marginTop: 10 }}>
                        <CommitTimeline items={devCommits} showAuthor={false} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        {loading && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, fontWeight: 700 }}>Hämtar GitHub-statistik…</div>}
        {!loading && gh === null && <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, fontWeight: 700 }}>Kunde inte hämta GitHub-statistik just nu.</div>}

        {/* Hela commit-historiken: ligger UTRULLAD (ingen toggle). Hämtas direkt vid sidladdning;
            varje commit är nedkokad till sin ämnesrad i backenden. */}
        <h3 style={{ fontSize: 15, fontWeight: 800, color: T.ink, margin: '26px 0 12px' }}>📜 Commit-historik</h3>
        <div style={{ display: 'grid', gap: 7 }}>
          {commits === null && <div style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700 }}>Hämtar commit-historik…</div>}
          {commits && commits.length === 0 && <div style={{ fontSize: 12.5, color: T.inkSoft, fontWeight: 700 }}>Ingen commit-historik tillgänglig just nu.</div>}
          {commits && commits.length > 0 && <CommitTimeline items={commits} showAuthor />}
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
