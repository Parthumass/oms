import { useCallback, useEffect, useMemo, useState } from 'react'
import Crud from '../components/Crud'
import { Field, LinkPicker, Modal, Tabs } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { downloadCsv, fmtDate, friendly } from '../lib/util'
import { MODES, useOptions } from './common'
import { useTeams } from './Teams'

export default function Training() {
  const a = useAuth()
  return a.isVolunteer ? <MyTraining /> : <ManageTraining />
}

function ManageTraining() {
  const a = useAuth()
  const o = useOptions()
  const [tab, setTab] = useState('Meetings and sessions')
  const [topics, setTopics] = useState<any[]>([])
  const [mark, setMark] = useState<any | null>(null)
  const [assign, setAssign] = useState<any | null>(null)
  const [invite, setInvite] = useState<any | null>(null)
  const [record, setRecord] = useState<any | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { supabase.from('training_topics').select('*').eq('active', true).order('sort').then(({ data }) => setTopics(data ?? [])) }, [tick])
  const vols = a.lookups.volunteers.filter(v => v.status === 'Active' && (a.isStaff || v.centre_id === a.profile?.centre_id))
  const volOpts = vols.map(v => ({ value: v.id, label: v.full_name, sub: v.code }))
  // people with a login but no volunteer record: board, admin team, centre leads
  const [staff, setStaff] = useState<any[]>([])
  const [mineIn, setMineIn] = useState<Set<string>>(new Set())
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email, code, role, title, volunteer_id, active').limit(2000)
      .then(({ data }) => setStaff((data ?? []).filter((p: any) => p.active && p.role && p.role !== 'partner' && !p.volunteer_id)))
    supabase.from('training_invites_logins').select('session_id').eq('profile_id', a.profile!.id)
      .then(({ data }) => setMineIn(new Set((data ?? []).map((r: any) => r.session_id))))
  }, [a.profile, tick])
  const ROLE: Record<string, string> = { admin: 'Admin team', board: 'Board', centre_lead: 'Centre lead' }
  const people: Person[] = [
    ...staff.map(p => ({ key: 'p:' + p.id, id: p.id as string, login: true, label: p.full_name || p.email, sub: [p.code, p.title || ROLE[p.role]].filter(Boolean).join(' · ') })),
    ...volOpts.map(v => ({ key: 'v:' + v.value, id: v.value, login: false, label: v.label, sub: v.sub })),
  ]
  const fields: Field[] = [
    { key: 'session_date', label: 'Date', type: 'date', required: true },
    { key: 'title', label: 'Title', required: true, list: r => <>{r.title}{mineIn.has(r.id) && <> <span className="pill good">You are invited</span></>}</> },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Meeting', 'Core', 'Monthly', 'Other'], required: true,
      help: 'Meeting for a meeting; Core or Monthly for a training session.' },
    { key: 'start_time', label: 'Start time (India time)', type: 'time' },
    { key: 'audience', label: 'Who can see it', type: 'select', options: a.isStaff ? ['Everyone', 'Invited only', 'Board only'] : ['Everyone', 'Invited only'], required: true,
      help: 'Everyone: all volunteers and leads of the centre (or of every centre if none is chosen). Invited only: just the people you invite. Board only: the board and admin team.',
      list: r => (r.audience === 'Everyone' ? '' : <span className="pill info">{r.audience}</span>) },
    { key: 'topic_id', label: 'Training', type: 'select', options: topics.map(t => ({ value: t.id, label: t.name + (t.is_core ? ' (core)' : '') })),
      help: 'If this session delivers one of the trainings, pick it. Everyone marked present is then recorded as having completed it.' },
    { key: 'centre_id', label: 'Centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: a.isLead, locked: a.isLead,
      help: a.isLead ? undefined : 'Leave empty for a session open to every centre.',
      list: r => o.allCentres.find(c => c.value === r.centre_id)?.label ?? 'All centres' },
    { key: 'mode', label: 'Mode', type: 'select', options: MODES, list: false },
    { key: 'duration_min', label: 'Minutes', type: 'number', list: false },
    { key: 'description', label: 'Description', type: 'textarea', list: false },
    { key: '_n', label: 'Attended', form: false, list: r => { const at = (r.training_attendance?.[0]?.count ?? 0) + (r.training_attendance_logins?.[0]?.count ?? 0), inv = (r.training_invites?.[0]?.count ?? 0) + (r.training_invites_logins?.[0]?.count ?? 0); return inv ? `${at} (${inv} invited)` : at } },
  ]
  return (
    <>
      <h1>Trainings / Meetings</h1>
      <Tabs tabs={['Meetings and sessions', 'Trainings', 'Tracker', 'Feedback']} value={tab} onChange={setTab} />
      {tab === 'Trainings' && (
        <Crud key={'t' + tick} title="Trainings" table="training_topics" select="*, training_assignments(count)" order={{ col: 'sort' }}
          canAdd={a.isStaff} canEdit={a.isStaff} canDelete={a.isStaff} defaults={{ is_core: false, active: true, sort: 10 }}
          onChanged={() => setTick(t => t + 1)} addLabel="Add training"
          hint={a.isStaff ? 'Add a training here, then use Assign to choose who has to do it. Centre leads can assign their own volunteers.'
            : 'Use Assign to choose which of your volunteers have to do each training.'}
          fields={[
            { key: 'name', label: 'Training', required: true },
            { key: 'description', label: 'What it covers', type: 'textarea' },
            { key: 'link', label: 'Link to material', list: r => r.link ? <a href={/^https?:\/\//.test(r.link) ? r.link : undefined} target="_blank" rel="noreferrer">Open</a> : '' },
            { key: 'is_core', label: 'Core (required for all)', type: 'bool' },
            { key: 'sort', label: 'Order', type: 'number', required: true, list: false },
            { key: 'active', label: 'Active', type: 'bool', list: false },
            { key: '_n', label: 'Assigned', form: false, list: r => r.training_assignments?.[0]?.count ?? 0 },
          ]}
          actions={r => <button className="link" onClick={() => setAssign(r)}>Assign</button>} />
      )}
      {tab === 'Tracker' && <Tracker topics={topics} vols={vols} />}
      {tab === 'Meetings and sessions' && (
        <Crud key={'s' + tick} title="Meetings and sessions" table="training_sessions" select="*, training_attendance(count), training_invites(count), training_attendance_logins(count), training_invites_logins(count)" addLabel="Add meeting or session" fields={fields}
          order={{ col: 'session_date', asc: false }} canAdd canDelete
          canEdit={r => a.isStaff || r.centre_id === a.profile?.centre_id}
          defaults={{ kind: 'Meeting', centre_id: o.myCentre, mode: 'Online', audience: 'Everyone' }}
          hint="Add a meeting or training session, use Invite to choose who should come, then Mark attendance afterwards. Record shows who was invited and who was there."
          actions={r => <><button className="link" onClick={() => setInvite(r)}>Invite</button><button className="link" onClick={() => setMark(r)}>Mark attendance</button><button className="link" onClick={() => setRecord(r)}>Record</button></>} />
      )}
      {tab === 'Feedback' && <FeedbackList />}
      {assign && (
        <LinkPicker title={`Assign: ${assign.name}`} table="training_assignments" parentKey="topic_id" parentId={assign.id} childKey="volunteer_id"
          canEdit options={volOpts} note="Tick the volunteers who have to do this training. Unticking removes it from their list."
          onClose={() => { setAssign(null); setTick(t => t + 1) }} />
      )}
      {invite && <PeoplePicker title={`Invite to: ${invite.title}`} session={invite} what="invites" people={people}
        note="Tick everyone who should come: volunteers, centre leads, board or admin team. They see it under their trainings and meetings."
        onClose={() => { setInvite(null); setTick(t => t + 1) }} />}
      {mark && <PeoplePicker title={`Who attended: ${mark.title}`} session={mark} what="attendance" people={people}
        note="Tick everyone who was there. Invited people are listed first."
        onClose={() => { setMark(null); setTick(t => t + 1) }} />}
      {record && <SessionRecord session={record} onClose={() => setRecord(null)} />}
    </>
  )
}

type Person = { key: string; id: string; login: boolean; label: string; sub?: string }

/** Tick people for a meeting: who is invited, or who attended. Works for volunteers and for people who only have a login. */
function PeoplePicker({ title, session, what, people, note, onClose }: { title: string; session: any; what: 'invites' | 'attendance'; people: Person[]; note?: string; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const teams = useTeams()
  const table = (login: boolean) => `training_${what}${login ? '_logins' : ''}`
  useEffect(() => {
    const keys = async (w: string) => {
      const [v, l] = await Promise.all([
        supabase.from(`training_${w}`).select('volunteer_id').eq('session_id', session.id),
        supabase.from(`training_${w}_logins`).select('profile_id').eq('session_id', session.id),
      ])
      return new Set([...(v.data ?? []).map((r: any) => 'v:' + r.volunteer_id), ...(l.data ?? []).map((r: any) => 'p:' + r.profile_id)])
    }
    Promise.all([keys(what), what === 'attendance' ? keys('invites') : Promise.resolve(new Set<string>())])
      .then(([p, i]) => { setPicked(p); setInvited(i); setLoading(false) })
  }, [session.id, what])
  const toggle = async (o: Person) => {
    setErr('')
    const on = picked.has(o.key)
    const next = new Set(picked); on ? next.delete(o.key) : next.add(o.key); setPicked(next)
    const col = o.login ? 'profile_id' : 'volunteer_id'
    const res = on
      ? await supabase.from(table(o.login)).delete().eq('session_id', session.id).eq(col, o.id)
      : await supabase.from(table(o.login)).insert({ session_id: session.id, [col]: o.id } as any)
    if (res.error) { setErr(friendly(res.error)); setPicked(picked) }
  }
  // tick every member of a team in one go
  const addTeam = async (teamId: string) => {
    if (!teamId) return
    setErr(''); setBusy(true)
    const { data, error } = await supabase.from('team_members').select('volunteer_id, profile_id').eq('team_id', teamId)
    if (error) { setBusy(false); return setErr(friendly(error)) }
    const next = new Set(picked)
    for (const m of (data ?? []) as any[]) {
      const login = !m.volunteer_id, id = (m.volunteer_id ?? m.profile_id) as string, key = (login ? 'p:' : 'v:') + id
      if (next.has(key)) continue
      const res = await supabase.from(table(login)).insert({ session_id: session.id, [login ? 'profile_id' : 'volunteer_id']: id } as any)
      if (res.error) { setErr(friendly(res.error)); break }
      next.add(key)
    }
    setPicked(next); setBusy(false)
  }
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? people.filter(o => (o.label + ' ' + (o.sub ?? '')).toLowerCase().includes(s)) : people
    const rank = (o: Person) => (picked.has(o.key) ? 0 : invited.has(o.key) ? 1 : o.login ? 2 : 3)
    return [...list].sort((x, y) => rank(x) - rank(y) || x.label.localeCompare(y.label))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, people, loading, busy])
  return (
    <Modal title={title} onClose={onClose}>
      {note && <p className="muted">{note}</p>}
      {teams.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <select value="" disabled={busy} onChange={e => addTeam(e.target.value)} aria-label="Tick a whole team">
            <option value="">{busy ? 'Adding…' : 'Tick a whole team…'}</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </div>
      )}
      <div className="row"><input placeholder="Search by name, ID or role" value={q} onChange={e => setQ(e.target.value)} /><span className="muted">{picked.size} selected</span></div>
      {err && <p className="error">{err}</p>}
      <div className="ticklist">
        {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">Nobody to choose from yet.</p> :
          shown.map(o => (
            <label key={o.key} className="tick">
              <input type="checkbox" checked={picked.has(o.key)} onChange={() => toggle(o)} />
              <span>{o.label}</span><small>{[invited.has(o.key) && 'invited', o.sub].filter(Boolean).join(' · ')}</small>
            </label>
          ))}
      </div>
      <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  )
}

