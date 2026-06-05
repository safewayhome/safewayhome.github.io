import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap, Handle, Position, MarkerType,
  ReactFlowProvider, useReactFlow, useViewport, useNodesState, applyNodeChanges,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { T, CATEGORIES, CAT, STATUS } from '../theme'
import { updateTask, createTask, setCursor, clearCursor } from '../collab'
import { useCursors } from '../store'
import { fraction, round1, computeProgress } from '../util'

const CURSOR_TTL = 6000 // hide a peer's cursor if it hasn't moved in this many ms
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo' } // click status dot to cycle

// category "hubs" anchored in a wide 2×2 spread; tasks ring around them → spider-web
const HUBS = {
  dev: { x: -760, y: -470 },
  backend: { x: 760, y: -470 },
  data: { x: -760, y: 470 },
  mkt: { x: 760, y: 470 },
}

// hidden, centred connection handles so edges run node-centre → node-centre (clean spokes).
// 1px so the half-size anchor offset is sub-pixel (a larger handle visibly offsets the spokes).
const H = {
  left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
  width: 1, height: 1, opacity: 0, border: 'none', background: 'transparent', pointerEvents: 'none',
}

function layoutFor(task, idx, count) {
  if (task.x != null && task.y != null) return { x: task.x, y: task.y }
  const hub = HUBS[task.category] || { x: 0, y: 0 }
  const n = Math.max(count, 1)
  const R = Math.min(190 + n * 24, 360)
  const ang = idx * ((2 * Math.PI) / n) - Math.PI / 2
  return { x: hub.x + Math.cos(ang) * R, y: hub.y + Math.sin(ang) * R }
}

function buildNodes(allTasks, visibleTasks) {
  const byCat = {}
  allTasks.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach((t) => { (byCat[t.category] ||= []).push(t.id) })
  const visibleCats = new Set(visibleTasks.map((t) => t.category))
  // per-category completion shown as a ring on each hub
  const catPct = {}
  CATEGORIES.forEach((c) => { catPct[c.key] = computeProgress(allTasks.filter((t) => t.category === c.key)).pct })
  const nodes = []
  CATEGORIES.forEach((c) => {
    if (!visibleCats.has(c.key)) return
    nodes.push({ id: 'hub-' + c.key, type: 'hub', position: HUBS[c.key] || { x: 0, y: 0 }, data: { cat: c, pct: catPct[c.key] }, draggable: false, selectable: false })
  })
  visibleTasks.forEach((t) => {
    const ids = byCat[t.category] || []
    const idx = Math.max(ids.indexOf(t.id), 0)
    nodes.push({ id: t.id, type: 'task', position: layoutFor(t, idx, ids.length), data: { task: t } })
  })
  return nodes
}

