import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../theme'
import { useThreads, useThreadMsgs, useThreadsMeta } from '../store'
import { startThreads, createThread, postThreadMessage, setThreadArchived } from '../threads'
import { Avatar } from './Avatar.jsx'
import { ago } from '../util'

/* Diskussionstrådar inuti ett kort: starta trådar, svara på enskilda meddelanden (Twitch-/Discord-
   liknande reply med citerat original + pil), klicka citatet för att hoppa till originalet, samt
   arkivera lösta/döda trådar (döljs men sparas). All text renderas som ren React-text (aldrig
   dangerouslySetInnerHTML): meddelandena kommer från andra användare. */

const snippet = (s, n = 90) => {
  const one = (s || '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

export default function Threads({ taskId, canEdit, onRequireLogin }) {
  const threadsByTask = useThreads()
  const meta = useThreadsMeta()
  useEffect(() => { startThreads() }, [])

  const all = useMemo(() => threadsByTask[taskId] || [], [threadsByTask, taskId])
  const archived = all.filter((t) => t.archived)
  const shownDefault = all.filter((t) => !t.archived)
  const [showArchived, setShowArchived] = useState(false)
  const shown = showArchived ? all : shownDefault

  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  async function onCreate() {
    if (!canEdit) { onRequireLogin?.(); return }
    setCreating(true); setErr('')
    const { error } = await createThread(taskId, newTitle)
    setCreating(false)
    if (error) setErr(error); else setNewTitle('')
  }

  if (!meta.available) {
    return (
      <div style={info}>
        Diskussionstrådar aktiveras när migrationen <b>board_ext_schema.sql</b> körts i Supabase
        (Dashboard: SQL Editor). Allt annat på tavlan fungerar som vanligt.
      </div>
    )
  }

  return (
    <div>
      {/* Ny tråd: valfri titel/syfte. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={newTitle} onChange={(e) => setNewTitle(e.target.value)} disabled={!canEdit}
          onKeyDown={(e) => { if (e.key === 'Enter' && !creating) onCreate() }}
          placeholder={canEdit ? 'Starta en tråd: kort syfte (valfritt)' : 'Logga in för att starta en tråd'}
          style={{ ...inp, flex: 1 }}
        />
        <button onClick={onCreate} disabled={!canEdit || creating} style={{
          border: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 13,
          padding: '0 14px', borderRadius: 10, opacity: (!canEdit || creating) ? 0.5 : 1, whiteSpace: 'nowrap',
        }}>{creating ? '…' : '＋ Tråd'}</button>
      </div>
      {err && <div style={{ fontSize: 12, color: T.roseDeep, marginBottom: 8 }}>{err}</div>}

      {archived.length > 0 && (
        <button onClick={() => setShowArchived((v) => !v)} style={{
          border: `1px solid ${T.line}`, background: showArchived ? T.roseSoft : T.panel, color: T.inkSoft,
          fontWeight: 700, fontSize: 11.5, padding: '4px 10px', borderRadius: 999, marginBottom: 10, cursor: 'pointer',
        }}>{showArchived ? 'Dölj arkiverade' : `🗄️ Visa arkiverade (${archived.length})`}</button>
      )}

      {shown.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.inkSoft, padding: '8px 4px' }}>
          Inga trådar än. Starta en för att diskutera ett förslag eller en tanke om det här kortet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((t) => (
          <Thread key={t.id} thread={t} canEdit={canEdit} onRequireLogin={onRequireLogin} />
        ))}
      </div>
    </div>
  )
}

function Thread({ thread, canEdit, onRequireLogin }) {
  const msgsByThread = useThreadMsgs()
  const msgs = msgsByThread[thread.id] || []
  const byId = useMemo(() => Object.fromEntries(msgs.map((m) => [m.id, m])), [msgs])

  const [open, setOpen] = useState(true)
  const [replyTo, setReplyTo] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flashId, setFlashId] = useState(null)
  const nodeRefs = useRef(new Map())   // msgId -> DOM-nod, för "hoppa till originalet"

  function scrollToMsg(id) {
    const el = nodeRefs.current.get(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashId(id); setTimeout(() => setFlashId(null), 1300)
  }

  async function send() {
    if (!canEdit) { onRequireLogin?.(); return }
    if (!text.trim() || busy) return
    setBusy(true); setErr('')
    const { error } = await postThreadMessage(thread.id, text, replyTo?.id || null)
    setBusy(false)
    if (error) setErr(error); else { setText(''); setReplyTo(null) }
  }
  async function toggleArchive() {
    if (!canEdit) { onRequireLogin?.(); return }
    await setThreadArchived(thread.id, !thread.archived)
  }

  return (
    <div style={{
      border: `1px solid ${thread.archived ? T.line : T.rose + '44'}`, borderRadius: 12,
      background: thread.archived ? T.panelSoft : T.panel, overflow: 'hidden', opacity: thread.archived ? 0.78 : 1,
    }}>
      {/* trådhuvud */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', background: thread.archived ? 'transparent' : T.roseSoft + '66', borderBottom: open ? `1px solid ${T.line}` : 'none' }}>
        <button onClick={() => setOpen((v) => !v)} title={open ? 'Fäll ihop' : 'Visa'} style={{
          border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: T.inkSoft,
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease', padding: 0, lineHeight: 1,
        }}>▸</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {thread.title?.trim() ? thread.title : '💬 Diskussion'}{thread.archived ? ' · arkiverad' : ''}
          </div>
          <div style={{ fontSize: 10.5, color: T.inkSoft }}>
            {thread.created_by_name || 'någon'} · {msgs.length} {msgs.length === 1 ? 'inlägg' : 'inlägg'}
          </div>
        </div>
        {canEdit && (
          <button onClick={toggleArchive} title={thread.archived ? 'Avarkivera tråden' : 'Arkivera tråden (löst/klar/död)'} style={{
            border: `1px solid ${T.line}`, background: T.panel, color: T.inkSoft, fontWeight: 700, fontSize: 11,
            padding: '4px 9px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{thread.archived ? '↩︎ Återställ' : '🗄️ Arkivera'}</button>
        )}
      </div>

      {open && (
        <div style={{ padding: 10 }}>
          {/* meddelanden */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflow: 'auto' }}>
            {msgs.length === 0 && (
              <div style={{ fontSize: 12, color: T.inkSoft, padding: '2px 2px' }}>Inga inlägg än: skriv det första nedan.</div>
            )}
            {msgs.map((m) => {
              const parent = m.parent_id ? byId[m.parent_id] : null
              return (
                <div
                  key={m.id}
                  ref={(el) => { if (el) nodeRefs.current.set(m.id, el); else nodeRefs.current.delete(m.id) }}
                  className={flashId === m.id ? 'lm-flash' : undefined}
                  style={{ borderRadius: 10, padding: '2px 2px' }}
                >
                  {/* Twitch-liknande citat av originalet (klickbart -> hoppa upp till det). */}
                  {m.parent_id && (
                    <button onClick={() => scrollToMsg(m.parent_id)} className="lm-reply-quote" title="Hoppa till originalmeddelandet" style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', cursor: 'pointer',
                      border: 'none', borderLeft: `2px solid ${T.rose}`, background: T.panelSoft, color: T.inkSoft,
                      fontSize: 11, padding: '3px 8px', borderRadius: '0 8px 8px 0', marginBottom: 3,
                    }}>
                      <span style={{ color: T.rose, fontWeight: 900 }}>↪</span>
                      <b style={{ color: T.ink }}>{parent ? (parent.user_name || 'någon') : 'någon'}</b>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {parent ? snippet(parent.body, 70) : '(borttaget meddelande)'}
                      </span>
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Avatar name={m.user_name} color={m.user_color || T.todo} size={24} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>{m.user_name || 'någon'}</span>
                        <span style={{ fontSize: 10.5, color: T.inkSoft }}>{ago(Date.parse(m.created_at))}</span>
                        {canEdit && (
                          <button onClick={() => setReplyTo(m)} title="Svara på det här meddelandet" style={{
                            marginLeft: 'auto', border: 'none', background: 'transparent', color: T.rose,
                            fontWeight: 800, fontSize: 11, cursor: 'pointer', padding: 0,
                          }}>↪ Svara</button>
                        )}
                      </div>
                      {/* meddelandetext: ren text, bevarade radbrytningar */}
                      <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>{m.body}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* svar-/skrivruta */}
          <div style={{ marginTop: 9 }}>
            {replyTo && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.inkSoft,
                background: T.panelSoft, borderLeft: `2px solid ${T.rose}`, padding: '4px 8px', borderRadius: '0 8px 8px 0', marginBottom: 6,
              }}>
                <span style={{ color: T.rose, fontWeight: 900 }}>↪</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Svarar <b style={{ color: T.ink }}>{replyTo.user_name || 'någon'}</b>: {snippet(replyTo.body, 60)}
                </span>
                <button onClick={() => setReplyTo(null)} title="Avbryt svar" style={{ border: 'none', background: 'transparent', color: T.inkSoft, cursor: 'pointer', fontSize: 13, padding: 0 }}>✕</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} rows={2}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
                placeholder={canEdit ? (replyTo ? 'Skriv ditt svar… (Cmd/Ctrl+Enter skickar)' : 'Skriv ett inlägg… (Cmd/Ctrl+Enter skickar)') : 'Logga in för att delta'}
                style={{ ...inp, flex: 1, resize: 'vertical', minHeight: 38 }}
              />
              <button onClick={send} disabled={!canEdit || busy || !text.trim()} style={{
                border: 'none', background: T.rose, color: '#fff', fontWeight: 800, fontSize: 13,
                padding: '0 14px', height: 38, borderRadius: 10, opacity: (!canEdit || busy || !text.trim()) ? 0.5 : 1, whiteSpace: 'nowrap',
              }}>{busy ? '…' : 'Skicka'}</button>
            </div>
            {err && <div style={{ fontSize: 12, color: T.roseDeep, marginTop: 6 }}>{err}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

const inp = { padding: '8px 10px', borderRadius: 10, border: `1.5px solid ${T.line}`, fontSize: 13, color: T.ink, background: T.panel, outline: 'none', fontFamily: 'inherit' }
const info = { fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5, background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 12px' }
