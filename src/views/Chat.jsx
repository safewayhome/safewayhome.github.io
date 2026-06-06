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
 *
 * PREMIUM-PASS (endast presentation, logiken orörd): frostade glas-ytor, mjukt djup, sammanhållen
 * rose/gräddvit-palett från theme.js, geometriskt AI-märke och smakfull "levande" rörelse medan
 * pipelinen kör. Nya @keyframes ligger i index.css (lm-rise, lm-breathe, lm-sheen, lm-ring).
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

// Frostat glas-recept — återanvänds på header, inmatningsdocka, forsknings-kort och bubblor.
const GLASS = {
  background: 'rgba(255,255,255,0.66)',
  backdropFilter: 'blur(22px) saturate(150%)',
  WebkitBackdropFilter: 'blur(22px) saturate(150%)',
}
// Mjukt, exklusivt djup utan att bli tungt.
const LIFT = '0 1px 0 rgba(255,255,255,0.7) inset, 0 10px 30px -12px rgba(63,54,64,0.22)'
const LIFT_SOFT = '0 1px 0 rgba(255,255,255,0.6) inset, 0 6px 18px -10px rgba(63,54,64,0.18)'

export default function Chat({ onRequireLogin }) {
  const auth = useAuth()
  if (!auth.ready) return <Splash>Laddar…</Splash>
  if (!auth.user) return <LockView onLogin={onRequireLogin} />
  return <ChatRoom myEmail={auth.user.email} />
}

/* ───────────────────────────── Geometriskt AI-märke ───────────────────────────── */
// Märkesform i stället för robot-emoji: en rose-gradient-"squircle" med en ljus diamant i mitten.
// active=true lägger till en långsamt roterande konisk glödring (när AI:n arbetar).
function BrandMark({ size = 34, active = false }) {
  const r = Math.round(size * 0.34)
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      {active && (
        <span style={{
          position: 'absolute', inset: -3, borderRadius: r + 4,
          background: `conic-gradient(from 0deg, ${T.rose}, ${T.roseDeep}, ${T.doing}, ${T.rose})`,
          filter: 'blur(2px)', opacity: 0.85, animation: 'lm-ring 2.6s linear infinite',
        }} />
      )}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: r, display: 'grid', placeItems: 'center',
        background: `linear-gradient(150deg, ${T.rose}, ${T.roseDeep})`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 6px 16px -6px rgba(225,29,72,0.5)',
        animation: active ? 'lm-breathe 2.6s ease-in-out infinite' : 'none',
      }}>
        <div style={{
          width: Math.round(size * 0.32), height: Math.round(size * 0.32),
          transform: 'rotate(45deg)', borderRadius: Math.round(size * 0.09),
          background: 'rgba(255,255,255,0.96)',
          boxShadow: '0 0 0 2px rgba(255,255,255,0.22)',
        }} />
      </div>
    </div>
  )
}

/* ───────────────────────────── Låsvy (utloggad) ───────────────────────────── */
function LockView({ onLogin }) {
  return (
    <div style={{ position: 'relative', height: '100%', display: 'grid', placeItems: 'center', background: T.bg, overflow: 'hidden' }}>
      <Aurora />
      <div style={{
        position: 'relative', textAlign: 'center', borderRadius: 26, padding: '44px 44px 40px', maxWidth: 440,
        border: `1px solid rgba(255,255,255,0.7)`, boxShadow: LIFT, animation: 'lm-rise .4s cubic-bezier(.2,.7,.2,1)',
        ...GLASS,
      }}>
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 18 }}>
          <div style={{
            position: 'relative', width: 72, height: 72, borderRadius: 22, display: 'grid', placeItems: 'center',
            background: `linear-gradient(150deg, ${T.rose}, ${T.roseDeep})`, fontSize: 30, color: '#fff',
            boxShadow: '0 12px 28px -10px rgba(225,29,72,0.55), inset 0 1px 0 rgba(255,255,255,0.4)',
          }}>🔒</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, color: T.ink, marginBottom: 8, letterSpacing: -0.3 }}>Team Chat är privat</div>
        <div style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.6, marginBottom: 26 }}>
          Chatten och AI-assistenten är bara för teamet. Logga in (eller skapa ett konto) så får du
          full tillgång: skriv, bifoga skärmdumpar och kör den sekventiella AI-pipelinen.
        </div>
        <button onClick={onLogin} style={{
          border: 'none', background: `linear-gradient(180deg, ${T.rose}, ${T.roseDeep})`, color: '#fff',
          fontWeight: 800, fontSize: 15, padding: '13px 26px', borderRadius: 14, cursor: 'pointer', whiteSpace: 'nowrap',
          boxShadow: '0 12px 26px -10px rgba(225,29,72,0.6), inset 0 1px 0 rgba(255,255,255,0.35)',
        }}>Logga in</button>
      </div>
    </div>
  )
}

