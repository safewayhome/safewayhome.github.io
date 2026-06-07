import { useRef, useState } from 'react'
import { submitInterview, validateInterview } from './interviews'

/* ───────────────────────── Ideell förening: /ideel ─────────────────────────
   En varm, respektfull och saklig undersida som ger röst åt "de tysta offren": unga kvinnors dolda
   otrygghet i vardagen. Sidan samlar in berättelser/intervjuer med samtycke, lyfter officiell BRÅ-data
   på ett lättsmält sätt och fungerar som en transparent brygga till den helt kostnadsfria appen LedMig.

   Estetik: projektets mörka natt-estetik (djup midnattsblå mot charcoal) med mjuka accenter i guld,
   roseguld och rosa, semi-transparenta kort och radiella ljus-auror. Tonen ska vara välkomnande, aldrig
   tung eller skrämmande. FORMAT: aldrig AI-tankestreck som separator, alltid kolon (:). */

// Mörk lokal palett (sidan är fristående från tavlans ljusa tema T).
const D = {
  ink: '#ede7f0', inkSoft: '#bcb8d0', inkFaint: '#908ca8',
  gold: '#f0cf8c', roseGold: '#e6b59a', pink: '#f4a9be',
  card: 'rgba(255,255,255,0.05)', cardBorder: 'rgba(255,255,255,0.10)', cardSolid: '#141a2c',
}
const APP_URL = '/app/'   // bryggan till den kostnadsfria appen (samma domän)

// Officiell statistik (BRÅ, Nationella trygghetsundersökningen). Headline-siffran är saklig och källsatt;
// de "dolda" korten är kvalitativa konsekvenser (ingen påhittad procentsats), för att vara ärliga.
const STATS = [
  {
    big: '≈ var tredje', accent: D.gold,
    label: 'kvinna 16-29 år känner sig ganska eller mycket otrygg när hon är ute ensam sent på kvällen i sitt eget bostadsområde.',
    glow: 'rgba(240,207,140,0.30)',
  },
  {
    big: 'Den dolda omvägen', accent: D.roseGold,
    label: 'Otryggheten begränsar vardagen i tysthet: många väljer en längre, mer upplyst väg hem eller avstår helt från kvällspromenaden.',
    glow: 'rgba(230,181,154,0.26)',
  },
  {
    big: 'Det osynliga arbetet', accent: D.pink,
    label: 'Att hela tiden planera sin trygghet (nycklar i handen, dela sin position, ringa en vän) är ett mentalt arbete som sällan syns eller räknas.',
    glow: 'rgba(244,169,190,0.24)',
  },
]

export default function Ideel() {
  const formRef = useRef(null)
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <Auras />
      <main style={{ position: 'relative', zIndex: 1, maxWidth: 980, margin: '0 auto', padding: '0 clamp(16px, 5vw, 32px)' }}>
        <Hero onShare={scrollToForm} />
        <Stats />
        <StoryConcept onShare={scrollToForm} />
        <section ref={formRef} style={{ scrollMarginTop: 24 }}>
          <InterviewForm />
        </section>
        <Footer />
      </main>
    </div>
  )
}

/* Radiella ljus-auror bakom innehållet: mjuka guld/roseguld/rosa-glow som ramar in sidan utan att
   konkurrera med texten. Fixed + pointerEvents:none så de aldrig stör scroll eller klick. */
function Auras() {
  // Aurorna är position:absolute INUTI en fixed, helskärmstäckande behållare med overflow:hidden, så de
  // klipps mot vyporten och aldrig kan skapa horisontell scroll (sidan ska bara scrolla vertikalt).
  const aura = (s) => ({
    position: 'absolute', borderRadius: '50%', filter: 'blur(60px)', pointerEvents: 'none',
    animation: 'ideel-aura 9s ease-in-out infinite', ...s,
  })
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden' }}>
      <div style={aura({ top: '-12%', left: '-8%', width: 520, height: 520, background: 'radial-gradient(circle, rgba(240,207,140,0.18), transparent 70%)' })} />
      <div style={aura({ top: '20%', right: '-12%', width: 560, height: 560, background: 'radial-gradient(circle, rgba(244,169,190,0.16), transparent 70%)', animationDelay: '1.5s' })} />
      <div style={aura({ bottom: '-15%', left: '20%', width: 620, height: 620, background: 'radial-gradient(circle, rgba(230,181,154,0.14), transparent 70%)', animationDelay: '3s' })} />
    </div>
  )
}

