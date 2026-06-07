import { useEffect, useRef, useState } from 'react'
import { submitInterview, validateInterview } from './interviews'

/* ───────────────────────── Ideell förening: /ideel ─────────────────────────
   En levande, mjuk och personligt utformad sida som ger röst åt "de tysta offren": unga kvinnors dolda
   otrygghet i vardagen. Tonen är varm, ombonad och trygg, aldrig tung eller skrämmande.

   Designspråk (medvetet HANDGJORT, inte SaaS/AI-mall):
     - Inga stela rektangulära kort. Texten flyter fritt mot en ljus, varm gräddvit yta.
     - En mycket tunn, mjukt kurvad och glödande "Led" (rutt-linje i roseguld och rosa) slingrar sig
       nerför sidan bakom texten, med några små, subtila fotsteg som vandrar längs den (knyter ihop
       sidan med appens själ: vägen hem).
     - Stora, mycket diffusa ljus-auras (radial-gradients med stort blur) som mjuka, varma ljuspölar: en
       bärnstens/guldig glöd bakom BRÅ-statistiken (en trygg, belyst zon) och en blush-rosa glöd bakom
       formuläret.
     - Mjuk, varm typografi (text-transparenta rubriker), inga tech-ikoner, sömlösa formulärfält med en
       hårfin roseguld-ram.

   Allt textinnehåll, den källkritiska BRÅ-hänvisningen och transparensen om att appen är HELT
   kostnadsfri är oförändrade. FORMAT: aldrig AI-tankestreck som separator, alltid kolon (:). */

// Varm, ljus gryningspalett (mjuk gräddvit bakgrund med varma accenter): ljusare och tydligare än den
// tidigare natt-versionen, men samma organiska själ. Accentfärgerna är fördjupade så att de håller
// god läsbarhet (WCAG-kontrast) mot den ljusa bakgrunden.
const D = {
  ink: '#3b2f3a', inkSoft: '#6e6370', inkFaint: '#756a73',
  gold: '#8f5820', amber: '#9a6820', roseGold: '#95502f', pink: '#9a3950',
}
const APP_URL = '/app/'   // bryggan till den kostnadsfria appen (samma domän)
const COL = 880           // innehållets max-bredd: Leden (SVG) använder SAMMA centrerade spalt som <main>

// Officiell statistik (BRÅ, Nationella trygghetsundersökningen). Bara headline-siffran är numerisk och
// källsatt; de "dolda" raderna är kvalitativa konsekvenser (ingen påhittad procentsats), för ärlighets skull.
const STATS = [
  {
    big: '≈ var tredje', accent: D.amber,
    label: 'kvinna 16-29 år känner sig ganska eller mycket otrygg när hon är ute ensam sent på kvällen i sitt eget bostadsområde.',
  },
  {
    big: 'Den dolda omvägen', accent: D.roseGold,
    label: 'Otryggheten begränsar vardagen i tysthet: många väljer en längre, mer upplyst väg hem eller avstår helt från kvällspromenaden.',
  },
  {
    big: 'Det osynliga arbetet', accent: D.pink,
    label: 'Att hela tiden planera sin trygghet (nycklar i handen, dela sin position, ringa en vän) är ett mentalt arbete som sällan syns eller räknas.',
  },
]