function buildEdges(visibleTasks) {
  const vis = new Set(visibleTasks.map((t) => t.id))
  const edges = []
  visibleTasks.forEach((t) => {
    const color = (CAT[t.category] || {}).color || T.todo
    edges.push({
      id: 'spoke-' + t.id, source: 'hub-' + t.category, target: t.id,
      sourceHandle: 's', targetHandle: 't', type: 'straight',
      style: { stroke: color + '55', strokeWidth: 1.2 },
    })
    ;(t.deps || []).forEach((d) => {
      if (vis.has(d)) edges.push({
        id: `dep-${d}-${t.id}`, source: d, target: t.id,
        sourceHandle: 's', targetHandle: 't', type: 'straight',
        markerEnd: { type: MarkerType.ArrowClosed, color: T.rose, width: 16, height: 16 },
        style: { stroke: T.rose, strokeWidth: 1.4, strokeDasharray: '5 4', opacity: 0.6 },
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
  const done = t.status === 'done'
  return (
    <div style={{
      width: 174, padding: '10px 12px', borderRadius: 13,
      background: done ? T.doneSoft : T.panel,
      border: `1.5px solid ${done ? T.done + '99' : cat.color + '55'}`,
      boxShadow: T.shadowSoft, opacity: done ? 0.5 : 1, cursor: 'pointer',
    }}>
      <Handle id="t" type="target" position={Position.Top} style={H} />
      <Handle id="s" type="source" position={Position.Top} style={H} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: cat.color, flex: '0 0 auto' }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: cat.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.sub || cat.label}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); updateTask(t.id, { status: NEXT_STATUS[t.status] || 'doing' }) }}
          title={`Status: ${s.label} — klicka för att ändra`}
          style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', width: 16, height: 16, display: 'grid', placeItems: 'center' }}
        >
          {done ? <span style={{ color: T.done, fontWeight: 900, fontSize: 13 }}>✓</span>
            : <span style={{ width: 9, height: 9, borderRadius: 999, background: s.color, display: 'block' }} />}
        </button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, lineHeight: 1.2, textDecoration: done ? 'line-through' : 'none' }}>
        {t.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 999, background: T.line, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(fraction(t) * 100)}%`, background: done ? T.done : s.color }} />
        </div>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: T.inkSoft }}>{round1(t.spentH)}/{round1(t.estimateH)}h</span>
      </div>
    </div>
  )
}

function HubNode({ data }) {
  const c = data.cat
  const pct = data.pct ?? 0
  const R = 58
  const C = 2 * Math.PI * R
  return (
    <div style={{
      width: 124, height: 124, borderRadius: 999, display: 'grid', placeItems: 'center', textAlign: 'center',
      background: `radial-gradient(circle at 50% 38%, ${c.color}2e, ${c.color}10)`,
      position: 'relative',
    }}>
      {/* progress ring = how done this area is */}
      <svg width="124" height="124" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx="62" cy="62" r={R} fill="none" stroke={c.color + '22'} strokeWidth="5" />
        <circle cx="62" cy="62" r={R} fill="none" stroke={c.color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(C * pct) / 100} ${C}`} />
      </svg>
      <Handle id="s" type="source" position={Position.Top} style={H} />
      <Handle id="t" type="target" position={Position.Top} style={H} />
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 24 }}>{c.glyph}</div>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: c.color }}>{c.label}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.inkSoft }}>{pct}% klart</div>
      </div>
    </div>
  )
}

const nodeTypes = { task: TaskNode, hub: HubNode }

