import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { downloadCsv, fmtDate, friendly, today } from '../lib/util'
import { Modal } from '../components/ui'

export const TRAITS: [string, string][] = [
  ['punctuality', 'Regular and on time'],
  ['appearance', 'Neat and tidy'],
  ['materials', 'Brings own books and stationery'],
  ['english', 'Speaks English fluently'],
  ['attention', 'Pays attention in class'],
  ['asks', 'Raises hand to answer or ask'],
  ['conduct', 'No fighting or abusive language'],
  ['respect', 'Respectful and helpful to others'],
  ['participation', 'Takes part in the session'],
  ['confidence', 'Confident'],
]
const SCALE = ['1 Needs improvement', '2 Sometimes', '3 Usually', '4 Always']

export default function Holistic() {
  const a = useAuth()
  const [rows, setRows] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [edit, setEdit] = useState<any | null>(null)
  const [q, setQ] = useState('')
  const load = useCallback(async () => {
    const [h, s] = await Promise.all([
      supabase.from('holistic_assessments').select('*, students(full_name, code), volunteers(full_name)').order('assess_date', { ascending: false }).limit(2000),
      supabase.from('students').select('id, code, full_name').eq('status', 'Active').order('full_name').limit(5000),
    ])
    setRows(h.data ?? []); setStudents(s.data ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  const shown = rows.filter(r => !q || (r.students?.full_name ?? '').toLowerCase().includes(q.toLowerCase()))
  const mine = (r: any) => a.canManage || r.volunteer_id === a.profile?.volunteer_id
  return (
    <>
      <h1>Holistic assessment</h1>
      <section className="card">
        <div className="card-head wrap">
          <h2>Ratings <span className="count">{shown.length}</span></h2>
          <div className="row">
            <input className="search" placeholder="Search student" value={q} onChange={e => setQ(e.target.value)} />
            <button onClick={() => downloadCsv('holistic-assessments', ['Student', 'Code', 'Type', 'Date', ...TRAITS.map(t => t[1]), 'Overall /10', 'Feedback'],
              shown.map(r => [r.students?.full_name, r.students?.code, r.kind, r.assess_date, ...TRAITS.map(t => r.ratings?.[t[0]] ?? ''), r.overall, r.feedback]))}>Export</button>
            <button className="primary" onClick={() => setEdit({ kind: 'Baseline', assess_date: today(), ratings: {}, volunteer_id: a.profile?.volunteer_id ?? null })}>New rating</button>
          </div>
        </div>
        <p className="muted hint">Rate each student once at the start (Baseline) and once at the end (Endline) on ten everyday behaviours.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Student</th><th>Type</th><th>Date</th><th className="num">Trait average</th><th className="num">Overall /10</th><th>By</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="muted">No ratings yet.</td></tr>}
            {shown.map(r => { const vals = TRAITS.map(t => Number(r.ratings?.[t[0]])).filter(Boolean); return (
              <tr key={r.id}>
                <td><b>{r.students?.full_name}</b> <small className="muted">{r.students?.code}</small></td>
                <td>{r.kind}</td><td>{fmtDate(r.assess_date)}</td>
                <td className="num">{vals.length ? (vals.reduce((x, y) => x + y, 0) / vals.length).toFixed(1) + ' / 4' : '–'}</td>
                <td className="num">{r.overall ?? '–'}</td><td>{r.volunteers?.full_name ?? 'Centre team'}</td>
                <td className="row-actions"><button className="link" onClick={() => setEdit(r)}>{mine(r) ? 'Open' : 'View'}</button></td>
              </tr>
            ) })}
          </tbody>
        </table></div>
      </section>
      {edit && <Form row={edit} students={students} canEdit={!edit.id || mine(edit)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function Form(p: { row: any; students: any[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...p.row, ratings: { ...(p.row.ratings ?? {}) } })
  const [err, setErr] = useState('')
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (TRAITS.some(t => !v.ratings[t[0]])) return setErr('Please rate all ten behaviours.')
    const body = { student_id: v.student_id, volunteer_id: v.volunteer_id ?? null, assess_date: v.assess_date, kind: v.kind, ratings: v.ratings, overall: v.overall ?? null, feedback: v.feedback || null }
    const res = v.id ? await supabase.from('holistic_assessments').update(body).eq('id', v.id) : await supabase.from('holistic_assessments').insert(body)
    if (res.error) setErr(friendly(res.error)); else p.onSaved()
  }
  return (
    <Modal title="Holistic assessment" onClose={p.onClose} wide>
      <form onSubmit={save}>
        <fieldset disabled={!p.canEdit} className="plain">
          <div className="form-grid">
            <div className="field"><label htmlFor="hs">Student</label>
              <select id="hs" required value={v.student_id ?? ''} onChange={e => set('student_id', e.target.value)} disabled={!!v.id}>
                <option value="">Select…</option>{p.students.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.code})</option>)}
              </select></div>
            <div className="field"><label htmlFor="hk">Type</label><select id="hk" value={v.kind} onChange={e => set('kind', e.target.value)}><option>Baseline</option><option>Endline</option></select></div>
            <div className="field"><label htmlFor="hd">Date</label><input id="hd" type="date" required value={v.assess_date} onChange={e => set('assess_date', e.target.value)} /></div>
          </div>
          <p className="muted scale">{SCALE.join(' · ')}</p>
          <div className="traits">
            {TRAITS.map(([k, label]) => (
              <div key={k} className="trait" role="radiogroup" aria-label={label}>
                <span>{label}</span>
                <div className="chips">{[1, 2, 3, 4].map(n => (
                  <button type="button" key={n} className={'chip round' + (v.ratings[k] === n ? ' on' : '')} aria-pressed={v.ratings[k] === n} title={SCALE[n - 1]}
                    onClick={() => setV((s: any) => ({ ...s, ratings: { ...s.ratings, [k]: n } }))}>{n}</button>
                ))}</div>
              </div>
            ))}
          </div>
          <div className="form-grid top-gap">
            <div className="field"><label htmlFor="ho">Overall rating out of 10</label><input id="ho" type="number" min={0} max={10} value={v.overall ?? ''} onChange={e => set('overall', e.target.value === '' ? null : Number(e.target.value))} /></div>
            <div className="field span"><label htmlFor="hf">Any other feedback</label><textarea id="hf" rows={2} value={v.feedback ?? ''} onChange={e => set('feedback', e.target.value)} /></div>
          </div>
        </fieldset>
        {err && <p className="error">{err}</p>}
        <div className="actions"><span className="grow" /><button type="button" onClick={p.onClose}>Close</button>{p.canEdit && <button className="primary">Save</button>}</div>
      </form>
    </Modal>
  )
}