export default function Ideel() {
  const mainRef = useRef(null)
  const formRef = useRef(null)
  const [dim, setDim] = useState({ w: 0, h: 0 })

  // Mät innehållets exakta mått så den slingrande Leden kan ritas oförvrängt bakom texten, och
  // ritas om när höjden ändras (t.ex. formulärets tack-läge). ResizeObserver på själva innehållet
  // (Leden ligger absolut och påverkar därför aldrig måttet -> ingen återkopplingsloop).
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const measure = () => setDim({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <AmbientAuras />
      <WindingPath w={dim.w} h={dim.h} />
      <main ref={mainRef} style={{ position: 'relative', zIndex: 1, maxWidth: COL, margin: '0 auto', padding: '0 clamp(18px, 5vw, 36px)' }}>
        <Hero onShare={scrollToForm} />
        <Stats />
        <StoryConcept onShare={scrollToForm} />
        <section ref={formRef} style={{ position: 'relative', padding: 'clamp(40px, 9vh, 92px) 0', scrollMarginTop: 24 }}>
          <Glow color="rgba(233,150,178,0.26)" style={{ top: '6%', left: '50%', transform: 'translateX(-50%)', width: 'min(640px, 96%)', height: 560 }} />
          <InterviewForm />
        </section>
        <Footer />
      </main>
    </div>
  )
}

/* Stora, mycket diffusa ambient-auras: en mjuk, varm glöd som ramar in sidan utan att konkurrera med
   texten. Fixed + pointerEvents:none + overflow-klippt behållare så de aldrig stör scroll eller klick. */
function AmbientAuras() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden' }}>
      <div style={auraBase({ top: '-14%', left: '-6%', width: 560, height: 560, background: 'radial-gradient(circle, rgba(233,170,90,0.22), transparent 70%)' })} />
      <div style={auraBase({ bottom: '-18%', right: '-10%', width: 620, height: 620, background: 'radial-gradient(circle, rgba(233,150,178,0.20), transparent 70%)', animationDelay: '2.5s' })} />
    </div>
  )
}
const auraBase = (s) => ({ position: 'absolute', borderRadius: '50%', filter: 'blur(80px)', pointerEvents: 'none', animation: 'ideel-aura 11s ease-in-out infinite', ...s })

// En sektionsbunden, mycket diffus glöd (en mjuk, varm ljuspöl) som ligger BAKOM ett textavsnitt.
function Glow({ color, style }) {
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', zIndex: 0, borderRadius: '50%', filter: 'blur(90px)', pointerEvents: 'none',
      background: `radial-gradient(circle, ${color}, transparent 70%)`, ...style,
    }} />
  )
}

/* Den slingrande, glödande Leden: en tunn roseguld/rosa-linje som ritas parametriskt (mjuk sinuskurva)
   ner genom hela innehållets höjd, bakom texten. Längs den vandrar några små, subtila fotsteg som
   tänds i tur och ordning. Allt i SVG (inga inline-script -> CSP-kompatibelt). */
function WindingPath({ w, h }) {
  if (!w || !h) return null
  const cx = w / 2
  const amp = Math.min(w * 0.16, 110)                       // hur mycket linjen svänger i sidled
  const turns = Math.max(2.5, Math.round(h / 620) + 0.5)    // antal mjuka vågor utifrån sidans höjd
  const fn = (t) => [cx + amp * Math.sin(t * Math.PI * turns), t * h]

  const segs = Math.max(48, Math.min(180, Math.round(h / 22)))
  let d = ''
  for (let i = 0; i <= segs; i++) {
    const [x, y] = fn(i / segs)
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
  }

  // Fotsteg: alternerande vänster/höger om linjen, lätt roterade efter kurvans riktning.
  const count = Math.max(6, Math.min(13, Math.round(h / 270)))
  const feet = []
  for (let i = 0; i < count; i++) {
    const t = (i + 0.6) / count
    const [x, y] = fn(t)
    const [x2, y2] = fn(Math.min(1, t + 0.004))
    const ang = Math.atan2(y2 - y, x2 - x)
    const side = i % 2 === 0 ? 1 : -1
    const px = x + Math.cos(ang + Math.PI / 2) * 8 * side
    const py = y + Math.sin(ang + Math.PI / 2) * 8 * side
    feet.push({ px, py, deg: (ang * 180) / Math.PI - 90, i })
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, margin: '0 auto', maxWidth: COL, width: '100%', height: h, zIndex: 0, pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="ideel-led" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c2873f" />
          <stop offset="50%" stopColor="#bd7257" />
          <stop offset="100%" stopColor="#cf5e82" />
        </linearGradient>
        <filter id="ideel-led-blur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
      </defs>
      {/* mjukt glödlager (suddigt, brett) + hårfin kärna */}
      <path className="ideel-led-glow" d={d} fill="none" stroke="url(#ideel-led)" strokeWidth="5" strokeLinecap="round" filter="url(#ideel-led-blur)" />
      <path d={d} fill="none" stroke="url(#ideel-led)" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
      {feet.map((f) => (
        <g key={f.i} className="ideel-step" style={{ animationDelay: (f.i * 0.3) + 's' }}
          transform={`translate(${f.px.toFixed(1)} ${f.py.toFixed(1)}) rotate(${f.deg.toFixed(1)})`}>
          <ellipse cx="0" cy="0" rx="2.2" ry="4.3" fill="#bd7450" />
          <circle cx="0" cy="-4.7" r="1.2" fill="#bd7450" />
        </g>
      ))}
    </svg>
  )
}

