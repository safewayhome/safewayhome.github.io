import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  nodesStore, edgesStore, cursorsStore, peopleStore, connStore,
  createNode, moveNode, commitNode, deleteNode as cDeleteNode, setNodeTitle, setNodeCategory,
  addEdge as cAddEdge, deleteEdge as cDeleteEdge, uploadNodeImage, removeNodeImage,
  setCursorWorld, clearCursor, maybeSeed, identity, setName,
} from './idea_collab'
import { authStore, canWrite, signIn, signUp, signOut, currentEmail } from '../auth'

/* ───────────────────────── Idea Web: /idea ─────────────────────────
   Internt brainstorm-verktyg för teamet: en DELAD spindelvävskarta där idéer hängs upp som block
   och trådar spinns mellan dem (kärnfunktioner i mitten, perifera idéer utåt). Byggt utan
   canvas-bibliotek: pannbart/zoombart världslager (div-transform) + SVG-trådlager + pointer events.

   Synk: all data (noder, trådar, kategorier, bilder) bor i Supabase och synkas i realtid, precis
   som tavlans Nätet (se idea_collab.js). En ändring syns för hela teamet direkt, även när ingen
   annan är online, och finns kvar efter refresh. LÄSNING är öppen, men REDIGERING kräver
   inloggning (samma RLS-modell som tavlan): utloggade kan titta och panorera, inte kladda.

   Per-användar-tillstånd (vy, markering, redigering, länkning) är LOKALT: bara själva kartdatan
   delas. Andras pekare visas live som färgade markörer.

   VIKTIG gest-lärdom: setPointerCapture gör att click/dblclick omdirigeras till kartytan, aldrig
   till elementet under pekaren. Därför avgörs stillastående klick (markera tråd) i pointerup via
   elementFromPoint, och dubbelklick-rename fångas som e.detail === 2 i pointerdown.
   FORMAT: aldrig AI-tankestreck som separator, alltid kolon (:). */

export const CATS = {
  core:      { label: 'Core',      ink: '#c2255d', glow: '#ff5fa2' },
  marketing: { label: 'Marketing', ink: '#9c4a1f', glow: '#d97b45' },
  tech:      { label: 'Tech',      ink: '#48618a', glow: '#7e96bd' },
  ux:        { label: 'UX',        ink: '#5f7040', glow: '#94a86f' },
}

const NODE_W = 212
const ZOOM_MIN = 0.45
const ZOOM_MAX = 1.8
const DRAG_THRESHOLD = 4
const NUDGE = 14

// Startväv (seedas EN gång i den delade DB:n, se idea_collab.maybeSeed). Stabila id:n så två
// samtidiga seedare konvergerar. Visar direkt hur verktyget är tänkt och går att radera.
const SEED = {
  nodes: [
    { id: 'seed-core',    x: 0,    y: 0,    title: 'LedMig: the safe way home', category: 'core',      imageUrl: null },
    { id: 'seed-heatmap', x: -290, y: -175, title: 'Lit-route heatmap layer',   category: 'tech',      imageUrl: null },
    { id: 'seed-walk',    x: 275,  y: -165, title: 'Walk-home companion mode',  category: 'ux',        imageUrl: null },
    { id: 'seed-campus',  x: -265, y: 190,  title: 'Campus ambassador program', category: 'marketing', imageUrl: null },
    { id: 'seed-checkin', x: 290,  y: 180,  title: 'Safe-spot check-ins',       category: 'core',      imageUrl: null },
  ],
  edges: [
    { id: 'seed-e1', from: 'seed-core', to: 'seed-heatmap' },
    { id: 'seed-e2', from: 'seed-core', to: 'seed-walk' },
    { id: 'seed-e3', from: 'seed-core', to: 'seed-campus' },
    { id: 'seed-e4', from: 'seed-core', to: 'seed-checkin' },
    { id: 'seed-e5', from: 'seed-walk', to: 'seed-checkin' },
  ],
}

// Trådens geometri (mjukt spänd kvadratisk kurva): delas av path:en och radera-knappen så knappen
// sitter PÅ kurvans mitt, inte bredvid på den raka kordan.
function edgeGeom(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const sag = Math.min(26, len * 0.07)
  const cx = mx - (dy / len) * sag, cy = my + (dx / len) * sag
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, midX: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, midY: 0.25 * a.y + 0.5 * cy + 0.25 * b.y }
}

