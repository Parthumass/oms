import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { by, pct, WEEKDAYS } from '../lib/util'
import { Stat } from '../components/ui'
import { useOptions } from './common'
import { ALL_EXAMS } from './Assessments'
import { AskTimeChange, TimeRequests } from '../components/TimeRequests'
import { CoverList, CoverModal } from '../components/Cover'
import { istLabel, localTime } from './Calendar'

export default function Dashboard() {
  const a = useAuth()
  const o = useOptions()
  const [d, setD] = useState<any>(null)
  const [ask, setAsk] = useState<any | null>(null)
  const [cover, setCover] = useState<any | null>(null)
  const [coverTick, setCoverTick] = useState(0)
  const [mine, setMine] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!a.profile?.volunteer_id) return
    supabase.from('class_teachers').select('class_id').eq('volunteer_id', a.profile.volunteer_id).then(({ data }) => setMine(new Set((data ?? []).map((r: any) => r.class_id))))
  }, [a.profile])
  useEffect(() => {
    Promise.all([
      supabase.from('students').select('id, gender, status').limit(10000),
      supabase.from('classes').select('*, class_students(count)').order('name').limit(2000),
      supabase.from('attendance_summary').select('*').limit(20000),
      supabase.from('assessment_summary').select('*').limit(5000),
      a.isVolunteer ? supabase.from('volunteer_hours').select('*').eq('volunteer_id', a.profile!.volunteer_id!) : Promise.resolve({ data: [] as any[] }),
    ]).then(([s, c, at, as, h]) => setD({ students: s.data ?? [], classes: c.data ?? [], att: at.data ?? [], asm: as.data ?? [], hours: h.data?.[0] }))
  }, [a.isVolunteer, a.profile])

  const calc = useMemo(() => {
    if (!d) return null
    const active = d.students.filter((s: any) => s.status === 'Active')
    const cById = by(d.classes as any[], c => c.id)
    const rate = (rows: any[]) => { const m = rows.reduce((x, r) => x + Number(r.marked), 0); return m ? (100 * rows.reduce((x, r) => x + Number(r.present), 0)) / m : null }
    const byClass = d.classes.map((c: any) => ({ c, pct: rate(d.att.filter((r: any) => r.class_id === c.id)) }))
    const byProgram = o.programs.map(p => ({ p, pct: rate(d.att.filter((r: any) => cById[r.class_id]?.program_id === p.value)), n: d.classes.filter((c: any) => c.program_id === p.value).length })).filter(x => x.n)
    const exams = ALL_EXAMS.map(e => { const rows = d.asm.filter((r: any) => r.exam_type === e); const n = rows.reduce((x: number, r: any) => x + Number(r.scores), 0)
      return { e, n, pct: n ? rows.reduce((x: number, r: any) => x + Number(r.avg_pct) * Number(r.scores), 0) / n : null } }).filter(x => x.n)
    return { active, overall: rate(d.att), byClass, byProgram, exams }
  }, [d, o.programs])

  if (!d || !calc) return <><h1>{a.isVolunteer ? 'My classes' : 'Dashboard'}</h1><p className="muted">Loading…</p></>

  if (a.isVolunteer) {
    return (
      <>
        <h1>My classes</h1>
        <div className="stats">
          <Stat label="My students" value={calc.active.length} />
          <Stat label="Classes taken" value={d.hours?.classes_taken ?? 0} />
          <Stat label="Teaching hours" value={((d.hours?.teaching_min ?? 0) / 60).toFixed(1)} />
          <Stat label="Trainings done" value={`${d.hours?.trainings_done ?? 0} of ${d.hours?.trainings_assigned ?? 0}`} />
        </div>
        {d.classes.length === 0 && <p className="card pad muted">No class has been assigned to you yet. Your centre lead will add you to one.</p>}
        <div className="cards">
          {calc.byClass.map(({ c, pct: p }: any) => (
            <div key={c.id} className="card pad class-card">
              <h2>{c.name}</h2>
              <p className="muted">{o.programs.find(x => x.value === c.program_id)?.label} · {o.allCentres.find(x => x.value === c.centre_id)?.label}</p>
              <p>{c.class_students?.[0]?.count ?? 0} students{c.weekdays?.length ? ' · ' + c.weekdays.map((w: number) => WEEKDAYS[w]).join(', ') : ''}</p>
              <p>{c.start_time ? <>Starts <b>{istLabel(c.start_time)}</b> <span className="muted">({localTime('2026-01-05', c.start_time).time} your time)</span></> : <span className="muted">Start time not set yet</span>}</p>
              <p>Attendance so far: <b>{pct(p)}</b></p>
              <div className="row"><Link className="btn primary" to={`/attendance?class=${c.id}`}>Mark attendance</Link><Link className="btn" to={`/assessments?class=${c.id}`}>Assessments</Link>{(c.volunteer_id === a.profile?.volunteer_id || mine?.has(c.id)) && <><button onClick={() => setAsk(c)}>Ask to change time</button><button onClick={() => setCover(c)}>Can't make a class</button></>}</div>
            </div>
          ))}
        </div>
        <CoverList classes={d.classes} tick={coverTick} />
        <TimeRequests key={ask ? 'a' : 'b'} classes={d.classes} />
        {cover && <CoverModal cls={cover} onClose={() => setCover(null)} onSaved={() => setCoverTick(t => t + 1)} />}
        {ask && <AskTimeChange cls={ask} onClose={() => setAsk(null)} />}
      </>
    )
  }
  const vols = a.lookups.volunteers.filter(v => v.status === 'Active' && (a.isStaff || v.centre_id === a.profile?.centre_id))
  return (
    <>
      <h1>Dashboard</h1>
      {a.canManage && <CoverList />}
      <div className="stats">
        <Stat label="Active students" value={calc.active.length} sub={`${calc.active.filter((s: any) => s.gender === 'Female').length} girls · ${calc.active.filter((s: any) => s.gender === 'Male').length} boys`} />
        {!a.isPartner && <Stat label="Active volunteers" value={vols.length} />}
        <Stat label="Classes running" value={d.classes.filter((c: any) => c.active).length} />
        <Stat label="Overall attendance" value={pct(calc.overall)} />
      </div>
      <div className="two">
        <section className="card">
          <div className="card-head"><h2>Attendance by program</h2></div>
          <table><thead><tr><th>Program</th><th className="num">Classes</th><th className="num">Attendance</th></tr></thead>
            <tbody>{calc.byProgram.length === 0 && <tr><td colSpan={3} className="muted">No classes yet.</td></tr>}
              {calc.byProgram.map(x => <tr key={x.p.value}><td>{x.p.label}</td><td className="num">{x.n}</td><td className="num">{pct(x.pct)}</td></tr>)}</tbody></table>
        </section>
        <section className="card">
          <div className="card-head"><h2>Assessment averages</h2></div>
          <table><thead><tr><th>Type</th><th className="num">Marks entered</th><th className="num">Average</th></tr></thead>
            <tbody>{calc.exams.length === 0 && <tr><td colSpan={3} className="muted">No assessments yet.</td></tr>}
              {calc.exams.map(x => <tr key={x.e}><td>{x.e}</td><td className="num">{x.n}</td><td className="num">{pct(x.pct)}</td></tr>)}</tbody></table>
        </section>
      </div>
      <section className="card">
        <div className="card-head"><h2>Classes</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Class</th><th>Centre</th><th>Program</th><th>Volunteer</th><th className="num">Students</th><th className="num">Attendance</th><th /></tr></thead>
          <tbody>{calc.byClass.length === 0 && <tr><td colSpan={7} className="muted">No classes yet.</td></tr>}
            {calc.byClass.map(({ c, pct: p }: any) => (
              <tr key={c.id}><td><b>{c.name}</b>{c.active ? '' : <small className="muted"> closed</small>}</td>
                <td>{o.allCentres.find(x => x.value === c.centre_id)?.label}</td><td>{o.programs.find(x => x.value === c.program_id)?.label}</td>
                <td>{a.lookups.volunteers.find(v => v.id === c.volunteer_id)?.full_name ?? ''}</td>
                <td className="num">{c.class_students?.[0]?.count ?? 0}</td><td className="num">{pct(p)}</td>
                <td className="row-actions"><Link className="link" to={`/attendance?class=${c.id}`}>Open</Link></td></tr>
            ))}</tbody>
        </table></div>
      </section>
    </>
  )
}