function Hero({ onShare }) {
  return (
    <header style={{ position: 'relative', zIndex: 1, textAlign: 'center', paddingTop: 'clamp(74px, 14vh, 144px)', paddingBottom: 'clamp(28px, 6vh, 60px)' }}>
      <div style={{ fontSize: 26, marginBottom: 18, opacity: 0.9 }}>💗</div>
      <h1 style={{ ...softHeading, fontSize: 'clamp(32px, 6.4vw, 58px)', margin: '0 0 20px' }}>
        Vi ger röst åt de tysta
      </h1>
      <p style={{ ...lead, margin: '0 auto 14px', maxWidth: 620 }}>
        En gemenskap som lyssnar på unga kvinnors dolda otrygghet i vardagen och lyfter den med värme och
        respekt. Din berättelse kan göra någon annans väg hem tryggare.
      </p>
      <p style={{ fontSize: 14.5, color: D.inkFaint, maxWidth: 580, margin: '0 auto 32px', lineHeight: 1.65 }}>
        Vi samlar in upplevelser för att synliggöra ett tyst problem, helt utan vinstintresse, och visar
        vägen till vår kostnadsfria trygghetsapp.
      </p>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={onShare} style={btnSoft}>Dela din berättelse</button>
        <a href={APP_URL} style={btnGhost}>Öppna appen</a>
      </div>
    </header>
  )
}

function Stats() {
  return (
    <section style={{ position: 'relative', padding: 'clamp(38px, 8vh, 84px) 0' }} aria-labelledby="stats-rubrik">
      {/* trygg, belyst zon: en mjuk bärnstens/guldig glöd bakom statistiken */}
      <Glow color="rgba(233,170,90,0.28)" style={{ top: '14%', left: '50%', transform: 'translateX(-50%)', width: 'min(720px, 98%)', height: 520 }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 'clamp(28px, 5vh, 52px)' }}>
        <Eyebrow center>Faktabaserat: så ser vardagen ut</Eyebrow>
        <h2 id="stats-rubrik" style={softHeading}>Otryggheten är verklig, och ofta osynlig</h2>
        <p style={{ ...lead, margin: '10px auto 0' }}>Bakom siffrorna finns vardagliga val som krymper friheten. Här är några av dem.</p>
      </div>

      {STATS.map((s, i) => (
        <FlowBlock key={i} align={i % 2 === 0 ? 'left' : 'right'}>
          <div style={{ fontSize: 'clamp(27px, 4.6vw, 42px)', fontWeight: 800, color: s.accent, lineHeight: 1.05, marginBottom: 8, filter: `drop-shadow(0 0 22px ${s.accent}44)` }}>{s.big}</div>
          <div style={{ fontSize: 'clamp(15px, 2.2vw, 17.5px)', color: D.inkSoft, lineHeight: 1.6 }}>{s.label}</div>
        </FlowBlock>
      ))}

      <p style={{ position: 'relative', zIndex: 1, fontSize: 12.5, color: D.inkSoft, textAlign: 'center', maxWidth: 600, margin: '8px auto 0', lineHeight: 1.6 }}>
        Källa: BRÅ, Nationella trygghetsundersökningen (NTU). Siffran avser andelen som känner sig
        ganska eller mycket otrygga utomhus ensam sen kväll i det egna bostadsområdet.
      </p>
    </section>
  )
}

