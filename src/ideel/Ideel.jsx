import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { submitInterview, validateInterview } from './interviews'

// three.js är tung: svärmen lazy-laddas i egen chunk så typografin målas direkt (LCP är texten)
// och WebGL strömmar in strax efter. Hjärtlogotypen ligger här (ren SVG) och syns omedelbart.
const Swarm = lazy(() => import('./Swarm.jsx'))

/* ───────────────────────── Ideell förening: /ideel ─────────────────────────
   Publik landningssida som ger röst åt "de tysta": unga kvinnors dolda otrygghet i vardagen.

   Designspråk (editorial plansch, INTE SaaS/AI-mall):
     - Ett uppslag: vänster blad med boktrycks-typografi som scrollar, höger ett fast blad med den
       interaktiva partikelfjärilen (three.js) och föreningens streckade neonhjärta som glödande kärna.
     - Varm gräddvit botten, ALL typografi och grafik i en enhetlig rosa familj (djup ros för läsbar
       brödtext, klar ros för rubriker, neonros för glöd): en kulör, många valörer.
     - Fraunces (elegant display-serif, roman + kursiv accent) för rubriker, Karla (ren, mycket läsbar
       sans) för brödtext, Spline Sans Mono i spärrad versal för nav/etiketter.

   Innehållet, BRÅ/NTU-källhänvisningen och transparensen om att appen är HELT
   kostnadsfri följer föreningens manus. Formuläret återanvänder det säkrade datalagret
   (write-only Supabase-tabell med RLS: samtycke + berättelse krävs, inget kan läsas tillbaka).
   FORMAT: aldrig AI-tankestreck som separator, alltid kolon (:). */

const APP_URL = '/app/'   // bryggan till den kostnadsfria appen (samma domän)

// Rosa familjen (spegel av CSS-variablerna i ideel.css, håll i synk): inline-stilar är spaltens
// konvention. Kontrast mot cream: ink 6.4:1, soft 4.9:1, bright 4.1:1 (endast stor text),
// neonText 3.3:1 (endast stora kursiva accentord), neon enbart för aria-hidden glöd/grafik.
const P = {
  cream: '#f7f1e6',
  ink: '#a1235c',
  soft: 'rgba(161,35,92,0.85)',
  bright: '#d6336c',
  neon: '#ff5fa2',
  neonText: '#f03a82',
  hairline: 'rgba(161,35,92,0.28)',
}
const serif = "'Fraunces', Georgia, 'Times New Roman', serif"

export default function Ideel() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <TopNav />
      <aside className="ideel-stage" aria-hidden="true">
        <Suspense fallback={null}>
          <Swarm />
        </Suspense>
        <HeartLogo />
        <ExamineCue />
      </aside>
      <main className="ideel-main">
        <Hero />
        <Facts />
        <Stories />
        <About />
        <Footer />
      </main>
    </div>
  )
}

/* Föreningens logotyp: det streckade neonhjärtat med pil nedåt, ritat i SVG (skarpt i alla storlekar)
   och lagt som glödande kärna mitt i partikelvolymen. Konturen är en ÖPPEN hjärtbana vars spets
   ersätts av en nedåtpil (chevron), plus den lilla strecksatsen i urringningen: samma mark som
   favicon. Dasharray över pathLength ger de runda, jämnt fördelade strecken. */
function HeartLogo({ size = 132 }) {
  return (
    <div className="ideel-heart" aria-hidden="true" style={{
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: size, height: size, pointerEvents: 'none', zIndex: 2,
    }}>
      {/* mjuk gloria bakom märket så kärnan lyser ur volymen */}
      <div style={{
        position: 'absolute', inset: '-38%', borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(255,95,162,0.20), rgba(255,95,162,0.07) 45%, transparent 70%)',
        filter: 'blur(6px)',
      }} />
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ position: 'relative' }}>
        <g stroke="#ff5fa2" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M61 76 C78 63 92 52 92 36 C92 24 84 16 73 16 C62 16 53 24 50 31 C47 24 38 16 27 16 C16 16 8 24 8 36 C8 52 22 63 39 76"
            pathLength="160" strokeDasharray="11 9.4" strokeDashoffset="-2.5"
          />
          <path d="M41 79 L50 87 L59 79" />
          <path d="M50 37 L50 41.5" />
        </g>
      </svg>
    </div>
  )
}

