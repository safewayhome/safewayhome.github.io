import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap, Handle, Position,
  ReactFlowProvider, useReactFlow, useViewport, useNodesState, applyNodeChanges,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { T, CATEGORIES, CAT, STATUS } from '../theme'
import { updateTask, setCursor, clearCursor } from '../collab'
import { useCursors } from '../store'
import { fraction, round1 } from '../util'

const CURSOR_TTL = 6000 // hide a peer's cursor if it hasn't moved in this many ms

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
  const nodes = []
  CATEGORIES.forEach((c) => {
    if (!visibleCats.has(c.key)) return
    nodes.push({ id: 'hub-' + c.key, type: 'hub', position: HUBS[c.key] || { x: 0, y: 0 }, data: { cat: c }, draggable: false, selectable: false })
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
        {done ? <span style={{ color: T.done, fontWeight: 900, fontSize: 13 }}>✓</span>
          : <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color }} />}
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
  return (
    <div style={{
      width: 124, height: 124, borderRadius: 999, display: 'grid', placeItems: 'center', textAlign: 'center',
      background: `radial-gradient(circle at 50% 38%, ${c.color}33, ${c.color}12)`,
      border: `2px dashed ${c.color}aa`,
    }}>
      <Handle id="s" type="source" position={Position.Top} style={H} />
      <Handle id="t" type="target" position={Position.Top} style={H} />
      <div>
        <div style={{ fontSize: 26 }}>{c.glyph}</div>
        <div style={{ fontSize: 13, fontWeight: 900, color: c.color }}>{c.label}</div>
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseMove={onMouseMove} onMouseLeave={clearCursor}>
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
    </div>
  )
}

function Legend() {
  return (
    <div style={{
      position: 'absolute', left: 14, bottom: 14, zIndex: 6, background: T.panel, border: `1px solid ${T.line}`,
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