// Liten useSyncExternalStore-brygga mot collab-storarna.
function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get)
}

export default function IdeaMap() {
  const nodes = useStore(nodesStore)
  const edges = useStore(edgesStore)
  const cursors = useStore(cursorsStore)
  const people = useStore(peopleStore)
  const conn = useStore(connStore)
  const auth = useStore(authStore)
  const canEdit = !!auth.user

  const [view, setView] = useState(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 + 16, k: 1 }))
  const [selected, setSelected] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [editing, setEditing] = useState(null)
  const [linking, setLinking] = useState(null)
  const [kbLink, setKbLink] = useState(null)
  const [panning, setPanning] = useState(false)
  const [notice, setNotice] = useState(null)
  const [showLogin, setShowLogin] = useState(false)

  const canvasRef = useRef(null)
  const fileRef = useRef(null)
  const uploadForRef = useRef(null)
  const dragRef = useRef(null)
  const pointersRef = useRef(new Map())
  const viewRef = useRef(view)
  viewRef.current = view
  const noticeTimer = useRef(null)

  // seeda startväven en gång (no-op om redan seedad / cache finns)
  useEffect(() => { maybeSeed(SEED) }, [])
  // släpp egen pekare ur andras vy när fliken lämnas
  useEffect(() => () => clearCursor(), [])

  function requireLogin() { setShowLogin(true) }

  function worldFromClient(clientX, clientY) {
    const rect = canvasRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k }
  }
  function capturePointer(e) {
    try { canvasRef.current.setPointerCapture(e.pointerId) } catch { /* ofarligt */ }
  }
  function flash(msg, ms = 2800) {
    setNotice(msg)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), ms)
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  /* ── Gester ─────────────────────────────────────────────────────────────────── */
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // två pekare: nyp-zoom
    if (pointersRef.current.size === 2 && dragRef.current?.mode !== 'link') {
      const [p1, p2] = [...pointersRef.current.values()]
      const v = viewRef.current
      const rect = canvasRef.current.getBoundingClientRect()
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      dragRef.current = { mode: 'pinch', startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, startK: v.k, world: { x: (mid.x - rect.left - v.x) / v.k, y: (mid.y - rect.top - v.y) / v.k } }
      setPanning(true); capturePointer(e)
      return
    }
    if (dragRef.current) return

    const t = e.target
    const portEl = t.closest('[data-port-for]')
    if (portEl) {
      if (!canEdit) { requireLogin(); return }
      const w = worldFromClient(e.clientX, e.clientY)
      dragRef.current = { mode: 'link', pointerId: e.pointerId, id: portEl.dataset.portFor, moved: false }
      setLinking({ from: portEl.dataset.portFor, x: w.x, y: w.y })
      capturePointer(e)
      return
    }
    if (t.closest('button, input, a')) return

    const nodeEl = t.closest('[data-node-id]')
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId
      if (e.detail === 2 && t.closest('.idea-node-title')) {
        if (!canEdit) { requireLogin(); return }
        setSelected(id); setEditing(id)
        return
      }
      setSelected(id); setSelectedEdge(null)
      if (!canEdit) return   // utloggad: markera men dra inte
      const n = nodes.find((x) => x.id === id)
      const w = worldFromClient(e.clientX, e.clientY)
      dragRef.current = { mode: 'node', pointerId: e.pointerId, id, grabDX: w.x - n.x, grabDY: w.y - n.y, startCX: e.clientX, startCY: e.clientY, moved: false }
      capturePointer(e)
      return
    }

    dragRef.current = { mode: 'pan', pointerId: e.pointerId, startVX: view.x, startVY: view.y, startCX: e.clientX, startCY: e.clientY, moved: false }
    setPanning(true); capturePointer(e)
  }

  function onPointerMove(e) {
    const pts = pointersRef.current
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // live-pekare: broadcasta egen världsposition (strypt i collab)
    const wc = worldFromClient(e.clientX, e.clientY)
    setCursorWorld(wc.x, wc.y)

    const d = dragRef.current
    if (!d) return
    if (d.mode === 'pinch') {
      if (pts.size < 2) return
      const [p1, p2] = [...pts.values()]
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, d.startK * (dist / d.startDist)))
      const rect = canvasRef.current.getBoundingClientRect()
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      setView({ k, x: mid.x - rect.left - d.world.x * k, y: mid.y - rect.top - d.world.y * k })
      return
    }
    if (d.pointerId !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.startCX, e.clientY - d.startCY) < DRAG_THRESHOLD && d.mode !== 'link') return
    d.moved = true
    if (d.mode === 'node') {
      const w = worldFromClient(e.clientX, e.clientY)
      moveNode(d.id, w.x - d.grabDX, w.y - d.grabDY)
    } else if (d.mode === 'pan') {
      setView((v) => ({ ...v, x: d.startVX + (e.clientX - d.startCX), y: d.startVY + (e.clientY - d.startCY) }))
    } else if (d.mode === 'link') {
      const w = worldFromClient(e.clientX, e.clientY)
      setLinking((l) => (l ? { ...l, x: w.x, y: w.y } : l))
    }
  }

  function onPointerUp(e) {
    pointersRef.current.delete(e.pointerId)
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'pinch') { if (pointersRef.current.size < 2) { dragRef.current = null; setPanning(false) } return }
    if (d.pointerId !== e.pointerId) return
    dragRef.current = null
    setPanning(false)
    if (d.mode === 'node' && d.moved) commitNode(d.id)
    if (d.mode === 'link') {
      if (linking) {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]')
        if (hit && hit.dataset.nodeId !== d.id) cAddEdge(d.id, hit.dataset.nodeId)
      }
      setLinking(null)
      return
    }
    if (d.mode === 'pan' && !d.moved) {
      const edgeEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-edge-id]')
      if (edgeEl) { setSelectedEdge(edgeEl.dataset.edgeId); setSelected(null); setEditing(null); return }
      setSelected(null); setSelectedEdge(null); setEditing(null)
    }
  }

  function onPointerCancel(e) {
    pointersRef.current.delete(e.pointerId)
    const d = dragRef.current
    if (d && (d.mode === 'pinch' || d.pointerId === e.pointerId)) { dragRef.current = null; setPanning(false); setLinking(null) }
  }

  // hjul/trackpad-zoom mot pekaren (passive:false: får preventDefault:a)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      const v = viewRef.current
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0014))
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor))
      if (k === v.k) return
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      setView({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // tangentbord: pilar knuffar markerat block, Delete tar bort, Escape släpper allt
  useEffect(() => {
    function onKey(e) {
      if (editing !== null || e.target.closest?.('input, textarea')) return
      if (e.key === 'Escape') {
        dragRef.current = null; setPanning(false)
        setSelected(null); setSelectedEdge(null); setLinking(null); setKbLink(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit) { if (selected || selectedEdge) requireLogin(); return }
        if (selected) { e.preventDefault(); cDeleteNode(selected); setSelected(null) }
        else if (selectedEdge) { e.preventDefault(); cDeleteEdge(selectedEdge); setSelectedEdge(null) }
      } else if (selected && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!canEdit) { requireLogin(); return }
        e.preventDefault()
        const n = nodes.find((x) => x.id === selected)
        if (!n) return
        const step = (e.shiftKey ? 4 : 1) * NUDGE
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        moveNode(selected, n.x + dx, n.y + dy); commitNode(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ── mutationer (genom datalagret) ──────────────────────────────────────────── */
  function addNode() {
    if (!canEdit) { requireLogin(); return }
    const src = selected ? nodes.find((n) => n.id === selected) : null
    let x, y
    if (src) {
      const spokes = edges.filter((ed) => ed.from === src.id || ed.to === src.id).length
      const ang = -Math.PI / 2 + spokes * 1.05
      x = src.x + Math.cos(ang) * 270
      y = src.y + Math.sin(ang) * 220
    } else {
      const w = worldFromClient(window.innerWidth / 2, window.innerHeight / 2)
      x = w.x + (Math.random() - 0.5) * 80
      y = w.y + (Math.random() - 0.5) * 60
    }
    const id = createNode({ x, y, title: '', category: src ? src.category : 'core' })
    if (!id) { requireLogin(); return }
    if (src) cAddEdge(src.id, id)
    setSelected(id); setEditing(id)
  }

  function onPortClick(id) {
    if (!canEdit) { requireLogin(); return }
    if (!kbLink) { setKbLink(id); flash('Linking: activate another idea’s ring to connect (Escape cancels)', 6000); return }
    if (kbLink === id) { setKbLink(null); setNotice(null); return }
    const exists = edges.some((e) => (e.from === kbLink && e.to === id) || (e.from === id && e.to === kbLink))
    if (exists) { cDeleteEdgeBetween(kbLink, id); flash('Thread removed') }
    else { cAddEdge(kbLink, id); flash('Ideas linked') }
    setKbLink(null)
  }
  function cDeleteEdgeBetween(a, b) {
    const e = edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a))
    if (e) cDeleteEdge(e.id)
  }

  function pickImage(id) {
    if (!canEdit) { requireLogin(); return }
    uploadForRef.current = id
    fileRef.current?.click()
  }
  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const id = uploadForRef.current
    uploadForRef.current = null
    if (!file || !id) return
    flash('Uploading image…', 8000)
    const { error } = await uploadNodeImage(id, file)
    if (error) flash(error)
    else setNotice(null)
  }

  /* ── render ─────────────────────────────────────────────────────────────────── */
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const selEdge = selectedEdge ? edges.find((e) => e.id === selectedEdge) : null
  const selGeom = selEdge && nodeById[selEdge.from] && nodeById[selEdge.to] ? edgeGeom(nodeById[selEdge.from], nodeById[selEdge.to]) : null

  return (
    <div
      ref={canvasRef}
      className={`idea-canvas${panning ? ' is-panning' : ''}`}
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${28 * view.k}px ${28 * view.k}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => clearCursor()}
    >
      <div className="idea-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg aria-hidden="true">
          <defs>
            {edges.map((e) => {
              const a = nodeById[e.from], b = nodeById[e.to]
              if (!a || !b) return null
              return (
                <linearGradient key={e.id} id={`igrad-${e.id}`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                  <stop offset="0%" stopColor={CATS[a.category].ink} />
                  <stop offset="100%" stopColor={CATS[b.category].ink} />
                </linearGradient>
              )
            })}
          </defs>
          {edges.map((e) => {
            const a = nodeById[e.from], b = nodeById[e.to]
            if (!a || !b) return null
            const g = edgeGeom(a, b)
            const isSel = selectedEdge === e.id
            return (
              <g key={e.id}>
                <path d={g.d} fill="none" stroke={`url(#igrad-${e.id})`} strokeWidth={isSel ? 2.8 : 1.8} strokeOpacity={isSel ? 1 : 0.8} strokeLinecap="round" />
                <path d={g.d} data-edge-id={e.id} fill="none" stroke="transparent" strokeWidth="16" style={{ cursor: 'pointer' }} />
              </g>
            )
          })}
          {linking && nodeById[linking.from] && (
            <line x1={nodeById[linking.from].x} y1={nodeById[linking.from].y} x2={linking.x} y2={linking.y}
              stroke={CATS[nodeById[linking.from].category].ink} strokeWidth="1.6" strokeDasharray="6 7" strokeLinecap="round" strokeOpacity="0.8" />
          )}
        </svg>

        {selGeom && (
          <button className="idea-edge-x" aria-label="Remove this connection" style={{ left: selGeom.midX, top: selGeom.midY }}
            onClick={() => { cDeleteEdge(selectedEdge); setSelectedEdge(null) }}>
            <CrossIcon />
          </button>
        )}

        {nodes.map((n) => (
          <IdeaNode key={n.id} node={n}
            canEdit={canEdit}
            isSelected={selected === n.id}
            isEditing={editing === n.id}
            isLinkSource={kbLink === n.id}
            onEdit={() => { if (!canEdit) return requireLogin(); setEditing(n.id) }}
            onEditDone={() => setEditing(null)}
            onTitle={(t) => setNodeTitle(n.id, t)}
            onCategory={(c) => { if (!canEdit) return requireLogin(); setNodeCategory(n.id, c) }}
            onImage={() => pickImage(n.id)}
            onImageRemove={() => { if (!canEdit) return requireLogin(); removeNodeImage(n.id) }}
            onDelete={() => { if (!canEdit) return requireLogin(); cDeleteNode(n.id); setSelected(null) }}
            onPortClick={() => onPortClick(n.id)}
          />
        ))}
      </div>

      {/* andras live-pekare: världskoordinater -> skärm via vyn (skalar inte med zoom) */}
      <div className="idea-cursors" aria-hidden="true">
        {cursors.map((c) => (
          <div key={c.clientId} className="idea-cursor" style={{ left: view.x + c.x * view.k, top: view.y + c.y * view.k, color: c.user?.color || '#d6336c' }}>
            <CursorIcon />
            <span className="idea-cursor-name" style={{ background: c.user?.color || '#d6336c' }}>{c.user?.name || 'Gäst'}</span>
          </div>
        ))}
      </div>

      <header className="idea-topbar">
        <h1 className="sr-only">LedMig Idea Web: shared team brainstorm canvas</h1>
        <a className="idea-wordmark" href="/">
          <b>LedMig</b>
          <span>Idea Web · Shared brainstorm</span>
        </a>
        <div className="idea-topbar-right">
          <PresenceStack people={people} synced={conn.synced} dbMode={conn.dbMode} />
          <button className="idea-pill" onClick={addNode}><PlusIcon /> Add New Idea Node</button>
          <AuthChip canEdit={canEdit} email={currentEmail()} onLogin={requireLogin} onLogout={signOut} />
        </div>
      </header>

      <div className="idea-legend" aria-hidden="true">
        {Object.entries(CATS).map(([k, c]) => (
          <div key={k} className="idea-legend-row"><span className="idea-dot" style={{ background: c.ink }} /> {c.label}</div>
        ))}
      </div>

      <div className="idea-hint">
        {canEdit ? 'Drag canvas to pan · scroll or pinch to zoom' : 'View only: sign in to edit · drag to pan · scroll to zoom'}<br />
        Drag the ring to link ideas · double-click a title to rename<br />
        Everything syncs live to your team
      </div>

      <div className="idea-notice" role="status" data-empty={notice ? undefined : 'true'}>{notice || ''}</div>

      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}

/* Ett idéblock. All gestlogik bor i kartan (data-attribut pekar ut block + ring). */
function IdeaNode({ node, canEdit, isSelected, isEditing, isLinkSource, onEdit, onEditDone, onTitle, onCategory, onImage, onImageRemove, onDelete, onPortClick }) {
  const cat = CATS[node.category] || CATS.core
  return (
    <div data-node-id={node.id} role="group" aria-label={`Idea: ${node.title || 'untitled'}`}
      className={`idea-node${isSelected ? ' is-selected' : ''}`}
      style={{
        left: node.x, top: node.y, width: NODE_W, zIndex: isSelected ? 2 : 1, borderColor: cat.ink,
        boxShadow: isSelected ? `0 14px 34px ${cat.glow}55, 0 0 0 4px ${cat.glow}22` : '0 1px 0 rgba(161,35,92,0.10), 0 8px 18px -12px rgba(161,35,92,0.22)',
      }}>
      <div className="idea-node-cat" style={{ color: cat.ink }}>
        <span className="idea-dot" style={{ background: cat.ink }} />
        {cat.label}
      </div>

      {node.imageUrl && (
        <div className="idea-node-img">
          <img src={node.imageUrl} alt="" draggable={false} />
          {canEdit && <button className="idea-tool idea-img-remove" aria-label="Remove image" onClick={onImageRemove}><CrossIcon /></button>}
        </div>
      )}

      {isEditing ? (
        <input className="idea-node-title-input" defaultValue={node.title} placeholder="Name this idea" maxLength={120} autoFocus
          onFocus={(e) => e.target.select()} onChange={(e) => onTitle(e.target.value)} onBlur={onEditDone}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') onEditDone() }} />
      ) : (
        <h3 className="idea-node-title" style={node.title ? undefined : { color: 'rgba(161,35,92,0.85)', fontStyle: 'italic' }}>
          {node.title || 'Untitled idea'}
        </h3>
      )}

      {canEdit && (
        <div className="idea-node-tools">
          {Object.entries(CATS).map(([k, c]) => (
            <button key={k} className={`idea-catdot${node.category === k ? ' is-active' : ''}`} style={{ background: c.ink, color: c.ink }}
              aria-label={`Set category: ${c.label}`} aria-pressed={node.category === k} onClick={() => onCategory(k)} />
          ))}
          <span style={{ flex: 1 }} />
          <button className="idea-tool" aria-label={node.imageUrl ? 'Replace image' : 'Add image'} onClick={onImage}><ImageIcon /></button>
          <button className="idea-tool" aria-label="Rename idea" onClick={onEdit}><PenIcon /></button>
          <button className="idea-tool" aria-label="Delete idea" onClick={onDelete}><TrashIcon /></button>
        </div>
      )}

      {canEdit && (
        <button className={`idea-port${isLinkSource ? ' is-linking' : ''}`} data-port-for={node.id} style={{ borderColor: cat.ink, color: cat.ink }}
          aria-label="Link this idea to another (drag the ring, or press Enter here and then on another idea’s ring)" aria-pressed={isLinkSource}
          title="Drag to another block to link" onClick={onPortClick} />
      )}
    </div>
  )
}

// Närvaro: vilka i teamet som är inne just nu + synk-status.
function PresenceStack({ people, synced, dbMode }) {
  const dotTitle = !dbMode ? 'Local mode: changes are not shared (run the migration)' : synced ? 'Synced live with your team' : 'Connecting…'
  return (
    <div className="idea-presence" title={dotTitle}>
      <span className={`idea-sync-dot${synced ? ' is-on' : ''}`} />
      {people.slice(0, 4).map((p) => (
        <span key={p.clientId} className="idea-avatar" style={{ background: p.user?.color || '#d6336c' }} title={p.user?.name || 'Gäst'}>
          {(p.user?.name || '?').trim().charAt(0).toUpperCase() || '?'}
        </span>
      ))}
      {people.length > 4 && <span className="idea-avatar idea-avatar-more">+{people.length - 4}</span>}
    </div>
  )
}

function AuthChip({ canEdit, email, onLogin, onLogout }) {
  if (canEdit) {
    return (
      <button className="idea-authchip" onClick={onLogout} title={`Signed in as ${email}: click to sign out`}>
        <span className="idea-authchip-dot" /> {email ? email.split('@')[0] : 'Signed in'}
      </button>
    )
  }
  return <button className="idea-authchip idea-authchip-out" onClick={onLogin}>Sign in to edit</button>
}

function LoginModal({ onClose }) {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit() {
    if (!email.trim() || !pwd || busy) return
    setBusy(true); setErr('')
    const { error } = mode === 'in' ? await signIn(email, pwd) : await signUp(email, pwd)
    setBusy(false)
    if (error) { setErr(error.message || 'Something went wrong'); return }
    onClose()
  }
  return (
    <div className="idea-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="idea-modal" role="dialog" aria-modal="true" aria-label={mode === 'in' ? 'Sign in' : 'Create account'}>
        <h2 className="idea-modal-title">{mode === 'in' ? 'Sign in to edit' : 'Create an account'}</h2>
        <p className="idea-modal-sub">Only signed-in team members can edit the idea web. Anyone can view it.</p>
        <input className="idea-modal-input" autoFocus type="email" value={email} placeholder="Email"
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <input className="idea-modal-input" type="password" value={pwd} placeholder="Password"
          onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {err && <div className="idea-modal-err" role="alert">{err}</div>}
        <div className="idea-modal-row">
          <button className="idea-modal-link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr('') }}>
            {mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="idea-btn-ghost" onClick={onClose}>Cancel</button>
            <button className="idea-btn-primary" disabled={busy || !email.trim() || !pwd} onClick={submit}>
              {busy ? '…' : (mode === 'in' ? 'Sign in' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* streck-ikoner (inga emojis) */
const ico = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
const PlusIcon = () => (<svg {...ico}><path d="M8 3v10M3 8h10" /></svg>)
const CrossIcon = () => (<svg {...ico}><path d="M4 4l8 8M12 4l-8 8" /></svg>)
const ImageIcon = () => (<svg {...ico}><rect x="2" y="3" width="12" height="10" rx="2" /><circle cx="6" cy="7" r="1.2" /><path d="M2 11.5 6 8l3 2.5 2.5-2L14 11" /></svg>)
const PenIcon = () => (<svg {...ico}><path d="M3 13l1-3.5L11.5 2 14 4.5 6.5 12 3 13z" /></svg>)
const TrashIcon = () => (<svg {...ico}><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" /></svg>)
const CursorIcon = () => (<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" style={{ display: 'block', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))' }}><path d="M2 2l5.5 13 2.2-5.3L15 7.5 2 2z" /></svg>)