function TopNav() {
  return (
    <nav className="ideel-nav" aria-label="Huvudmeny">
      <a href="/ideel/" style={{ fontFamily: serif, fontStyle: 'italic', fontWeight: 600, fontSize: 22, color: P.bright, textDecoration: 'none', letterSpacing: 0.2, textShadow: '0 0 18px rgba(255,95,162,0.35)' }}>
        LedMig
      </a>
      <div className="ideel-nav-links">
        <a className="ideel-navlink" href="#facts">Fakta</a>
        <a className="ideel-navlink" href="#stories">Berättelser</a>
        <a className="ideel-navlink" href="#about">Om oss</a>
      </div>
      <a className="ideel-pill" href={APP_URL}>Skaffa appen</a>
    </nav>
  )
}

// Planschens vertikala visare i scenens nederkant (som uppslagets "scroll to examine").
function ExamineCue() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', right: 'clamp(14px, 2vw, 26px)', bottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, zIndex: 2 }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 500, letterSpacing: '0.3em', textTransform: 'uppercase', color: P.soft, writingMode: 'vertical-rl' }}>
        Scrolla för att utforska
      </span>
      <span className="ideel-scrollcue" style={{ width: 1, height: 42, background: P.bright, display: 'block' }} />
    </div>
  )
}

function Hero() {
  return (
    <header className="ideel-rise ideel-hero">
      <div className="ideel-label" style={{ marginBottom: 'clamp(26px, 4.5vh, 46px)' }}>
        LedMig · Ideell förening · 2026
      </div>
      <h1 style={{ fontFamily: serif, fontVariationSettings: "'opsz' 144", fontWeight: 480, fontSize: 'clamp(46px, 6.4vw, 96px)', lineHeight: 1.02, letterSpacing: '-0.015em', color: P.bright, margin: '0 0 clamp(22px, 4vh, 38px)' }}>
        Ge röst<br />
        <em style={{ fontStyle: 'italic', fontWeight: 440, color: P.neonText, textShadow: '0 0 30px rgba(255,95,162,0.35)' }}>åt de tysta</em>
      </h1>
      <p style={{ fontFamily: serif, fontVariationSettings: "'opsz' 40", fontWeight: 430, fontSize: 'clamp(17px, 1.7vw, 21px)', lineHeight: 1.55, color: P.ink, maxWidth: 520, margin: 0 }}>
        En gemenskap som lyssnar på unga kvinnors dolda otrygghet i vardagen och lyfter den med
        värme och respekt. Din berättelse kan göra någon annans väg hem tryggare.
      </p>
    </header>
  )
}

/* 3-spaltsmodulen med vardagsfakta (planschens "context · output · thinking"-rad, men som
   innehållsbärare). Bara kolumn 1 har en numerisk headline; den är källsatt mot BRÅ/NTU nedanför. */
const FACTS = [
  {
    heading: 'Otryggheten är verklig',
    big: '≈ var tredje',
    body: 'kvinna 16-29 år känner sig ganska eller mycket otrygg när hon är ute ensam sent på kvällen i sitt eget bostadsområde.',
  },
  {
    heading: 'Den dolda omvägen',
    body: 'Otryggheten begränsar vardagen i tysthet: många väljer en längre, mer upplyst väg hem eller avstår helt från kvällspromenaden.',
  },
  {
    heading: 'Det osynliga arbetet',
    body: 'Att hela tiden planera sin trygghet (nycklar i handen, dela sin position, ringa en vän) är ett mentalt arbete som sällan syns eller räknas.',
  },
]

function Facts() {
  return (
    <section id="facts" aria-labelledby="facts-label" style={{ padding: 'clamp(36px, 7vh, 76px) 0', scrollMarginTop: 40 }}>
      <h2 className="ideel-label" id="facts-label" style={{ marginBottom: 'clamp(28px, 5vh, 48px)' }}>
        Faktabaserat: så ser vardagen ut
      </h2>
      <div className="ideel-facts-grid">
        {FACTS.map((f) => (
          <article key={f.heading} style={{ borderTop: `1px solid ${P.hairline}`, paddingTop: 18 }}>
            <h3 style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: P.soft, margin: '0 0 12px' }}>
              {f.heading}
            </h3>
            {f.big && (
              <div style={{ fontFamily: serif, fontStyle: 'italic', fontVariationSettings: "'opsz' 100", fontWeight: 500, fontSize: 'clamp(24px, 2.4vw, 32px)', lineHeight: 1.1, color: P.bright, marginBottom: 10, textShadow: '0 0 22px rgba(255,95,162,0.25)' }}>
                {f.big}
              </div>
            )}
            <p style={{ fontSize: 14.5, lineHeight: 1.65, color: P.ink, margin: 0 }}>{f.body}</p>
          </article>
        ))}
      </div>
      <p style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em', color: P.soft, margin: '26px 0 0' }}>
        Källa: BRÅ, Nationella trygghetsundersökningen (NTU).
      </p>
    </section>
  )
}

