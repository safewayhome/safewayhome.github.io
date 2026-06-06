/**
 * Team Chat: flerspelarchatt med en molnhostad 3-stegs LLM-pipeline.
 *
 * Vyn har tre lägen som speglar säkerhetsmodellen:
 *   - laddar: vi vet ännu inte om det finns en session (undvik att blinka låsvyn först).
 *   - utloggad: en stilren LÅSVY med inloggningsknapp (chatten är privat för teamet, RLS spärrar allt).
 *   - inloggad: själva chattrummet (ChatRoom).
 *
 * ChatRoom monteras bara när man är inloggad -> dess effekter (starta realtime, hämta historik) körs
 * vid rätt tillfälle och städas vid utloggning. Forsknings-UI:t (pulserande glöd, framstegsindikator,
 * rullande tänkande-process) drivs av liveStore som SSE-strömmen från backend fyller på i realtid.
 *
 * Svaren renderas som riktig Markdown (react-markdown + GFM) så rubriker, tabeller, citat och kodblock
 * blir läsbara i stället för rå text.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { T } from '../theme'
import { useAuth } from '../store'
import { initials } from '../components/Avatar.jsx'
import {
  messagesStore, liveStore, sendMessage, startChat, stopChat, fetchUsers, colorForEmail,
} from '../chat'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export default function Chat({ onRequireLogin }) {
  const auth = useAuth()
  if (!auth.ready) return <Splash>Laddar…</Splash>
  if (!auth.user) return <LockView onLogin={onRequireLogin} />
  return <ChatRoom myEmail={auth.user.email} />
}

/* ───────────────────────────── Låsvy (utloggad) ───────────────────────────── */
function LockView({ onLogin }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: T.bg }}>
      <div style={{
        textAlign: 'center', background: T.panel, border: `1px solid ${T.line}`, borderRadius: 20,
        boxShadow: T.shadow, padding: '38px 40px', maxWidth: 420, animation: 'lm-fade-in .2s ease',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 999, margin: '0 auto 16px', display: 'grid', placeItems: 'center',
          background: `linear-gradient(135deg, ${T.roseSoft}, #fff)`, fontSize: 30, boxShadow: T.shadowSoft,
        }}>🔒</div>
        <div style={{ fontWeight: 800, fontSize: 20, color: T.ink, marginBottom: 6 }}>Team Chat är privat</div>
        <div style={{ fontSize: 13.5, color: T.inkSoft, lineHeight: 1.55, marginBottom: 22 }}>
          Chatten och AI-assistenten är bara för teamet. Logga in (eller skapa ett konto) så får du
          full tillgång: skriv, bifoga skärmdumpar och kör den sekventiella AI-pipelinen.
        </div>
        <button onClick={onLogin} style={{
          border: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 14.5,
          padding: '11px 22px', borderRadius: 12, boxShadow: T.shadowSoft,
        }}>🔓 Logga in</button>
      </div>
    </div>
  )
}

function Splash({ children }) {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: T.inkSoft, fontWeight: 700 }}>{children}</div>
}

