import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap, Handle, Position, MarkerType,
  ReactFlowProvider, useReactFlow, useViewport, useNodesState, applyNodeChanges,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { T, CATEGORIES, CAT, STATUS, DIFFICULTIES } from '../theme'
import { updateTask, createTask, setCursor, clearCursor } from '../collab'
import { useCursors } from '../store'
import { fraction, computeProgress, diffOf } from '../util'

const CURSOR_TTL = 6000 // dölj en peers muspekare om den inte rört sig på så här många ms
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo' } // klicka statusprick för att stega

// Rena banor (lanes) i stället för ett radiellt spindelnät: en kolumn per team-kategori.
// Korten staplas snyggt under sin rubrik; bara verkliga beroenden ritas som linjer.
const LANE_W = 320   // horisontellt avstånd mellan kolumner
const CARD_W = 232
const HEADER_Y = -78 // rubrikkortet sitter strax ovanför första uppgiftskortet
const CARD_TOP = 18  // y för första kortet i en kolumn
const CARD_GAP = 124 // vertikalt avstånd mellan kort

// dolda anslutningshandtag (topp/botten-centrerade) så beroendelinjerna får rena, ortogonala banor.
const H_TARGET = { left: '50%', top: 0, transform: 'translate(-50%,-50%)', width: 1, height: 1, opacity: 0, border: 'none', background: 'transparent', pointerEvents: 'none' }
const H_SOURCE = { left: '50%', top: '100%', transform: 'translate(-50%,-50%)', width: 1, height: 1, opacity: 0, border: 'none', background: 'transparent', pointerEvents: 'none' }

function buildNodes(allTasks, visibleTasks, lanes, onAddCard) {
  // synliga uppgifter grupperade per kategori, i ordningsföljd
  const byCat = {}
  visibleTasks.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach((t) => { (byCat[t.category] ||= []).push(t) })
  // framsteg per kategori (över ALLA uppgifter, inte bara synliga) → visas i rubriken
  const catProg = {}
  CATEGORIES.forEach((c) => { catProg[c.key] = computeProgress(allTasks.filter((t) => t.category === c.key)) })

  const nodes = []
  lanes.forEach((c, li) => {
    const laneX = li * LANE_W
    nodes.push({
      id: 'lane-' + c.key, type: 'lane', position: { x: laneX, y: HEADER_Y },
      data: { cat: c, prog: catProg[c.key], onAdd: () => onAddCard(c.key) },
      draggable: false, selectable: false,
    })
    // eget löpnummer enbart för oplacerade kort → de staplas tätt även i kolumner som
    // blandar manuellt flyttade kort med auto-flödade (inga glapp där manuella kort "äter" slottar)
    let flowIdx = 0
    ;(byCat[c.key] || []).forEach((t) => {
      const placed = t.x != null && t.y != null
      const pos = placed ? { x: t.x, y: t.y } : { x: laneX, y: CARD_TOP + (flowIdx++) * CARD_GAP }
      nodes.push({ id: t.id, type: 'task', position: pos, data: { task: t } })
    })
  })
  return nodes
}

function buildEdges(visibleTasks) {
  const vis = new Set(visibleTasks.map((t) => t.id))
  const catById = Object.fromEntries(visibleTasks.map((t) => [t.id, t.category]))
  const edges = []
  visibleTasks.forEach((t) => {
    (t.deps || []).forEach((d) => {
      if (!vis.has(d)) return
      const color = (CAT[catById[d]] || {}).color || T.rose
      edges.push({
        id: `dep-${d}-${t.id}`, source: d, target: t.id, sourceHandle: 's', targetHandle: 't',
        type: 'smoothstep', pathOptions: { borderRadius: 18 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 17, height: 17 },
        style: { stroke: color, strokeWidth: 2, opacity: 0.5 },
      })
    })
  })
  return edges
}

