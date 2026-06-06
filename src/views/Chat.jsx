/**
 * Team Chat: flerspelarchatt med en molnhostad 3-stegs LLM-pipeline.
 *
 * Vyn har tre lägen som speglar säkerhetsmodellen:
 *   - laddar: vi vet ännu inte om det finns en session (undvik att blinka låsvyn först).
 *   - utloggad: en stilren LÅSVY med inloggningsknapp (chatten är privat för teamet, RLS spärrar allt).
 *   - inloggad: själva chattrummet (ChatRoom).
 *
 * ChatRoom monteras bara när man är inloggad -> dess effekter (starta realtime, hämta historik) körs
 * vid rätt tillfälle och städas vid utloggning. Forsknings-UI:t (pulsande yta, framstegsindikator,
 * rullande tänkande-process) drivs av liveStore som SSE-strömmen från backend fyller på i realtid.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { T } from '../theme'
import { useAuth } from '../store'
import { initials } from '../components/Avatar.jsx'
import {
  messagesStore, liveStore, sendMessage, startChat, stopChat, fetchUsers, colorForEmail,
} from '../chat'

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
          background: T.roseSoft, fontSize: 30,
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
        <div style={{ fontWeight: 800, fontSize: 15, color: T.ink }}>Team Chat</div>
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
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
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
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
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
    <div style={{ display: 'flex', gap: 10, margin: '10px 0', flexDirection: mine ? 'row-reverse' : 'row', animation: 'lm-fade-in .15s ease' }}>
      <div title={name} style={{
        flex: '0 0 auto', width: 32, height: 32, borderRadius: 999, background: color, color: '#fff',
        display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12,
      }}>{isAI ? '🤖' : (initials(name.split('@')[0]) || '?')}</div>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3, flexDirection: mine ? 'row-reverse' : 'row' }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: isAI ? T.roseDeep : T.ink }}>{isAI ? 'LedMig AI' : name.split('@')[0]}</span>
          <span style={{ fontSize: 10.5, color: T.inkSoft }}>{time}</span>
        </div>
        <div style={{
          background: isAI ? T.panel : (mine ? T.roseSoft : T.panelSoft),
          border: `1px solid ${isAI ? T.line : (mine ? T.rose + '55' : T.line)}`,
          borderRadius: 14, padding: '9px 13px', color: T.ink, fontSize: 14, lineHeight: 1.5,
        }}>
          {m.image_url && (
            <a href={m.image_url} target="_blank" rel="noreferrer">
              <img src={m.image_url} alt="bifogad bild" style={{ maxWidth: '100%', borderRadius: 10, marginBottom: m.message_text ? 8 : 0, display: 'block' }} />
            </a>
          )}
          {m.message_text && <MessageText text={m.message_text} />}
        </div>
      </div>
    </div>
  )
}

// Minimal markdown: dela på ```-block. Fenced -> monospace-block, övrigt -> radbrytande text.
function MessageText({ text }) {
  const parts = String(text || '').split(/```/)
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1
        ? <pre key={i} style={{
            background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 12px',
            overflowX: 'auto', fontSize: 12.5, lineHeight: 1.45, margin: '6px 0',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>{p.replace(/^[a-zA-Z0-9+#.-]*\n/, '')}</pre>
        : <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</span>))}
    </>
  )
}

/* ───────────────────────────── Forsknings-UI (under körning) ───────────────────────────── */
const STEP_LABELS = ['Analys & arkitektur', 'Kodgenerering', 'Kvalitetsgranskning']

function ResearchPanel({ live }) {
  const pct = Math.max(0, Math.min(100, Math.round(live.progress)))
  const thinkRef = useRef(null)
  // håll tänkande-rutan rullad till senaste tecknet (rinnande CoT)
  useEffect(() => { if (thinkRef.current) thinkRef.current.scrollTop = thinkRef.current.scrollHeight }, [live.thinking])
  return (
    <div style={{
      margin: '14px 0', border: `1.5px solid ${T.rose}44`, borderRadius: 16, background: T.panel,
      boxShadow: T.shadowSoft, overflow: 'hidden', animation: 'lm-pulse 1.8s ease-in-out infinite',
    }}>
      {/* rubrik + steg */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px 8px' }}>
        <span style={{ fontSize: 15 }}>🤖</span>
        <span style={{ fontWeight: 800, fontSize: 13, color: T.ink }}>AI:n arbetar</span>
        <Dots />
        <div style={{ flex: 1 }} />
        {live.model && <span style={{ fontSize: 11, color: T.inkSoft, background: T.panelSoft, borderRadius: 999, padding: '3px 9px', border: `1px solid ${T.line}` }}>{live.model}</span>}
      </div>

      {/* framstegsindikator med tre etiketter */}
      <div style={{ padding: '0 14px 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700, color: T.inkSoft, marginBottom: 5 }}>
          {STEP_LABELS.map((l, i) => (
            <span key={l} style={{ color: live.step >= i + 1 ? T.roseDeep : T.inkSoft }}>
              {i + 1}. {l} {Math.round(((i + 1) / 3) * 100)}%
            </span>
          ))}
        </div>
        <div style={{ height: 8, borderRadius: 999, background: T.panelSoft, overflow: 'hidden' }}>
          <div style={{
            width: pct + '%', height: '100%', borderRadius: 999, transition: 'width .35s ease',
            background: `linear-gradient(90deg, ${T.rose}, ${T.roseDeep}, ${T.rose})`,
            backgroundSize: '200% 100%', animation: 'lm-shimmer 1.3s linear infinite',
          }} />
        </div>
        <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 5, fontWeight: 700 }}>
          Steg {live.step || 1}/3 · {live.label || STEP_LABELS[(live.step || 1) - 1]} · {pct}%
        </div>
      </div>

      {/* rullande tänkande-process (chain of thought) */}
      {live.thinking && (
        <div style={{ padding: '6px 14px 10px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.inkSoft, marginBottom: 4, letterSpacing: 0.3, textTransform: 'uppercase' }}>Tänkande-process</div>
          <div ref={thinkRef} style={{
            maxHeight: 150, overflowY: 'auto', background: T.panelSoft, border: `1px solid ${T.line}`,
            borderRadius: 10, padding: '9px 11px', fontSize: 12, lineHeight: 1.5, color: T.inkSoft,
            whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>{live.thinking}</div>
        </div>
      )}

      {/* svaret medan det byggs (steg 3) */}
      {live.answer && (
        <div style={{ padding: '0 14px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.roseDeep, marginBottom: 4, letterSpacing: 0.3, textTransform: 'uppercase' }}>Svar (skrivs…)</div>
          <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: '9px 11px', fontSize: 13.5, lineHeight: 1.5, color: T.ink }}>
            <MessageText text={live.answer} />
          </div>
        </div>
      )}

      {live.error && <div style={{ padding: '0 14px 12px', fontSize: 12, color: T.roseDeep }}>{live.error}</div>}
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

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
