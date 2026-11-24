import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { downloadCsv, fmtDate, friendly, today } from '../lib/util'
import { Modal, Tabs } from '../components/ui'
import { useOptions } from './common'

export const TIME_OFF_KINDS = ['Vacation or trip', 'Medical', 'Personal', 'Other']
/** Ready-made replies a supervisor can send when marking time off as noted. */
const REPLIES: Record<string, string[]> = {
  'Vacation or trip': ['Noted, thank you for letting us know. Have a great time!', 'Noted, thank you. Your classes are covered. Enjoy your trip!'],
  Medical: ['Noted, thank you for letting us know. Take care and get well soon.', 'Noted. Please rest and do not worry about your classes, they are covered.'],
  Personal: ['Noted, thank you for letting us know. Take the time you need.', 'Noted, thank you. Your classes are covered.'],
  Other: ['Noted, thank you for letting us know.', 'Noted, thank you. Your classes are covered.'],
}
export const span = (r: any) => (r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} to ${fmtDate(r.end_date)}`)
const dayCount = (r: any) => Math.round((new Date(r.end_date + 'T00:00:00').getTime() - new Date(r.start_date + 'T00:00:00').getTime()) / 86400000) + 1

export default function TimeOff() {
  const a = useAuth()
  const o = useOptions()
  const me = a.profile!.id
  const [tab, setTab] = useState(a.canManage ? 'Team' : 'Mine')
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<any | null>(null)
  const [past, setPast] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('time_off').select('*').order('start_date', { ascending: false }).limit(2000)
    setErr(error ? friendly(error) : ''); setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const remove = async (r: any) => {
    if (!window.confirm('Remove this time off entry? Do this if your plans changed.')) return
    const { error } = await supabase.from('time_off').delete().eq('id', r.id)
    if (error) setErr(friendly(error)); else load()
  }
  const undo = async (r: any) => {
    const { error } = await supabase.rpc('note_time_off', { p_id: r.id, p_noted: false })
    if (error) setErr(friendly(error)); else load()
  }
  const mine = rows.filter(r => r.profile_id === me)
  const team = rows.filter(r => r.profile_id !== me)
  const shown = (tab === 'Mine' ? mine : team).filter(r => past || r.end_date >= today())
  const waiting = team.filter(r => !r.noted_at && r.end_date >= today()).length
  const centreName = (id?: string | null) => o.allCentres.find(c => c.value === id)?.label ?? ''

  return (
    <>
      <h1>Time off</h1>
      {a.canManage && <Tabs tabs={['Team', 'Mine']} value={tab} onChange={setTab} />}
      <section className="card">
        <div className="card-head wrap">
          <h2>{tab === 'Mine' ? 'My time off' : 'Team time off'} <span className="count">{tab === 'Team' && waiting ? `${waiting} to note` : shown.length}</span></h2>
          <div className="row">
            <label className="check"><input type="checkbox" checked={past} onChange={e => setPast(e.target.checked)} /> Show past</label>
            {tab === 'Team' && <button onClick={() => downloadCsv('time-off', ['Name', 'ID', 'Centre', 'Type', 'From', 'To', 'Days', 'Reason', 'Logged on', 'Noted by', 'Noted on', 'Reply'],
              shown.map(r => [r.person_name, r.person_code, centreName(r.centre_id), r.kind, r.start_date, r.end_date, dayCount(r), r.reason, r.created_at?.slice(0, 10), r.noted_by_name, r.noted_at?.slice(0, 10), r.reply]))}>Export</button>}
            <button className="primary" onClick={() => setAdding(true)}>Let us know you will be away</button>
          </div>
        </div>
        <p className="muted hint">{tab === 'Mine'
          ? 'Going on a trip, unwell, or away for any reason? Add the dates here so the team knows and can arrange cover. This is not a request and nothing needs approving. It only keeps us informed.'
          : 'People who have told us they will be away. Nothing here needs approving. Check whether classes need cover, then mark the entry as noted; the person gets your reply by email.'}</p>
        {err && <p className="error">{err}</p>}
        <div className="table-wrap"><table>
          <thead><tr>{tab === 'Team' && <th>Who</th>}<th>Dates</th><th className="num">Days</th><th>Type</th><th>Reason (for records)</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="muted">{tab === 'Mine' ? 'You have no time off on record.' : 'Nobody has time off coming up.'}</td></tr>}
            {shown.map(r => (
              <tr key={r.id}>
                {tab === 'Team' && <td><b>{r.person_name}</b> <small className="muted">{[r.person_code, centreName(r.centre_id)].filter(Boolean).join(' · ')}</small></td>}
                <td>{span(r)}</td><td className="num">{dayCount(r)}</td><td>{r.kind}</td><td>{r.reason}</td>
                <td>{r.noted_at ? <><span className="pill good">Noted</span> <small className="muted">by {r.noted_by_name}{r.reply ? `: “${r.reply}”` : ''}</small></> : <span className="pill info">Sent to supervisors</span>}</td>
                <td className="row-actions">
                  {tab === 'Team' && a.canManage && (r.noted_at ? <button className="link" onClick={() => undo(r)}>Undo noted</button> : <button className="link" onClick={() => setNote(r)}>Mark as noted</button>)}
                  {(r.profile_id === me || a.isAdmin) && <button className="link danger-link" onClick={() => remove(r)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {adding && <AddTimeOff onClose={() => setAdding(false)} onSaved={() => { setTab('Mine'); load() }} />}
      {note && <NoteTimeOff row={note} onClose={() => setNote(null)} onSaved={() => { setNote(null); load() }} />}
    </>
  )
}

function AddTimeOff({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const a = useAuth()
  const [v, setV] = useState({ kind: 'Vacation or trip', start: today(), end: today(), reason: '' })
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = (k: string, x: string) => setV(s => ({ ...s, [k]: x, ...(k === 'start' && x > s.end ? { end: x } : {}) }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('log_time_off', { p_kind: v.kind, p_start: v.start, p_end: v.end, p_reason: v.reason })
    if (error) return setErr(friendly(error))
    setDone(true); onSaved()
  }
  return (
    <Modal title="Let us know you will be away" onClose={onClose}>
      {done ? (<><p className="ok">Noted, thank you. Your supervisors have been told. You do not need to wait for anything.</p>
        <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div></>) : (
        <form onSubmit={save}>
          <p className="muted">For <b>{a.profile?.full_name}</b>{a.profile?.code ? ` (${a.profile.code})` : ''}. This is to keep the team informed. It is not a request and is never refused.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="to_start">First day away</label><input id="to_start" type="date" required value={v.start} onChange={e => set('start', e.target.value)} /></div>
            <div className="field"><label htmlFor="to_end">Last day away</label><input id="to_end" type="date" required min={v.start} value={v.end} onChange={e => set('end', e.target.value)} /></div>
            <div className="field span"><label htmlFor="to_kind">Type</label><select id="to_kind" value={v.kind} onChange={e => set('kind', e.target.value)}>{TIME_OFF_KINDS.map(k => <option key={k}>{k}</option>)}</select></div>
            <div className="field span"><label htmlFor="to_reason">Reason</label><textarea id="to_reason" rows={2} required value={v.reason} onChange={e => set('reason', e.target.value)} />
              <small>A few words is enough. It is kept for our records and seen only by your supervisors.</small></div>
          </div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Send</button></div>
        </form>
      )}
    </Modal>
  )
}

function NoteTimeOff({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const options = REPLIES[row.kind] ?? REPLIES.Other
  const [reply, setReply] = useState(options[0])
  const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('note_time_off', { p_id: row.id, p_noted: true, p_reply: reply })
    if (error) setErr(friendly(error)); else onSaved()
  }
  return (
    <Modal title={`Mark as noted: ${row.person_name}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="task-meta"><span>{span(row)}</span><span>{row.kind}</span></p>
        <p className="muted">Do this once you have seen it and sorted out any cover. {row.person_name} gets your reply by email.</p>
        <div className="field"><label>Quick replies</label>
          <div className="chips col">{options.map(x => <button type="button" key={x} className={'chip' + (reply === x ? ' on' : '')} aria-pressed={reply === x} onClick={() => setReply(x)}>{x}</button>)}</div></div>
        <div className="field top-gap"><label htmlFor="to_reply">Your reply</label><textarea id="to_reply" rows={3} value={reply} onChange={e => setReply(e.target.value)} /></div>
        {err && <p className="error">{err}</p>}
        <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Mark as noted</button></div>
      </form>
    </Modal>
  )
}

/** Time off still to be noted by the signed-in supervisor, for the menu badge. */
export function useTimeOffToNote(enabled: boolean, userId?: string) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled || !userId) return
    let stop = false
    const run = () => supabase.from('time_off').select('id', { count: 'exact', head: true }).is('noted_at', null).neq('profile_id', userId).gte('end_date', today())
      .then(({ count }) => { if (!stop) setN(count ?? 0) })
    run(); const t = setInterval(run, 120000)
    return () => { stop = true; clearInterval(t) }
  }, [enabled, userId])
  return n
}
