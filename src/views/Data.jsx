import { useEffect, useState } from 'react'
import { T } from '../theme'

// Det publika trygghetsdatasetet byggs av llm_training/build_training_dataset.py (--public-out)
// och läggs i team-board/public/data/. Vite serverar public/ från sajtens ROT, så den live-URL:en
// blir /data/... (inte /public/data/...). BASE_URL gör länken korrekt oavsett bas ('/' för rot-sajt).
const DATASET_URL = `${import.meta.env.BASE_URL}data/ledmig_incident_dataset.json`

export default function Data() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  useEffect(() => {
    let alive = true
    fetch(DATASET_URL, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => alive && setState({ status: 'ok', data, error: null }))
      .catch((error) => alive && setState({ status: 'error', data: null, error: String(error) }))
    return () => { alive = false }
  }, [])

  const { status, data, error } = state
  const examples = Array.isArray(data?.examples) ? data.examples : []

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* Hero */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 30 }}>🛰️</span>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink }}>Trygghetsdata</h1>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: T.inkSoft, margin: '0 0 22px', maxWidth: 640 }}>
          Här kan teamet och kompisarna se den trygghetsdata vi samlat in från lagliga, anonymiserade
          källor (Polisens öppna API + SVT:s publika RSS). Den utgör <strong>AI-träningsunderlaget</strong> för
          LedMigs lokala trygghetsmodell — modellen bedömer <em>områden och tidpunkter</em>, aldrig enskilda personer.
        </p>

        {/* Primär länk */}
        <div style={{
          background: T.panel, border: `1px solid ${T.line}`, borderRadius: T.radius,
          boxShadow: T.shadowSoft, padding: 20, marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: T.ink, marginBottom: 4 }}>
              Se insamlad trygghetsdata (AI-träningsunderlag)
            </div>
            <div style={{ fontSize: 13, color: T.inkSoft }}>
              {status === 'ok'
                ? `${data.count ?? examples.length} exempel · uppdaterat ${fmtDate(data.generated_at)}`
                : status === 'loading' ? 'Laddar dataset…' : 'Datasetfilen kunde inte läsas in just nu.'}
            </div>
          </div>
          <a href={DATASET_URL} target="_blank" rel="noopener noreferrer" style={{
            textDecoration: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 14,
            padding: '11px 18px', borderRadius: 12, boxShadow: T.shadowSoft, whiteSpace: 'nowrap',
          }}>📂 Öppna datasetet ↗</a>
        </div>

        {status === 'error' && (
          <div style={{
            background: T.roseSoft, border: `1px solid ${T.rose}55`, borderRadius: 12,
            padding: '12px 16px', color: T.ink, fontSize: 13.5, marginBottom: 24,
          }}>
            Kunde inte läsa in <code>{DATASET_URL}</code> ({error}). Filen publiceras vid nästa bygge —
            du kan ändå öppna den direkt via knappen ovan när den finns.
          </div>
        )}

        {status === 'ok' && (
          <>
            {/* Metadata / proveniens */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
              <Stat label="Exempel" value={data.count ?? examples.length} />
              <Stat label="Källor" value={(data.sources || []).join(' + ') || '—'} />
              <Stat label="Uppdaterat" value={fmtDate(data.generated_at)} />
            </div>

            {data.license_ethics && (
              <div style={{
                background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12,
                padding: '12px 16px', fontSize: 13, color: T.inkSoft, lineHeight: 1.55, marginBottom: 28,
              }}>
                <strong style={{ color: T.ink }}>Etik & juridik:</strong> {data.license_ethics}
              </div>
            )}

            {/* Smakprov */}
            <div style={{ fontWeight: 800, fontSize: 15, color: T.ink, marginBottom: 12 }}>
              Smakprov ur datasetet
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {examples.slice(0, 4).map((ex, i) => (
                <Sample key={i} ex={ex} />
              ))}
            </div>
            {examples.length > 4 && (
              <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 14 }}>
                …och {examples.length - 4} exempel till — öppna datasetet för allt.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, boxShadow: T.shadowSoft,
      padding: '12px 16px', minWidth: 0, flex: '1 1 160px',
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: T.inkSoft, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginTop: 3 }}>{value}</div>
    </div>
  )
}

function Sample({ ex }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: T.shadowSoft, padding: 16,
    }}>
      {ex.input && (
        <pre style={{
          margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: T.font,
          fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5,
        }}>{ex.input}</pre>
      )}
      {ex.expected_output && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${T.line}`,
          fontSize: 13.5, color: T.ink, lineHeight: 1.55,
        }}>
          <span style={{ fontWeight: 800, color: T.roseDeep }}>Bedömning: </span>{ex.expected_output}
        </div>
      )}
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}