function Stories() {
  return (
    <section id="stories" aria-labelledby="stories-label" style={{ padding: 'clamp(36px, 7vh, 76px) 0', scrollMarginTop: 40 }}>
      <h2 className="ideel-label" id="stories-label" style={{ marginBottom: 'clamp(28px, 5vh, 48px)' }}>
        Berättelser och intervjuer
      </h2>
      <h3 style={{ fontFamily: serif, fontVariationSettings: "'opsz' 144", fontWeight: 480, fontSize: 'clamp(32px, 3.6vw, 52px)', lineHeight: 1.08, letterSpacing: '-0.01em', color: P.bright, margin: '0 0 20px' }}>
        Din röst, <em style={{ fontWeight: 440, color: P.neonText, textShadow: '0 0 26px rgba(255,95,162,0.3)' }}>på dina villkor</em>
      </h3>
      <p style={{ fontSize: 'clamp(15px, 1.5vw, 16.5px)', lineHeight: 1.7, color: P.ink, maxWidth: 560, margin: '0 0 clamp(34px, 6vh, 58px)' }}>
        Vi samlar in tjejers och unga kvinnors berättelser för att göra en tyst otrygghet synlig. 
        Allt sker transparent: du väljer själv om du vill vara anonym, och inget delas utan ditt 
        samtycke. Vi använder insikterna för att lyfta problemet och sprida medvetenhet, alltid 
        med värdighet.
      </p>

      <div style={{ borderTop: `1px solid ${P.hairline}`, paddingTop: 'clamp(26px, 4vh, 40px)' }}>
        {/* min 24px: under det räknas #d6336c inte som "stor text" i WCAG och kontrasten faller */}
        <h4 style={{ fontFamily: serif, fontStyle: 'italic', fontVariationSettings: "'opsz' 80", fontWeight: 480, fontSize: 'clamp(24px, 2.2vw, 28px)', lineHeight: 1.25, color: P.bright, margin: '0 0 12px' }}>
          Bli intervjuad eller dela din berättelse
        </h4>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: P.soft, maxWidth: 540, margin: '0 0 28px' }}>
          Lämna gärna en e-post om du vill bli kontaktad. Vill du vara anonym? Lämna namn 
          och e-post tomma och berätta bara det du vill dela.
        </p>
        <StoryForm />
      </div>
    </section>
  )
}

function StoryForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [company, setCompany] = useState('') // honeypot: människor ser inte fältet, bottar fyller i det
  const [state, setState] = useState('idle') // idle | sending | done
  const [err, setErr] = useState(null)       // { field: 'message'|'email'|'consent'|null, msg } | null
  const doneRef = useRef(null)

  // Tack-läget ersätter hela formuläret (inklusive den fokuserade knappen): flytta fokus till
  // bekräftelsen så tangentbords- och skärmläsaranvändare inte tappas på body (WCAG 2.4.3).
  useEffect(() => {
    if (state === 'done') doneRef.current?.focus()
  }, [state])

  // aria-invalid/aria-describedby bara på det fält som felet faktiskt gäller.
  const errProps = (field) =>
    err && err.field === field ? { 'aria-invalid': true, 'aria-describedby': 'ideel-form-err' } : {}

  async function onSubmit(e) {
    e.preventDefault()
    if (state === 'sending') return
    if (company) { setState('done'); return } // honeypot ifyllt: låtsas lyckas (avslöja inte fällan), spara inget
    const v = validateInterview({ email, message, consent })
    if (v) { setErr(v); return }
    setErr(null); setState('sending')
    const { error } = await submitInterview({ name, email, message, consent })
    if (error) {
      setState('idle')
      setErr({ field: null, msg: 'Något gick fel vid skickandet. Försök igen, eller mejla oss på info@ledmig.nu.' })
      return
    }
    setState('done')
  }

  if (state === 'done') {
    return (
      <div className="ideel-rise" role="status" style={{ padding: '10px 0 16px' }}>
        <p ref={doneRef} tabIndex={-1} style={{ fontFamily: serif, fontStyle: 'italic', fontVariationSettings: "'opsz' 80", fontWeight: 480, fontSize: 'clamp(24px, 2.2vw, 28px)', color: P.bright, margin: '0 0 10px', outline: 'none' }}>
          Tack för att du delar med dig
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: P.ink, maxWidth: 480, margin: 0 }}>
          Vi har tagit emot din berättelse och hör av oss om du lämnade en e-post. Din röst gör skillnad.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ position: 'relative', maxWidth: 560 }}>
      {/* honeypot: dolt för människor (aria-hidden + utanför tab), fångar enkla bottar */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Lämna detta fält tomt
          <input type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'clamp(18px, 2vw, 28px)', marginBottom: 24 }}>
        <label style={{ display: 'block' }}>
          <span className="ideel-field-label">Namn (frivilligt)</span>
          <input className="ideel-input" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
            aria-required="false" placeholder="Ditt namn eller alias" autoComplete="name" />
        </label>
        <label style={{ display: 'block' }}>
          <span className="ideel-field-label">E-postadress (frivilligt)</span>
          <input className="ideel-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320}
            aria-required="false" placeholder="namn@exempel.se" autoComplete="email" {...errProps('email')} />
        </label>
      </div>

      <label style={{ display: 'block', marginBottom: 22 }}>
        <span className="ideel-field-label">Din berättelse</span>
        <textarea className="ideel-input" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={4000}
          aria-required="true" {...errProps('message')}
          placeholder="Berätta så mycket eller lite du vill. Vad får dig att känna dig otrygg i vardagen? Vad skulle hjälpa?" />
      </label>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer', margin: '0 0 6px' }}>
        <input type="checkbox" className="ideel-check" checked={consent} onChange={(e) => setConsent(e.target.checked)}
          aria-required="true" style={{ marginTop: 3 }} {...errProps('consent')} />
        <span style={{ fontSize: 13, color: P.soft, lineHeight: 1.55 }}>
          Jag samtycker till att föreningen sparar min berättelse och eventuella kontaktuppgifter säkert, 
          och att de endast används inom föreningens arbete. Jag kan när som helst be att få min data raderad.
        </span>
      </label>

      {err && <div id="ideel-form-err" role="alert" style={{ fontSize: 13, fontWeight: 700, color: P.ink, marginTop: 10 }}>{err.msg}</div>}

      <button type="submit" disabled={state === 'sending'} className="ideel-btn ideel-btn--primary" style={{ marginTop: 24 }}>
        {state === 'sending' ? 'Skickar…' : 'Dela min berättelse'}
      </button>
      <p style={{ fontSize: 11.5, color: P.soft, marginTop: 16, lineHeight: 1.55, maxWidth: 480 }}>
        Dina uppgifter skickas krypterat och lagras med strikt behörighetskontroll (de kan inte läsas 
        offentligt). Vi sparar bara det du fyller i, inget annat.
      </p>
    </form>
  )
}

function About() {
  return (
    <section id="about" aria-labelledby="about-label" style={{ padding: 'clamp(36px, 7vh, 76px) 0 clamp(44px, 8vh, 90px)', scrollMarginTop: 40 }}>
      <h2 className="ideel-label" id="about-label" style={{ marginBottom: 'clamp(28px, 5vh, 48px)' }}>
        Om appen LedMig
      </h2>
      <p style={{ fontFamily: serif, fontVariationSettings: "'opsz' 60", fontWeight: 440, fontSize: 'clamp(19px, 2vw, 25px)', lineHeight: 1.5, color: P.ink, maxWidth: 560, margin: '0 0 30px' }}>
        Berättelserna pekar mot LedMig: en helt kostnadsfri trygghetsapp utan dolda kostnader, ingen reklam och inga kommersiella vinstintressen. Finansieras ideellt.
      </p>
      <a className="ideel-btn ideel-btn--ghost" href={APP_URL}>Skaffa appen</a>
    </section>
  )
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${P.hairline}`, padding: '30px 0 56px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: serif, fontStyle: 'italic', fontWeight: 600, fontSize: 19, color: P.bright }}>LedMig</span>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        <a href={APP_URL} style={{ color: P.ink, textDecoration: 'none' }}>Skaffa appen</a>
        <a href="/" style={{ color: P.soft, textDecoration: 'none' }}>ledmig.nu</a>
        <a href="mailto:info@ledmig.nu" style={{ color: P.soft, textDecoration: 'none' }}>info@ledmig.nu</a>
      </div>
    </footer>
  )
}