/** The record of one meeting or session: who was invited, who was there. */
function SessionRecord({ session, onClose }: { session: any; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    Promise.all([
      supabase.from('training_invites').select('volunteer_id, volunteers(full_name, code)').eq('session_id', session.id),
      supabase.from('training_attendance').select('volunteer_id, marked_at, volunteers(full_name, code)').eq('session_id', session.id),
      supabase.from('training_invites_logins').select('profile_id, person_name, person_code').eq('session_id', session.id),
      supabase.from('training_attendance_logins').select('profile_id, person_name, person_code').eq('session_id', session.id),
    ]).then(([i, t, il, tl]) => {
      const m = new Map<string, any>()
      for (const r of (i.data ?? []) as any[]) m.set(r.volunteer_id, { name: r.volunteers?.full_name, code: r.volunteers?.code, invited: true, present: false })
      for (const r of (t.data ?? []) as any[]) m.set(r.volunteer_id, { ...(m.get(r.volunteer_id) ?? { name: r.volunteers?.full_name, code: r.volunteers?.code, invited: false }), present: true })
      for (const r of (il.data ?? []) as any[]) m.set(r.profile_id, { name: r.person_name, code: r.person_code, invited: true, present: false })
      for (const r of (tl.data ?? []) as any[]) m.set(r.profile_id, { ...(m.get(r.profile_id) ?? { name: r.person_name, code: r.person_code, invited: false }), present: true })
      setRows([...m.values()].sort((x, y) => String(x.name).localeCompare(String(y.name))))
    })
  }, [session.id])
  const list = rows ?? []
  const status = (r: any) => (r.present ? 'Present' : 'Absent')
  return (
    <Modal title={`Record: ${session.title}`} onClose={onClose} wide>
      <p className="task-meta"><span>{fmtDate(session.session_date)}</span><span>{session.kind}</span>
        <span><b>{list.filter(r => r.present).length}</b> present</span><span><b>{list.filter(r => r.invited).length}</b> invited</span>
        <span><b>{list.filter(r => r.invited && !r.present).length}</b> absent</span></p>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>ID</th><th>Invited</th><th>Attendance</th></tr></thead>
        <tbody>
          {rows && list.length === 0 && <tr><td colSpan={4} className="muted">Nobody has been invited or marked yet.</td></tr>}
          {list.map(r => (
            <tr key={r.code ?? r.name}><td><b>{r.name}</b></td><td>{r.code}</td><td>{r.invited ? 'Yes' : 'No'}</td>
              <td>{r.present ? <span className="yes">✓ Present</span> : <span className="pill warn">Absent</span>}</td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="actions"><span className="grow" />
        <button onClick={() => downloadCsv(`record-${session.session_date}-${session.title}`, ['Date', 'Meeting or session', 'Kind', 'Name', 'ID', 'Invited', 'Attendance'],
          list.map(r => [session.session_date, session.title, session.kind, r.name, r.code, r.invited ? 'Yes' : 'No', status(r)]))}>Export</button>
        <button onClick={onClose}>Close</button></div>
    </Modal>
  )
}

function Tracker({ topics, vols }: { topics: any[]; vols: any[] }) {
  const [rows, setRows] = useState<Record<string, any>>({})
  const [err, setErr] = useState('')
  const [only, setOnly] = useState(false)
  const load = useCallback(() => {
    supabase.from('training_assignments').select('*').limit(20000).then(({ data }) =>
      setRows(Object.fromEntries((data ?? []).map((r: any) => [r.volunteer_id + '|' + r.topic_id, r]))))
  }, [])
  useEffect(load, [load])
  const get = (v: any, t: any) => rows[v.id + '|' + t.id]
  const toggle = async (r: any) => {
    setErr('')
    const { error } = await supabase.from('training_assignments').update({ completed_on: r.completed_on ? null : new Date().toISOString().slice(0, 10) }).eq('id', r.id)
    if (error) setErr(friendly(error)); else load()
  }
  const done = (v: any) => topics.filter(t => get(v, t)?.completed_on).length
  const given = (v: any) => topics.filter(t => get(v, t)).length
  const shown = vols.filter(v => !only || given(v) > done(v))
  return (
    <section className="card">
      <div className="card-head wrap"><h2>Training tracker <span className="count">{shown.length}</span></h2>
        <div className="row">
          <label className="check"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Still to finish only</label>
          <button onClick={() => downloadCsv('training-tracker', ['Volunteer', 'Code', ...topics.map(t => t.name), 'Done', 'Assigned'],
            shown.map(v => [v.full_name, v.code, ...topics.map(t => { const r = get(v, t); return r ? (r.completed_on ? 'Done ' + r.completed_on : 'Assigned') : '' }), done(v), given(v)]))}>Export</button>
        </div></div>
      <p className="muted hint">Click <b>To do</b> to mark a training as done, or <b>Done</b> to undo. A dash means it is not assigned to that volunteer.</p>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Volunteer</th>{topics.map(t => <th key={t.id} className="num">{t.name}{t.is_core ? ' *' : ''}</th>)}<th className="num">Done</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={99} className="muted">No volunteers to show.</td></tr>}
          {shown.map(v => (
            <tr key={v.id}>
              <td><b>{v.full_name}</b> <small className="muted">{v.code}</small></td>
              {topics.map(t => { const r = get(v, t); return (
                <td key={t.id} className="num">{!r ? <span className="muted" aria-label="Not assigned">–</span>
                  : <button className={'chip' + (r.completed_on ? ' done' : ' todo')} onClick={() => toggle(r)} title={r.completed_on ? 'Done on ' + fmtDate(r.completed_on) : 'Assigned, not done yet'}>{r.completed_on ? '✓ Done' : 'To do'}</button>}</td>
              ) })}
              <td className="num"><b>{done(v)}/{given(v)}</b></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="muted hint">* core training</p>
    </section>
  )
}

function FeedbackList() {
  return (
    <Crud title="Training feedback" table="training_feedback" select="*, training_sessions(title, session_date), volunteers(full_name)"
      order={{ col: 'created_at', asc: false }}
      fields={[
        { key: '_s', label: 'Session', list: r => r.training_sessions?.title },
        { key: '_d', label: 'Date', list: r => fmtDate(r.training_sessions?.session_date) },
        { key: '_v', label: 'Volunteer', list: r => r.volunteers?.full_name },
        { key: 'relevance', label: 'Relevance' }, { key: 'content', label: 'Content' }, { key: 'space', label: 'Questions' },
        { key: 'pace', label: 'Pace' }, { key: 'overall', label: 'Overall' },
        { key: 'takeaways', label: 'Key takeaways' }, { key: 'apply_plan', label: 'Will apply' }, { key: 'comments', label: 'Comments' },
      ]} />
  )
}

const RATE: [string, string][] = [['relevance', 'Relevance of the topic'], ['content', 'Quality of the content'], ['space', 'Space to ask questions'], ['pace', 'Pace of the session'], ['overall', 'Overall satisfaction']]

export function MyTraining() {
  const a = useAuth()
  const me = a.profile!.volunteer_id!
  const [sessions, setSessions] = useState<any[]>([])
  const [todo, setTodo] = useState<any[]>([])
  const [attended, setAttended] = useState<Set<string>>(new Set())
  const [given, setGiven] = useState<Set<string>>(new Set())
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const [fb, setFb] = useState<any | null>(null)
  const load = useCallback(async () => {
    const [s, t, at, f, inv] = await Promise.all([
      supabase.from('training_sessions').select('*').order('session_date', { ascending: false }),
      supabase.from('training_assignments').select('*, training_topics(name, description, link, is_core, sort)').eq('volunteer_id', me),
      supabase.from('training_attendance').select('session_id').eq('volunteer_id', me),
      supabase.from('training_feedback').select('session_id').eq('volunteer_id', me),
      supabase.from('training_invites').select('session_id').eq('volunteer_id', me),
    ])
    setSessions(s.data ?? [])
    setTodo((t.data ?? []).sort((x: any, y: any) => Number(!!x.completed_on) - Number(!!y.completed_on) || (x.training_topics?.sort ?? 0) - (y.training_topics?.sort ?? 0)))
    setAttended(new Set((at.data ?? []).map((r: any) => r.session_id)))
    setGiven(new Set((f.data ?? []).map((r: any) => r.session_id)))
    setInvited(new Set((inv.data ?? []).map((r: any) => r.session_id)))
  }, [me])
  useEffect(() => { load() }, [load])
  return (
    <>
      <h1>My trainings / meetings</h1>
      <section className="card">
        <div className="card-head"><h2>Trainings assigned to me: {todo.filter(t => t.completed_on).length} of {todo.length} done</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Training</th><th>What it covers</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {todo.length === 0 && <tr><td colSpan={4} className="muted">Nothing has been assigned to you yet.</td></tr>}
            {todo.map(t => (
              <tr key={t.id}>
                <td><b>{t.training_topics?.name}</b>{t.training_topics?.is_core ? <small className="muted"> core</small> : ''}</td>
                <td>{t.training_topics?.description}{t.training_topics?.link && /^https?:\/\//.test(t.training_topics.link) ? <> <a href={t.training_topics.link} target="_blank" rel="noreferrer">Open material</a></> : ''}</td>
                <td>{fmtDate(t.due_date)}</td>
                <td>{t.completed_on ? <span className="yes">✓ Done {fmtDate(t.completed_on)}</span> : <span className="pill warn">To do</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Meetings and sessions</h2></div>
        <p className="muted hint">Meetings and training sessions. <b>Invited</b> means you are expected to come. Your centre lead marks who attended; once you are marked, you can leave feedback.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Meeting or session</th><th>Kind</th><th>Attended</th><th /></tr></thead>
          <tbody>
            {sessions.length === 0 && <tr><td colSpan={5} className="muted">No meetings or sessions yet.</td></tr>}
            {sessions.map(s => (
              <tr key={s.id}>
                <td>{fmtDate(s.session_date)}{s.start_time ? <small className="muted"> {String(s.start_time).slice(0, 5)} IST</small> : ''}</td><td>{s.title}{invited.has(s.id) && <> <span className="pill info">Invited</span></>}</td><td>{s.kind}</td>
                <td>{attended.has(s.id) ? <span className="yes">✓ Yes</span> : <span className="muted">Not marked</span>}</td>
                <td className="row-actions">{attended.has(s.id) && (given.has(s.id) ? <span className="muted">Feedback sent</span> : <button className="link" onClick={() => setFb(s)}>Give feedback</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {fb && <FeedbackForm session={fb} me={me} onClose={() => setFb(null)} onSaved={() => { setFb(null); load() }} />}
    </>
  )
}

function FeedbackForm(p: { session: any; me: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({})
  const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (RATE.some(r => !v[r[0]])) return setErr('Please give all five ratings.')
    const { error } = await supabase.from('training_feedback').insert({ session_id: p.session.id, volunteer_id: p.me, ...v })
    if (error) setErr(friendly(error)); else p.onSaved()
  }
  return (
    <Modal title={`Feedback: ${p.session.title}`} onClose={p.onClose} wide>
      <form onSubmit={save}>
        <p className="muted scale">1 = very dissatisfied · 5 = very satisfied</p>
        <div className="traits">
          {RATE.map(([k, label]) => (
            <div key={k} className="trait"><span>{label}</span>
              <div className="chips">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} className={'chip round' + (v[k] === n ? ' on' : '')} aria-pressed={v[k] === n} onClick={() => setV((s: any) => ({ ...s, [k]: n }))}>{n}</button>)}</div>
            </div>
          ))}
        </div>
        <div className="form-grid top-gap">
          <div className="field span"><label htmlFor="ft">Your key takeaways</label><textarea id="ft" rows={2} value={v.takeaways ?? ''} onChange={e => setV((s: any) => ({ ...s, takeaways: e.target.value }))} /></div>
          <div className="field span"><label htmlFor="fa">How will you use this in class?</label><textarea id="fa" rows={2} value={v.apply_plan ?? ''} onChange={e => setV((s: any) => ({ ...s, apply_plan: e.target.value }))} /></div>
          <div className="field span"><label htmlFor="fc">Anything else?</label><textarea id="fc" rows={2} value={v.comments ?? ''} onChange={e => setV((s: any) => ({ ...s, comments: e.target.value }))} /></div>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="actions"><span className="grow" /><button type="button" onClick={p.onClose}>Cancel</button><button className="primary">Send feedback</button></div>
      </form>
    </Modal>
  )
}
