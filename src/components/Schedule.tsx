import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { addDaysIso, fmtDate, friendly, iso, today, WEEKDAYS } from '../lib/util'
import { Modal } from './ui'
import { useOptions } from '../pages/common'
import { useRooms } from '../pages/Training'
import { useTeams } from '../pages/Teams'

export type RequestKind = 'new_class' | 'extra_class' | 'room'
const KIND_LABEL: Record<string, string> = { new_class: 'New class', extra_class: 'Extra class', room: 'Room booking' }
const WAITING = ['Waiting for centre lead', 'Waiting for board']
const pill = (s: string) => (s === 'Approved' ? 'good' : s === 'Declined' || s === 'Cancelled' ? 'warn' : 'info')
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')
const endOf = (t: string, min: number) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + min; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }
export const slot = (t: string, min: number) => `${hhmm(t)}-${endOf(hhmm(t), min)} IST`
const OWN = 'own'

/** Where a class is held, for lists and cards. */
export function placeLabel(c: any, rooms: any[]) {
  if (c.own_room) return 'Own classroom'
  return rooms.find(r => r.id === c.room_id)?.name ?? ''
}

/** Ask for a new class, an extra class, or a room. */
export function RequestModal({ kind, cls, classes = [], onClose, onSaved }: { kind: RequestKind; cls?: any; classes?: any[]; onClose: () => void; onSaved?: () => void }) {
  const a = useAuth()
  const o = useOptions()
  const rooms = useRooms()
  const teams = useTeams()
  const first = cls ?? classes[0]
  const [v, setV] = useState<any>({
    title: kind === 'new_class' ? '' : kind === 'extra_class' ? `Extra class: ${first?.name ?? ''}` : '',
    class_id: first?.id ?? '',
    centre_id: first?.centre_id ?? a.profile?.centre_id ?? a.lookups.volunteers.find(x => x.id === a.profile?.volunteer_id)?.centre_id ?? '',
    program_id: '', subject: '', team_id: '', weekdays: [] as number[],
    date: kind === 'new_class' ? addDaysIso(today(), 7) : today(),
    start: hhmm(first?.start_time) || '17:00', minutes: first?.duration_min ?? 60,
    place: kind === 'room' ? '' : first?.room_id ?? (kind === 'new_class' ? '' : OWN), link: first?.meeting_link ?? '', note: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [showRooms, setShowRooms] = useState(false)
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const pickClass = (id: string) => { const c = classes.find(x => x.id === id); setV((s: any) => ({ ...s, class_id: id, title: `Extra class: ${c?.name ?? ''}`, start: hhmm(c?.start_time) || s.start, minutes: c?.duration_min ?? s.minutes, place: c?.room_id ?? OWN, link: c?.meeting_link ?? '' })) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (kind !== 'room' && !v.place) return setErr('Choose a room, or the volunteer\'s own classroom.')
    if (kind === 'room' && !v.place) return setErr('Choose a room.')
    if (kind === 'new_class' && !v.weekdays.length) return setErr('Choose at least one class day.')
    setBusy(true)
    const { data, error } = await supabase.rpc('request_schedule', {
      p_kind: kind, p_title: v.title, p_date: v.date, p_start: v.start, p_minutes: Number(v.minutes) || 60,
      p_room: v.place && v.place !== OWN ? v.place : null, p_own_room: v.place === OWN, p_link: v.place === OWN ? v.link || null : null,
      p_class: kind === 'extra_class' ? v.class_id || null : null, p_centre: v.centre_id || null,
      p_program: kind === 'new_class' ? v.program_id || null : null, p_subject: v.subject || null,
      p_weekdays: kind === 'new_class' ? v.weekdays : [], p_team: kind === 'room' ? v.team_id || null : null, p_note: v.note || null,
    })
    setBusy(false)
    if (error) return setErr(friendly(error))
    const { data: row } = await supabase.from('schedule_requests').select('status').eq('id', data as string).maybeSingle()
    setDone(row?.status ?? 'Waiting'); onSaved?.()
  }
  const title = kind === 'new_class' ? 'Propose a new class' : kind === 'extra_class' ? 'Add an extra class' : 'Book a room'
  const who = kind === 'room' ? 'the board' : v.place && v.place !== OWN ? 'your centre lead, then the board (for the room)' : 'your centre lead'
  return (
    <Modal title={title} onClose={onClose} wide>
      {done ? (<>
        <p className="ok">{done === 'Approved' ? 'Done. It is approved and on the schedule.' : `Sent. It now needs approval from ${who}. The room is held for you until they decide.`}</p>
        <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
      </>) : (
        <form onSubmit={save}>
          <p className="muted">{kind === 'new_class' ? 'Suggest a class you would like to teach. Your centre lead approves it, and the board approves the room if you choose one. Once approved, the class is created with you as its teacher.'
            : kind === 'extra_class' ? 'One extra class on a date, in a room or your own classroom. Your centre lead approves it, and the board approves the room if you choose one. Once approved, the date is added to the attendance sheet.'
            : 'Reserve a room for a date and time, for example for a team meeting. The board approves room bookings.'} All times are India time.</p>
          <div className="form-grid">
            {kind === 'extra_class' && (
              <div className="field"><label htmlFor="rq_class">Class</label>
                <select id="rq_class" required value={v.class_id} onChange={e => pickClass(e.target.value)}>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            )}
            {kind !== 'extra_class' && (
              <div className="field"><label htmlFor="rq_title">{kind === 'new_class' ? 'Class name' : 'What is it for'}</label>
                <input id="rq_title" required value={v.title} placeholder={kind === 'room' ? 'e.g. Curriculum team meeting' : 'e.g. Phonics, Grade 3'} onChange={e => set('title', e.target.value)} /></div>
            )}
            {kind === 'new_class' && (<>
              <div className="field"><label htmlFor="rq_centre">Centre</label>
                <select id="rq_centre" required value={v.centre_id} onChange={e => set('centre_id', e.target.value)}>
                  <option value="">Choose…</option>{o.allCentres.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div className="field"><label htmlFor="rq_prog">Program</label>
                <select id="rq_prog" required value={v.program_id} onChange={e => set('program_id', e.target.value)}>
                  <option value="">Choose…</option>{o.programs.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
              <div className="field"><label htmlFor="rq_subj">Subject (optional)</label><input id="rq_subj" value={v.subject} onChange={e => set('subject', e.target.value)} /></div>
              <div className="field"><label>Class days</label>
                <div className="chips">{WEEKDAYS.map((d, i) => <button type="button" key={d} className={'chip' + (v.weekdays.includes(i) ? ' on' : '')} aria-pressed={v.weekdays.includes(i)}
                  onClick={() => set('weekdays', v.weekdays.includes(i) ? v.weekdays.filter((x: number) => x !== i) : [...v.weekdays, i].sort())}>{d}</button>)}</div></div>
            </>)}
            {kind === 'room' && teams.length > 0 && (
              <div className="field"><label htmlFor="rq_team">Team (optional)</label>
                <select id="rq_team" value={v.team_id} onChange={e => set('team_id', e.target.value)}><option value="">None</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            )}
            <div className="field"><label htmlFor="rq_date">{kind === 'new_class' ? 'First week from' : 'Date'}</label><input id="rq_date" type="date" required min={today()} value={v.date} onChange={e => set('date', e.target.value)} /></div>
            <div className="field"><label htmlFor="rq_start">Start time (India time)</label><input id="rq_start" type="time" required value={v.start} onChange={e => set('start', e.target.value)} /></div>
            <div className="field"><label htmlFor="rq_min">Minutes</label><input id="rq_min" type="number" min={15} max={480} step={5} required value={v.minutes} onChange={e => set('minutes', e.target.value)} /></div>
            <div className="field"><label htmlFor="rq_place">{kind === 'room' ? 'Room' : 'Where'}</label>
              <select id="rq_place" required value={v.place} onChange={e => set('place', e.target.value)}>
                <option value="">Choose…</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                {kind !== 'room' && <option value={OWN}>Volunteer's own classroom (own link)</option>}
              </select>
              <small><button type="button" className="link" onClick={() => setShowRooms(s => !s)}>{showRooms ? 'Hide' : 'See'} when rooms are free</button></small></div>
            {v.place === OWN && <div className="field"><label htmlFor="rq_link">Own classroom link (optional)</label><input id="rq_link" inputMode="url" placeholder="https://" value={v.link} onChange={e => set('link', e.target.value)} /></div>}
          </div>
          <div className="field top-gap"><label htmlFor="rq_note">Note (optional)</label><textarea id="rq_note" rows={2} value={v.note} onChange={e => set('note', e.target.value)} /></div>
          {showRooms && <div className="top-gap"><RoomSchedule startOn={v.date} compact /></div>}
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
        </form>
      )}
    </Modal>
  )
}

/** Requests: the ones waiting for the signed-in person to decide, and their own. */
export function ScheduleRequests({ tick = 0, onChanged }: { tick?: number; onChanged?: () => void }) {
  const a = useAuth()
  const rooms = useRooms()
  const [rows, setRows] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const me = a.profile?.id
  const load = useCallback(() => {
    supabase.from('schedule_requests').select('*').order('created_at', { ascending: false }).limit(300).then(({ data }) => setRows(data ?? []))
    supabase.from('classes').select('id, name').limit(2000).then(({ data }) => setClasses(data ?? []))
  }, [])
  useEffect(load, [load, tick])
  const canDecide = (r: any) => (r.status === 'Waiting for centre lead' && (a.isStaff || (a.isLead && r.centre_id === a.profile?.centre_id)))
    || (r.status === 'Waiting for board' && a.isStaff)
  const decide = async (r: any, ok: boolean) => {
    setErr('')
    const { error } = await supabase.rpc('decide_schedule', { p_id: r.id, p_approve: ok, p_note: notes[r.id] || null })
    if (error) setErr(friendly(error)); else { load(); onChanged?.() }
  }
  const cancel = async (r: any) => {
    setErr('')
    const { error } = await supabase.rpc('cancel_schedule', { p_id: r.id })
    if (error) setErr(friendly(error)); else { load(); onChanged?.() }
  }
  const toDecide = rows.filter(canDecide)
  const mine = rows.filter(r => r.requested_by === me && (WAITING.includes(r.status) || r.start_date >= addDaysIso(today(), -14))).slice(0, 20)
  if (!toDecide.length && !mine.length) return null
  const when = (r: any) => r.kind === 'new_class'
    ? `${r.weekdays.map((d: number) => WEEKDAYS[d]).join(', ')} from ${fmtDate(r.start_date)}`
    : `${WEEKDAYS[new Date(r.start_date + 'T00:00:00').getDay()]} ${fmtDate(r.start_date)}`
  const what = (r: any) => (<>
    <b>{r.kind === 'extra_class' ? classes.find(c => c.id === r.class_id)?.name ?? r.title : r.title}</b>
    <small className="muted"> {KIND_LABEL[r.kind]}</small>
    {r.note && <small className="block muted">{r.note}</small>}
  </>)
  const place = (r: any) => (r.own_room ? 'Own classroom' : rooms.find(x => x.id === r.room_id)?.name ?? '')
  return (<>
    {err && <p className="error">{err}</p>}
    {toDecide.length > 0 && (
      <section className="card">
        <div className="card-head"><h2>Class and room requests waiting for you <span className="count">{toDecide.length}</span></h2></div>
        <p className="muted hint">New and extra classes are approved by the centre lead. Anything in a room then goes to the board. The room is held until you decide.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>What</th><th>When</th><th>Time</th><th>Where</th><th>Asked by</th><th>Step</th><th /></tr></thead>
          <tbody>{toDecide.map(r => (
            <tr key={r.id}>
              <td>{what(r)}</td><td>{when(r)}</td><td>{slot(r.start_time, r.duration_min)}</td><td>{place(r)}</td>
              <td>{r.requester_name}{r.lead_ok_by_name && <small className="block muted">centre lead OK: {r.lead_ok_by_name}</small>}</td>
              <td><span className="pill info">{r.status}</span></td>
              <td className="row-actions">
                <input className="mini" placeholder="Note (optional)" aria-label="Note" value={notes[r.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} />
                <button className="link" onClick={() => decide(r, true)}>Approve</button><button className="link danger-link" onClick={() => decide(r, false)}>Decline</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    )}
    {mine.length > 0 && (
      <section className="card">
        <div className="card-head"><h2>My class and room requests <span className="count">{mine.length}</span></h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>What</th><th>When</th><th>Time</th><th>Where</th><th>Status</th><th /></tr></thead>
          <tbody>{mine.map(r => (
            <tr key={r.id}>
              <td>{what(r)}</td><td>{when(r)}</td><td>{slot(r.start_time, r.duration_min)}</td><td>{place(r)}</td>
              <td><span className={'pill ' + pill(r.status)}>{r.status}</span>{r.decision_note && <small className="block muted">{r.decided_by_name ? r.decided_by_name + ': ' : ''}{r.decision_note}</small>}</td>
              <td className="row-actions">{(WAITING.includes(r.status) || (r.status === 'Approved' && r.kind !== 'new_class' && r.start_date >= today())) &&
                <button className="link danger-link" onClick={() => cancel(r)}>{r.status === 'Approved' ? 'Give back' : 'Withdraw'}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    )}
  </>)
}

/** Which room is in use when, one week at a time. All times India time. */
export function RoomSchedule({ startOn, compact }: { startOn?: string; compact?: boolean }) {
  const rooms = useRooms()
  const sunday = (s: string) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - d.getDay()); return iso(d) }
  const [from, setFrom] = useState(sunday(startOn ?? today()))
  useEffect(() => { if (startOn) setFrom(sunday(startOn)) }, [startOn])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(from, i)), [from])
  const [rows, setRows] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setRows(null)
    supabase.rpc('room_schedule', { p_from: from, p_to: addDaysIso(from, 6) }).then(({ data, error }) => { setErr(error ? friendly(error) : ''); setRows(data ?? []) })
  }, [from])
  const cell = (room: string, d: string) => (rows ?? []).filter(r => r.room_id === room && r.day === d)
  return (
    <section className={compact ? 'room-sched compact' : 'card room-sched'}>
      <div className="card-head wrap">
        {!compact && <h2>Room schedule</h2>}
        <div className="month">
          <button type="button" onClick={() => setFrom(addDaysIso(from, -7))} aria-label="Previous week">‹</button>
          <b>{fmtDate(from)} to {fmtDate(addDaysIso(from, 6))}</b>
          <button type="button" onClick={() => setFrom(addDaysIso(from, 7))} aria-label="Next week">›</button>
        </div>
      </div>
      <p className="muted hint">Times are India time. A room is free whenever nothing is shown. Dashed entries are waiting for approval but already hold the room.</p>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap"><table className="rooms-grid">
        <thead><tr><th>Room</th>{days.map(d => { const dt = new Date(d + 'T00:00:00'); return <th key={d} className={d === today() ? 'today' : ''}>{WEEKDAYS[dt.getDay()]} {dt.getDate()}</th> })}</tr></thead>
        <tbody>{rows === null ? <tr><td colSpan={8} className="muted">Loading…</td></tr> : rooms.map(r => (
          <tr key={r.id}><th>{r.name}</th>{days.map(d => { const list = cell(r.id, d); return (
            <td key={d}>{list.length === 0 ? <span className="free">Free</span> : list.map((b, i) => (
              <div key={i} className={'booking' + (b.status !== 'Approved' ? ' waiting' : '')} title={`${b.what}${b.status !== 'Approved' ? ' (waiting for approval)' : ''}`}>
                <b>{slot(b.start_time, b.minutes)}</b><span>{b.title}</span><small>{b.what}{b.status !== 'Approved' ? ' · waiting' : ''}</small>
              </div>
            ))}</td>
          ) })}</tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}
