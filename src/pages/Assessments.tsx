import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { avg, fmtDate, friendly, pct, today } from '../lib/util'
import { Modal } from '../components/ui'
import { MODES, useClasses } from './common'

export const EXAMS = ['Baseline Written', 'Baseline Oral', 'Monthly', 'Midline', 'Endline Written', 'Endline Oral']

export default function Assessments() {
  const a = useAuth()
  const { classes, classId, cls, setClassId, loading: loadingClasses } = useClasses()
  const [rows, setRows] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [edit, setEdit] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const canEdit = !!cls && (a.canManage || (a.isVolunteer && cls.volunteer_id === a.profile?.volunteer_id))

  const load = useCallback(async () => {
    if (!classId) return
    const [as, st] = await Promise.all([
      supabase.from('assessments').select('*, assessment_scores(student_id, pct, remarks)').eq('class_id', classId).order('assess_date', { ascending: false }),
      supabase.from('class_students').select('students(id, code, full_name)').eq('class_id', classId),
    ])
    setErr(as.error ? friendly(as.error) : '')
    setRows(as.data ?? [])
    setStudents((st.data ?? []).map((r: any) => r.students).filter(Boolean).sort((x: any, y: any) => x.full_name.localeCompare(y.full_name)))
  }, [classId])
  useEffect(() => { load() }, [load])

  if (!loadingClasses && classes.length === 0) return <><h1>Assessments</h1><p className="card pad muted">No classes to show yet.</p></>
  return (
    <>
      <h1>Assessments</h1>
      <section className="card">
        <div className="card-head wrap">
          <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Class">
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {canEdit && <button className="primary" onClick={() => setEdit({ class_id: classId, exam_type: 'Monthly', assess_date: today(), mode: cls.mode, assessment_scores: [] })}>New assessment</button>}
        </div>
        <p className="muted hint">Marks are entered as a percentage for each student. Baseline and Endline are compared in Reports.</p>
        {err && <p className="error">{err}</p>}
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Type</th><th>Mode</th><th>Topics</th><th className="num">Students</th><th className="num">Average</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No assessments for this class yet.</td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <td>{fmtDate(r.assess_date)}</td><td>{r.exam_type}</td><td>{r.mode}</td><td>{r.topics}</td>
                <td className="num">{r.assessment_scores.length}</td>
                <td className="num">{pct(avg(r.assessment_scores.map((s: any) => Number(s.pct))))}</td>
                <td className="row-actions"><button className="link" onClick={() => setEdit(r)}>{canEdit ? 'Open' : 'View'}</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {edit && <AssessmentForm row={edit} students={students} canEdit={canEdit} canDelete={a.canManage} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function AssessmentForm(p: { row: any; students: any[]; canEdit: boolean; canDelete: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...p.row })
  const [scores, setScores] = useState<Record<string, { pct: string; remarks: string }>>(() =>
    Object.fromEntries((p.row.assessment_scores ?? []).map((s: any) => [s.student_id, { pct: String(Number(s.pct)), remarks: s.remarks ?? '' }])))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const setScore = (id: string, k: 'pct' | 'remarks', x: string) => setScores(s => ({ ...s, [id]: { pct: s[id]?.pct ?? '', remarks: s[id]?.remarks ?? '', [k]: x } }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const head = { class_id: v.class_id, exam_type: v.exam_type, assess_date: v.assess_date, mode: v.mode || null, topics: v.topics || null, remarks: v.remarks || null }
    let id = v.id
    if (id) { const { error } = await supabase.from('assessments').update(head).eq('id', id); if (error) { setBusy(false); return setErr(friendly(error)) } }
    else { const { data, error } = await supabase.from('assessments').insert(head).select('id').single(); if (error) { setBusy(false); return setErr(friendly(error)) } id = data.id }
    const keep = p.students.filter(s => (scores[s.id]?.pct ?? '') !== '')
    const drop = p.students.filter(s => (scores[s.id]?.pct ?? '') === '' && (p.row.assessment_scores ?? []).some((x: any) => x.student_id === s.id))
    if (keep.length) {
      const { error } = await supabase.from('assessment_scores').upsert(keep.map(s => ({ assessment_id: id, student_id: s.id, pct: Number(scores[s.id].pct), remarks: scores[s.id].remarks || null })))
      if (error) { setBusy(false); return setErr(friendly(error)) }
    }
    if (drop.length) await supabase.from('assessment_scores').delete().eq('assessment_id', id).in('student_id', drop.map(s => s.id))
    setBusy(false); p.onSaved()
  }
  const remove = async () => {
    if (!window.confirm('Delete this assessment and its marks?')) return
    const { error } = await supabase.from('assessments').delete().eq('id', v.id)
    if (error) setErr(friendly(error)); else p.onSaved()
  }
  return (
    <Modal title={v.id ? 'Assessment' : 'New assessment'} onClose={p.onClose} wide>
      <form onSubmit={save}>
        <fieldset disabled={!p.canEdit} className="plain">
          <div className="form-grid">
            <div className="field"><label htmlFor="at">Type</label><select id="at" required value={v.exam_type} onChange={e => set('exam_type', e.target.value)}>{EXAMS.map(x => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="ad">Date</label><input id="ad" type="date" required value={v.assess_date} onChange={e => set('assess_date', e.target.value)} /></div>
            <div className="field"><label htmlFor="am">Mode</label><select id="am" value={v.mode ?? ''} onChange={e => set('mode', e.target.value)}><option value="">Select…</option>{MODES.map(m => <option key={m}>{m}</option>)}</select></div>
            <div className="field span"><label htmlFor="ato">Topics covered</label><textarea id="ato" rows={2} value={v.topics ?? ''} onChange={e => set('topics', e.target.value)} /></div>
          </div>
          <table className="scores">
            <thead><tr><th>Student</th><th>% marks</th><th>Remarks</th></tr></thead>
            <tbody>
              {p.students.length === 0 && <tr><td colSpan={3} className="muted">This class has no students yet.</td></tr>}
              {p.students.map(s => (
                <tr key={s.id}>
                  <td><b>{s.full_name}</b> <small className="muted">{s.code}</small></td>
                  <td><input type="number" min={0} max={100} step="0.5" aria-label={`Marks for ${s.full_name}`} value={scores[s.id]?.pct ?? ''} onChange={e => setScore(s.id, 'pct', e.target.value)} /></td>
                  <td><input aria-label={`Remarks for ${s.full_name}`} value={scores[s.id]?.remarks ?? ''} onChange={e => setScore(s.id, 'remarks', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="field span top-gap"><label htmlFor="ar">Overall remarks</label><textarea id="ar" rows={2} value={v.remarks ?? ''} onChange={e => set('remarks', e.target.value)} /></div>
        </fieldset>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          {v.id && p.canDelete && <button type="button" className="danger" onClick={remove}>Delete</button>}
          <span className="grow" /><button type="button" onClick={p.onClose}>Close</button>
          {p.canEdit && <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
        </div>
      </form>
    </Modal>
  )
}
