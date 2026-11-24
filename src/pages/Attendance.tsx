import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { downloadCsv, fmtDate, fmtDay, friendly, iso, monthLabel, monthRange, today } from '../lib/util'
import { Modal } from '../components/ui'
import { MODES, useClasses, useOptions } from './common'

type Mark = 'X' | 'AB'

export default function Attendance() {
  const a = useAuth()
  const o = useOptions()
  const { classes, classId, cls, setClassId, loading: loadingClasses, isTeacher, extraTeachers } = useClasses()
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [students, setStudents] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [newDate, setNewDate] = useState(today())
  const [open, setOpen] = useState<any | null>(null)
  const [covers, setCovers] = useState<any[]>([])
  const [joining, setJoining] = useState<any | null>(null)

  const myVol = a.profile?.volunteer_id
  const canEditAll = !!cls && (a.canManage || isTeacher(cls))
  const canEdit = (s: any) => canEditAll || (!!myVol && s.taught_by === myVol)
  const key = (sid: string, stu: string) => sid + '|' + stu
  // a class day before the student joined the class: not theirs, never counted
  const notYet = (st: any, s: any) => !!st.joined_on && s.session_date < st.joined_on

  const load = useCallback(async () => {
    if (!classId) return
    setLoading(true); setErr('')
    const { from, to } = monthRange(ym.y, ym.m)
    const [st, se] = await Promise.all([
      supabase.from('class_students').select('student_id, joined_on, students(id, code, full_name, status)').eq('class_id', classId),
      supabase.from('sessions').select('*').eq('class_id', classId).gte('session_date', from).lte('session_date', to).order('session_date'),
    ])
    if (st.error || se.error) setErr(friendly(st.error ?? se.error))
    const list = (st.data ?? []).filter((r: any) => r.students).map((r: any) => ({ ...r.students, joined_on: r.joined_on })).sort((x: any, y: any) => x.full_name.localeCompare(y.full_name))
    const ses = se.data ?? []
    const m: Record<string, Mark> = {}
    if (ses.length) {
      const { data } = await supabase.from('attendance').select('session_id, student_id, status').in('session_id', ses.map((s: any) => s.id)).limit(10000)
      for (const r of data ?? []) m[key(r.session_id, r.student_id)] = r.status
    }
    setStudents(list); setSessions(ses); setMarks(m); setLoading(false)
  }, [classId, ym.y, ym.m])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!classId) return
    supabase.from('class_covers').select('*').eq('class_id', classId).then(({ data }) => setCovers(data ?? []))
  }, [classId])
  // Dates handed to me that are not on the sheet yet (up to today).
  const myCoverDates = covers.filter(k => k.volunteer_id === myVol && k.cover_date <= today() && !sessions.some(s => s.session_date === k.cover_date)
    && k.cover_date.slice(0, 7) === `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`).map(k => k.cover_date as string)

  // Scheduled class days in this month that have no column yet (up to today).
  const suggestions = useMemo(() => {
    if (!cls || !canEditAll || !cls.weekdays?.length) return []
    const have = new Set(sessions.map(s => s.session_date))
    const out: string[] = []
    const last = new Date(ym.y, ym.m + 1, 0).getDate()
    for (let d = 1; d <= last; d++) {
      const dt = new Date(ym.y, ym.m, d)
      const s = iso(dt)
      if (cls.weekdays.includes(dt.getDay()) && !have.has(s) && s <= today() && s >= cls.start_date && (!cls.end_date || s <= cls.end_date)) out.push(s)
    }
    return out
  }, [cls, sessions, ym, canEditAll])

  const addDate = async (d: string) => {
    setErr('')
    if (!d || !cls) return
    const { error } = await supabase.from('sessions').insert({ class_id: cls.id, session_date: d, mode: cls.mode, duration_min: cls.duration_min })
    if (error) return setErr(/duplicate/i.test(error.message) ? 'That date is already on the sheet.' : friendly(error))
    const dt = new Date(d + 'T00:00:00')
    if (dt.getFullYear() !== ym.y || dt.getMonth() !== ym.m) setYm({ y: dt.getFullYear(), m: dt.getMonth() }); else load()
  }

  const setMark = async (s: any, stu: string, next: Mark | null) => {
    const k = key(s.id, stu)
    const prev = marks[k]
    setMarks(m => { const n = { ...m }; if (next) n[k] = next; else delete n[k]; return n })
    const res = next
      ? await supabase.from('attendance').upsert({ session_id: s.id, student_id: stu, status: next })
      : await supabase.from('attendance').delete().eq('session_id', s.id).eq('student_id', stu)
    if (res.error) {
      setErr(friendly(res.error))
      setMarks(m => { const n = { ...m }; if (prev) n[k] = prev; else delete n[k]; return n })
    }
  }
  const cycle = (s: any, stu: string) => {
    const cur = marks[key(s.id, stu)]
    setErr('')
    setMark(s, stu, cur === undefined ? 'X' : cur === 'X' ? 'AB' : null)
  }
  const fillBlanks = async (s: any, value: Mark) => {
    const rows = students.filter(st => !marks[key(s.id, st.id)] && !notYet(st, s)).map(st => ({ session_id: s.id, student_id: st.id, status: value }))
    if (!rows.length) return
    const { error } = await supabase.from('attendance').upsert(rows)
    if (error) setErr(friendly(error)); else load()
  }

  const totals = (st: any) => {
    let x = 0, n = 0
    for (const s of sessions) { if (notYet(st, s)) continue; const v = marks[key(s.id, st.id)]; if (v) { n++; if (v === 'X') x++ } }
    return { x, n, p: n ? Math.round((100 * x) / n) : null }
  }
  const colPresent = (s: any) => students.filter(st => !notYet(st, s) && marks[key(s.id, st.id)] === 'X').length

  const exportCsv = () => downloadCsv(
    `attendance-${cls?.name}-${ym.y}-${String(ym.m + 1).padStart(2, '0')}`,
    ['Code', 'Student', ...sessions.map(s => fmtDate(s.session_date)), 'Present', 'Marked', '%'],
    students.map(st => { const t = totals(st); return [st.code, st.full_name, ...sessions.map(s => notYet(st, s) ? '-' : marks[key(s.id, st.id)] ?? ''), t.x, t.n, t.p ?? ''] }),
  )
  const shift = (d: number) => setYm(({ y, m }) => { const dt = new Date(y, m + d, 1); return { y: dt.getFullYear(), m: dt.getMonth() } })
  const volName = (id: string | null) => a.lookups.volunteers.find(v => v.id === id)?.full_name

  if (!loadingClasses && classes.length === 0) {
    return <><h1>Attendance</h1><p className="card pad muted">{a.isVolunteer ? 'No class has been assigned to you yet. Ask your centre lead.' : a.canManage ? 'Create a class first, then add its students.' : 'Nothing to show yet.'}</p></>
  }
  return (
    <>
      <h1>Attendance</h1>
      <section className="card">
        <div className="card-head wrap">
          <div className="row">
            <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Class">
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (closed)'}</option>)}
            </select>
            <div className="month">
              <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
              <b>{monthLabel(ym.y, ym.m)}</b>
              <button onClick={() => shift(1)} aria-label="Next month">›</button>
            </div>
          </div>
          <div className="row">
            {canEditAll && (<>
              <input type="date" value={newDate} max={today()} onChange={e => setNewDate(e.target.value)} aria-label="Class date to add" />
              <button className="primary" onClick={() => addDate(newDate)}>Add class date</button>
            </>)}
            <button onClick={exportCsv}>Export</button>
          </div>
        </div>
        {cls && (
          <p className="muted hint">
            {o.programs.find(p => p.value === cls.program_id)?.label} · {o.allCentres.find(c => c.value === cls.centre_id)?.label}
            {[cls.volunteer_id, ...extraTeachers(cls)].map(volName).filter(Boolean).map(n => ` · ${n}`).join('')}
            {canEditAll || sessions.some(canEdit) ? ' · Click a box: X = present, AB = absent, click again to clear.' : ' · View only.'}
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="row hint wrap">
            <span className="muted">Scheduled days not yet added:</span>
            {suggestions.map(d => { const f = fmtDay(d); return <button key={d} className="chip" onClick={() => addDate(d)}>+ {f.wd} {f.day} {f.mon}</button> })}
          </div>
        )}
        {!canEditAll && myCoverDates.length > 0 && (
          <div className="row hint wrap">
            <span className="muted">You are taking this class on:</span>
            {myCoverDates.map(d => { const f = fmtDay(d); return <button key={d} className="chip" onClick={() => addDate(d)}>+ {f.wd} {f.day} {f.mon}</button> })}
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky name">Student</th>
                {sessions.map(s => { const f = fmtDay(s.session_date); return (
                  <th key={s.id} className="date">
                    <button className="date-btn" onClick={() => setOpen(s)} title="Class details">
                      <small>{f.wd}</small><b>{f.day}</b><small>{f.mon}{s.taught_by ? ' •' : ''}</small>
                    </button>
                  </th>
                ) })}
                <th className="num">Present</th><th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={99} className="muted">Loading…</td></tr> :
                students.length === 0 ? <tr><td colSpan={99} className="muted">No students in this class yet.</td></tr> :
                  students.map(st => { const t = totals(st); return (
                    <tr key={st.id}>
                      <td className="sticky name"><b>{st.full_name}</b><small>{st.code}{st.status === 'Inactive' ? ' · inactive' : ''}
                        {st.joined_on && <> · joined {fmtDate(st.joined_on)}</>}
                        {a.canManage && <> · <button className="link" onClick={() => setJoining(st)}>{st.joined_on ? 'change' : 'joined late?'}</button></>}</small></td>
                      {sessions.map(s => { if (notYet(st, s)) return <td key={s.id} className="cell"><span className="mark not-yet" title={`Joined this class on ${fmtDate(st.joined_on)}`}>–</span></td>
                        const v = marks[key(s.id, st.id)]; const ed = canEdit(s); return (
                        <td key={s.id} className="cell">
                          <button className={'mark ' + (v === 'X' ? 'x' : v === 'AB' ? 'ab' : 'blank')} disabled={!ed}
                            onClick={() => cycle(s, st.id)} aria-label={`${st.full_name}, ${fmtDate(s.session_date)}: ${v === 'X' ? 'present' : v === 'AB' ? 'absent' : 'not marked'}`}>{v ?? ''}</button>
                        </td>
                      ) })}
                      <td className="num">{t.n ? `${t.x}/${t.n}` : '–'}</td>
                      <td className="num">{t.p == null ? '–' : t.p + '%'}</td>
                    </tr>
                  ) })}
            </tbody>
            {students.length > 0 && sessions.length > 0 && (
              <tfoot><tr><td className="sticky name"><b>Present</b></td>{sessions.map(s => <td key={s.id} className="cell num">{colPresent(s)}</td>)}<td /><td /></tr></tfoot>
            )}
          </table>
        </div>
        {!loading && students.length > 0 && sessions.length === 0 && <p className="muted pad">No class dates in {monthLabel(ym.y, ym.m)} yet.{canEditAll ? ' Add one above to start marking.' : ''}</p>}
      </section>
      {open && cls && (
        <SessionModal session={open} canEdit={canEdit(open)} canManage={a.canManage} volunteers={o.volunteers}
          onFill={v => { fillBlanks(open, v); setOpen(null) }} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load() }} />
      )}
      {joining && cls && <JoinedModal classId={cls.id} student={joining} onClose={() => setJoining(null)} onSaved={() => { setJoining(null); load() }} />}
    </>
  )
}

