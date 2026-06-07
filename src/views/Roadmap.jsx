import { useMemo, useState } from 'react'
import { T } from '../theme'

/* ─────────────────────────── Projektets Tidslinje ───────────────────────────
   En strategisk färdplan (roadmap) för hela bolagsresan, inte bara koden. Vi varvar
   medvetet fem områden i kronologisk ordning: bolagsbildning, infrastruktur och inköp,
   utveckling (på milstolpsnivå), marknadsföring och tillväxt samt lansering och juridik.

   TIDSTYPOGRAFI: avståndet (höjden) mellan två noder är proportionellt mot hur lång tid
   steget uppskattas ta. Korta steg ligger tätt, långa väntetider (bankens KYC, butikernas
   granskning, UX-iteration) får ett stort visuellt glapp så att tidsåtgången syns direkt.

   ESTETIK: en mörk natt-vy (djup midnattsblå mot charcoal) med mjuka guld-, roseguld- och
   rosa accenter på spåret och noderna. Varje nod är expanderbar och visar målet med steget.

   FORMAT: vi använder aldrig AI-tankestreck som separator i rubriker eller text, alltid kolon (:). */

// Mörk lokal palett för just denna vy (resten av team-tavlan är ljus). Accenterna håller
// sig i guld/roseguld/rosa-familjen som efterfrågat, men är distinkta nog per område.
const D = {
  bg: 'linear-gradient(180deg, #0b1022 0%, #0c1020 42%, #0e0f17 100%)',
  panel: 'rgba(255,255,255,0.045)',
  panelSolid: '#141a2c',
  line: 'rgba(255,255,255,0.10)',
  ink: '#ede7f0',          // primär ljus text
  inkSoft: '#a9a6c0',      // sekundär text
  gold: '#f0cf8c',         // guld (rubriker, accenter)
}

// De fem områdena vi väver samman. accent = nodens glöd och badge-färg, alla hållna i en mjuk
// guld -> roseguld -> rosa-skala (champagneguld, roseguld, mjuk rosa, persika, djup ros) så att
// paletten känns lugn och sammanhängande mot den mörka bakgrunden i stället för skrikig.
const AREAS = {
  company: { label: 'Bolagsbildning', glyph: '🏛️', accent: '#ecd08a' },
  infra: { label: 'Infrastruktur & Inköp', glyph: '🧰', accent: '#dcae93' },
  dev: { label: 'Utveckling', glyph: '💻', accent: '#ef8fa6' },
  mkt: { label: 'Marknadsföring & Tillväxt', glyph: '📣', accent: '#f59e8b' },
  launch: { label: 'Lansering & Juridik', glyph: '🚀', accent: '#d4627a' },
}
const AREA_KEYS = Object.keys(AREAS)

/* Färdplanen i kronologisk ordning, med områdena medvetet VARVADE: medan de långa väntetiderna
   (Bolagsverket, bankens KYC, butikernas granskning) löper parallellt jobbar vi vidare med infra,
   utveckling och marknadsföring. Ordningen respekterar de hårda beroendena (företagskonto kräver
   organisationsnummer, inlämning kräver färdig app, lansering kräver godkänd granskning).
   days = uppskattad tid steget tar (driver avståndet till nästa nod). kind: 'work' = aktivt arbete,
   'wait' = väntetid vi inte styr över (handläggning, granskning), 'milestone' = sluttillstånd. */
