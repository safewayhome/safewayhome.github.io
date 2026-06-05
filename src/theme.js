// Visual language — borrowed from the SafeWayHome app (soft light "gräddvit" + warm rose),
// but desktop-scaled for a wide team board.
export const T = {
  font: "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif",

  // surfaces
  bg: '#faf6f2',          // gräddvit / cream page
  panel: '#ffffff',
  panelSoft: '#fbf3ef',
  line: '#ece2dc',        // hairline borders
  ink: '#3f3640',         // primary text (warm near-black)
  inkSoft: '#8a7f86',     // secondary text

  // brand
  rose: '#fb7185',
  roseSoft: '#ffe4e9',
  roseDeep: '#e11d48',

  // status
  done: '#34b27b',        // muted green (not too much)
  doneSoft: '#e3f5ec',
  doing: '#f0a83c',
  doingSoft: '#fdeecf',
  todo: '#9aa6b2',
  todoSoft: '#eef1f4',

  shadow: '0 6px 22px rgba(63,54,64,0.10)',
  shadowSoft: '0 2px 8px rgba(63,54,64,0.07)',
  radius: 16,
}

// The four broad teams, each with finer sub-categories. Stable keys (used in stored tasks).
export const CATEGORIES = [
  {
    key: 'dev', label: 'Utveckling', color: '#fb7185', glyph: '💻',
    subs: ['Onboarding & konto', 'Karta & navigation', 'Krisläge / FSM-UI', 'Guardian-vy', 'Design & tema', 'Team-board'],
  },
  {
    key: 'backend', label: 'Backend', color: '#6aa9f4', glyph: '⚙️',
    subs: ['API-server', 'DSRO-routing', 'On-device FSM', 'Databas', 'Integrationer', 'Infra & Drive'],
  },
  {
    key: 'data', label: 'Datainsamling', color: '#9b8cf0', glyph: '🛰️',
    subs: ['Polisens API', 'TDM-medieinsamling', 'Safe havens', 'OSM-vägnät', 'Embeddings / loop'],
  },
  {
    key: 'mkt', label: 'Marknadsföring', color: '#f0a83c', glyph: '📣',
    subs: ['Exjobb & rapport', 'Pitch & demo', 'Webb & landing', 'Användartester'],
  },
]

export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

export const STATUS = {
  todo: { label: 'Att göra', color: T.todo, soft: T.todoSoft },
  doing: { label: 'Pågår', color: T.doing, soft: T.doingSoft },
  done: { label: 'Klar', color: T.done, soft: T.doneSoft },
}

// Distinct, friendly presence colours (team of 3, a couple spare).
export const PRESENCE_COLORS = ['#fb7185', '#6aa9f4', '#34b27b', '#f0a83c', '#9b8cf0']
