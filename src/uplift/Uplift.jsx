import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import baseline from './baseline.json'
import { optimize } from './optimizer'

/* ───────────────────────── Uplift-modellering: /UpliftModeling ─────────────────────────
   En datadriven optimeringsmodul för våra fysiska kampanjer (broschyrutskick) över Umeå. Modellen i
   den här versionen maximerar ENBART finansiell nettovinst: donationer minus produkt- och portokostnad.

   Två steg, samma som backend (api_server/uplift.py):
     1. En Causal Forest (econml) skattar donationslyftet per stadsdel utifrån reella ekonomiska
        indikatorer (medelinkomst, åldersstruktur, andel fastighetsägare).
     2. En knapsack-optimering (OR-Tools, här speglad i ren JS) fördelar våra två broschyrtyper
        (Standard / Premium) mot en dynamisk budget för att krama ut maximal nettovinst.

   Visuellt: appens mörka natt-estetik (#0A0E1A) med varma accenter i guld, roseguld och mjuk rosa.
   Stadsdelarna ritas som mjuka, glödande zoner på en mörk Umeå-karta:
     · Guld/roseguld-glöd  = Premium-broschyr (där den dyrare satsningen maximerar vinsten)
     · Mjukt rosa-glöd     = Standard-broschyr
     · Dämpad, mörk zon    = modellen avstår (förlust, eller budgeten räcker bättre på annat håll)
   En glaspanel flyter ovanpå med realtids-KPI:er och reglage (budget + produktionskostnader): dra i
   dem och se hur OR-Tools räknar om och zonerna flyttar sig direkt.

   FORMAT: aldrig AI-tankestreck som separator, alltid kolon (:). Inline-stilar (projektets konvention,
   ingen Tailwind), tunga animationer respekterar prefers-reduced-motion via uplift.css. */

// Backend-bas: samma Cloud Run-tjänst som resten av LedMig (publik URL, ok i klartext). Vi definierar
// den LOKALT i stället för att importera ../chat, så att den här sidans bundle förblir lätt och frikopplad.
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://ledmig-65580962936.europe-north1.run.app').replace(/\/$/, '')

// Mörk natt-palett med varma accenter (lånad från appen, skalad för en datatät karta + panel).
const T = {
  bg: '#0A0E1A',
  ink: '#eef1fb', inkSoft: '#a6b0cf', inkFaint: '#737d9e',
  gold: '#f2c879', goldDeep: '#caa24e',
  roseGold: '#e7a98b',
  pink: '#f4a8c8', pinkDeep: '#e06f9b',
  line: 'rgba(231,169,139,0.20)',
  glass: 'rgba(14,19,36,0.62)',
  glassEdge: 'rgba(231,169,139,0.26)',
}

// Per beslut: fyllning/kontur/glöd på kartzonen + accentfärg i panel/legend.
const ZONE = {
  premium: {
    label: 'Premium', fill: '#e7b15f', stroke: '#f6d18a', fillOp: 0.42, strokeOp: 0.95, weight: 1.6,
    glow: 'drop-shadow(0 0 9px rgba(242,201,121,0.9)) drop-shadow(0 0 24px rgba(226,165,82,0.55))',
    accent: '#f2c879',
  },
  standard: {
    label: 'Standard', fill: '#df83a9', stroke: '#f6a9cb', fillOp: 0.38, strokeOp: 0.92, weight: 1.5,
    glow: 'drop-shadow(0 0 9px rgba(244,160,200,0.85)) drop-shadow(0 0 22px rgba(223,110,158,0.5))',
    accent: '#f4a8c8',
  },
  none: {
    label: 'Avstår', fill: '#33405e', stroke: '#566489', fillOp: 0.16, strokeOp: 0.5, weight: 1.0,
    glow: 'drop-shadow(0 0 3px rgba(70,84,128,0.35))',
    accent: '#737d9e',
  },
}

const fmtSEK = (x) => `${Math.round(x).toLocaleString('sv-SE')} kr`
const fmtInt = (x) => Math.round(x).toLocaleString('sv-SE')