/* ───────────────────────────── custom nodes ───────────────────────────── */
function TaskNode({ data }) {
  const t = data.task
  const cat = CAT[t.category] || {}
  const s = STATUS[t.status] || STATUS.todo
  const d = diffOf(t)
  const done = t.status === 'done'
  return (
    <div style={{
      width: CARD_W, borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
      background: done ? T.doneSoft : T.panel,
      border: `1.5px solid ${done ? T.done + '88' : T.line}`,
      boxShadow: T.shadowSoft, opacity: done ? 0.62 : 1,
      display: 'flex',
    }}>
      <Handle id="t" type="target" position={Position.Top} style={H_TARGET} />
      <Handle id="s" type="source" position={Position.Bottom} style={H_SOURCE} />
      {/* svårighetsgrad = färgad kantremsa till vänster (det nya färgspråket) */}
      <div style={{ width: 5, flex: '0 0 5px', background: d.color, opacity: done ? 0.5 : 1 }} />
      <div style={{ flex: 1, minWidth: 0, padding: '9px 11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 12 }}>{cat.glyph}</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.sub || cat.label}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); updateTask(t.id, { status: NEXT_STATUS[t.status] || 'doing' }) }}
            title={`Status: ${s.label} — klicka för att ändra`}
            className="nodrag"
            style={{ border: 'none', background: 'transparent', padding: 0, width: 16, height: 16, display: 'grid', placeItems: 'center' }}
          >
            {done ? <span style={{ color: T.done, fontWeight: 900, fontSize: 13 }}>✓</span>
              : <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, display: 'block', border: `2px solid ${s.color}55` }} />}
          </button>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, lineHeight: 1.22, textDecoration: done ? 'line-through' : 'none' }}>
          {t.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
          <span style={{
            fontSize: 9.5, fontWeight: 900, color: d.text, background: d.soft,
            padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
          }}>{d.short}</span>
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: T.line, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(fraction(t) * 100)}%`, background: done ? T.done : s.color }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function LaneNode({ data }) {
  const c = data.cat
  const p = data.prog || { done: 0, n: 0, pct: 0 }
  return (
    <div style={{
      width: CARD_W, borderRadius: 14, padding: '11px 13px',
      background: `linear-gradient(180deg, ${c.color}1f, ${c.color}0c)`,
      border: `1.5px solid ${c.color}55`, boxShadow: T.shadowSoft,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{c.glyph}</span>
        <span style={{ fontSize: 14, fontWeight: 900, color: c.color }}>{c.label}</span>
        <div style={{ flex: 1 }} />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); data.onAdd && data.onAdd() }}
          title={`Lägg till kort i ${c.label}`}
          className="nodrag"
          style={{
            border: 'none', background: c.color, color: '#fff', fontWeight: 900, fontSize: 15,
            width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', lineHeight: 1,
            boxShadow: T.shadowSoft,
          }}
        >＋</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: '#ffffff90', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p.pct}%`, background: c.color, transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: c.color, whiteSpace: 'nowrap' }}>{p.done}/{p.n} klara</span>
      </div>
    </div>
  )
}

const nodeTypes = { task: TaskNode, lane: LaneNode }

