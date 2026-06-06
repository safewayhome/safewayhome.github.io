/**
 * Innehåll till Changelog-vyn — systembeskrivning, arkitektur-karta och kronologisk changelog.
 * Författat mot projektets faktiska historik (git-logg + HANDOFF_STATUS + README), inte påhittat.
 * Statiskt så vyn fungerar utan backend och är lika för hela teamet.
 */

// Färg per område (matchar team-kategorierna + en neutral ton för infra).
export const AREA = {
  dev: { label: 'Utveckling', color: '#fb7185', glyph: '💻' },
  backend: { label: 'Backend', color: '#6aa9f4', glyph: '⚙️' },
  data: { label: 'Data', color: '#9b8cf0', glyph: '🛰️' },
  mkt: { label: 'Marknad', color: '#f0a83c', glyph: '📣' },
  infra: { label: 'Infra', color: '#3fb5a3', glyph: '🧱' },
}

export const SYSTEM_DESC = {
  tagline: 'LedMig hittar inte den snabbaste vägen hem, utan den tryggaste — och låter någon vaka över dig hela vägen.',
  paragraphs: [
    'De flesta känner igen känslan: det är sent och mörkt, och man har en bit kvar att gå hem. Man väljer den upplysta gatan i stället för genvägen, lyssnar efter steg bakom sig, eller har telefonen redo i handen. LedMig är byggd för just den situationen. I stället för att bara visa snabbaste vägen, som vanliga kartor gör, räknar appen ut den tryggaste vägen hem. Varje gatusträcka får ett säkerhetsbetyg från 0 till 100, och appen väljer en rutt som styr runt platser som bedöms som mer otrygga. Du skriver in var du är och vart du ska, och ser allt på en vanlig karta med beräknad gångtid.',
    'Betygen bygger på fakta, inte gissningar. Den viktigaste källan är polisens öppna lista över händelser, som redan är avidentifierad och inte innehåller namn eller personnummer. Till det läggs väder och sikt från SMHI (i mörker och dimma väljer appen hellre upplysta stråk), kollektivtrafikförseningar och vägdata om till exempel trottoarer. En plats där något hänt för länge sedan väger mindre med tiden, och om belysning eller annan trygghetsinfrastruktur har installerats efteråt dämpas den gamla risken. Appen pekar också ut trygga punkter som är öppna dygnet runt, som bensinmackar, sjukhus och polisstationer.',
    'Skulle något kännas fel under promenaden finns ett tyst nödläge. Du kan låta en betrodd person vaka över din väg och se att du checkar in och kommer fram — men servern får aldrig din exakta position i klartext, utan jämför bara skyddade koder. Det finns två PIN-koder: en avbryter ett larm, och en nödkod som i hemlighet skickar ett larm samtidigt som skärmen ser ut som om appen är avstängd, tänkt för lägen där man inte vågar visa att man ringer efter hjälp. En fem sekunders nedräkning gör att falsklarm hinner stoppas.',
    'En bärande tanke i hela projektet är var informationen kommer ifrån. Appen använder enbart lagliga, öppna och avidentifierade källor, tvättar bort personuppgifter automatiskt, och om tvätten inte kan göras säkert sparas inget alls. Detta är ett pågående examensarbete, så allt är inte färdigt. Grunden står stadigt: databasen, kartan, adress-till-adress-navigeringen, säkerhetsruttens kärna och de lagliga datakällorna är på plats, och appen ligger uppe i molnet. Andra delar är påbörjade eller fortfarande på ritbordet — särskilt de som ska bo direkt i mobilen, som det tysta nödläget och larm utan internet. En genomgående regel är att om en datakälla ligger nere ska appen tyst falla tillbaka på något neutralt i stället för att krascha eller invagga i falsk trygghet.',
  ],
  principles: [
    { icon: '🛡️', title: 'Trygghet före hastighet', text: 'Appen utgår från en verklig situation — att ta sig hem tryggt på kvällen — och väljer den väg som bedöms säkrast utifrån faktiska händelser, sikt och belysning, inte bara den snabbaste.' },
    { icon: '⚖️', title: 'Bara laglig, avidentifierad data', text: 'Appen bygger enbart på öppna, lagliga källor som polisens avidentifierade API. Personuppgifter tvättas bort automatiskt, och olaglig skrapning är borttagen och får inte återinföras.' },
    { icon: '🔒', title: 'Integritet i grunden', text: 'Din exakta GPS-position lämnar aldrig telefonen i klartext — väktarfunktionen och servern jämför bara skyddade, krypterade koder.' },
    { icon: '📴', title: 'Fungerar även när annat fallerar', text: 'Om en datakälla eller uppkopplingen faller bort fortsätter appen försiktigt i stället för att krascha eller ge ett falskt lugn.' },
  ],
}