function StoryConcept({ onShare }) {
  const points = [
    { title: 'Vi lyssnar', text: 'Du delar din upplevelse genom en anonym eller öppen intervju. Du bestämmer själv hur mycket du vill berätta.' },
    { title: 'Vi synliggör', text: 'Med din tillåtelse använder vi insikterna för att lyfta problemet och sprida medvetenhet, alltid med värdighet.' },
    { title: 'Vi visar vägen', text: 'Berättelserna pekar mot LedMig: en helt kostnadsfri trygghetsapp utan dolda kostnader eller vinstintressen.' },
  ]
  return (
    <section style={{ position: 'relative', padding: 'clamp(38px, 8vh, 84px) 0' }} aria-labelledby="story-rubrik">
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 'clamp(28px, 5vh, 52px)' }}>
        <Eyebrow center>Berättelser och intervjuer</Eyebrow>
        <h2 id="story-rubrik" style={softHeading}>Din röst, på dina villkor</h2>
        <p style={{ ...lead, margin: '10px auto 0' }}>
          Föreningen samlar in tjejers och unga kvinnors berättelser för att göra en tyst otrygghet synlig.
          Allt sker transparent: du väljer själv om du vill vara anonym, och inget delas utan ditt samtycke.
        </p>
      </div>

      {points.map((p, i) => {
        const align = i % 2 === 0 ? 'right' : 'left'
        return (
          <FlowBlock key={i} align={align}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: align === 'right' ? 'row-reverse' : 'row', marginBottom: 6 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: D.roseGold, boxShadow: `0 0 10px ${D.roseGold}`, flex: '0 0 8px' }} />
              <h3 style={{ fontSize: 'clamp(19px, 3vw, 24px)', fontWeight: 800, color: D.ink, margin: 0 }}>{p.title}</h3>
            </div>
            <p style={{ fontSize: 'clamp(14.5px, 2.1vw, 16.5px)', color: D.inkSoft, lineHeight: 1.6, margin: 0 }}>{p.text}</p>
          </FlowBlock>
        )
      })}

      {/* Transparensen om att appen är HELT kostnadsfri: fritt flytande, ingen box. */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 640, margin: '12px auto 0' }}>
        <p style={{ fontSize: 'clamp(16px, 2.4vw, 19px)', color: D.inkSoft, lineHeight: 1.65 }}>
          <b style={{ color: D.gold }}>Helt kostnadsfritt:</b> appen LedMig finansieras ideellt och har inga
          dolda avgifter, ingen reklam och inga kommersiella vinstintressen.
        </p>
        <button onClick={onShare} style={{ ...btnSoft, marginTop: 18 }}>Jag vill dela min story</button>
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
    if (company) { setState('done'); return } // honeypot ifyllt: låtsas lyckas (avslöja inte fällan), spara inget
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
      <div className="ideel-rise" style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 520, margin: '0 auto', padding: '30px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💗</div>
        <h2 style={{ ...softHeading, marginBottom: 10 }}>Tack för att du delar</h2>
        <p style={{ ...lead, margin: '0 auto' }}>
          Vi har tagit emot din anmälan och hör av oss om du lämnat en e-post. Din röst gör skillnad.
        </p>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', zIndex: 1, maxWidth: 560, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 'clamp(20px, 4vh, 34px)' }}>
        <Eyebrow center>Anmäl dig</Eyebrow>
        <h2 style={softHeading}>Bli intervjuad eller dela din berättelse</h2>
        <p style={{ ...lead, margin: '10px auto 0' }}>
          Lämna gärna en e-post om du vill bli kontaktad. Vill du vara anonym? Lämna namn och e-post tomma
          och berätta bara det du vill dela.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate style={{ position: 'relative' }}>
        {/* honeypot: dolt för människor (aria-hidden + utanför tab), fångar enkla bottar */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Lämna tomt
            <input type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
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
            style={{ ...inp, resize: 'vertical', minHeight: 116 }} />
        </Field>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer', margin: '4px 0 2px' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-required="true" style={{ marginTop: 3, accentColor: D.pink }} />
          <span style={{ fontSize: 13, color: D.inkSoft, lineHeight: 1.5 }}>
            Jag samtycker till att föreningen lagrar min berättelse och eventuell kontaktuppgift säkert,
            och endast använder dem inom föreningens arbete. Jag kan när som helst be om att få mina
            uppgifter raderade.
          </span>
        </label>

        {err && <div role="alert" style={{ fontSize: 13, color: '#c2354f', marginTop: 6 }}>{err}</div>}

        <button type="submit" disabled={state === 'sending'} style={{ ...btnSoft, width: '100%', marginTop: 16, opacity: state === 'sending' ? 0.6 : 1, cursor: state === 'sending' ? 'wait' : 'pointer' }}>
          {state === 'sending' ? 'Skickar…' : 'Skicka in'}
        </button>
        <p style={{ fontSize: 11.5, color: D.inkFaint, marginTop: 14, lineHeight: 1.55, textAlign: 'center' }}>
          Dina uppgifter skickas krypterat och lagras med strikt åtkomstkontroll (kan inte läsas publikt).
          Vi sparar bara det du fyller i, inget mer.
        </p>
      </form>
    </div>
  )
}