/* ───────────────────────────── presence cursors ───────────────────────── */
// Self-subscribes to the high-frequency cursor stream so only this overlay re-renders on cursor
// ticks (not the whole board). A slow tick re-evaluates staleness so frozen cursors disappear.
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
function Flow({ tasks, visibleTasks, onOpenTask }) {
  const rf = useReactFlow()
  const [nodes, setNodes] = useNodesState([])
  const edges = useMemo(() => buildEdges(visibleTasks), [visibleTasks])
  const draggingRef = useRef(false)

  // keep refs to the latest store data so onNodeDragStop can rebuild with whatever arrived
  // (remote edits) while a drag was in progress
  const tasksRef = useRef(tasks)
  const visRef = useRef(visibleTasks)
  tasksRef.current = tasks
  visRef.current = visibleTasks

  // rebuild nodes from the store, but never clobber a drag in progress
  useEffect(() => {
    if (draggingRef.current) return
    setNodes(buildNodes(tasks, visibleTasks))
  }, [tasks, visibleTasks, setNodes])

  // clear our cursor when the board unmounts (e.g. switching to Timeline/Progress)
  useEffect(() => () => clearCursor(), [])

  const onNodesChange = useCallback((changes) => {
    if (changes.some((c) => c.type === 'position' && c.dragging)) draggingRef.current = true
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [setNodes])

  const onNodeDragStop = useCallback((_e, node) => {
    draggingRef.current = false
    if (node.type === 'task') updateTask(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })
    // apply any remote changes that arrived during the drag (the rebuild effect skipped them)
    setNodes(buildNodes(tasksRef.current, visRef.current))
  }, [setNodes])

  const onNodeClick = useCallback((_e, node) => {
    if (node.type === 'task') onOpenTask(node.id)
  }, [onOpenTask])

  const toFlow = rf.screenToFlowPosition || rf.project
  const onMouseMove = useCallback((e) => {
    if (!toFlow) return
    const p = toFlow({ x: e.clientX, y: e.clientY })
    setCursor('board', p.x, p.y)
  }, [toFlow])

  // double-click empty canvas → new task at that spot, in the nearest category's cluster
  const onDoubleClick = useCallback((e) => {
    if (!e.target.classList?.contains('react-flow__pane') || !toFlow) return
    const p = toFlow({ x: e.clientX, y: e.clientY })
    let best = 'dev'
    let bestD = Infinity
    for (const [k, pos] of Object.entries(HUBS)) {
      const d = (pos.x - p.x) ** 2 + (pos.y - p.y) ** 2
      if (d < bestD) { bestD = d; best = k }
    }
    const id = createTask({ category: best, x: Math.round(p.x), y: Math.round(p.y), title: 'Ny uppgift' })
    onOpenTask(id)
  }, [toFlow, onOpenTask])

  const resetLayout = useCallback(() => {
    if (!confirm('Återställ alla uppgifters positioner till standard-spindelnätet?')) return
    visRef.current.forEach((t) => { if (t.x != null || t.y != null) updateTask(t.id, { x: null, y: null }) })
    setTimeout(() => rf.fitView({ padding: 0.25, duration: 400 }), 60)
  }, [rf])

  const empty = visibleTasks.length === 0

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseMove={onMouseMove} onMouseLeave={clearCursor} onDoubleClick={onDoubleClick}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onNodeClick={onNodeClick}
        fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.2} maxZoom={1.8}
        proOptions={{ hideAttribution: false }} nodesConnectable={false} elementsSelectable
        style={{ background: T.bg }}
      >
        <Background color={T.line} gap={26} size={1.5} />
        <MiniMap pannable zoomable nodeColor={(n) => n.type === 'hub'
          ? (n.data.cat.color)
          : ((STATUS[n.data.task.status] || STATUS.todo).color)} nodeStrokeWidth={2} maskColor="rgba(250,246,242,0.6)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <CursorsLayer />
      <Legend />

      {/* reset layout */}
      <button onClick={resetLayout} title="Återställ positioner" style={{
        position: 'absolute', top: 14, right: 14, zIndex: 6, background: T.panel, border: `1px solid ${T.line}`,
        borderRadius: 10, boxShadow: T.shadowSoft, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, color: T.inkSoft,
      }}>↺ Återställ layout</button>

      {/* hint / empty-state */}
      {empty ? (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 4,
        }}>
          <div style={{ textAlign: 'center', color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: '20px 26px', boxShadow: T.shadowSoft }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>🕸️</div>
            <div style={{ fontWeight: 800, color: T.ink, marginBottom: 4 }}>Inget att visa i nuvarande filter</div>
            <div style={{ fontSize: 13 }}>Slå på fler kategorier högst upp, eller <b>dubbelklicka</b> på ytan för att lägga till en uppgift.</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 6, fontSize: 11, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 9, padding: '5px 9px', boxShadow: T.shadowSoft, whiteSpace: 'nowrap' }}>
          dubbelklicka ytan = ny uppgift · klicka ✓-pricken = ändra status
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <div style={{
      position: 'absolute', left: 14, top: 14, zIndex: 6, background: T.panel, border: `1px solid ${T.line}`,
      borderRadius: 12, boxShadow: T.shadowSoft, padding: '10px 12px', display: 'flex', gap: 14, fontSize: 11.5, fontWeight: 700, color: T.inkSoft,
    }}>
      {Object.entries(STATUS).map(([k, s]) => (
        <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, opacity: k === 'done' ? 0.5 : 1 }} />
          {s.label}
        </span>
      ))}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 16, height: 0, borderTop: `2px dashed ${T.rose}` }} /> beroende
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