function SessionModal(p: { session: any; canEdit: boolean; canManage: boolean; volunteers: { value: string; label: string }[]; onClose: () => void; onSaved: () => void; onFill: (v: Mark) => void }) {
  const [v, setV] = useState<any>({ ...p.session })
  const [err, setErr] = useState('')
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: any = { mode: v.mode || null, duration_min: v.duration_min || null, topics: v.topics || null, notes: v.notes || null }
    if (p.canManage) { body.taught_by = v.taught_by || null; body.session_date = v.session_date }
    const { error } = await supabase.from('sessions').update(body).eq('id', p.session.id)
    if (error) setErr(friendly(error)); else p.onSaved()
  }
  const remove = async () => {
    if (!window.confirm('Remove this class date and all its attendance marks?')) return
    const { error } = await supabase.from('sessions').delete().eq('id', p.session.id)
    if (error) setErr(friendly(error)); else p.onSaved()
  }
  return (
    <Modal title={`Class on ${fmtDate(p.session.session_date)}`} onClose={p.onClose}>
      <form onSubmit={save}>
        <fieldset disabled={!p.canEdit} className="plain">
          <div className="form-grid">
            {p.canManage && <div className="field"><label htmlFor="sd">Date</label><input id="sd" type="date" required value={v.session_date} onChange={e => set('session_date', e.target.value)} /></div>}
            <div className="field"><label htmlFor="sm">Mode</label>
              <select id="sm" value={v.mode ?? ''} onChange={e => set('mode', e.target.value)}><option value="">Select…</option>{MODES.map(m => <option key={m}>{m}</option>)}</select></div>
            <div className="field"><label htmlFor="sdu">Minutes</label><input id="sdu" type="number" min={5} max={600} value={v.duration_min ?? ''} onChange={e => set('duration_min', e.target.value === '' ? null : Number(e.target.value))} /></div>
            {p.canManage && <div className="field"><label htmlFor="ss">Substitute volunteer</label>
              <select id="ss" value={v.taught_by ?? ''} onChange={e => set('taught_by', e.target.value)}><option value="">None (class volunteer taught)</option>{p.volunteers.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              <small>A substitute can mark this one date only.</small></div>}
            <div className="field span"><label htmlFor="st">Topics covered</label><textarea id="st" rows={3} value={v.topics ?? ''} onChange={e => set('topics', e.target.value)} /></div>
            <div className="field span"><label htmlFor="sn">Notes</label><textarea id="sn" rows={2} value={v.notes ?? ''} onChange={e => set('notes', e.target.value)} /></div>
          </div>
        </fieldset>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          {p.canManage && <button type="button" className="danger" onClick={remove}>Remove date</button>}
          {p.canEdit && <button type="button" onClick={() => p.onFill('X')}>Mark blanks X</button>}
          {p.canEdit && <button type="button" onClick={() => p.onFill('AB')}>Mark blanks AB</button>}
          <span className="grow" />
          <button type="button" onClick={p.onClose}>Close</button>
          {p.canEdit && <button className="primary">Save</button>}
        </div>
      </form>
    </Modal>
  )
}

/** Centre lead / admin: when a student joined this class. Days before it are not counted for them. */
function JoinedModal(p: { classId: string; student: any; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<string>(p.student.joined_on ?? '')
  const [err, setErr] = useState('')
  const save = async (value: string | null) => {
    const { error } = await supabase.from('class_students').update({ joined_on: value }).eq('class_id', p.classId).eq('student_id', p.student.id)
    if (error) setErr(friendly(error)); else p.onSaved()
  }
  return (
    <Modal title={`When did ${p.student.full_name} join this class?`} onClose={p.onClose}>
      <p className="muted">Class days before this date are not theirs: they show as a dash, cannot be marked, and do not count in their attendance or the class's.</p>
      <div className="field"><label htmlFor="joined_on">Joined on</label><input id="joined_on" type="date" max={today()} value={d} onChange={e => setD(e.target.value)} /></div>
      {err && <p className="error">{err}</p>}
      <div className="actions">
        <button type="button" onClick={() => save(null)}>In the class from the start</button>
        <span className="grow" />
        <button type="button" onClick={p.onClose}>Cancel</button>
        <button className="primary" disabled={!d} onClick={() => save(d)}>Save</button>
      </div>
    </Modal>
  )
}