/* ───────────────────────────── presence cursors ───────────────────────── */
// Prenumererar själv på den högfrekventa muspekarströmmen så bara detta lager ritas om
// vid pekartick (inte hela tavlan). En långsam tick omvärderar inaktualitet → frusna pekare försvinner.
function CursorsLayer() {
  const { x, y, zoom } = useViewport()
  const cursors = useCursors()
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 2000)
    return () => clearInterval(id)
  }, [])
  const now = Date.now()
  const live = cursors.filter((p) => p.cursor && p.cursor.view === 'board' && now - (p.cursor.t || 0) < CURSOR_TTL)
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
      {live.map((p) => {
        const sx = p.cursor.x * zoom + x
        const sy = p.cursor.y * zoom + y
        return (
          <div key={p.clientId} style={{ position: 'absolute', left: sx, top: sy, transform: 'translate(-2px,-2px)', transition: 'left .08s linear, top .08s linear' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }}>
              <path d="M4 2 L4 20 L9 15 L12.5 22 L15 21 L11.5 14 L18 14 Z" fill={p.user.color} stroke="#fff" strokeWidth="1.3" />
            </svg>
            <span style={{
              marginLeft: 12, marginTop: -6, display: 'inline-block', background: p.user.color, color: '#fff',
              fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 8, whiteSpace: 'nowrap',
            }}>{p.user.name}{p.typing ? ' ✍️' : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ───────────────────────────── flow ───────────────────────────── */
function Flow({ tasks, visibleTasks, cats, onOpenTask }) {
  const rf = useReactFlow()
  const [nodes, setNodes] = useNodesState([])
  const edges = useMemo(() => buildEdges(visibleTasks), [visibleTasks])
  const draggingRef = useRef(false)

  // synliga kolumner = de team-kategorier som är påslagna i toppfiltret
  const lanes = useMemo(() => CATEGORIES.filter((c) => !cats || cats[c.key]), [cats])

  // lägg ett nytt kort i en kolumn (utan x/y → det flödar in sist i kolumnen) och öppna det
  const onAddCard = useCallback((catKey) => {
    const id = createTask({ category: catKey, title: 'Ny uppgift' })
    onOpenTask(id)
  }, [onOpenTask])

  // håll refs till senaste store-data så onNodeDragStop kan bygga om med det som hann anlända
  // (fjärr-redigeringar) medan ett drag pågick
  const tasksRef = useRef(tasks)
  const visRef = useRef(visibleTasks)
  const lanesRef = useRef(lanes)
  tasksRef.current = tasks
  visRef.current = visibleTasks
  lanesRef.current = lanes

  // bygg om noderna från store, men klottra aldrig över ett pågående drag
  useEffect(() => {
    if (draggingRef.current) return
    setNodes(buildNodes(tasks, visibleTasks, lanes, onAddCard))
  }, [tasks, visibleTasks, lanes, onAddCard, setNodes])

  // rensa vår muspekare när tavlan avmonteras (t.ex. byte till Timeline/Progress)
  useEffect(() => () => clearCursor(), [])

  const onNodesChange = useCallback((changes) => {
    if (changes.some((c) => c.type === 'position' && c.dragging)) draggingRef.current = true
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [setNodes])

  const onNodeDragStop = useCallback((_e, node) => {
    draggingRef.current = false
    const px = Math.round(node.position.x)
    const py = Math.round(node.position.y)
    if (node.type === 'task') updateTask(node.id, { x: px, y: py })
    // bygg om med ev. fjärr-ändringar som anlände under draget, men behåll den nyss släppta
    // positionen — storen speglar inte updateTask i samma frame, annars ett kort snäpp tillbaka.
    const patch = (arr) => (node.type === 'task'
      ? arr.map((t) => (t.id === node.id ? { ...t, x: px, y: py } : t))
      : arr)
    setNodes(buildNodes(patch(tasksRef.current), patch(visRef.current), lanesRef.current, onAddCard))
  }, [setNodes, onAddCard])

  const onNodeClick = useCallback((_e, node) => {
    if (node.type === 'task') onOpenTask(node.id)
  }, [onOpenTask])

  const toFlow = rf.screenToFlowPosition || rf.project
  const onMouseMove = useCallback((e) => {
    if (!toFlow) return
    const p = toFlow({ x: e.clientX, y: e.clientY })
    setCursor('board', p.x, p.y)
  }, [toFlow])

  // dubbelklick på tom yta → nytt kort just där, i närmaste kolumns kategori
  const onDoubleClick = useCallback((e) => {
    if (!e.target.classList?.contains('react-flow__pane') || !toFlow) return
    const p = toFlow({ x: e.clientX, y: e.clientY })
    const ln = lanesRef.current.length ? lanesRef.current : CATEGORIES
    const li = Math.max(0, Math.min(ln.length - 1, Math.round(p.x / LANE_W)))
    const id = createTask({ category: ln[li].key, x: Math.round(p.x), y: Math.round(p.y), title: 'Ny uppgift' })
    onOpenTask(id)
  }, [toFlow, onOpenTask])

  const resetLayout = useCallback(() => {
    if (!confirm('Ordna alla kort i rena kolumner igen (återställ flyttade positioner)?')) return
    visRef.current.forEach((t) => { if (t.x != null || t.y != null) updateTask(t.id, { x: null, y: null }) })
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 60)
  }, [rf])

  const empty = visibleTasks.length === 0

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseMove={onMouseMove} onMouseLeave={clearCursor} onDoubleClick={onDoubleClick}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onNodeClick={onNodeClick}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.8}
        proOptions={{ hideAttribution: false }} nodesConnectable={false} elementsSelectable
        zoomOnDoubleClick={false}
        style={{ background: T.bg }}
      >
        <Background color={T.line} gap={26} size={1.5} />
        <MiniMap pannable zoomable nodeColor={(n) => n.type === 'lane'
          ? (n.data.cat.color)
          : (diffOf(n.data.task).color)} nodeStrokeWidth={2} maskColor="rgba(250,246,242,0.6)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <CursorsLayer />
      <Legend />

      {/* ordna om i kolumner */}
      <button onClick={resetLayout} title="Ordna korten i rena kolumner" style={{
        position: 'absolute', top: 14, right: 14, zIndex: 6, background: T.panel, border: `1px solid ${T.line}`,
        borderRadius: 10, boxShadow: T.shadowSoft, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, color: T.inkSoft,
      }}>⊞ Ordna kolumner</button>

      {/* hint / tomt-läge */}
      {empty ? (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 4,
        }}>
          <div style={{ textAlign: 'center', color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '20px 26px', boxShadow: T.shadowSoft }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>🗂️</div>
            <div style={{ fontWeight: 800, color: T.ink, marginBottom: 4 }}>Inget att visa i nuvarande filter</div>
            <div style={{ fontSize: 13 }}>Slå på fler kategorier högst upp, tryck <b>＋</b> i en kolumnrubrik, eller <b>dubbelklicka</b> på ytan.</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 6, fontSize: 11, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 9, padding: '5px 9px', boxShadow: T.shadowSoft, whiteSpace: 'nowrap' }}>
          ＋ i en kolumnrubrik = nytt kort · dubbelklicka ytan = nytt kort · klicka statusprick = ändra status
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <div style={{
      position: 'absolute', left: 14, top: 14, zIndex: 6, background: T.panel, border: `1px solid ${T.line}`,
      borderRadius: 12, boxShadow: T.shadowSoft, padding: '10px 12px', display: 'flex', alignItems: 'center',
      gap: 13, fontSize: 11.5, fontWeight: 700, color: T.inkSoft, flexWrap: 'wrap', maxWidth: 460,
    }}>
      <span style={{ fontWeight: 800, color: T.ink }}>Svårighet:</span>
      {DIFFICULTIES.map((d) => (
        <span key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: d.color }} />
          {d.short}
        </span>
      ))}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 16, height: 0, borderTop: `2px solid ${T.rose}` }} />→ beror på
      </span>
    </div>
  )
}

export default function Whiteboard(props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  )
}