// Arkitektur uppifrån och ner: app → API → kärna → lagring → datakällor.
export const ARCHITECTURE = {
  intro: 'LedMig räknar fram den säkraste gångvägen mellan två adresser och håller ett vakande öga på promenaden hela vägen hem. Så här hänger delarna ihop, uppifrån och ner:',
  flowNote: 'Du skriver in vart du ska i appen. API:t verifierar din inloggning och frågar kärnan, som väger ihop brott, väder och vägnät från de lagliga datakällorna mot den geografiska databasen — och skickar tillbaka den säkraste vägen att rita upp på kartan.',
  layers: [
    {
      id: 'user-app', title: 'Användare & app', subtitle: 'Det användaren ser och rör vid i mobilen',
      nodes: [
        { label: 'React/Vite-frontend', sub: 'Appens skärmar i mobilen', cat: 'dev' },
        { label: 'Kartan (Leaflet/OSM)', sub: 'Visar rutten på riktig karta', cat: 'dev' },
        { label: 'Adress-till-adress', sub: 'Skriv vart du ska', cat: 'dev' },
        { label: 'Krisläge / tyst SOS', sub: 'Dold nödkod larmar tyst', cat: 'dev' },
        { label: 'Guardian-vy', sub: 'Anhörig ser din promenad', cat: 'dev' },
      ],
    },
    {
      id: 'api', title: 'API', subtitle: 'Dörren mellan app och hjärna, på internet',
      nodes: [
        { label: 'FastAPI på Cloud Run', sub: 'Servern appen pratar med', cat: 'backend' },
        { label: 'Supabase auth', sub: 'Kollar att du är inloggad', cat: 'backend' },
        { label: '/api/route', sub: 'Begär den säkraste rutten', cat: 'backend' },
        { label: '/api/context', sub: 'Väder & förseningar nu', cat: 'backend' },
        { label: '/api/fsm/check-pin', sub: 'Vanlig kod eller nödkod', cat: 'backend' },
        { label: 'Mjuk degradering', sub: 'Funkar även om källa saknas', cat: 'backend' },
      ],
    },
    {
      id: 'core', title: 'Kärna', subtitle: 'Hjärnan som väger säkerhet mot avstånd',
      nodes: [
        { label: 'DSRO säkerhetsrouting', sub: 'Säkraste vägen, ej snabbaste', cat: 'backend' },
        { label: 'networkx + H3', sub: 'Vägnät delat i kartrutor', cat: 'backend' },
        { label: 'W_crime (allvarsvikt)', sub: 'Grövre brott väger tyngre', cat: 'data' },
        { label: 'Tidsdämpning', sub: 'Gammalt brott & ny belysning bleknar', cat: 'data' },
        { label: 'Feedback', sub: 'Vägar folk undviker tappar poäng', cat: 'data' },
        { label: '§5-adaptrar (seams)', sub: 'Byt lokalt mot moln enkelt', cat: 'infra' },
      ],
    },
    {
      id: 'storage', title: 'Lagring', subtitle: 'Var datan sparas och söks geografiskt',
      nodes: [
        { label: 'PostgreSQL', sub: 'Databasen som lagrar allt', cat: 'data' },
        { label: 'PostGIS', sub: 'Sökning på plats & avstånd', cat: 'data' },
        { label: 'pgvector', sub: 'Likhetssökning på text', cat: 'data' },
        { label: 'Lokal Docker → Aurora', sub: 'Samma motor lokalt & i moln', cat: 'infra' },
      ],
    },
    {
      id: 'sources', title: 'Lagliga datakällor', subtitle: 'Öppna, lovliga källor som matar säkerheten',
      nodes: [
        { label: 'Polisens händelse-API', sub: 'Anonyma brott, huvudkälla', cat: 'data' },
        { label: 'TDM-nyheter', sub: 'Publik media, namn tvättas bort', cat: 'data' },
        { label: 'SMHI väder', sub: 'Dimma & mörker påverkar rutt', cat: 'data' },
        { label: 'Trafiklab', sub: 'Förseningar förlänger vakt', cat: 'data' },
        { label: 'NVDB', sub: 'Trottoarbredd ger straff/bonus', cat: 'data' },
        { label: 'OSM-vägnät', sub: 'Bygger gångnätet att rutta i', cat: 'data' },
        { label: 'Safe havens', sub: 'Öppna trygga punkter dygnet runt', cat: 'data' },
      ],
    },
  ],
}