/* ───────────────────────────── Chattrummet (inloggad) ───────────────────────────── */
function ChatRoom({ myEmail }) {
  const messages = useSyncExternalStore(messagesStore.subscribe, messagesStore.get)
  const live = useSyncExternalStore(liveStore.subscribe, liveStore.get)

  const [filter, setFilter] = useState('all')      // avsändar-filter ('all' eller en mejladress)
  const [accounts, setAccounts] = useState([])     // registrerade konton (via backend/GoTrue admin)
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const bottomRef = useRef(null)

  // Starta realtime + historik en gång; städa vid avmontering (utloggning byter ut hela vyn).
  useEffect(() => { startChat(); return () => stopChat() }, [])
  useEffect(() => { fetchUsers().then(setAccounts) }, [])

  // Avsändarlista i filtret: konton från auth UNION de som faktiskt skrivit (täcker båda fallen).
  const senders = useMemo(() => {
    const set = new Set(accounts)
    for (const m of messages) if (!m.is_ai && m.user_email) set.add(m.user_email)
    return [...set].sort()
  }, [accounts, messages])

  // Filtrera människors meddelanden; AI-svaren visas alltid så samtalet hänger ihop.
  const shown = useMemo(
    () => (filter === 'all' ? messages : messages.filter((m) => m.is_ai || m.user_email === filter)),
    [messages, filter],
  )

  // Rulla till botten när det kommer nytt (eller medan AI:n streamar).
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [shown.length, live.active, live.answer, live.thinking])

  async function onSend() {
    if (busy || (!text.trim() && !imageFile)) return
    setBusy(true); setErr('')
    const { error } = await sendMessage(text, imageFile)
    setBusy(false)
    if (error) { setErr(error.message || 'Kunde inte skicka.'); return }
    setText(''); setImageFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>
      {/* Rubrikrad + avsändar-filter */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: `1px solid ${T.line}`, background: T.panel,
      }}>
        <span style={{ fontSize: 18 }}>💬</span>
        <div style={{
          fontWeight: 800, fontSize: 15,
          background: `linear-gradient(90deg, ${T.roseDeep}, ${T.rose})`, WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>Team Chat</div>
        <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 600 }}>3-stegs AI-pipeline · realtid</span>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: T.inkSoft, fontWeight: 700 }}>Visa:</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{
          border: `1.5px solid ${T.line}`, borderRadius: 10, padding: '6px 10px', fontSize: 12.5,
          fontWeight: 700, color: T.ink, background: T.panel,
        }}>
          <option value="all">Alla ({senders.length})</option>
          {senders.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {/* Meddelanden */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 18px 8px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {shown.length === 0 && (
            <div style={{ textAlign: 'center', color: T.inkSoft, fontSize: 13.5, marginTop: 40, lineHeight: 1.6 }}>
              Inga meddelanden än. Ställ en fråga eller klistra in en skärmdump:<br />
              AI:n kör <b>Analys → Kodgenerering → Granskning</b> och svaret sparas för hela teamet.
            </div>
          )}
          {shown.map((m) => <Bubble key={m.id} m={m} mine={!m.is_ai && m.user_email === myEmail} />)}

          {/* Forsknings-UI medan kedjan kör */}
          {live.active && <ResearchPanel live={live} />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Inmatning */}
      <div style={{ borderTop: `1px solid ${T.line}`, background: T.panel, padding: '12px 18px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {err && <div style={{ fontSize: 12.5, color: T.roseDeep, marginBottom: 8 }}>{err}</div>}
          {imageFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, color: T.inkSoft, background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 8, padding: '4px 9px' }}>
                🖼️ {imageFile.name}
              </span>
              <button onClick={() => { setImageFile(null); if (fileRef.current) fileRef.current.value = '' }} style={{
                border: 'none', background: 'transparent', color: T.roseDeep, fontWeight: 800, fontSize: 12, cursor: 'pointer',
              }}>ta bort</button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <button onClick={() => fileRef.current?.click()} title="Bifoga skärmdump" style={{
              border: `1.5px solid ${T.line}`, background: T.panel, borderRadius: 12, padding: '10px 12px', fontSize: 16,
            }}>📎</button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
            <textarea
              value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Skriv ett meddelande till teamet och AI:n…"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
              style={{
                flex: 1, resize: 'none', maxHeight: 140, padding: '11px 13px', borderRadius: 12,
                border: `1.5px solid ${T.line}`, fontSize: 14.5, lineHeight: 1.4,
              }} />
            <button disabled={busy || (!text.trim() && !imageFile)} onClick={onSend} style={{
              border: 'none', background: (busy || (!text.trim() && !imageFile)) ? T.todo : T.rose, color: '#fff',
              fontWeight: 800, fontSize: 14, padding: '11px 18px', borderRadius: 12, boxShadow: T.shadowSoft,
            }}>{busy ? '…' : 'Skicka'}</button>
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 6 }}>
            Enter skickar · Shift+Enter ny rad · drivs av gratis-moln-modeller (OpenRouter + Gemini)
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── Meddelande-bubbla ───────────────────────────── */
function Bubble({ m, mine }) {
  const isAI = m.is_ai
  const name = isAI ? 'LedMig AI' : (m.user_email || 'okänd')
  const color = isAI ? T.rose : colorForEmail(m.user_email)
  const time = fmtTime(m.created_at)
  return (
    <div style={{ display: 'flex', gap: 10, margin: '12px 0', flexDirection: mine ? 'row-reverse' : 'row', animation: 'lm-fade-in .18s ease' }}>
      <div title={name} style={{
        flex: '0 0 auto', width: 34, height: 34, borderRadius: 999,
        background: isAI ? `linear-gradient(135deg, ${T.rose}, ${T.roseDeep})` : color, color: '#fff',
        display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
        boxShadow: isAI ? `0 0 0 3px ${T.roseSoft}` : T.shadowSoft,
      }}>{isAI ? '🤖' : (initials(name.split('@')[0]) || '?')}</div>
      <div style={{ maxWidth: '80%', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3, flexDirection: mine ? 'row-reverse' : 'row' }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: isAI ? T.roseDeep : T.ink }}>{isAI ? 'LedMig AI' : name.split('@')[0]}</span>
          <span style={{ fontSize: 10.5, color: T.inkSoft }}>{time}</span>
        </div>
        <div style={{
          background: isAI ? T.panel : (mine ? T.roseSoft : T.panelSoft),
          border: `1px solid ${isAI ? T.line : (mine ? T.rose + '55' : T.line)}`,
          borderRadius: 16, padding: '10px 14px', color: T.ink, fontSize: 14, lineHeight: 1.5,
          boxShadow: isAI ? T.shadowSoft : 'none', overflowWrap: 'anywhere',
        }}>
          {m.image_url && (
            <a href={m.image_url} target="_blank" rel="noreferrer">
              <img src={m.image_url} alt="bifogad bild" style={{ maxWidth: '100%', borderRadius: 10, marginBottom: m.message_text ? 8 : 0, display: 'block' }} />
            </a>
          )}
          {m.message_text && <Markdown text={m.message_text} />}
        </div>
      </div>
    </div>
  )
}

