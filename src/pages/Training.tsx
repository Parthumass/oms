import { useCallback, useEffect, useState } from 'react'
import Crud from '../components/Crud'
import { Field, LinkPicker, Modal, Tabs } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { downloadCsv, fmtDate, friendly } from '../lib/util'
import { MODES, useOptions } from './common'

export default function Training() {
  const a = useAuth()
  return a.isVolunteer ? <MyTraining /> : <ManageTraining />
}

function ManageTraining() {
  const a = useAuth()
  const o = useOptions()
  const [tab, setTab] = useState('Trainings')
  const [topics, setTopics] = useState<any[]>([])
  const [mark, setMark] = useState<any | null>(null)
  const [assign, setAssign] = useState<any | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { supabase.from('training_topics').select('*').eq('active', true).order('sort').then(({ data }) => setTopics(data ?? [])) }, [tick])
  const vols = a.lookups.volunteers.filter(v => v.status === 'Active' && (a.isStaff || v.centre_id === a.profile?.centre_id))
  const volOpts = vols.map(v => ({ value: v.id, label: v.full_name, sub: v.code }))
  const fields: Field[] = [
    { key: 'session_date', label: 'Date', type: 'date', required: true },
    { key: 'title', label: 'Title', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Core', 'Monthly', 'Other'], required: true },
    { key: 'topic_id', label: 'Training', type: 'select', options: topics.map(t => ({ value: t.id, label: t.name + (t.is_core ? ' (core)' : '') })),
      help: 'If this session delivers one of the trainings, pick it. Everyone marked present is then recorded as having completed it.' },
    { key: 'centre_id', label: 'Centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: a.isLead, locked: a.isLead,
      help: a.isLead ? undefined : 'Leave empty for a session open to every centre.',
      list: r => o.allCentres.find(c => c.value === r.centre_id)?.label ?? 'All centres' },
    { key: 'mode', label: 'Mode', type: 'select', options: MODES, list: false },
    { key: 'duration_min', label: 'Minutes', type: 'number', list: false },
    { key: 'description', label: 'Description', type: 'textarea', list: false },
    { key: '_n', label: 'Attended', form: false, list: r => r.training_attendance?.[0]?.count ?? 0 },
  ]
  return (
    <>
      <h1>Volunteer training</h1>
      <Tabs tabs={['Trainings', 'Tracker', 'Sessions', 'Feedback']} value={tab} onChange={setTab} />
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
      {tab === 'Sessions' && (
        <Crud key={'s' + tick} title="Training sessions" table="training_sessions" select="*, training_attendance(count)" fields={fields}
          order={{ col: 'session_date', asc: false }} canAdd canDelete
          canEdit={r => a.isStaff || r.centre_id === a.profile?.centre_id}
          defaults={{ kind: 'Monthly', centre_id: o.myCentre, mode: 'Online' }}
          hint="Live sessions, including the monthly centre meetings. Mark who attended after each one."
          actions={r => <button className="link" onClick={() => setMark(r)}>Mark attendance</button>} />
      )}
      {tab === 'Feedback' && <FeedbackList />}
      {assign && (
        <LinkPicker title={`Assign: ${assign.name}`} table="training_assignments" parentKey="topic_id" parentId={assign.id} childKey="volunteer_id"
          canEdit options={volOpts} note="Tick the volunteers who have to do this training. Unticking removes it from their list."
          onClose={() => { setAssign(null); setTick(t => t + 1) }} />
      )}
      {mark && (
        <LinkPicker title={`Who attended: ${mark.title}`} table="training_attendance" parentKey="session_id" parentId={mark.id} childKey="volunteer_id"
          canEdit options={volOpts}
          onClose={() => { setMark(null); setTick(t => t + 1) }} />
      )}
    </>
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
  const [fb, setFb] = useState<any | null>(null)
  const load = useCallback(async () => {
    const [s, t, at, f] = await Promise.all([
      supabase.from('training_sessions').select('*').order('session_date', { ascending: false }),
      supabase.from('training_assignments').select('*, training_topics(name, description, link, is_core, sort)').eq('volunteer_id', me),
      supabase.from('training_attendance').select('session_id').eq('volunteer_id', me),
      supabase.from('training_feedback').select('session_id').eq('volunteer_id', me),
    ])
    setSessions(s.data ?? [])
    setTodo((t.data ?? []).sort((x: any, y: any) => Number(!!x.completed_on) - Number(!!y.completed_on) || (x.training_topics?.sort ?? 0) - (y.training_topics?.sort ?? 0)))
    setAttended(new Set((at.data ?? []).map((r: any) => r.session_id)))
    setGiven(new Set((f.data ?? []).map((r: any) => r.session_id)))
  }, [me])
  useEffect(() => { load() }, [load])
  return (
    <>
      <h1>My training</h1>
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
        <div className="card-head"><h2>Sessions</h2></div>
        <p className="muted hint">Your centre lead marks who attended and ticks off finished trainings. Once you are marked at a session, you can leave feedback.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Session</th><th>Kind</th><th>Attended</th><th /></tr></thead>
          <tbody>
            {sessions.length === 0 && <tr><td colSpan={5} className="muted">No training sessions yet.</td></tr>}
            {sessions.map(s => (
              <tr key={s.id}>
                <td>{fmtDate(s.session_date)}</td><td>{s.title}</td><td>{s.kind}</td>
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