function Hero({ onShare }) {
  return (
    <header className="ideel-rise" style={{ paddingTop: 'clamp(64px, 12vh, 130px)', paddingBottom: 'clamp(36px, 7vh, 70px)', textAlign: 'center' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999,
        border: `1px solid ${D.gold}44`, background: 'rgba(240,207,140,0.08)', color: D.gold,
        fontSize: 13, fontWeight: 800, marginBottom: 22,
      }}>🤍 Ideell förening</div>
      <h1 style={{
        fontSize: 'clamp(30px, 6vw, 54px)', lineHeight: 1.1, fontWeight: 800, margin: '0 0 18px',
        letterSpacing: 0.2,
        background: `linear-gradient(100deg, ${D.gold}, ${D.roseGold} 45%, ${D.pink})`,
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
      }}>
        Vi ger röst åt de tysta
      </h1>
      <p style={{ fontSize: 'clamp(16px, 2.4vw, 20px)', color: D.inkSoft, maxWidth: 660, margin: '0 auto 14px', lineHeight: 1.6 }}>
        En gemenskap som lyssnar på unga kvinnors dolda otrygghet i vardagen och lyfter den med värme och
        respekt. Din berättelse kan göra någon annans väg hem tryggare.
      </p>
      <p style={{ fontSize: 14.5, color: D.inkFaint, maxWidth: 600, margin: '0 auto 30px', lineHeight: 1.6 }}>
        Vi samlar in upplevelser för att synliggöra ett tyst problem, helt utan vinstintresse, och visar
        vägen till vår kostnadsfria trygghetsapp.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={onShare} style={btnPrimary}>Dela din berättelse</button>
        <a href={APP_URL} style={btnGhost}>Öppna appen 🛡️</a>
      </div>
    </header>
  )
}

function Stats() {
  return (
    <section className="ideel-rise" style={{ padding: '24px 0 12px' }} aria-labelledby="stats-rubrik">
      <SectionEyebrow>Faktabaserat: så ser vardagen ut</SectionEyebrow>
      <h2 id="stats-rubrik" style={h2}>Otryggheten är verklig, och ofta osynlig</h2>
      <p style={{ ...lead, marginBottom: 26 }}>
        Bakom siffrorna finns vardagliga val som krymper friheten. Här är några av dem.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {STATS.map((s, i) => <StatCard key={i} s={s} />)}
      </div>
      <p style={{ fontSize: 12.5, color: D.inkSoft, marginTop: 16 }}>
        Källa: BRÅ, Nationella trygghetsundersökningen (NTU). Siffran avser andelen som känner sig
        ganska eller mycket otrygga utomhus ensam sen kväll i det egna bostadsområdet.
      </p>
    </section>
  )
}

function StatCard({ s }) {
  return (
    <div style={{
      position: 'relative', borderRadius: 18, padding: '22px 20px', overflow: 'hidden',
      background: D.card, border: `1px solid ${D.cardBorder}`, backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
    }}>
      {/* mjuk radiell aura i kortets accentfärg så statistiken känns lätt, inte grafiskt tung */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%',
        background: `radial-gradient(circle, ${s.glow}, transparent 70%)`, filter: 'blur(8px)', pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 800, color: s.accent, marginBottom: 8, lineHeight: 1.1 }}>{s.big}</div>
        <div style={{ fontSize: 14.5, color: D.inkSoft, lineHeight: 1.55 }}>{s.label}</div>
      </div>
    </div>
  )
}