const ROADMAP = [
  { id: 'ab', area: 'company', title: 'Registrera aktiebolag', days: 1, kind: 'work',
    goal: 'Fyll i och skicka in nyregistreringen på verksamt.se till Bolagsverket: bolagsordning, styrelse och firmateckning.' },
  { id: 'loopia', area: 'infra', title: 'Aktivera Loopia Företagspaket', days: 1, kind: 'work',
    goal: 'Domänen ledmig.nu, webbhotell och e-postpaket i ett: grunden för både sajt och teamadresser, igång direkt.' },
  { id: 'epost', area: 'infra', title: 'Skapa info@ledmig.nu', days: 1, kind: 'work',
    goal: 'Sätt upp teamets e-postadresser och vidarebefordran så att kontakt och konton blir professionella.' },
  { id: 'bolagsverket', area: 'company', title: 'Bolagsverkets handläggning', days: 21, kind: 'wait',
    goal: 'Vänta in organisationsnummer och registreringsbevis. Under tiden bygger vi vidare på sajt och kod.' },
  { id: 'isolering', area: 'dev', title: 'Säkra sessionsisolering', days: 5, kind: 'work',
    goal: 'Strikt per-användarisolering i chatt och API så att ingen ser någon annans data (OWASP A01).' },
  { id: 'landing', area: 'mkt', title: 'Landningssida för ledmig.nu', days: 4, kind: 'work',
    goal: 'Publicera en landningssida med tydligt budskap och en väntelista som börjar bygga målgrupp tidigt.' },
  { id: 'bankkonto', area: 'company', title: 'Företagskonto + aktiekapital', days: 2, kind: 'work',
    goal: 'När organisationsnumret finns: boka bank, sätt in aktiekapitalet (25 000 kr) och få bankintyget.' },
  { id: 'inkop', area: 'infra', title: 'Inköp: testhårdvara + tjänster', days: 4, kind: 'work',
    goal: 'Testtelefoner (iOS och Android), kart-API-kvot och molnkredit så att vi kan bygga och prova på riktig hårdvara.' },
  { id: 'kyc', area: 'company', title: 'Bankens KYC-handläggning', days: 14, kind: 'wait',
    goal: 'Kundkännedom och penningtvättskontroll innan företagskontot aktiveras: en process vi får vänta ut.' },
  { id: 'radar', area: 'dev', title: 'Integrera kart-radar', days: 12, kind: 'work',
    goal: 'Risk-radar på kartan som väver samman polisens öppna data och safe havens till en tryggare rutt.' },
  { id: 'nyhetsbrev', area: 'mkt', title: 'Samla mailadresser (Loopia nyhetsbrev)', days: 3, kind: 'work',
    goal: 'Opt-in-formulär och nyhetsbrev via Loopia, helt enligt GDPR: aktivt samtycke och enkel avregistrering.' },
  { id: 'beta', area: 'dev', title: 'Betatest av fotstegs-gränssnitt', days: 3, kind: 'work',
    goal: 'Släpp en intern beta av den stegvisa hemvägs-navigeringen och samla första intrycken.' },
  { id: 'gdpr', area: 'launch', title: 'Integritetspolicy och GDPR', days: 3, kind: 'work',
    goal: 'Publicera integritetspolicy, dataskyddsinformation och samtyckesflöden innan vi släpper appen publikt.' },
  { id: 'ux', area: 'dev', title: 'UX-iteration av fotstegs-gränssnittet', days: 21, kind: 'work',
    goal: 'Iterera designen utifrån betatestarnas feedback tills känslan av trygghet sitter: tar tid, men avgör allt.' },
  { id: 'donation', area: 'launch', title: 'Donationslösning', days: 3, kind: 'work',
    goal: 'Sätt upp donationer (Swish och Stripe) så att driften kan finansieras utan att låsa funktioner bakom betalvägg.' },
  { id: 'kampanj', area: 'mkt', title: 'Lanseringskampanj i sociala medier', days: 6, kind: 'work',
    goal: 'Riktad kampanj mot målgruppen kring trygghet och vägen hem: bygg räckvidd inför lanseringen.' },
  { id: 'submit', area: 'launch', title: 'Skicka in till App Store och Google Play', days: 2, kind: 'work',
    goal: 'Bygg, signera och lämna in apparna för granskning med butikstexter, skärmbilder och åldersmärkning.' },
  { id: 'review', area: 'launch', title: 'Butikernas granskningsprocess', days: 14, kind: 'wait',
    goal: 'Apples och Googles granskning innan appen blir publik: en väntetid vi planerar in, inte hoppas bort.' },
  { id: 'launch', area: 'launch', title: 'Lansering av LedMig', days: 0, kind: 'milestone',
    goal: 'Go-live: appen och ledmig.nu är publika och de första användarna kan ta sig hem tryggare.' },
]