function Footer() {
  return (
    <footer style={{ position: 'relative', zIndex: 1, padding: '50px 0 64px', textAlign: 'center', color: D.inkFaint }}>
      <div aria-hidden="true" style={{ width: 60, height: 1, margin: '0 auto 26px', background: `linear-gradient(90deg, transparent, ${D.roseGold}66, transparent)` }} />
      <div style={{ fontSize: 16, fontWeight: 800, color: D.ink, marginBottom: 8, letterSpacing: 0.3 }}>LedMig</div>
      <p style={{ fontSize: 13.5, color: D.inkSoft, maxWidth: 480, margin: '0 auto 18px', lineHeight: 1.65 }}>
        Den ideella föreningen och appen hör ihop: berättelserna visar vägen, appen hjälper dig hem.
        Helt kostnadsfritt.
      </p>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', fontSize: 13.5, fontWeight: 700 }}>
        <a href={APP_URL} style={{ color: D.gold, textDecoration: 'none' }}>Öppna appen</a>
        <a href="/" style={{ color: D.inkSoft, textDecoration: 'none' }}>Till ledmig.nu</a>
        <a href="mailto:info@ledmig.nu" style={{ color: D.inkSoft, textDecoration: 'none' }}>info@ledmig.nu</a>
      </div>
    </footer>
  )
}

/* ── små delkomponenter + delade stilar ─────────────────────────────────────── */
// Fritt flytande textblock som turas om att luta åt vänster/höger sida, så den slingrande Leden
// väver sig mellan dem. På smala skärmar blir blocken nästan helbreda och väven mjuknar naturligt.
function FlowBlock({ align = 'center', children }) {
  const s = { position: 'relative', zIndex: 1, maxWidth: 'min(440px, 84%)', marginBottom: 'clamp(34px, 7vh, 74px)' }
  if (align === 'left') { s.marginRight = 'auto'; s.marginLeft = 0; s.textAlign = 'left' }
  else if (align === 'right') { s.marginLeft = 'auto'; s.marginRight = 0; s.textAlign = 'right' }
  else { s.margin = '0 auto'; s.textAlign = 'center' }
  return <div className="ideel-rise" style={s}>{children}</div>
}

const Eyebrow = ({ children, center }) => (
  <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 1.6, textTransform: 'uppercase', color: D.roseGold, marginBottom: 12, textAlign: center ? 'center' : 'left' }}>{children}</div>
)
const Field = ({ label, children }) => (
  <label style={{ display: 'block', marginBottom: 16 }}>
    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: D.inkSoft, marginBottom: 7 }}>{label}</span>
    {children}
  </label>
)

// Mjuk, varm rubrik: text-transparent gradient (guld -> roseguld -> rosa) med en hårfin glöd.
const softHeading = {
  fontSize: 'clamp(23px, 4.2vw, 34px)', fontWeight: 800, lineHeight: 1.16, margin: 0, letterSpacing: 0.2,
  // Mörkare, varma toningar (guld -> roseguld -> ros) så rubriken är mjuk MEN tydligt läsbar mot ljust (WCAG AA).
  background: 'linear-gradient(104deg, #8f5820, #984f3a 48%, #9a3556)',
  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
  filter: 'drop-shadow(0 2px 8px rgba(176,106,72,0.14))',
}
const lead = { fontSize: 'clamp(15px, 2.2vw, 17px)', color: D.inkSoft, lineHeight: 1.65, maxWidth: 640 }
// Sömlösa fält: hårfin roseguld-ram + lätt genomskinlig vit bakgrund som smälter in i den ljusa ytan.
const inp = {
  width: '100%', padding: '13px 15px', borderRadius: 14, fontSize: 15, color: D.ink,
  background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(176,106,72,0.35)', outline: 'none',
}
// Mjuk, varm knapp (pill) med diskret glöd. Mörk, varm gradient + vit text -> tydlig kontrast mot ljust.
const btnSoft = {
  border: 'none', cursor: 'pointer', borderRadius: 999, padding: '13px 26px', fontSize: 15, fontWeight: 800,
  color: '#fff', background: 'linear-gradient(105deg, #a8551c, #a84636 50%, #b02c54)',
  boxShadow: '0 10px 26px rgba(176,44,84,0.26)',
}
const btnGhost = {
  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999,
  padding: '13px 24px', fontSize: 15, fontWeight: 800, color: D.ink,
  background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(176,106,72,0.45)',
}