function StoryConcept({ onShare }) {
  const points = [
    { glyph: '🎧', title: 'Vi lyssnar', text: 'Du delar din upplevelse genom en anonym eller öppen intervju. Du bestämmer själv hur mycket du vill berätta.' },
    { glyph: '🔆', title: 'Vi synliggör', text: 'Med din tillåtelse använder vi insikterna för att lyfta problemet och sprida medvetenhet, alltid med värdighet.' },
    { glyph: '🛡️', title: 'Vi visar vägen', text: 'Berättelserna pekar mot LedMig: en helt kostnadsfri trygghetsapp utan dolda kostnader eller vinstintressen.' },
  ]
  return (
    <section className="ideel-rise" style={{ padding: '46px 0 12px' }} aria-labelledby="story-rubrik">
      <SectionEyebrow>Berättelser och intervjuer</SectionEyebrow>
      <h2 id="story-rubrik" style={h2}>Din röst, på dina villkor</h2>
      <p style={lead}>
        Föreningen samlar in tjejers och unga kvinnors berättelser för att göra en tyst otrygghet synlig.
        Allt sker transparent: du väljer själv om du vill vara anonym, och inget delas utan ditt samtycke.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, margin: '24px 0 22px' }}>
        {points.map((p, i) => (
          <div key={i} style={{
            borderRadius: 18, padding: '20px', background: D.card, border: `1px solid ${D.cardBorder}`,
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          }}>
            <div style={{ fontSize: 26, marginBottom: 10 }}>{p.glyph}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: D.ink, marginBottom: 6 }}>{p.title}</div>
            <div style={{ fontSize: 14, color: D.inkSoft, lineHeight: 1.55 }}>{p.text}</div>
          </div>
        ))}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between',
        borderRadius: 16, padding: '16px 18px', background: 'rgba(240,207,140,0.07)', border: `1px solid ${D.gold}33`,
      }}>
        <div style={{ fontSize: 14.5, color: D.inkSoft, lineHeight: 1.55, maxWidth: 560 }}>
          <b style={{ color: D.gold }}>Helt kostnadsfritt:</b> appen LedMig finansieras ideellt och har inga
          dolda avgifter, ingen reklam och inga kommersiella vinstintressen.
        </div>
        <button onClick={onShare} style={btnPrimary}>Jag vill dela min story</button>
      </div>
    </section>
  )
}

function InterviewForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [company, setCompany] = useState('') // honeypot: människor ser inte fältet, bottar fyller i det
  const [state, setState] = useState('idle') // idle | sending | done
  const [err, setErr] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    if (state === 'sending') return
    if (company) { setState('done'); return } // honeypot ifyllt: låtsas lyckas, spara inget
    const v = validateInterview({ email, message, consent })
    if (v) { setErr(v); return }
    setErr(''); setState('sending')
    const { error } = await submitInterview({ name, email, message, consent })
    if (error) {
      setState('idle')
      setErr('Det gick tyvärr inte att skicka just nu. Försök igen, eller mejla oss på info@ledmig.nu.')
      return
    }
    setState('done')
  }

  if (state === 'done') {
    return (
      <div className="ideel-rise" style={{ ...formCard, textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🤍</div>
        <h2 style={{ ...h2, marginBottom: 8 }}>Tack för att du delar</h2>
        <p style={{ ...lead, margin: '0 auto', maxWidth: 480 }}>
          Vi har tagit emot din anmälan och hör av oss om du lämnat en e-post. Din röst gör skillnad.
        </p>
      </div>
    )
  }

  return (
    <div className="ideel-rise" style={{ padding: '46px 0 12px' }}>
      <SectionEyebrow>Anmäl dig</SectionEyebrow>
      <h2 style={h2}>Bli intervjuad eller dela din berättelse</h2>
      <p style={{ ...lead, marginBottom: 22 }}>
        Lämna gärna en e-post om du vill bli kontaktad. Vill du vara anonym? Lämna namn och e-post tomma
        och berätta bara det du vill dela.
      </p>
      <form onSubmit={onSubmit} style={formCard} noValidate>
        {/* honeypot: dolt för människor (aria-hidden + utanför tab), fångar enkla bottar */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Lämna tomt
            <input type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <Field label="Namn (valfritt: lämna tomt för anonymt)">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
              aria-required="false" placeholder="Ditt namn eller alias" style={inp} autoComplete="name" />
          </Field>
          <Field label="E-post (valfritt: behövs bara om du vill bli kontaktad)">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320}
              aria-required="false" placeholder="namn@exempel.se" style={inp} autoComplete="email" />
          </Field>
        </div>

        <Field label="Din berättelse eller fråga">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={4000}
            aria-required="true" placeholder="Berätta så mycket eller lite du vill. Vad gör dig otrygg i vardagen? Vad skulle hjälpa?"
            style={{ ...inp, resize: 'vertical', minHeight: 110 }} />
        </Field>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', margin: '4px 0 2px' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-required="true" style={{ marginTop: 3, accentColor: D.pink }} />
          <span style={{ fontSize: 13, color: D.inkSoft, lineHeight: 1.5 }}>
            Jag samtycker till att föreningen lagrar min berättelse och eventuell kontaktuppgift säkert,
            och endast använder dem inom föreningens arbete. Jag kan när som helst be om att få mina
            uppgifter raderade.
          </span>
        </label>

        {err && <div role="alert" style={{ fontSize: 13, color: '#ffb4c4', marginTop: 4 }}>{err}</div>}

        <button type="submit" disabled={state === 'sending'} style={{ ...btnPrimary, width: '100%', marginTop: 12, opacity: state === 'sending' ? 0.6 : 1 }}>
          {state === 'sending' ? 'Skickar…' : 'Skicka in'}
        </button>
        <p style={{ fontSize: 11.5, color: D.inkFaint, marginTop: 12, lineHeight: 1.5 }}>
          Dina uppgifter skickas krypterat och lagras med strikt åtkomstkontroll (kan inte läsas publikt).
          Vi sparar bara det du fyller i, inget mer.
        </p>
      </form>
    </div>
  )
}

function Footer() {
  return (
    <footer style={{ padding: '54px 0 60px', textAlign: 'center', color: D.inkFaint }}>
      <div style={{ height: 1, background: D.cardBorder, margin: '0 0 28px' }} />
      <div style={{ fontSize: 15, fontWeight: 800, color: D.ink, marginBottom: 6 }}>🛡️ LedMig</div>
      <p style={{ fontSize: 13.5, color: D.inkSoft, maxWidth: 480, margin: '0 auto 16px', lineHeight: 1.6 }}>
        Den ideella föreningen och appen hör ihop: berättelserna visar vägen, appen hjälper dig hem.
        Helt kostnadsfritt.
      </p>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', fontSize: 13.5, fontWeight: 700 }}>
        <a href={APP_URL} style={{ color: D.gold, textDecoration: 'none' }}>Öppna appen</a>
        <a href="/" style={{ color: D.inkSoft, textDecoration: 'none' }}>Till ledmig.nu</a>
        <a href="mailto:info@ledmig.nu" style={{ color: D.inkSoft, textDecoration: 'none' }}>info@ledmig.nu</a>
      </div>
    </footer>
  )
}

/* ── små delkomponenter + delade stilar ─────────────────────────────────────── */
const SectionEyebrow = ({ children }) => (
  <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: D.roseGold, marginBottom: 8 }}>{children}</div>
)
const Field = ({ label, children }) => (
  <label style={{ display: 'block', marginBottom: 14 }}>
    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: D.inkSoft, marginBottom: 6 }}>{label}</span>
    {children}
  </label>
)

const h2 = { fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 800, color: D.ink, margin: '0 0 10px', lineHeight: 1.15 }
const lead = { fontSize: 'clamp(15px, 2.2vw, 17px)', color: D.inkSoft, lineHeight: 1.6, maxWidth: 640, margin: 0 }
const inp = {
  width: '100%', padding: '11px 13px', borderRadius: 12, fontSize: 15, color: D.ink,
  background: 'rgba(255,255,255,0.04)', border: `1px solid ${D.cardBorder}`, outline: 'none',
}
const formCard = {
  position: 'relative', borderRadius: 20, padding: 'clamp(18px, 3vw, 28px)', background: D.card,
  border: `1px solid ${D.cardBorder}`, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
}
const btnPrimary = {
  border: 'none', cursor: 'pointer', borderRadius: 12, padding: '12px 22px', fontSize: 15, fontWeight: 800,
  color: '#2a1622', background: `linear-gradient(100deg, ${D.gold}, ${D.roseGold} 55%, ${D.pink})`,
  boxShadow: '0 8px 26px rgba(244,169,190,0.22)',
}
const btnGhost = {
  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 12,
  padding: '12px 22px', fontSize: 15, fontWeight: 800, color: D.ink,
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${D.cardBorder}`,
}