export default function Uplift() {
  // Stadsdelarna (geometri + demografi) kommer från den bakade ögonblicksbilden; lyftet kan friskas upp
  // från backend om den råkar ha ML-lagret installerat (annars behåller vi ögonblicksbilden, tyst).
  const districts = baseline.districts
  const city = baseline.city
  const [uplift, setUplift] = useState(() => ({ ...baseline.uplift }))
  const [source, setSource] = useState('snapshot')   // 'snapshot' | 'live'

  // Slider-styrd kampanjekonomi (initieras från modellens defaultvärden).
  const d0 = baseline.defaults
  const [budget, setBudget] = useState(d0.budget_sek)
  const [costStandard, setCostStandard] = useState(d0.cost_standard)
  const [costPremium, setCostPremium] = useState(d0.cost_premium)
  const [multPremium, setMultPremium] = useState(d0.mult_premium)
  const rideCost = baseline.ride_cost_sek

  const econ = useMemo(() => ({
    budget, costStandard, costPremium,
    multStandard: d0.mult_standard, multPremium, rideCost,
  }), [budget, costStandard, costPremium, multPremium, d0.mult_standard, rideCost])

  // Lös om allokeringen direkt när lyft eller reglage ändras (uttömmande sökning, < 1 ms).
  const solution = useMemo(() => optimize(districts, uplift, econ), [districts, uplift, econ])

  // Referenslösning med obegränsad budget: ger taket för "gratis hemresor"-mätaren (hur nära maximal
  // möjlig effekt vi är vid nuvarande kostnader). Beror på allt UTOM budgeten.
  const reference = useMemo(
    () => optimize(districts, uplift, { ...econ, budget: 1e12 }),
    [districts, uplift, econ.costStandard, econ.costPremium, econ.multStandard, econ.multPremium, econ.rideCost], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Friska upp lyftet från backend (om provisionerad). 503/timeout/offline -> behåll ögonblicksbilden.
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4500)
    fetch(`${API_BASE}/api/uplift/baseline`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.ok && data.uplift) { setUplift(data.uplift); setSource('live') }
      })
      .catch(() => { /* tyst: ögonblicksbilden räcker, sidan fungerar alltid */ })
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [])

  return (
    <div className="uplift-root" style={{ background: T.bg, color: T.ink }}>
      <MapCanvas districts={districts} city={city} solution={solution} />
      <Header source={source} />
      <Panel
        solution={solution} reference={reference} rideCost={rideCost}
        budget={budget} setBudget={setBudget}
        costStandard={costStandard} setCostStandard={setCostStandard}
        costPremium={costPremium} setCostPremium={setCostPremium}
        multPremium={multPremium} setMultPremium={setMultPremium}
        onReset={() => {
          setBudget(d0.budget_sek); setCostStandard(d0.cost_standard)
          setCostPremium(d0.cost_premium); setMultPremium(d0.mult_premium)
        }}
      />
    </div>
  )
}

