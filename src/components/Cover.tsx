import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { addDaysIso, fmtDate, friendly, today, WEEKDAYS } from '../lib/util'
import { Modal } from './ui'

const OPEN = ['Waiting for teacher', 'Waiting for centre lead', 'Approved']
const pill = (s: string) => (s === 'Approved' ? 'good' : s === 'Declined' || s === 'Cancelled' ? 'warn' : 'info')

/** Ask another teacher to take one date of a class. They accept, then the centre lead approves. */
export function CoverModal({ cls, onClose, onSaved }: { cls: any; onClose: () => void; onSaved?: () => void }) {
  const a = useAuth()
  const [people, setPeople] = useState<any[] | null>(null)
  const [date, setDate] = useState(today())
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  useEffect(() => {
    supabase.rpc('cover_candidates', { p_class: cls.id }).then(({ data, error }) => { if (error) setErr(friendly(error)); setPeople(data ?? []) })
  }, [cls.id])
  const offDay = !!cls.weekdays?.length && !cls.weekdays.includes(new Date(date + 'T00:00:00').getDay())
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('request_cover', { p_class: cls.id, p_date: date, p_volunteer: who, p_note: note })
    if (error) return setErr(friendly(error))
    setDone(people?.find(p => p.id === who)?.full_name ?? 'them'); onSaved?.()
  }
  return (
    <Modal title={`Hand over a class: ${cls.name}`} onClose={onClose}>
      {done ? (<><p className="ok">Request sent to {done} for {fmtDate(date)}. {a.canManage
        ? 'The class moves to them as soon as they accept.'
        : 'They need to accept, and then your centre lead approves. Until both have said yes, the class is still yours.'}</p>
        <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div></>) : (
        <form onSubmit={save}>
          <p className="muted">Use this when the usual teacher cannot take the class on one date. {a.canManage
            ? 'The other teacher is asked to accept.' : 'The other teacher is asked to accept, then the centre lead approves.'}</p>
          <div className="field"><label htmlFor="cv_date">Which date</label><input id="cv_date" type="date" required min={addDaysIso(today(), -1)} value={date} onChange={e => setDate(e.target.value)} />
            {offDay && <small>This class normally runs on {cls.weekdays.map((w: number) => WEEKDAYS[w]).join(', ')}. Check the date.</small>}</div>
          <div className="field top-gap"><label htmlFor="cv_who">Who should take it</label>
            <select id="cv_who" required value={who} onChange={e => setWho(e.target.value)}>
              <option value="">{people ? 'Select…' : 'Loading…'}</option>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.code})</option>)}</select>
            <small>{people && people.length === 0 ? 'No other active volunteer at this centre has a login yet.' : 'Active volunteers of this centre who have a login.'}</small></div>
          <div className="field top-gap"><label htmlFor="cv_note">Note for them</label><textarea id="cv_note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Send request</button></div>
        </form>
      )}
    </Modal>
  )
}

/** Hand-over requests the signed-in person is part of: to answer, to approve, or to follow. Hidden when there are none. */
export function CoverList({ tick }: { classes?: any[]; tick?: number }) {
  const a = useAuth()
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    supabase.from('class_cover_requests').select('*').gte('cover_date', addDaysIso(today(), -1)).order('cover_date').limit(500)
      .then(({ data }) => setRows((data ?? []).filter((r: any) => OPEN.includes(r.status) || (r.decided_at ?? r.teacher_answered_at ?? r.created_at) >= addDaysIso(today(), -3))))
  }, [])
  useEffect(load, [load, tick])
  const myVol = a.profile?.volunteer_id
  const me = a.profile?.id
  const run = async (fn: string, args: any, ask?: string) => {
    let note: string | null = null
    if (ask) { note = window.prompt(ask, ''); if (note === null) return }
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc(fn, note === null ? args : { ...args, p_note: note })
    setBusy(false)
    if (error) setErr(friendly(error)); else load()
  }
  if (!rows.length) return null
  const waiting = rows.filter(r => (r.status === 'Waiting for teacher' && r.volunteer_id === myVol) || (r.status === 'Waiting for centre lead' && a.canManage)).length
  return (
    <section className="card">
      <div className="card-head"><h2>Class hand-overs {waiting > 0 && <span className="count">{waiting} waiting for you</span>}</h2></div>
      <p className="muted hint">A class date moves to another teacher once that teacher has accepted and the centre lead has approved.</p>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Class</th><th>To be taken by</th><th>Asked by</th><th>Note</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(r => {
          const mineToAnswer = r.status === 'Waiting for teacher' && r.volunteer_id === myVol
          const mineToApprove = r.status === 'Waiting for centre lead' && a.canManage
          const canCancel = OPEN.includes(r.status) && (r.requested_by === me || a.canManage)
          return (
            <tr key={r.id}>
              <td>{fmtDate(r.cover_date)}</td><td><b>{r.class_name ?? 'Class'}</b></td>
              <td>{r.volunteer_id === myVol ? <span className="pill info">You</span> : r.volunteer_name}</td>
              <td>{r.requested_by === me ? 'You' : r.requested_by_name}</td><td>{r.note}</td>
              <td><span className={'pill ' + pill(r.status)}>{r.status}</span>
                {r.status === 'Declined' && <small className="muted"> by the {r.declined_by}{r.decline_note ? `: ${r.decline_note}` : ''}</small>}</td>
              <td className="row-actions">
                {mineToAnswer && <><button className="link" disabled={busy} onClick={() => run('answer_cover', { p_request: r.id, p_accept: true })}>Accept</button>
                  <button className="link danger-link" disabled={busy} onClick={() => run('answer_cover', { p_request: r.id, p_accept: false }, 'Reason for declining (optional)')}>Decline</button></>}
                {mineToApprove && <><button className="link" disabled={busy} onClick={() => run('decide_cover', { p_request: r.id, p_approve: true })}>Approve</button>
                  <button className="link danger-link" disabled={busy} onClick={() => run('decide_cover', { p_request: r.id, p_approve: false }, 'Reason for declining (optional)')}>Decline</button></>}
                {canCancel && !mineToApprove && <button className="link danger-link" disabled={busy} onClick={() => { if (window.confirm('Cancel this hand-over? The class stays with its usual teacher for that date.')) run('cancel_cover', { p_request: r.id }) }}>Cancel</button>}
              </td>
            </tr>
          )
        })}</tbody>
      </table></div>
    </section>
  )
}
