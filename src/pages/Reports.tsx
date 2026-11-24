import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { avg, by, downloadCsv, fmtDate, hours, pct } from '../lib/util'
import { Tabs } from '../components/ui'
import { useClasses, useOptions } from './common'

export default function Reports() {
  const a = useAuth()
  const tabs = a.isPartner ? ['Attendance', 'Assessments'] : ['Attendance', 'Assessments', 'Volunteer hours']
  const [tab, setTab] = useState(tabs[0])
  return (
    <>
      <h1>Reports</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Attendance' && <AttendanceReport />}
      {tab === 'Assessments' && <AssessmentReport />}
      {tab === 'Volunteer hours' && <HoursReport />}
    </>
  )
}

function AttendanceReport() {
  const o = useOptions()
  const [rows, setRows] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [centre, setCentre] = useState('')
  const [cls, setCls] = useState('')
  const [low, setLow] = useState(false)
  useEffect(() => {
    Promise.all([
      supabase.from('attendance_summary').select('*').limit(20000),
      supabase.from('classes').select('id, name, centre_id, program_id').order('name').limit(2000),
      supabase.from('students').select('id, code, full_name, standard').limit(5000),
    ]).then(([s, c, st]) => { setRows(s.data ?? []); setClasses(c.data ?? []); setStudents(st.data ?? []) })
  }, [])
  const cById = useMemo(() => by(classes, c => c.id), [classes])
  const sById = useMemo(() => by(students, s => s.id), [students])
  const shown = rows
    .filter(r => cById[r.class_id] && sById[r.student_id])
    .filter(r => (!centre || cById[r.class_id].centre_id === centre) && (!cls || r.class_id === cls) && (!low || Number(r.pct) < 75))
    .sort((x, y) => sById[x.student_id].full_name.localeCompare(sById[y.student_id].full_name))
  const prog = (id: string) => o.programs.find(p => p.value === id)?.label ?? ''
  const centres = o.allCentres.filter(c => classes.some(k => k.centre_id === c.value))
  return (
    <section className="card">
      <div className="card-head wrap">
        <div className="row">
          {centres.length > 1 && <select value={centre} onChange={e => { setCentre(e.target.value); setCls('') }} aria-label="Centre"><option value="">All centres</option>{centres.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>}
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Class"><option value="">All classes</option>{classes.filter(c => !centre || c.centre_id === centre).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <label className="check"><input type="checkbox" checked={low} onChange={e => setLow(e.target.checked)} /> Below 75% only</label>
        </div>
        <button onClick={() => downloadCsv('attendance-report', ['Student', 'Code', 'Std', 'Class', 'Program', 'Classes marked', 'Present', '%'],
          shown.map(r => [sById[r.student_id].full_name, sById[r.student_id].code, sById[r.student_id].standard, cById[r.class_id].name, prog(cById[r.class_id].program_id), r.marked, r.present, r.pct]))}>Export</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Student</th><th>Class</th><th>Program</th><th className="num">Marked</th><th className="num">Present</th><th className="num">Attendance</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={6} className="muted">No attendance has been marked yet.</td></tr>}
          {shown.map(r => (
            <tr key={r.class_id + r.student_id}>
              <td><b>{sById[r.student_id].full_name}</b> <small className="muted">{sById[r.student_id].code}</small></td>
              <td>{cById[r.class_id].name}</td><td>{prog(cById[r.class_id].program_id)}</td>
              <td className="num">{r.marked}</td><td className="num">{r.present}</td>
              <td className="num"><span className={'pill ' + (Number(r.pct) >= 75 ? 'good' : 'warn')}>{pct(r.pct)}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  )
}

function AssessmentReport() {
  const { classes, classId, setClassId } = useClasses()
  const [tests, setTests] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  useEffect(() => {
    if (!classId) return
    Promise.all([
      supabase.from('assessments').select('id, name, exam_type, assess_date, max_marks, assessment_scores(student_id, marks, pct)').eq('class_id', classId).order('assess_date'),
      supabase.from('class_students').select('students(id, code, full_name)').eq('class_id', classId),
    ]).then(([t, s]) => {
      setTests(t.data ?? [])
      setStudents((s.data ?? []).map((r: any) => r.students).filter(Boolean).sort((x: any, y: any) => x.full_name.localeCompare(y.full_name)))
    })
  }, [classId])
  const score = (t: any, id: string) => { const s = t.assessment_scores.find((x: any) => x.student_id === id); return s ? Number(s.pct) : null }
  const change = (id: string) => {
    const b = tests.filter(t => t.exam_type.startsWith('Baseline')).map(t => score(t, id)).filter(x => x != null) as number[]
    const e = tests.filter(t => t.exam_type.startsWith('Endline')).map(t => score(t, id)).filter(x => x != null) as number[]
    return b.length && e.length ? avg(e)! - avg(b)! : null
  }
  return (
    <section className="card">
      <div className="card-head wrap">
        <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Class">{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button onClick={() => downloadCsv('assessment-report', ['Student', 'Code', ...tests.map(t => `${t.name || t.exam_type} ${t.assess_date} (% of ${Number(t.max_marks)})`), 'Baseline to Endline'],
          students.map(s => [s.full_name, s.code, ...tests.map(t => score(t, s.id) ?? ''), change(s.id)?.toFixed(1) ?? '']))}>Export</button>
      </div>
      <p className="muted hint">Marks as a % of each exam's total, so exams with different totals can be compared. The last column is Endline average minus Baseline average. For marks out of the total, use Assessments, then Report cards.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Student</th>{tests.map(t => <th key={t.id} className="num">{t.name || t.exam_type}<br /><small>{fmtDate(t.assess_date)} · out of {Number(t.max_marks)}</small></th>)}<th className="num">Change</th></tr></thead>
        <tbody>
          {(students.length === 0 || tests.length === 0) && <tr><td colSpan={99} className="muted">No assessments for this class yet.</td></tr>}
          {tests.length > 0 && students.map(s => { const c = change(s.id); return (
            <tr key={s.id}>
              <td><b>{s.full_name}</b> <small className="muted">{s.code}</small></td>
              {tests.map(t => <td key={t.id} className="num">{score(t, s.id) ?? '–'}</td>)}
              <td className="num">{c == null ? '–' : <span className={'pill ' + (c >= 0 ? 'good' : 'warn')}>{c >= 0 ? '+' : ''}{c.toFixed(1)}</span>}</td>
            </tr>
          ) })}
          {tests.length > 0 && students.length > 0 && (
            <tr className="total"><td><b>Class average</b></td>{tests.map(t => <td key={t.id} className="num"><b>{pct(avg(t.assessment_scores.map((x: any) => Number(x.pct))))}</b></td>)}<td /></tr>
          )}
        </tbody>
      </table></div>
    </section>
  )
}

function HoursReport() {
  const o = useOptions()
  const a = useAuth()
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { supabase.from('volunteer_hours').select('*').order('full_name').limit(5000).then(({ data }) => setRows(data ?? [])) }, [])
  const shown = rows.filter(r => a.isStaff || r.centre_id === a.profile?.centre_id)
  const total = (r: any) => Number(r.teaching_min) + Number(r.event_min) + Number(r.other_min)
  const centre = (id: string) => o.allCentres.find(c => c.value === id)?.label ?? ''
  return (
    <section className="card">
      <div className="card-head"><h2>Volunteer hours <span className="count">{shown.length}</span></h2>
        <button onClick={() => downloadCsv('volunteer-hours', ['Volunteer', 'Code', 'Centre', 'Status', 'Classes taken', 'Teaching hours', 'Events', 'Event hours', 'Other hours', 'Total hours', 'Trainings assigned', 'Trainings done', 'Core trainings done'],
          shown.map(r => [r.full_name, r.code, centre(r.centre_id), r.status, r.classes_taken, hours(r.teaching_min), r.events_attended, hours(r.event_min), hours(r.other_min), hours(total(r)), r.trainings_assigned, r.trainings_done, r.core_trainings_done]))}>Export</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Volunteer</th><th>Centre</th><th className="num">Classes</th><th className="num">Teaching h</th><th className="num">Event h</th><th className="num">Other h</th><th className="num">Total h</th><th className="num">Trainings done</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={8} className="muted">No volunteers yet.</td></tr>}
          {shown.map(r => (
            <tr key={r.volunteer_id}>
              <td><b>{r.full_name}</b> <small className="muted">{r.code}{r.status === 'Inactive' ? ' · inactive' : ''}</small></td><td>{centre(r.centre_id)}</td>
              <td className="num">{r.classes_taken}</td><td className="num">{hours(r.teaching_min)}</td><td className="num">{hours(r.event_min)}</td>
              <td className="num">{hours(r.other_min)}</td><td className="num"><b>{hours(total(r))}</b></td><td className="num">{r.trainings_done}/{r.trainings_assigned}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  )
}