// Kronologisk changelog: klart → pågår → planerat (order stigande = tidigare i tiden).
export const CHANGELOG = [
  { order: 1, period: 'April 2026', title: 'Projektstart: LedMig (säkerhet först)', area: 'dev', status: 'done', desc: 'Grundprototyp för en kvinnosäkerhetsapp som räknar fram den säkraste gångvägen mellan två adresser, inte bara den snabbaste.' },
  { order: 2, period: 'April 2026', title: 'PostgreSQL + PostGIS + pgvector-datalager', area: 'backend', status: 'done', desc: 'Fullt datalager med 10 tabeller via SQLAlchemy 2.0, Alembic-migreringar och Docker — samma motor lokalt som i prod (Docker → Aurora).' },
  { order: 3, period: 'April 2026', title: 'Dev-miljö & en-kommandos setup', area: 'infra', status: 'done', desc: 'setup_dev_env.sh sätter idempotent upp venv, beroenden och lokala modeller på M1, med pinnade requirements och .env.local.' },
  { order: 4, period: 'April 2026', title: 'Drive-artefaktlagring', area: 'infra', status: 'done', desc: 'Stora artefakter lagras utanför git på Google Drive och hämtas automatiskt via lazy OAuth och scripts/drive_sync.py.' },
  { order: 5, period: 'April 2026', title: 'Polisens öppna händelse-API', area: 'data', status: 'done', desc: 'fetch_police_events.py hämtar redan anonymiserade brottshändelser per ort som primärkälla, med ärlig User-Agent och artig rate-limit.' },
  { order: 6, period: 'Maj 2026', title: 'DSRO 1.1: severitetsviktad brottssignal', area: 'backend', status: 'done', desc: 'W_crime poängsätter vägkanter genom att binna severitetsviktade incidenter till H3-celler (r8) och sprida dem i k-ring.' },
  { order: 7, period: 'Maj 2026', title: 'DSRO 1.2: temporal infra-dämpning', area: 'backend', status: 'done', desc: 'Incidentvikt halveras med tiden, och dämpas extra när trygghetsinfra installerats efter brottet — all tidsmatematik relativ till nu.' },
  { order: 8, period: 'Maj 2026', title: '§6 kostnadsmatris & PROD_MODE-roadmap', area: 'infra', status: 'done', desc: 'Dokumentation för sömlös lokal-mot-prod-växling via env, med kostnadsresonemang (lokal databas vs Aurora, CoreML vs GPU).' },
  { order: 9, period: 'Maj 2026', title: 'Umeå walk-network-sandbox', area: 'backend', status: 'done', desc: 'simulation_grid.py simulerar gångnätet i Ålidhem/Ersboda/Centralstation med syntetiska incidenter, infra-toggle och recompute-timing.' },
  { order: 10, period: 'Maj 2026', title: 'SMHI väderintegration', area: 'data', status: 'done', desc: 'official_data.py översätter dimma, sikt och mörker till en belysningsmultiplikator så routern föredrar upplysta stråk vid dålig sikt.' },
  { order: 11, period: 'Maj 2026', title: 'Trafiklab GTFS-RT (Virtual Conductor)', area: 'data', status: 'done', desc: 'Nattbuss- och tågförseningar förlänger säkerhetsövervakningens fönster proportionellt; degraderar till tom lista utan API-nyckel.' },
  { order: 12, period: 'Maj 2026', title: 'NVDB trottoargeometri', area: 'data', status: 'done', desc: 'NVDB-attribut som trottoarbredd, separering och skogskant ger statiska straff och bonusar per vägsegment.' },
  { order: 13, period: 'Maj 2026', title: 'FastAPI-bryggan', area: 'backend', status: 'done', desc: 'REST-API på uvicorn exponerar Python-kärnan mot frontenden (route, context, safe-havens, geocode, walk-route, fsm) med mjuk degradering per källa.' },
  { order: 14, period: 'Maj 2026', title: 'Team-board: whiteboard, tidslinje & framsteg', area: 'dev', status: 'done', desc: 'Delad realtidstavla på GitHub Pages med Yjs och Trystero (Nostr) P2P och React Flow — den sida du tittar på just nu.' },
  { order: 15, period: 'Maj 2026', title: 'API-härdning: typade modeller, env-CORS & async I/O', area: 'backend', status: 'done', desc: 'Bryggan fick typade response-modeller, env-styrd CORS, asynkron I/O och en DB-health-endpoint.' },
  { order: 16, period: 'Maj 2026', title: 'Cloud Run-deploy: en tjänst för frontend + API', area: 'infra', status: 'done', desc: 'En Cloud Run-tjänst serverar både den byggda Vite-frontenden och FastAPI från samma origin via en Dockerfile.' },
  { order: 17, period: 'Maj 2026', title: 'OSM-karta & adress-till-adress-navigering i appen', area: 'dev', status: 'done', desc: 'Riktig OpenStreetMap-karta med Leaflet, samt gångväg med restid (min/km) via Nominatim-geokodning, OSRM foot och GPS-origin.' },
  { order: 18, period: 'Maj 2026', title: 'Design, tema & app-funktioner', area: 'dev', status: 'done', desc: 'Varmt ljust nattläge (rose #fb7185, Nunito), adress-autocomplete, bättre kontrast, mobil-chrome, DB-baserade safe havens, dialoger och kontohantering.' },
  { order: 19, period: 'Maj 2026', title: 'Supabase auth-gate', area: 'backend', status: 'done', desc: 'Frontenden loggar in med supabase-js och FastAPI verifierar access-token; konto-endpoints kräver giltig session, och simulerad BankID finns i prototypen.' },
  { order: 20, period: 'Juni 2026', title: 'Rebrand SafeWayHome → LedMig + domän ledmig.nu', area: 'mkt', status: 'done', desc: 'Hela projektet döptes om till LedMig, domänen migrerades till ledmig.nu, och UI, dokumentation och länkar uppdaterades; API:t pekades om till skarp miljö.' },
  { order: 21, period: 'Juni 2026', title: 'TDM-laglig medieinsamling', area: 'data', status: 'done', desc: 'scrape_news_tdm.py hämtar publik nyhetstext under EU DSM art. 4 med robots.txt, TDM-opt-out, fail-closed PII-tvätt och saltad proveniens.' },
  { order: 22, period: 'Juni 2026', title: 'Etik & datalaglighet: olaglig scraping borttagen', area: 'data', status: 'done', desc: 'Tidigare skrapor av forum och fildelningssajter (samt detektionsevasion) raderades och dokumenterades; endast Polis-API och TDM kvarstår.' },
  { order: 23, period: 'Juni 2026', title: 'Härdad datapipeline & rena §5-adaptrar', area: 'backend', status: 'done', desc: 'Datapipeline och appkärna härdades (kraschfixar, SSRF-skydd, retries) och fick rena seam-adaptrar: SpatialDB live mot PostGIS; LLM/Vector definierade men ej inkopplade (FUP pausat).' },
  { order: 24, period: 'Juni 2026', title: 'DSRO säkerhetsrouting som helhet', area: 'backend', status: 'in-progress', desc: 'Sammanvägningen av incidenter, infrastruktur och belysning till en ruttkostnad pågår över gångnätet med networkx och H3.' },
  { order: 25, period: 'Juni 2026', title: 'OSM gång-vägnät & safe havens-insamling', area: 'data', status: 'in-progress', desc: 'osmnx bygger ett routbart gångnät för Umeå, och öppna trygga punkter dygnet runt geokodas till safe_havens-tabellen.' },
  { order: 26, period: 'Juni 2026', title: 'On-device krisläges-FSM & krislägesgränssnitt', area: 'backend', status: 'in-progress', desc: 'Tillståndsmaskin på enheten för duress, akustik och kinetik med två PIN-koder, speglad i ett tyst nödläges-UI med avbrytbar nedräkning och guardian-larm.' },
  { order: 27, period: 'Juni 2026', title: 'Guardian-vy & onboarding/BankID-behörighet', area: 'dev', status: 'in-progress', desc: 'En väktare ser live-position och incheckningar via integritetsbevarande närhetsmatchning (servern ser aldrig rå-GPS), plus inloggning som bara lagrar en eligibility-boolean.' },
  { order: 28, period: 'Juni 2026', title: '§5 migrations-adaptrar (lokal ↔ moln)', area: 'backend', status: 'in-progress', desc: 'Rena seam-gränssnitt för lokal/AWS-byte via env finns; full lokal- och AWS-implementation återstår delvis.' },
  { order: 29, period: 'Juni 2026', title: 'Exjobbsrapport', area: 'mkt', status: 'in-progress', desc: 'Examensarbetet skrivs och struktureras kring bakgrund, metod (DSRO/FSM), etik/GDPR och resultat.' },
  { order: 30, period: 'Planerat', title: 'ML-anomalidetektion (DSRO 1.3)', area: 'backend', status: 'planned', desc: 'Dagens closed-form placeholder ska bytas mot en online-anomalidetektor (IsolationForest/streaming z-score) på live bypass-telemetri.' },
  { order: 31, period: 'Planerat', title: 'Zero-knowledge sister-matchning (PSI)', area: 'backend', status: 'planned', desc: 'Dagens saltade H3-tokens ska uppgraderas till formell ZK via PSI (ECDH-PSI/OPRF) för en riktig integritetsgaranti.' },
  { order: 32, period: 'Planerat', title: 'On-device SOS: BLE-mesh, akustik, kinetik & duress', area: 'dev', status: 'planned', desc: 'Ad-hoc BLE-mesh med signerad TTL-flood och binär-SMS-failover, akustisk incidentdetektion med 5 s nedräkning, kinetisk gångavvikelse och duress-FSM med falsk app-av-skärm.' },
  { order: 33, period: 'Planerat', title: 'Risk-verifierad gratis nödtaxi', area: 'backend', status: 'planned', desc: 'Server-side logik som erbjuder gratis nödtaxi när ruttens säkerhetspoäng är låg eller ett larm är aktivt.' },
  { order: 34, period: 'Planerat', title: 'BankID-provider & mid-session degradering', area: 'backend', status: 'planned', desc: 'Skarp identitetsprovider, VPN/Tor-block med graceful degradation mitt i en session, och ephemeral RAM-inferens för ansiktsmask.' },
  { order: 35, period: 'Planerat', title: 'WebSocket stress-sim & sensor-mockar', area: 'backend', status: 'planned', desc: 'Simulering med 50 bots och 300 m-tröskel för att stress-testa närhetsmatchningen, plus hårdvaru-sensormockar för kinetik och akustik.' },
  { order: 36, period: 'Planerat', title: 'Self-rewarding loop + embeddings', area: 'data', status: 'planned', desc: 'Inkrementell förbättring via incident-matchning med ChromaDB, all-MiniLM-L6-v2 och Ollama lokalt, och pgvector HNSW i prod.' },
  { order: 37, period: 'Planerat', title: 'Pitch, landningssida & användartester', area: 'mkt', status: 'planned', desc: 'Demoberättelse från hot till trygg väg hem, publik landningssida, och användartester av upplevd trygghet nattetid.' },
]
