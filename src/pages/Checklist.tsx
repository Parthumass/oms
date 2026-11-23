import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly } from '../lib/util'
import { useOptions } from './common'

export const ITEMS: [string, string][] = [
  ['students', 'Student records are up to date (class, status, family details)'],
  ['volunteers', 'Volunteer records are up to date'],
  ['classes', 'Every class has the right volunteer and students'],
  ['attendance', 'Attendance is marked for every class held'],
  ['assessments', 'Assessments due this month are entered'],
  ['holistic', 'Holistic assessments are done where due'],
  ['events', 'Events are logged with who attended'],
  ['training', 'Training attendance is marked'],
  ['feedback', 'Volunteers have given training feedback'],
]
const thisMonth = () => new Date().toISOString().slice(0, 7)

export default function Checklist() {
  const a = useAuth()
  const o = useOptions()
  const centres = a.isLead ? o.centres : o.allCentres
  const [centre, setCentre] = useState(a.profile?.centre_id ?? '')
  const [month, setMonth] = useState(thisMonth())
  const [row, setRow] = useState<any>({ items: {}, notes: '' })
  const [all, setAll] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (!centre && centres[0]) setCentre(centres[0].value) }, [centre, centres])

  const load = useCallback(async () => {
    setMsg(''); setErr('')
    const m = month + '-01'
    const { data } = await supabase.from('monthly_checklists').select('*').eq('month', m)
    setAll(data ?? [])
    setRow((data ?? []).find((r: any) => r.centre_id === centre) ?? { items: {}, notes: '' })
  }, [centre, month])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setErr(''); setMsg('')
    const { error } = await supabase.from('monthly_checklists').upsert(
      { centre_id: centre, month: month + '-01', items: row.items, notes: row.notes || null }, { onConflict: 'centre_id,month' })
    if (error) setErr(friendly(error)); else { setMsg('Saved.'); load() }
  }
  const yes = (r: any) => ITEMS.filter(i => r.items?.[i[0]] === 'Yes').length
  return (
    <>
      <h1>Monthly checklist</h1>
      <section className="card">
        <div className="card-head wrap">
          <div className="row">
            <select value={centre} onChange={e => setCentre(e.target.value)} disabled={a.isLead} aria-label="Centre">{centres.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month" />
          </div>
          <button className="primary" onClick={save} disabled={!centre}>Save</button>
        </div>
        <p className="muted hint">A quick self-check each month that the centre's records are complete.</p>
        <div className="traits pad">
          {ITEMS.map(([k, label]) => (
            <div key={k} className="trait"><span>{label}</span>
              <div className="chips">{['Yes', 'No', 'NA'].map(x => (
                <button type="button" key={x} className={'chip' + (row.items?.[k] === x ? ' on' : '')} aria-pressed={row.items?.[k] === x}
                  onClick={() => setRow((r: any) => ({ ...r, items: { ...r.items, [k]: x } }))}>{x}</button>
              ))}</div>
            </div>
          ))}
          <div className="field top-gap"><label htmlFor="cn">Notes</label><textarea id="cn" rows={2} value={row.notes ?? ''} onChange={e => setRow((r: any) => ({ ...r, notes: e.target.value }))} /></div>
          {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
        </div>
      </section>
      {a.isStaff && (
        <section className="card">
          <div className="card-head"><h2>All centres this month</h2></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Centre</th><th className="num">Done</th><th>Not done</th></tr></thead>
            <tbody>{o.allCentres.map(c => { const r = all.find(x => x.centre_id === c.value); return (
              <tr key={c.value}><td>{c.label}</td>
                <td className="num">{r ? `${yes(r)}/${ITEMS.length}` : <span className="muted">Not filled in</span>}</td>
                <td>{r ? ITEMS.filter(i => r.items?.[i[0]] === 'No').map(i => i[1]).join('; ') : ''}</td></tr>
            ) })}</tbody>
          </table></div>
        </section>
      )}
    </>
  )
}