/* ───────────────────────── Karta (Leaflet, mörka CARTO-tiles + glödande zoner) ───────────────────────── */
function MapCanvas({ districts, city, solution }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const zonesRef = useRef({})   // key -> { poly, label }

  // Skapa kartan EN gång.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return
    const map = L.map(elRef.current, {
      center: city.center, zoom: city.zoom, zoomControl: false,
      attributionControl: true, scrollWheelZoom: true, minZoom: 10, maxZoom: 17,
    })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    // Mörk basemap (CARTO dark_all): fri med attribution, https (tillåts av CSP img-src). Bakgrunden är
    // ändå mörk (#0A0E1A) så ev. luckor i kakelladdningen ser avsiktliga ut.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, detectRetina: true,
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map)

    districts.forEach((d) => {
      const poly = L.polygon(d.polygon, {
        className: 'uplift-zone', fillColor: ZONE.none.fill, color: ZONE.none.stroke,
        fillOpacity: ZONE.none.fillOp, weight: ZONE.none.weight, opacity: ZONE.none.strokeOp,
        lineJoin: 'round',
      }).addTo(map)
      poly.bindPopup('', { className: 'uplift-popup', maxWidth: 280, closeButton: true })
      const label = L.marker(d.center, {
        icon: L.divIcon({ className: 'uplift-zonelabel', html: '', iconSize: [120, 34] }),
        interactive: false, keyboard: false,
      }).addTo(map)
      zonesRef.current[d.key] = { poly, label }
    })

    mapRef.current = map
    // Säkerställ korrekt storlek (full viewport från start, men en tick skadar inte).
    setTimeout(() => map.invalidateSize(), 60)
    return () => { map.remove(); mapRef.current = null; zonesRef.current = {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Måla om zonerna när lösningen ändras (färg, glöd, etikett, popup-innehåll).
  useEffect(() => {
    if (!mapRef.current) return
    solution.districts.forEach((ds) => {
      const ref = zonesRef.current[ds.key]
      if (!ref) return
      const z = ZONE[ds.decision] || ZONE.none
      ref.poly.setStyle({
        fillColor: z.fill, color: z.stroke, fillOpacity: z.fillOp, weight: z.weight, opacity: z.strokeOp,
      })
      // Glöd + puls-klass per beslut ligger som CSS-filter direkt på SVG-pathen. Vi TOGGLAR bara
      // besluts-klassen via classList (rör inte Leaflets egen 'leaflet-interactive', som krävs för klick).
      const path = ref.poly._path
      if (path) {
        path.style.filter = z.glow
        path.classList.add('uplift-zone')
        path.classList.remove('uplift-zone--premium', 'uplift-zone--standard', 'uplift-zone--none')
        path.classList.add(`uplift-zone--${ds.decision}`)
      }
      ref.poly.setPopupContent(popupHtml(ds))
      ref.label.setIcon(L.divIcon({
        className: 'uplift-zonelabel', iconSize: [130, 36], html: labelHtml(ds),
      }))
    })
  }, [solution])

  return <div ref={elRef} className="uplift-map" aria-label="Karta över Umeå med modellens kampanjzoner" />
}

// Liten alltid-synlig etikett vid stadsdelens centrum.
function labelHtml(ds) {
  const z = ZONE[ds.decision] || ZONE.none
  return `<div class="uplift-zonelabel__inner uplift-zonelabel--${ds.decision}">
    <span class="uplift-zonelabel__dot" style="background:${z.accent}"></span>
    <span class="uplift-zonelabel__name">${esc(ds.name)}</span>
  </div>`
}

// Rik popup vid klick/tryck: visar hur algoritmen resonerat för just den stadsdelen.
function popupHtml(ds) {
  const z = ZONE[ds.decision] || ZONE.none
  const netClass = ds.net_sek >= 0 ? 'pos' : 'neg'
  return `<div class="uplift-pop">
    <div class="uplift-pop__head">
      <b>${esc(ds.name)}</b>
      <span class="uplift-chip" style="color:${z.accent};border-color:${z.accent}55;background:${z.accent}1a">${z.label}</span>
    </div>
    <div class="uplift-pop__grid">
      <div><span>Lyft</span><b>${ds.uplift_sek.toFixed(1)} kr/hushåll</b></div>
      <div><span>Hushåll</span><b>${fmtInt(ds.households)}</b></div>
      <div><span>Utskick</span><b>${fmtInt(ds.units)}</b></div>
      <div><span>Kostnad</span><b>${fmtSEK(ds.cost_sek)}</b></div>
      <div><span>Brutto</span><b>${fmtSEK(ds.gross_sek)}</b></div>
      <div><span>Netto</span><b class="uplift-${netClass}">${fmtSEK(ds.net_sek)}</b></div>
    </div>
    <div class="uplift-pop__reason">${esc(ds.reason)}</div>
  </div>`
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

/* ───────────────────────── Rubrik (uppe till vänster) ───────────────────────── */
function Header({ source }) {
  return (
    <header className="uplift-header">
      <div className="uplift-header__eyebrow">LedMig · kampanjoptimering</div>
      <h1 className="uplift-header__title">Uplift-modellering: Umeå</h1>
      <p className="uplift-header__sub">
        Causal Forest skattar donationslyftet per stadsdel. OR-Tools fördelar broschyrerna mot budgeten
        för maximal nettovinst.
      </p>
      <div className="uplift-source">
        <span className={`uplift-source__dot ${source === 'live' ? 'is-live' : ''}`} />
        {source === 'live'
          ? 'Modell: live från backend (econml + OR-Tools)'
          : 'Modell: tränad ögonblicksbild (econml + OR-Tools)'}
      </div>
    </header>
  )
}

/* ───────────────────────── Glaspanel (KPI:er + reglage) ───────────────────────── */
function Panel({
  solution, reference, rideCost, budget, setBudget, costStandard, setCostStandard,
  costPremium, setCostPremium, multPremium, setMultPremium, onReset,
}) {
  const k = solution.kpis
  const maxRides = Math.max(1, reference.kpis.free_rides_funded)
  return (
    <aside className="uplift-panel">
      <div className="uplift-panel__scroll">
        {/* Nettovinst: kampanjens hela poäng */}
        <div className="uplift-net">
          <div className="uplift-net__label">Beräknad nettovinst</div>
          <div className="uplift-net__value">{fmtSEK(k.net_profit_sek)}</div>
          <div className="uplift-net__sub">
            Donationer {fmtSEK(k.gross_donations_sek)} − kostnad {fmtSEK(k.spend_sek)}
          </div>
        </div>

        {/* Gratis hemresor: nettovinsten översatt till finansierade trygghetsresor */}
        <RidesGauge rides={k.free_rides_funded} max={maxRides} rideCost={rideCost} />

        {/* Utskick per kategori + avstådda områden */}
        <div className="uplift-stats">
          <Stat accent={ZONE.premium.accent} big={fmtInt(k.units_premium)} small={`Premium · ${k.districts_premium} omr.`} />
          <Stat accent={ZONE.standard.accent} big={fmtInt(k.units_standard)} small={`Standard · ${k.districts_standard} omr.`} />
          <Stat accent={ZONE.none.accent} big={String(k.districts_skipped)} small="Avstådda områden" />
        </div>

        {/* Budgetutnyttjande */}
        <div className="uplift-budgetbar">
          <div className="uplift-budgetbar__row">
            <span>Budget förbrukad</span>
            <span>{Math.round((k.budget_utilization || 0) * 100)}%</span>
          </div>
          <div className="uplift-budgetbar__track">
            <div className="uplift-budgetbar__fill" style={{ width: `${Math.min(100, (k.budget_utilization || 0) * 100)}%` }} />
          </div>
          <div className="uplift-budgetbar__hint">{fmtSEK(k.spend_sek)} av {fmtSEK(k.budget_sek)}</div>
        </div>

        <div className="uplift-divider" />

        {/* Reglage: dra och se zonerna flytta sig i realtid */}
        <Slider label="Total budget" value={budget} min={0} max={600000} step={10000}
          onChange={setBudget} fmt={fmtSEK} />
        <Slider label="Styckkostnad Standard" value={costStandard} min={1} max={30} step={0.5}
          onChange={setCostStandard} fmt={(v) => `${v.toFixed(1)} kr`} />
        <Slider label="Styckkostnad Premium" value={costPremium} min={10} max={120} step={1}
          onChange={setCostPremium} fmt={(v) => `${Math.round(v)} kr`} />
        <Slider label="Premium: övertalningsgrad" value={multPremium} min={1} max={3} step={0.1}
          onChange={setMultPremium} fmt={(v) => `${v.toFixed(1)}×`} />

        <button type="button" className="uplift-reset" onClick={onReset}>Återställ förutsättningar</button>

        {/* Legend */}
        <div className="uplift-legend">
          <LegendItem accent={ZONE.premium.accent} text="Premium-broschyr (guld/roseguld)" />
          <LegendItem accent={ZONE.standard.accent} text="Standard-broschyr (mjuk rosa)" />
          <LegendItem accent={ZONE.none.accent} text="Modellen avstår (mörk zon)" />
        </div>
      </div>
    </aside>
  )
}

function Stat({ accent, big, small }) {
  return (
    <div className="uplift-stat">
      <div className="uplift-stat__big" style={{ color: accent }}>{big}</div>
      <div className="uplift-stat__small">{small}</div>
    </div>
  )
}

function LegendItem({ accent, text }) {
  return (
    <div className="uplift-legend__item">
      <span className="uplift-legend__dot" style={{ background: accent }} />
      <span>{text}</span>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, fmt }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 50   // skydd mot division med noll om min === max
  return (
    <label className="uplift-slider">
      <div className="uplift-slider__top">
        <span>{label}</span>
        <span className="uplift-slider__val">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label} aria-valuetext={fmt(value)}
        style={{ '--pct': `${pct}%` }}
      />
    </label>
  )
}

/* Radiell mätare: hur många gratis hemresor kampanjens netto finansierar (relativt taket vid obegränsad budget). */
function RidesGauge({ rides, max, rideCost }) {
  const R = 52
  const C = 2 * Math.PI * R
  const frac = Math.max(0, Math.min(1, rides / max))
  return (
    <div className="uplift-gauge">
      <svg viewBox="0 0 140 140" className="uplift-gauge__svg" aria-hidden="true">
        <defs>
          <linearGradient id="uplift-gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f4a8c8" />
            <stop offset="100%" stopColor="#f2c879" />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={R} className="uplift-gauge__track" />
        <circle
          cx="70" cy="70" r={R} className="uplift-gauge__arc"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 70 70)"
        />
      </svg>
      <div className="uplift-gauge__center">
        <div className="uplift-gauge__num">{fmtInt(rides)}</div>
        <div className="uplift-gauge__cap">gratis hemresor</div>
      </div>
      <div className="uplift-gauge__foot">finansierade ({fmtSEK(rideCost)}/resa)</div>
    </div>
  )
}