/* ─────────── Markdown-rendering (react-markdown + GFM), stylad mot paletten ─────────── */
const clean = ({ node, ...rest }) => rest   // react-markdown skickar med 'node' -> plocka bort från DOM-props

const MD = {
  h1: (p) => <h1 style={{ fontSize: 18, fontWeight: 800, color: T.ink, margin: '12px 0 6px' }} {...clean(p)} />,
  h2: (p) => <h2 style={{ fontSize: 16, fontWeight: 800, color: T.ink, margin: '12px 0 6px' }} {...clean(p)} />,
  h3: (p) => <h3 style={{ fontSize: 14.5, fontWeight: 800, color: T.ink, margin: '10px 0 5px' }} {...clean(p)} />,
  h4: (p) => <h4 style={{ fontSize: 13.5, fontWeight: 800, color: T.ink, margin: '8px 0 4px' }} {...clean(p)} />,
  p: (p) => <p style={{ margin: '6px 0', lineHeight: 1.55 }} {...clean(p)} />,
  strong: (p) => <strong style={{ fontWeight: 800, color: T.ink }} {...clean(p)} />,
  a: (p) => <a style={{ color: T.roseDeep, textDecoration: 'underline' }} target="_blank" rel="noreferrer" {...clean(p)} />,
  ul: (p) => <ul style={{ margin: '6px 0', paddingLeft: 20 }} {...clean(p)} />,
  ol: (p) => <ol style={{ margin: '6px 0', paddingLeft: 22 }} {...clean(p)} />,
  li: (p) => <li style={{ margin: '3px 0', lineHeight: 1.5 }} {...clean(p)} />,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${T.line}`, margin: '12px 0' }} />,
  blockquote: (p) => <blockquote style={{
    margin: '8px 0', padding: '6px 12px', borderLeft: `3px solid ${T.rose}`,
    background: T.roseSoft + '66', borderRadius: '0 8px 8px 0', color: T.inkSoft,
  }} {...clean(p)} />,
  pre: (p) => <pre style={{
    background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 12px',
    overflowX: 'auto', fontSize: 12.5, lineHeight: 1.45, margin: '8px 0', fontFamily: MONO,
  }} {...clean(p)} />,
  code: ({ node, className, children, ...rest }) => {
    const fenced = /language-/.test(className || '') || String(children).includes('\n')
    if (fenced) return <code className={className} style={{ fontFamily: MONO }} {...rest}>{children}</code>
    return <code style={{
      fontFamily: MONO, fontSize: 12.5, background: T.panelSoft, border: `1px solid ${T.line}`,
      borderRadius: 6, padding: '1px 5px',
    }} {...rest}>{children}</code>
  },
  table: (p) => <div style={{ overflowX: 'auto', margin: '8px 0' }}>
    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }} {...clean(p)} />
  </div>,
  th: (p) => <th style={{ border: `1px solid ${T.line}`, background: T.panelSoft, padding: '6px 10px', textAlign: 'left', fontWeight: 800 }} {...clean(p)} />,
  td: (p) => <td style={{ border: `1px solid ${T.line}`, padding: '6px 10px', verticalAlign: 'top' }} {...clean(p)} />,
}

function Markdown({ text }) {
  return (
    <div className="lm-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{String(text || '')}</ReactMarkdown>
    </div>
  )
}

/* ───────────────────────────── Forsknings-UI (under körning) ───────────────────────────── */
const STEPS = [
  { n: 1, label: 'Analys', glyph: '🧠' },
  { n: 2, label: 'Kodgenerering', glyph: '⚙️' },
  { n: 3, label: 'Granskning', glyph: '✨' },
]

function ResearchPanel({ live }) {
  const pct = Math.max(0, Math.min(100, Math.round(live.progress)))
  const thinkRef = useRef(null)
  // håll tänkande-rutan rullad till senaste tecknet (rinnande CoT)
  useEffect(() => { if (thinkRef.current) thinkRef.current.scrollTop = thinkRef.current.scrollHeight }, [live.thinking])
  const step = live.step || 1
  return (
    <div style={{
      margin: '16px 0', borderRadius: 18, background: T.panel, overflow: 'hidden',
      animation: 'lm-glow 2.4s ease-in-out infinite',
    }}>
      {/* vandrande gradient-accent i toppen */}
      <div style={{
        height: 4, background: `linear-gradient(90deg, ${T.rose}, ${T.roseDeep}, ${T.doing}, ${T.rose})`,
        backgroundSize: '200% 100%', animation: 'lm-flow 3s linear infinite',
      }} />

      {/* rubrik + steg-piller + modell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 8px' }}>
        <span style={{ fontSize: 16, animation: 'lm-pulse 1.4s ease-in-out infinite' }}>🤖</span>
        <span style={{ fontWeight: 800, fontSize: 13.5, color: T.ink }}>AI:n arbetar</span>
        <Dots />
        <div style={{ flex: 1 }} />
        {live.model && <span style={{ fontSize: 11, color: T.inkSoft, background: T.panelSoft, borderRadius: 999, padding: '3px 9px', border: `1px solid ${T.line}` }}>{live.model}</span>}
      </div>

      {/* steg-piller som fylls i takt med kedjan */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px' }}>
        {STEPS.map((s) => {
          const done = step > s.n
          const active = step === s.n
          return (
            <div key={s.n} style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 11,
              fontSize: 12, fontWeight: 800,
              background: done ? T.doneSoft : active ? T.roseSoft : T.panelSoft,
              color: done ? T.done : active ? T.roseDeep : T.inkSoft,
              border: `1px solid ${done ? T.done + '55' : active ? T.rose + '66' : T.line}`,
              animation: active ? 'lm-pulse 1.5s ease-in-out infinite' : 'none',
            }}>
              <span>{done ? '✓' : s.glyph}</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.n}. {s.label}</span>
            </div>
          )
        })}
      </div>

      {/* framstegsindikator */}
      <div style={{ padding: '0 16px 10px' }}>
        <div style={{ height: 9, borderRadius: 999, background: T.panelSoft, overflow: 'hidden' }}>
          <div style={{
            width: pct + '%', height: '100%', borderRadius: 999, transition: 'width .35s ease',
            background: `linear-gradient(90deg, ${T.rose}, ${T.roseDeep}, ${T.rose})`,
            backgroundSize: '200% 100%', animation: 'lm-shimmer 1.3s linear infinite',
          }} />
        </div>
        <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 5, fontWeight: 700 }}>{pct}% · {live.label || STEPS[step - 1]?.label}</div>
      </div>

      {/* rullande tänkande-process (chain of thought) */}
      {live.thinking && (
        <div style={{ padding: '4px 16px 10px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.inkSoft, marginBottom: 4, letterSpacing: 0.4, textTransform: 'uppercase' }}>💭 Tänkande-process</div>
          <div ref={thinkRef} style={{
            maxHeight: 150, overflowY: 'auto', background: T.panelSoft, border: `1px solid ${T.line}`,
            borderRadius: 10, padding: '9px 11px', fontSize: 12, lineHeight: 1.5, color: T.inkSoft,
            whiteSpace: 'pre-wrap', fontFamily: MONO,
          }}>{live.thinking}<Caret /></div>
        </div>
      )}

      {/* svaret medan det byggs (steg 3), nu som riktig markdown + skrivande-markör */}
      {live.answer && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.roseDeep, marginBottom: 4, letterSpacing: 0.4, textTransform: 'uppercase' }}>✨ Svar (skrivs…)</div>
          <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.5, color: T.ink, boxShadow: T.shadowSoft }}>
            <Markdown text={live.answer} /><Caret />
          </div>
        </div>
      )}

      {live.error && <div style={{ padding: '0 16px 12px', fontSize: 12, color: T.roseDeep }}>{live.error}</div>}
    </div>
  )
}

function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: 999, background: T.rose,
          animation: 'lm-blink 1s infinite', animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </span>
  )
}

// Blinkande textmarkör som ger känslan av att texten skrivs i realtid.
function Caret() {
  return <span style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 1, background: T.rose, verticalAlign: 'text-bottom', borderRadius: 1, animation: 'lm-caret 1s steps(1) infinite' }} />
}

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