function Splash({ children }) {
  return (
    <div style={{ position: 'relative', height: '100%', display: 'grid', placeItems: 'center', background: T.bg, overflow: 'hidden' }}>
      <Aurora />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, color: T.inkSoft, fontWeight: 700 }}>
        <BrandMark size={26} active />
        {children}
      </div>
    </div>
  )
}

// Subtil bakgrundsglöd (rose-bloom) — bara palettfärger på låg alfa, ger djup utan att krocka.
function Aurora() {
  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(60% 50% at 18% 8%, ${T.rose}22, transparent 70%),
                   radial-gradient(50% 45% at 92% 22%, ${T.roseDeep}14, transparent 70%),
                   radial-gradient(70% 60% at 60% 110%, ${T.doing}10, transparent 70%)`,
    }} />
  )
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
  const [focused, setFocused] = useState(false)
  const fileRef = useRef(null)
  const bottomRef = useRef(null)
  const taRef = useRef(null)

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

  // Auto-väx textarean (premium känsla, ingen scroll-hopp).
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [text])

  async function onSend() {
    if (busy || (!text.trim() && !imageFile)) return
    setBusy(true); setErr('')
    const { error } = await sendMessage(text, imageFile)
    setBusy(false)
    if (error) { setErr(error.message || 'Kunde inte skicka.'); return }
    setText(''); setImageFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const canSend = !busy && (text.trim() || imageFile)

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: T.bg, overflow: 'hidden' }}>
      <Aurora />

      {/* Rubrikrad + avsändar-filter (frostat glas, sticky-känsla) */}
      <div style={{
        position: 'relative', zIndex: 3, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, rowGap: 10, padding: '14px 22px',
        borderBottom: `1px solid rgba(236,226,220,0.8)`, boxShadow: '0 1px 0 rgba(255,255,255,0.6)', ...GLASS,
      }}>
        <BrandMark size={32} active={live.active} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '0 0 auto' }}>
          <div style={{
            fontWeight: 800, fontSize: 16, letterSpacing: -0.3, whiteSpace: 'nowrap',
            background: `linear-gradient(90deg, ${T.roseDeep}, ${T.rose})`, WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Team Chat</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: T.inkSoft, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: live.active ? T.doing : T.done,
              boxShadow: `0 0 0 3px ${(live.active ? T.doing : T.done)}22`,
              animation: live.active ? 'lm-pulse 1.4s ease-in-out infinite' : 'none',
            }} />
            {live.active ? 'AI-pipeline kör…' : '3-stegs AI-pipeline · realtid'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, color: T.inkSoft, fontWeight: 700 }}>Visa</label>
          <div style={{ position: 'relative' }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{
              appearance: 'none', WebkitAppearance: 'none', border: `1px solid ${T.line}`, borderRadius: 11,
              padding: '8px 30px 8px 12px', fontSize: 12.5, fontWeight: 700, color: T.ink,
              background: 'rgba(255,255,255,0.85)', cursor: 'pointer', boxShadow: LIFT_SOFT, maxWidth: 200,
            }}>
              <option value="all">Alla ({senders.length})</option>
              {senders.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.inkSoft, fontSize: 10 }}>▾</span>
          </div>
        </div>
      </div>

      {/* Meddelanden */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 20px 12px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {shown.length === 0 && <EmptyState />}
          {shown.map((m) => <Bubble key={m.id} m={m} mine={!m.is_ai && m.user_email === myEmail} />)}

          {/* Forsknings-UI medan kedjan kör */}
          {live.active && <ResearchPanel live={live} />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Inmatning (frostad docka) */}
      <div style={{
        position: 'relative', zIndex: 3, borderTop: `1px solid rgba(236,226,220,0.8)`,
        boxShadow: '0 -1px 0 rgba(255,255,255,0.6)', padding: '14px 20px 16px', ...GLASS,
      }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {err && (
            <div style={{
              fontSize: 12.5, color: T.roseDeep, marginBottom: 9, fontWeight: 700,
              background: T.roseSoft, border: `1px solid ${T.rose}44`, borderRadius: 10, padding: '7px 11px',
            }}>{err}</div>
          )}
          {imageFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: T.ink, fontWeight: 700,
                background: 'rgba(255,255,255,0.8)', border: `1px solid ${T.line}`, borderRadius: 10, padding: '6px 11px', boxShadow: LIFT_SOFT,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: T.rose }} /> {imageFile.name}
              </span>
              <button onClick={() => { setImageFile(null); if (fileRef.current) fileRef.current.value = '' }} style={{
                border: 'none', background: 'transparent', color: T.roseDeep, fontWeight: 800, fontSize: 12, cursor: 'pointer',
              }}>ta bort</button>
            </div>
          )}
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 10, padding: 7, borderRadius: 20,
            background: 'rgba(255,255,255,0.8)', border: `1.5px solid ${focused ? T.rose + '88' : T.line}`,
            boxShadow: focused ? `0 0 0 4px ${T.rose}1f, ${LIFT_SOFT}` : LIFT_SOFT, transition: 'border-color .2s, box-shadow .2s',
          }}>
            <button onClick={() => fileRef.current?.click()} title="Bifoga skärmdump" style={{
              flex: '0 0 auto', width: 42, height: 42, display: 'grid', placeItems: 'center',
              border: `1px solid ${T.line}`, background: 'rgba(255,255,255,0.9)', borderRadius: 14, fontSize: 17, cursor: 'pointer',
              color: T.inkSoft, transition: 'transform .15s, border-color .15s',
            }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.94)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >📎</button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
            <textarea
              ref={taRef}
              value={text} onChange={(e) => setText(e.target.value)} rows={1}
              placeholder="Skriv ett meddelande till teamet och AI:n…"
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
              style={{
                flex: 1, resize: 'none', maxHeight: 160, padding: '11px 6px', border: 'none', outline: 'none',
                background: 'transparent', fontSize: 14.5, lineHeight: 1.5, color: T.ink,
              }} />
            <button disabled={!canSend} onClick={onSend} style={{
              flex: '0 0 auto', border: 'none', color: '#fff', fontWeight: 800, fontSize: 14,
              height: 42, padding: '0 20px', borderRadius: 14, cursor: canSend ? 'pointer' : 'default',
              background: canSend ? `linear-gradient(180deg, ${T.rose}, ${T.roseDeep})` : T.todo,
              boxShadow: canSend ? '0 8px 18px -8px rgba(225,29,72,0.6), inset 0 1px 0 rgba(255,255,255,0.35)' : 'none',
              opacity: busy ? 0.8 : 1, transition: 'background .2s, box-shadow .2s, opacity .2s',
            }}>{busy ? '···' : 'Skicka'}</button>
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 9, textAlign: 'center' }}>
            <b style={{ color: T.ink }}>Enter</b> skickar · <b style={{ color: T.ink }}>Shift+Enter</b> ny rad · drivs av gratis-moln-modeller (OpenRouter + Gemini)
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', marginTop: 56, animation: 'lm-rise .5s ease' }}>
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 16 }}>
        <BrandMark size={56} />
      </div>
      <div style={{ fontWeight: 800, fontSize: 18, color: T.ink, letterSpacing: -0.3, marginBottom: 8 }}>Inga meddelanden än</div>
      <div style={{ color: T.inkSoft, fontSize: 14, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
        Ställ en fråga eller klistra in en skärmdump. AI:n kör
        <PipeChip>Analys</PipeChip><Arrow /><PipeChip>Kodgenerering</PipeChip><Arrow /><PipeChip>Granskning</PipeChip>
        och svaret sparas för hela teamet.
      </div>
    </div>
  )
}
function PipeChip({ children }) {
  return <span style={{
    display: 'inline-block', margin: '0 2px', padding: '2px 9px', borderRadius: 999, fontSize: 12, fontWeight: 800,
    color: T.roseDeep, background: T.roseSoft, border: `1px solid ${T.rose}44`,
  }}>{children}</span>
}
function Arrow() {
  return <span style={{ color: T.inkSoft, fontWeight: 800, margin: '0 1px' }}>→</span>
}

/* ───────────────────────────── Meddelande-bubbla ───────────────────────────── */
function Bubble({ m, mine }) {
  const isAI = m.is_ai
  const name = isAI ? 'LedMig AI' : (m.user_email || 'okänd')
  const color = isAI ? T.rose : colorForEmail(m.user_email)
  const time = fmtTime(m.created_at)

  // Bubbel-yta: AI = frostat vitt glas med lyft; jag = rose-soft; andra = rent vitt kort.
  const surface = isAI
    ? { ...GLASS, border: `1px solid rgba(255,255,255,0.7)`, boxShadow: LIFT_SOFT }
    : mine
      ? { background: `linear-gradient(180deg, #fff, ${T.roseSoft})`, border: `1px solid ${T.rose}55`, boxShadow: LIFT_SOFT }
      : { background: T.panel, border: `1px solid ${T.line}`, boxShadow: LIFT_SOFT }

  // Subtilt "riktad" hörn mot avataren (premium-detalj).
  const radius = mine ? '18px 6px 18px 18px' : '6px 18px 18px 18px'

  return (
    <div style={{ display: 'flex', gap: 11, margin: '14px 0', flexDirection: mine ? 'row-reverse' : 'row', animation: 'lm-rise .26s cubic-bezier(.2,.7,.2,1)' }}>
      {isAI
        ? <BrandMark size={36} />
        : <div title={name} style={{
            flex: '0 0 auto', width: 36, height: 36, borderRadius: 999,
            background: color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
            boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${color}55, 0 4px 10px -4px ${color}`,
          }}>{initials(name.split('@')[0]) || '?'}</div>}

      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5, padding: '0 4px', flexDirection: mine ? 'row-reverse' : 'row' }}>
          <span style={{ fontWeight: 800, fontSize: 12.5, color: isAI ? T.roseDeep : T.ink, letterSpacing: -0.1, whiteSpace: 'nowrap' }}>
            {isAI ? 'LedMig' : name.split('@')[0]}
          </span>
          {isAI && <span style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: T.roseDeep,
            background: T.roseSoft, border: `1px solid ${T.rose}44`, borderRadius: 999, padding: '1px 7px',
          }}>AI</span>}
          <span style={{ fontSize: 10.5, color: T.inkSoft }}>{time}</span>
        </div>
        <div style={{
          ...surface, borderRadius: radius, padding: '11px 15px', color: T.ink, fontSize: 14.5, lineHeight: 1.55,
          overflowWrap: 'anywhere',
        }}>
          {m.image_url && (
            <a href={m.image_url} target="_blank" rel="noreferrer">
              <img src={m.image_url} alt="bifogad bild" style={{ maxWidth: '100%', borderRadius: 12, marginBottom: m.message_text ? 9 : 0, display: 'block', boxShadow: LIFT_SOFT }} />
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
  h1: (p) => <h1 style={{ fontSize: 18, fontWeight: 800, color: T.ink, margin: '12px 0 6px', letterSpacing: -0.3 }} {...clean(p)} />,
  h2: (p) => <h2 style={{ fontSize: 16, fontWeight: 800, color: T.ink, margin: '12px 0 6px', letterSpacing: -0.2 }} {...clean(p)} />,
  h3: (p) => <h3 style={{ fontSize: 14.5, fontWeight: 800, color: T.ink, margin: '10px 0 5px' }} {...clean(p)} />,
  h4: (p) => <h4 style={{ fontSize: 13.5, fontWeight: 800, color: T.ink, margin: '8px 0 4px' }} {...clean(p)} />,
  p: (p) => <p style={{ margin: '6px 0', lineHeight: 1.6 }} {...clean(p)} />,
  strong: (p) => <strong style={{ fontWeight: 800, color: T.ink }} {...clean(p)} />,
  a: (p) => <a style={{ color: T.roseDeep, textDecoration: 'underline', textUnderlineOffset: 2 }} target="_blank" rel="noreferrer" {...clean(p)} />,
  ul: (p) => <ul style={{ margin: '6px 0', paddingLeft: 20 }} {...clean(p)} />,
  ol: (p) => <ol style={{ margin: '6px 0', paddingLeft: 22 }} {...clean(p)} />,
  li: (p) => <li style={{ margin: '3px 0', lineHeight: 1.55 }} {...clean(p)} />,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${T.line}`, margin: '12px 0' }} />,
  blockquote: (p) => <blockquote style={{
    margin: '8px 0', padding: '7px 14px', borderLeft: `3px solid ${T.rose}`,
    background: T.roseSoft + '88', borderRadius: '0 10px 10px 0', color: T.inkSoft,
  }} {...clean(p)} />,
  pre: (p) => <pre style={{
    background: '#fffaf8', border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px',
    overflowX: 'auto', fontSize: 12.5, lineHeight: 1.5, margin: '9px 0', fontFamily: MONO,
    boxShadow: 'inset 0 1px 3px rgba(63,54,64,0.04)',
  }} {...clean(p)} />,
  code: ({ node, className, children, ...rest }) => {
    const fenced = /language-/.test(className || '') || String(children).includes('\n')
    if (fenced) return <code className={className} style={{ fontFamily: MONO }} {...rest}>{children}</code>
    return <code style={{
      fontFamily: MONO, fontSize: 12.5, background: T.roseSoft + '99', border: `1px solid ${T.rose}33`,
      borderRadius: 6, padding: '1px 5px', color: T.roseDeep,
    }} {...rest}>{children}</code>
  },
  table: (p) => <div style={{ overflowX: 'auto', margin: '9px 0', borderRadius: 12, border: `1px solid ${T.line}`, boxShadow: LIFT_SOFT }}>
    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }} {...clean(p)} />
  </div>,
  th: (p) => <th style={{ borderBottom: `1px solid ${T.line}`, background: T.panelSoft, padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: T.ink }} {...clean(p)} />,
  td: (p) => <td style={{ borderTop: `1px solid ${T.line}`, padding: '8px 12px', verticalAlign: 'top' }} {...clean(p)} />,
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
      position: 'relative', margin: '20px 0', borderRadius: 20, overflow: 'hidden',
      border: `1px solid rgba(255,255,255,0.7)`, ...GLASS,
      boxShadow: LIFT, animation: 'lm-glow 2.6s ease-in-out infinite',
    }}>
      {/* vandrande gradient-accent i toppen */}
      <div style={{
        height: 3, background: `linear-gradient(90deg, ${T.rose}, ${T.roseDeep}, ${T.doing}, ${T.rose})`,
        backgroundSize: '200% 100%', animation: 'lm-flow 3s linear infinite',
      }} />
      {/* mjuk sken-svep över kortet */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 20,
      }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: '40%',
          background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent)',
          animation: 'lm-sheen 3.4s ease-in-out infinite',
        }} />
      </div>

      {/* rubrik + status + modell */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px 10px' }}>
        <BrandMark size={34} active />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: T.ink, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>AI:n arbetar</span>
            <Dots />
          </div>
          <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 600, whiteSpace: 'nowrap' }}>{live.label || STEPS[step - 1]?.label} · steg {Math.min(step, 3)} / 3</span>
        </div>
        <div style={{ flex: 1 }} />
        {live.model && <span style={{
          fontSize: 11, color: T.inkSoft, fontWeight: 700, background: 'rgba(255,255,255,0.75)',
          borderRadius: 999, padding: '4px 11px', border: `1px solid ${T.line}`, boxShadow: LIFT_SOFT,
        }}>{live.model}</span>}
      </div>

      {/* steg-piller som fylls i takt med kedjan (var och en med egen fyll-remsa) */}
      <div style={{ position: 'relative', display: 'flex', gap: 9, padding: '0 18px 12px' }}>
        {STEPS.map((s) => {
          const done = step > s.n
          const active = step === s.n
          const tone = done ? T.done : active ? T.roseDeep : T.inkSoft
          const fill = done ? '100%' : active ? Math.max(8, Math.min(100, ((pct - (s.n - 1) * 33) / 33) * 100)) + '%' : '0%'
          return (
            <div key={s.n} style={{
              position: 'relative', flex: 1, overflow: 'hidden',
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 13, fontSize: 12.5, fontWeight: 800,
              background: done ? T.doneSoft : active ? 'rgba(255,255,255,0.85)' : T.panelSoft,
              color: tone, border: `1px solid ${done ? T.done + '55' : active ? T.rose + '66' : T.line}`,
              boxShadow: active ? `0 0 0 3px ${T.rose}18` : 'none', transition: 'all .3s ease',
            }}>
              <span style={{
                flex: '0 0 auto', width: 20, height: 20, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 11,
                background: done ? T.done : active ? `linear-gradient(150deg, ${T.rose}, ${T.roseDeep})` : '#fff',
                color: (done || active) ? '#fff' : T.inkSoft, border: active || done ? 'none' : `1px solid ${T.line}`,
                boxShadow: active ? `0 2px 6px -2px ${T.roseDeep}` : 'none',
              }}>{done ? '✓' : s.n}</span>
              <span style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
              {/* fyll-remsa längst ner i steget */}
              <div style={{
                position: 'absolute', left: 0, bottom: 0, height: 3, width: fill,
                background: done ? T.done : `linear-gradient(90deg, ${T.rose}, ${T.roseDeep})`,
                backgroundSize: '200% 100%', animation: active ? 'lm-shimmer 1.3s linear infinite' : 'none',
                transition: 'width .4s ease', borderRadius: 999,
              }} />
            </div>
          )
        })}
      </div>

      {/* fin framstegsindikator */}
      <div style={{ position: 'relative', padding: '0 18px 12px' }}>
        <div style={{ height: 8, borderRadius: 999, background: T.panelSoft, overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(63,54,64,0.08)' }}>
          <div style={{
            width: pct + '%', height: '100%', borderRadius: 999, transition: 'width .35s ease',
            background: `linear-gradient(90deg, ${T.rose}, ${T.roseDeep}, ${T.rose})`,
            backgroundSize: '200% 100%', animation: 'lm-shimmer 1.3s linear infinite',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.inkSoft, marginTop: 6, fontWeight: 700 }}>
          <span>{live.label || STEPS[step - 1]?.label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: T.roseDeep }}>{pct}%</span>
        </div>
      </div>

      {/* rullande tänkande-process (chain of thought) */}
      {live.thinking && (
        <div style={{ position: 'relative', padding: '4px 18px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.inkSoft, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Tänkande-process</div>
          <div ref={thinkRef} style={{
            maxHeight: 150, overflowY: 'auto', background: 'rgba(251,243,239,0.8)', border: `1px solid ${T.line}`,
            borderRadius: 12, padding: '11px 13px', fontSize: 12, lineHeight: 1.55, color: T.inkSoft,
            whiteSpace: 'pre-wrap', fontFamily: MONO, boxShadow: 'inset 0 1px 3px rgba(63,54,64,0.04)',
          }}>{live.thinking}<Caret /></div>
        </div>
      )}

      {/* svaret medan det byggs (steg 3), som riktig markdown + skrivande-markör */}
      {live.answer && (
        <div style={{ position: 'relative', padding: '0 18px 16px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.roseDeep, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Svar · skrivs</div>
          <div style={{
            background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '12px 15px',
            fontSize: 14, lineHeight: 1.55, color: T.ink, boxShadow: LIFT_SOFT,
          }}>
            <Markdown text={live.answer} /><Caret />
          </div>
        </div>
      )}

      {live.error && (
        <div style={{ position: 'relative', padding: '0 18px 14px' }}>
          <div style={{ fontSize: 12.5, color: T.roseDeep, fontWeight: 700, background: T.roseSoft, border: `1px solid ${T.rose}44`, borderRadius: 10, padding: '8px 12px' }}>{live.error}</div>
        </div>
      )}
    </div>
  )
}

function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
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
  return <span style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 1, background: T.rose, verticalAlign: 'text-bottom', borderRadius: 2, animation: 'lm-caret 1s steps(1) infinite' }} />
}

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
