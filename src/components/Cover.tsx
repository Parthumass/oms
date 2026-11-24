import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { addDaysIso, fmtDate, friendly, today, WEEKDAYS } from '../lib/util'
import { Modal } from './ui'

/** Hand one date of a class to another teacher ("I cannot make it, X will take it"). */
export function CoverModal({ cls, onClose, onSaved }: { cls: any; onClose: () => void; onSaved?: () => void }) {
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
    const { error } = await supabase.rpc('give_cover', { p_class: cls.id, p_date: date, p_volunteer: who, p_note: note })
    if (error) return setErr(friendly(error))
    setDone(people?.find(p => p.id === who)?.full_name ?? 'them'); onSaved?.()
  }
  return (
    <Modal title={`Hand over a class: ${cls.name}`} onClose={onClose}>
      {done ? (<><p className="ok">{done} now has this class on {fmtDate(date)}. They can see the class and mark attendance for that date.</p>
        <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div></>) : (
        <form onSubmit={save}>
          <p className="muted">Use this when the usual teacher cannot take the class on one date. Tell the other teacher first; the portal does not ask them to accept.</p>
          <div className="field"><label htmlFor="cv_date">Which date</label><input id="cv_date" type="date" required min={addDaysIso(today(), -1)} value={date} onChange={e => setDate(e.target.value)} />
            {offDay && <small>This class normally runs on {cls.weekdays.map((w: number) => WEEKDAYS[w]).join(', ')}. Check the date.</small>}</div>
          <div className="field top-gap"><label htmlFor="cv_who">Who will take it</label>
            <select id="cv_who" required value={who} onChange={e => setWho(e.target.value)}>
              <option value="">{people ? 'Select…' : 'Loading…'}</option>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.code})</option>)}</select>
            {people && people.length === 0 && <small>No other active volunteer at this centre yet.</small>}</div>
          <div className="field top-gap"><label htmlFor="cv_note">Note for them</label><textarea id="cv_note" rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Hand over</button></div>
        </form>
      )}
    </Modal>
  )
}

/** Upcoming class dates that have been handed to another teacher. Hidden when there are none. */
export function CoverList({ classes, tick }: { classes: any[]; tick?: number }) {
  const a = useAuth()
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    supabase.from('class_covers').select('*').gte('cover_date', addDaysIso(today(), -1)).order('cover_date').limit(500).then(({ data }) => setRows(data ?? []))
  }, [])
  useEffect(load, [load, tick])
  const me = a.profile?.volunteer_id
  const cancel = async (r: any) => {
    if (!window.confirm('Cancel this? The class goes back to its usual teacher for that date.')) return
    const { error } = await supabase.from('class_covers').delete().eq('id', r.id)
    if (error) setErr(friendly(error)); else load()
  }
  if (!rows.length) return null
  return (
    <section className="card">
      <div className="card-head"><h2>Classes handed over <span className="count">{rows.length}</span></h2></div>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Class</th><th>Taken by</th><th>Handed over by</th><th>Note</th><th /></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}>
            <td>{fmtDate(r.cover_date)}</td><td><b>{classes.find(c => c.id === r.class_id)?.name ?? 'Class'}</b></td>
            <td>{r.volunteer_id === me ? <span className="pill info">You</span> : r.volunteer_name}</td>
            <td>{r.given_by === a.profile?.id ? 'You' : r.given_by_name}</td><td>{r.note}</td>
            <td className="row-actions">{(a.canManage || r.given_by === a.profile?.id) && <button className="link danger-link" onClick={() => cancel(r)}>Cancel</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}
