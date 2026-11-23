import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, friendly, loginName, WEEKDAYS } from '../lib/util'
import { Modal } from './ui'

const days = (w?: number[]) => (w ?? []).map(d => WEEKDAYS[d]).join(', ') || 'no days'
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) + ' IST' : 'time not set')

/** Volunteer: ask the centre lead to move a class. */
export function AskTimeChange({ cls, onClose }: { cls: any; onClose: () => void }) {
  const a = useAuth()
  const [w, setW] = useState<number[]>(cls.weekdays ?? [])
  const [t, setT] = useState<string>((cls.start_time ?? '17:00').slice(0, 5))
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!w.length) return setErr('Choose at least one day.')
    const { error } = await supabase.from('class_time_requests').insert({ class_id: cls.id, requested_by: a.profile!.id,
      requester_name: a.profile!.full_name || loginName(a.profile!.email), new_weekdays: w, new_start_time: t, note: note.trim() || null })
    if (error) setErr(friendly(error)); else setDone(true)
  }
  return (
    <Modal title={`Ask to change time: ${cls.name}`} onClose={onClose}>
      {done ? (<><p className="ok">Sent to your centre lead. The class time changes only if they approve it.</p><div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div></>) : (
        <form onSubmit={save}>
          <p className="muted">Now: {days(cls.weekdays)} at {hhmm(cls.start_time)}</p>
          <div className="field"><label>New days</label>
            <div className="chips">{WEEKDAYS.map((d, i) => <button type="button" key={d} className={'chip' + (w.includes(i) ? ' on' : '')} aria-pressed={w.includes(i)} onClick={() => setW(w.includes(i) ? w.filter(x => x !== i) : [...w, i].sort())}>{d}</button>)}</div></div>
          <div className="field top-gap"><label htmlFor="tr_time">New start time (India time)</label><input id="tr_time" type="time" required value={t} onChange={e => setT(e.target.value)} /></div>
          <div className="field top-gap"><label htmlFor="tr_note">Reason</label><textarea id="tr_note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Send request</button></div>
        </form>
      )}
    </Modal>
  )
}

/** Centre lead / admin: requests waiting for a decision. Volunteers: their own requests. */
export function TimeRequests({ classes, onChanged }: { classes: any[]; onChanged?: () => void }) {
  const a = useAuth()
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  const canDecide = a.isLead || a.isAdmin
  const load = useCallback(() => {
    supabase.from('class_time_requests').select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => setRows(data ?? []))
  }, [])
  useEffect(load, [load])
  const decide = async (r: any, ok: boolean) => {
    setErr('')
    const note = ok ? null : window.prompt('Reason for declining (optional)') ?? null
    const { error } = await supabase.rpc('decide_time_request', { p_request: r.id, p_approve: ok, p_note: note })
    if (error) setErr(friendly(error)); else { load(); onChanged?.() }
  }
  const shown = rows.filter(r => r.status === 'Pending' || !canDecide).slice(0, canDecide ? 50 : 5)
  if (!shown.length) return null
  const name = (id: string) => classes.find(c => c.id === id)?.name ?? 'Class'
  return (
    <section className="card">
      <div className="card-head"><h2>{canDecide ? 'Time-change requests waiting' : 'My time-change requests'} <span className="count">{shown.length}</span></h2></div>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Class</th>{canDecide && <th>From</th>}<th>Asked for</th><th>Reason</th><th>Asked on</th><th>{canDecide ? '' : 'Status'}</th></tr></thead>
        <tbody>{shown.map(r => (
          <tr key={r.id}>
            <td><b>{name(r.class_id)}</b></td>{canDecide && <td>{r.requester_name}</td>}
            <td>{days(r.new_weekdays)} at {hhmm(r.new_start_time)}</td><td>{r.note}</td><td>{fmtDate(r.created_at)}</td>
            <td className="row-actions">{canDecide
              ? (<><button className="link" onClick={() => decide(r, true)}>Approve</button><button className="link danger-link" onClick={() => decide(r, false)}>Decline</button></>)
              : <span className={'pill ' + (r.status === 'Approved' ? 'good' : r.status === 'Declined' ? 'warn' : 'todo')}>{r.status}</span>}{!canDecide && r.decision_note ? <small className="muted"> {r.decision_note}</small> : ''}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}
