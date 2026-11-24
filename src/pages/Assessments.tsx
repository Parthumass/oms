import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { avg, downloadCsv, fmtDate, friendly, LOGO, pct, today } from '../lib/util'
import { Modal, Tabs } from '../components/ui'
import { MODES, useClasses, useOptions } from './common'

/** Types offered when setting up an exam. */
export const EXAMS = ['Unit Test', 'Term Exam', 'Baseline Written', 'Baseline Oral', 'Midline', 'Endline Written', 'Endline Oral', 'Other']
/** Every type that can be on record, including ones no longer offered. */
export const ALL_EXAMS = [...EXAMS, 'Monthly']

const num = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(Number(n) * 100) / 100))
export const examName = (r: any) => r?.name || r?.exam_type || 'Exam'

export default function Assessments() {
  const a = useAuth()
  const { classes, classId, cls, setClassId, loading: loadingClasses, isTeacher } = useClasses()
  const [tab, setTab] = useState('Exams')
  const [rows, setRows] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [edit, setEdit] = useState<any | null>(null)
  const [err, setErr] = useState('')
  // the centre lead or admin team sets up the exam; the class teacher enters marks
  const canSetUp = !!cls && a.canManage
  const canMark = !!cls && (a.canManage || isTeacher(cls))

  const load = useCallback(async () => {
    if (!classId) return
    const [as, st] = await Promise.all([
      supabase.from('assessments').select('*, assessment_scores(student_id, marks, pct, remarks)').eq('class_id', classId).order('assess_date', { ascending: false }),
      supabase.from('class_students').select('students(id, code, full_name, standard, centre_id)').eq('class_id', classId),
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
      <Tabs tabs={['Exams', 'Report cards']} value={tab} onChange={setTab} />
      {tab === 'Exams' && (
        <section className="card">
          <div className="card-head wrap">
            <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Class">
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {canSetUp && <button className="primary" onClick={() => setEdit({ class_id: classId, name: '', exam_type: 'Unit Test', assess_date: today(), max_marks: 20, mode: cls.mode, assessment_scores: [] })}>New exam</button>}
          </div>
          <p className="muted hint">{canSetUp
            ? 'Set up an exam, for example "Unit Test 1" out of 20. The class teacher then opens it and enters the marks each student got.'
            : canMark ? 'Your centre lead sets up each exam and its total marks. Open an exam to enter the marks your students got.'
              : 'Exams for this class and the marks entered.'}</p>
          {err && <p className="error">{err}</p>}
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Exam</th><th>Type</th><th className="num">Out of</th><th className="num">Marks entered</th><th className="num">Class average</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="muted">No exams for this class yet.</td></tr>}
              {rows.map(r => { const m = avg(r.assessment_scores.map((s: any) => Number(s.marks))); return (
                <tr key={r.id}>
                  <td>{fmtDate(r.assess_date)}</td><td><b>{examName(r)}</b></td><td>{r.exam_type}</td>
                  <td className="num">{num(r.max_marks)}</td>
                  <td className="num">{r.assessment_scores.length} of {students.length}</td>
                  <td className="num">{m == null ? '–' : <>{num(m)} <small className="muted">({pct(avg(r.assessment_scores.map((s: any) => Number(s.pct))))})</small></>}</td>
                  <td className="row-actions"><button className="link" onClick={() => setEdit(r)}>{canMark ? 'Enter marks' : 'View'}</button></td>
                </tr>
              ) })}
            </tbody>
          </table></div>
        </section>
      )}
      {tab === 'Report cards' && <ReportCards classes={classes} classId={classId} setClassId={setClassId} students={students} />}
      {edit && <ExamForm row={edit} students={students} canSetUp={canSetUp} canMark={canMark} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function ExamForm(p: { row: any; students: any[]; canSetUp: boolean; canMark: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...p.row })
  const [scores, setScores] = useState<Record<string, { marks: string; remarks: string }>>(() =>
    Object.fromEntries((p.row.assessment_scores ?? []).map((s: any) => [s.student_id, { marks: s.marks == null ? '' : String(Number(s.marks)), remarks: s.remarks ?? '' }])))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const setScore = (id: string, k: 'marks' | 'remarks', x: string) => { setErr(''); setScores(s => ({ ...s, [id]: { marks: s[id]?.marks ?? '', remarks: s[id]?.remarks ?? '', [k]: x } })) }
  const max = Number(v.max_marks)
  const okMax = Number.isFinite(max) && max > 0

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (p.canSetUp && !okMax) return setErr('Enter the total marks for this exam.')
    const over = p.students.find(s => { const m = scores[s.id]?.marks ?? ''; return m !== '' && (Number(m) < 0 || Number(m) > max) })
    if (over) return setErr(`${over.full_name}: marks must be between 0 and ${num(max)}.`)
    setBusy(true)
    let id = v.id
    if (p.canSetUp) {
      const head = { class_id: v.class_id, name: v.name.trim(), exam_type: v.exam_type, assess_date: v.assess_date, max_marks: max, mode: v.mode || null, topics: v.topics || null, remarks: v.remarks || null }
      if (id) { const { error } = await supabase.from('assessments').update(head).eq('id', id); if (error) { setBusy(false); return setErr(friendly(error)) } }
      else { const { data, error } = await supabase.from('assessments').insert(head).select('id').single(); if (error) { setBusy(false); return setErr(friendly(error)) } id = data.id }
    }
    const keep = p.students.filter(s => (scores[s.id]?.marks ?? '') !== '')
    const drop = p.students.filter(s => (scores[s.id]?.marks ?? '') === '' && (p.row.assessment_scores ?? []).some((x: any) => x.student_id === s.id))
    if (keep.length) {
      const { error } = await supabase.from('assessment_scores').upsert(keep.map(s => ({ assessment_id: id, student_id: s.id, marks: Number(scores[s.id].marks), remarks: scores[s.id].remarks || null })))
      if (error) { setBusy(false); return setErr(friendly(error)) }
    }
    if (drop.length) await supabase.from('assessment_scores').delete().eq('assessment_id', id).in('student_id', drop.map(s => s.id))
    setBusy(false); p.onSaved()
  }
  const remove = async () => {
    if (!window.confirm('Delete this exam and all its marks? This cannot be undone.')) return
    const { error } = await supabase.from('assessments').delete().eq('id', v.id)
    if (error) setErr(friendly(error)); else p.onSaved()
  }
  return (
    <Modal title={v.id ? examName(v) : 'New exam'} onClose={p.onClose} wide>
      <form onSubmit={save}>
        <fieldset disabled={!p.canSetUp} className="plain">
          <div className="form-grid">
            <div className="field"><label htmlFor="an">Exam name</label><input id="an" required placeholder="Unit Test 1" value={v.name ?? ''} onChange={e => set('name', e.target.value)} /></div>
            <div className="field"><label htmlFor="ax">Total marks</label><input id="ax" type="number" required min={1} max={1000} step="0.5" value={v.max_marks ?? ''} onChange={e => set('max_marks', e.target.value)} />
              {p.canSetUp && <small>What the exam is out of, for example 20.</small>}</div>
            <div className="field"><label htmlFor="at">Type</label><select id="at" required value={v.exam_type} onChange={e => set('exam_type', e.target.value)}>{(EXAMS.includes(v.exam_type) ? EXAMS : [v.exam_type, ...EXAMS]).map(x => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="ad">Date</label><input id="ad" type="date" required value={v.assess_date} onChange={e => set('assess_date', e.target.value)} /></div>
            <div className="field"><label htmlFor="am">Mode</label><select id="am" value={v.mode ?? ''} onChange={e => set('mode', e.target.value)}><option value="">Select…</option>{MODES.map(m => <option key={m}>{m}</option>)}</select></div>
            <div className="field span"><label htmlFor="ato">Topics covered</label><textarea id="ato" rows={2} value={v.topics ?? ''} onChange={e => set('topics', e.target.value)} /></div>
          </div>
        </fieldset>
        <fieldset disabled={!p.canMark} className="plain">
          <table className="scores">
            <thead><tr><th>Student</th><th>Marks out of {okMax ? num(max) : '…'}</th><th className="num">%</th><th>Remarks</th></tr></thead>
            <tbody>
              {p.students.length === 0 && <tr><td colSpan={4} className="muted">This class has no students yet.</td></tr>}
              {p.students.map(s => { const m = scores[s.id]?.marks ?? ''; const bad = m !== '' && okMax && (Number(m) < 0 || Number(m) > max); return (
                <tr key={s.id}>
                  <td><b>{s.full_name}</b> <small className="muted">{s.code}</small></td>
                  <td><input type="number" step="any" inputMode="decimal" aria-invalid={bad} aria-label={`Marks for ${s.full_name}`} value={m} onChange={e => setScore(s.id, 'marks', e.target.value)} /></td>
                  <td className="num">{m === '' || !okMax || bad ? '–' : pct((Number(m) / max) * 100)}</td>
                  <td><input aria-label={`Remarks for ${s.full_name}`} value={scores[s.id]?.remarks ?? ''} onChange={e => setScore(s.id, 'remarks', e.target.value)} /></td>
                </tr>
              ) })}
            </tbody>
          </table>
        </fieldset>
        <p className="muted hint">Leave a student blank if they did not take the exam.</p>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          {v.id && p.canSetUp && <button type="button" className="danger" onClick={remove}>Delete exam</button>}
          <span className="grow" /><button type="button" onClick={p.onClose}>Close</button>
          {p.canMark && <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- report cards

type CardRow = { id: string; name: string; type: string; date: string; max: number; marks: number | null; pct: number | null; remarks: string }
type Card = {
  student: any
  subjects: { classId: string; name: string; subject?: string; teacher?: string; rows: CardRow[]; got: number; outOf: number; present?: number; marked?: number }[]
  got: number; outOf: number
}

/** Everything needed for the report cards of these students, from the classes the signed-in person can see. */
async function loadCards(students: any[], classes: any[], volName: (id?: string | null) => string | undefined): Promise<Card[]> {
  const ids = students.map(s => s.id)
  if (!ids.length) return []
  const links = (await supabase.from('class_students').select('class_id, student_id').in('student_id', ids)).data ?? []
  const classIds = [...new Set(links.map((l: any) => l.class_id))]
  const [as, at] = await Promise.all([
    supabase.from('assessments').select('id, class_id, name, exam_type, assess_date, max_marks, assessment_scores(student_id, marks, pct, remarks)').in('class_id', classIds).order('assess_date'),
    supabase.from('attendance_summary').select('*').in('student_id', ids),
  ])
  return students.map(student => {
    const subjects = links.filter((l: any) => l.student_id === student.id).map((l: any) => {
      const c = classes.find(x => x.id === l.class_id)
      const rows: CardRow[] = (as.data ?? []).filter((e: any) => e.class_id === l.class_id).map((e: any) => {
        const sc = e.assessment_scores.find((x: any) => x.student_id === student.id)
        return { id: e.id, name: examName(e), type: e.exam_type, date: e.assess_date, max: Number(e.max_marks), marks: sc ? Number(sc.marks) : null, pct: sc ? Number(sc.pct) : null, remarks: sc?.remarks ?? '' }
      })
      const taken = rows.filter(r => r.marks != null)
      const att = (at.data ?? []).find((r: any) => r.student_id === student.id && r.class_id === l.class_id)
      return { classId: l.class_id, name: c?.name ?? 'Class', subject: c?.subject, teacher: volName(c?.volunteer_id), rows,
        got: taken.reduce((x, r) => x + (r.marks as number), 0), outOf: taken.reduce((x, r) => x + r.max, 0),
        present: att ? Number(att.present) : undefined, marked: att ? Number(att.marked) : undefined }
    }).filter((s: any) => s.rows.length || s.marked).sort((x: any, y: any) => x.name.localeCompare(y.name))
    return { student, subjects, got: subjects.reduce((x: number, s: any) => x + s.got, 0), outOf: subjects.reduce((x: number, s: any) => x + s.outOf, 0) }
  })
}

function ReportCards({ classes, classId, setClassId, students }: { classes: any[]; classId: string; setClassId: (id: string) => void; students: any[] }) {
  const a = useAuth()
  const o = useOptions()
  const [cards, setCards] = useState<Card[] | null>(null)
  const [show, setShow] = useState<Card[] | null>(null)
  const volName = useCallback((id?: string | null) => a.lookups.volunteers.find(v => v.id === id)?.full_name, [a.lookups.volunteers])
  useEffect(() => {
    let stop = false
    setCards(null)
    loadCards(students, classes, volName).then(c => { if (!stop) setCards(c) })
    return () => { stop = true }
  }, [students, classes, volName])
  const centreName = (id?: string | null) => o.allCentres.find(c => c.value === id)?.label
  const list = cards ?? []
  const exportAll = () => downloadCsv('report-cards', ['Student', 'ID', 'Class', 'Exam', 'Type', 'Date', 'Marks', 'Out of', '%', 'Remarks'],
    list.flatMap(c => c.subjects.flatMap(s => s.rows.map(r => [c.student.full_name, c.student.code, s.name, r.name, r.type, r.date, r.marks ?? '', r.max, r.pct == null ? '' : r.pct.toFixed(1), r.remarks]))))
  return (
    <section className="card">
      <div className="card-head wrap">
        <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Class">
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="row">
          <button onClick={exportAll} disabled={!list.length}>Export marks</button>
          <button className="primary" onClick={() => setShow(list)} disabled={!list.length}>All report cards</button>
        </div>
      </div>
      <p className="muted hint">One report card per student, with every exam, the marks out of the total, and attendance. Open one and use Print or save as PDF.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Student</th><th className="num">Exams taken</th><th className="num">Total marks</th><th className="num">Overall</th><th /></tr></thead>
        <tbody>
          {cards && list.length === 0 && <tr><td colSpan={5} className="muted">This class has no students yet.</td></tr>}
          {!cards && <tr><td colSpan={5} className="muted">Loading…</td></tr>}
          {list.map(c => (
            <tr key={c.student.id}>
              <td><b>{c.student.full_name}</b> <small className="muted">{c.student.code}</small></td>
              <td className="num">{c.subjects.reduce((x, s) => x + s.rows.filter(r => r.marks != null).length, 0)}</td>
              <td className="num">{c.outOf ? `${num(c.got)} / ${num(c.outOf)}` : '–'}</td>
              <td className="num">{c.outOf ? pct((c.got / c.outOf) * 100) : '–'}</td>
              <td className="row-actions"><button className="link" onClick={() => setShow([c])}>Report card</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {show && <CardsModal cards={show} centreName={centreName} onClose={() => setShow(null)} />}
    </section>
  )
}

function CardsModal({ cards, centreName, onClose }: { cards: Card[]; centreName: (id?: string | null) => string | undefined; onClose: () => void }) {
  const sheets = useMemo(() => cards.map(c => <ReportCard key={c.student.id} card={c} centre={centreName(c.student.centre_id)} />), [cards, centreName])
  return (
    <Modal title={cards.length === 1 ? `Report card: ${cards[0].student.full_name}` : `Report cards (${cards.length})`} onClose={onClose} wide>
      <div className="actions no-top"><span className="muted">In the print window, choose "Save as PDF" to keep a file.</span><span className="grow" />
        <button className="primary" onClick={() => window.print()}>Print or save as PDF</button></div>
      <div className="cards-preview">{sheets}</div>
      {createPortal(<div className="print-area">{sheets}</div>, document.body)}
    </Modal>
  )
}

function ReportCard({ card, centre }: { card: Card; centre?: string }) {
  const s = card.student
  return (
    <article className="report-card">
      <header>
        <img src={LOGO} alt="" />
        <div><h2>Pratyagra Education Foundation</h2><p>Student report card</p></div>
      </header>
      <dl>
        <div><dt>Student</dt><dd>{s.full_name}</dd></div>
        <div><dt>ID</dt><dd>{s.code}</dd></div>
        {s.standard && <div><dt>Standard</dt><dd>{s.standard}</dd></div>}
        {centre && <div><dt>Centre</dt><dd>{centre}</dd></div>}
        <div><dt>Date</dt><dd>{fmtDate(today())}</dd></div>
      </dl>
      {card.subjects.length === 0 && <p className="muted">No exams or attendance on record yet.</p>}
      {card.subjects.map(sub => (
        <section key={sub.classId}>
          <h3>{sub.name}{sub.subject ? ` · ${sub.subject}` : ''}{sub.teacher ? <small> Teacher: {sub.teacher}</small> : ''}</h3>
          <table>
            <thead><tr><th>Exam</th><th>Date</th><th className="num">Marks</th><th className="num">Out of</th><th className="num">%</th><th>Remarks</th></tr></thead>
            <tbody>
              {sub.rows.length === 0 && <tr><td colSpan={6} className="muted">No exams yet.</td></tr>}
              {sub.rows.map(r => (
                <tr key={r.id}><td>{r.name}</td><td>{fmtDate(r.date)}</td><td className="num">{r.marks == null ? 'Not taken' : num(r.marks)}</td>
                  <td className="num">{num(r.max)}</td><td className="num">{r.pct == null ? '–' : pct(r.pct)}</td><td>{r.remarks}</td></tr>
              ))}
            </tbody>
            {sub.outOf > 0 && <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{num(sub.got)}</b></td><td className="num"><b>{num(sub.outOf)}</b></td><td className="num"><b>{pct((sub.got / sub.outOf) * 100)}</b></td><td /></tr></tfoot>}
          </table>
          {sub.marked ? <p className="att">Attendance: {sub.present} of {sub.marked} classes ({pct((100 * (sub.present ?? 0)) / sub.marked)})</p> : null}
        </section>
      ))}
      {card.outOf > 0 && <p className="overall">Overall: <b>{num(card.got)} / {num(card.outOf)}</b> ({pct((card.got / card.outOf) * 100)})</p>}
      <footer><span>Class teacher</span><span>Centre lead</span><span>Parent or guardian</span></footer>
    </article>
  )
}