// Tidstypografi: höjden mellan två noder (px) som funktion av antal dagar. Klampad så att korta
// steg blir tajta och långa väntetider tydligt glesa, utan att en enda nod tar över hela sidan.
const gapPx = (days) => Math.round(Math.min(190, Math.max(26, 20 + days * 6)))

// Mänsklig tidsetikett. Vi lagrar bara dagar och formaterar här (slipper pluralfel i datan).
function durLabel(days) {
  if (days <= 0) return 'mål'
  if (days === 1) return '≈ 1 dag'
  if (days < 7) return `≈ ${days} dagar`
  const w = Math.round(days / 7)
  return w === 1 ? '≈ 1 vecka' : `≈ ${w} veckor`
}

export default function Roadmap() {
  // Per-användare i localStorage: vilka områden som visas + vilka noder som är expanderade.
  const [hidden, setHidden] = useState(() => new Set())
  const [open, setOpen] = useState(() => new Set())

  const items = useMemo(() => ROADMAP.filter((m) => !hidden.has(m.area)), [hidden])

  // Sammanlagd uppskattad genomloppstid (vissa steg överlappar i praktiken: en grov vägledning).
  const totalDays = useMemo(() => ROADMAP.reduce((s, m) => s + m.days, 0), [])
  const totalWeeks = Math.round(totalDays / 7)

  const toggleArea = (k) => setHidden((h) => {
    const n = new Set(h)
    n.has(k) ? n.delete(k) : n.add(k)
    return n
  })
  const toggleNode = (id) => setOpen((o) => {
    const n = new Set(o)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const allOpen = items.length > 0 && items.every((m) => open.has(m.id))
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(items.map((m) => m.id)))

  return (
    <div style={{ height: '100%', overflow: 'auto', background: D.bg }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px clamp(14px, 4vw, 34px) 90px' }}>
        <h2 style={{ fontSize: 'clamp(20px, 3.4vw, 26px)', fontWeight: 800, color: D.gold, margin: '0 0 6px', letterSpacing: 0.2 }}>
          🧭 Projektets Tidslinje
        </h2>
        <p style={{ fontSize: 13.5, color: D.inkSoft, lineHeight: 1.6, margin: '0 0 18px', maxWidth: 640 }}>
          Hela bolagsresan i kronologisk ordning: bolagsbildning, infrastruktur, utveckling, marknadsföring
          och lansering vävs samman. Avståndet mellan punkterna speglar tiden: tätt = snabbt, stort glapp =
          väntetid. Tryck på en nod för att se målet med steget.
        </p>

        {/* Områdesfilter (klickbart) + sammanfattning av total tid + expandera alla. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 26 }}>
          {AREA_KEYS.map((k) => {
            const a = AREAS[k]
            const on = !hidden.has(k)
            return (
              <button key={k} onClick={() => toggleArea(k)} aria-pressed={on} aria-label={`Visa eller dölj ${a.label}`} title={`Visa/dölj ${a.label}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
                border: `1.5px solid ${on ? a.accent + '99' : D.line}`,
                background: on ? a.accent + '22' : 'transparent',
                color: on ? D.ink : D.inkSoft, fontWeight: 700, fontSize: 12.5,
                opacity: on ? 1 : 0.55, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                <span>{a.glyph}</span>{a.label}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <span title="Grov uppskattning: vissa steg överlappar i praktiken" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
            border: `1px solid ${D.gold}55`, background: D.gold + '14', color: D.gold, fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap',
          }}>⏱️ ≈ {totalWeeks} veckor totalt</span>
          <button onClick={toggleAll} style={{
            border: `1px solid ${D.line}`, background: D.panel, color: D.inkSoft, fontWeight: 700, fontSize: 12.5,
            padding: '6px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{allOpen ? 'Fäll ihop alla' : 'Expandera alla'}</button>
        </div>

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', color: D.inkSoft, padding: 60, fontSize: 14 }}>
            Inga områden valda: slå på minst ett område ovan för att se färdplanen.
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            {/* Spåret: en kontinuerlig toning (vibrant guld/rosa överst, mörkare nederst) som
                "rinner" nedåt = den pulserande gången. Ligger bakom noderna (lm-rm-rail i index.css). */}
            <div className="lm-rm-rail" style={{ position: 'absolute', left: 22, top: 14, bottom: 14, width: 3, borderRadius: 3 }} />

            {items.map((m, i) => {
              const a = AREAS[m.area]
              const isOpen = open.has(m.id)
              const last = i === items.length - 1
              return (
                <div key={m.id}>
                  <Node m={m} a={a} isOpen={isOpen} onToggle={() => toggleNode(m.id)} />
                  {/* Kopplingen: ett tomrum vars HÖJD = tiden steget tar. En liten etikett sitter mitt i
                      glappet, väntetider markeras tydligare med timglas. Sista noden får ingen koppling. */}
                  {!last && <Connector m={m} />}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// En nod: glödande prick (områdesfärg) på spåret + ett expanderbart kort med mål.
function Node({ m, a, isOpen, onToggle }) {
  const milestone = m.kind === 'milestone'
  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      <div style={{ flex: '0 0 46px', display: 'flex', justifyContent: 'center', zIndex: 1 }}>
        <div className="lm-rm-node" style={{
          '--rm-glow': a.accent,
          width: milestone ? 44 : 38, height: milestone ? 44 : 38, borderRadius: 999,
          background: D.panelSolid, border: `2px solid ${a.accent}`,
          display: 'grid', placeItems: 'center', fontSize: milestone ? 20 : 16,
        }}>{milestone ? '🏁' : a.glyph}</div>
      </div>

      <button onClick={onToggle} aria-expanded={isOpen} aria-label={`${isOpen ? 'Dölj' : 'Visa'} mål för ${m.title}`} style={{
        flex: 1, textAlign: 'left', cursor: 'pointer',
        background: milestone ? a.accent + '1f' : D.panel,
        border: `1px solid ${milestone ? a.accent + '88' : a.accent + '3a'}`,
        borderRadius: 14, padding: '12px 15px', color: D.ink,
        boxShadow: milestone ? `0 0 22px ${a.accent}33` : 'none',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800,
            color: a.accent, background: a.accent + '1c', padding: '2px 9px', borderRadius: 999,
          }}>{a.glyph} {a.label}</span>
          {m.kind === 'wait' && (
            <span style={{ fontSize: 10.5, fontWeight: 800, color: D.inkSoft, background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 999 }}>⏳ väntetid</span>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: D.gold, background: D.gold + '14', padding: '2px 9px', borderRadius: 999 }}>
            {m.days > 0 ? durLabel(m.days) : '🎯 mål'}
          </span>
          <span style={{ fontSize: 12, color: D.inkSoft, transition: 'transform .15s ease', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
        </div>

        <div style={{ fontSize: 15.5, fontWeight: 800, color: milestone ? D.gold : D.ink, marginTop: 8 }}>{m.title}</div>

        {isOpen && (
          <div style={{ fontSize: 13, color: D.inkSoft, lineHeight: 1.6, marginTop: 8, borderTop: `1px solid ${D.line}`, paddingTop: 9 }}>
            <b style={{ color: a.accent, fontWeight: 800 }}>Mål:</b> {m.goal}
          </div>
        )}
      </button>
    </div>
  )
}

// Tidsglappet mellan två noder: höjden bär informationen (avstånd = tid), etiketten förtydligar.
function Connector({ m }) {
  const wait = m.kind === 'wait'
  return (
    <div style={{ position: 'relative', height: gapPx(m.days) }}>
      <span style={{
        position: 'absolute', left: 60, top: '50%', transform: 'translateY(-50%)',
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
        color: wait ? D.gold : D.inkSoft,
        background: wait ? D.gold + '12' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${wait ? D.gold + '44' : 'rgba(255,255,255,0.07)'}`,
        padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      }}>
        <span style={wait ? { animation: 'lm-pulse 2s ease-in-out infinite' } : undefined}>{wait ? '⏳' : '↓'}</span>
        {durLabel(m.days)}{wait ? ' väntetid' : ''}
      </span>
    </div>
  )
}
