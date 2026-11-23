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
  const [tab, setTab] = useState('Sessions')
  const [topics, setTopics] = useState<any[]>([])
  const [mark, setMark] = useState<any | null>(null)
  useEffect(() => { supabase.from('training_topics').select('*').eq('active', true).order('sort').then(({ data }) => setTopics(data ?? [])) }, [])
  const vols = a.lookups.volunteers.filter(v => v.status === 'Active' && (a.isStaff || v.centre_id === a.profile?.centre_id))
  const fields: Field[] = [
    { key: 'session_date', label: 'Date', type: 'date', required: true },
    { key: 'title', label: 'Title', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Core', 'Monthly', 'Other'], required: true },
    { key: 'topic_id', label: 'Topic', type: 'select', options: topics.map(t => ({ value: t.id, label: t.name + (t.is_core ? ' (core)' : '') })),
      help: 'Choose a core topic so attendance counts towards the required trainings.' },
    { key: 'centre_id', label: 'Centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: a.isLead, locked: a.isLead,
      help: a.isLead ? undefined : 'Leave empty for a training open to every centre.',
      list: r => o.allCentres.find(c => c.value === r.centre_id)?.label ?? 'All centres' },
    { key: 'mode', label: 'Mode', type: 'select', options: MODES, list: false },
    { key: 'duration_min', label: 'Minutes', type: 'number', list: false },
    { key: 'description', label: 'Description', type: 'textarea', list: false },
    { key: '_n', label: 'Attended', form: false, list: r => r.training_attendance?.[0]?.count ?? 0 },
  ]
  const [tick, setTick] = useState(0)
  return (
    <>
      <h1>Volunteer training</h1>
      <Tabs tabs={['Sessions', 'Core training tracker', 'Feedback']} value={tab} onChange={setTab} />
      {tab === 'Sessions' && (
        <Crud key={tick} title="Training sessions" table="training_sessions" select="*, training_attendance(count)" fields={fields}
          order={{ col: 'session_date', asc: false }} canAdd canDelete
          canEdit={r => a.isStaff || r.centre_id === a.profile?.centre_id}
          defaults={{ kind: 'Monthly', centre_id: o.myCentre, mode: 'Online' }}
          actions={r => <button className="link" onClick={() => setMark(r)}>Mark attendance</button>} />
      )}
      {tab === 'Core training tracker' && <CoreTracker topics={topics.filter(t => t.is_core)} vols={vols} />}
      {tab === 'Feedback' && <FeedbackList />}
      {mark && (
        <LinkPicker title={`Who attended: ${mark.title}`} table="training_attendance" parentKey="session_id" parentId={mark.id} childKey="volunteer_id"
          canEdit options={vols.map(v => ({ value: v.id, label: v.full_name, sub: v.code }))}
          onClose={() => { setMark(null); setTick(t => t + 1) }} />
      )}
    </>
  )
}

function CoreTracker({ topics, vols }: { topics: any[]; vols: any[] }) {
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => {
    supabase.from('training_attendance').select('volunteer_id, training_sessions(topic_id)').limit(10000).then(({ data }) => {
      setDone(new Set((data ?? []).map((r: any) => r.volunteer_id + '|' + r.training_sessions?.topic_id)))
    })
  }, [])
  const n = (v: any) => topics.filter(t => done.has(v.id + '|' + t.id)).length
  return (
    <section className="card">
      <div className="card-head"><h2>Core training tracker</h2>
        <button onClick={() => downloadCsv('core-training', ['Volunteer', 'Code', ...topics.map(t => t.name), 'Done'], vols.map(v => [v.full_name, v.code, ...topics.map(t => (done.has(v.id + '|' + t.id) ? 'Yes' : '')), `${n(v)}/${topics.length}`]))}>Export</button></div>
      <p className="muted hint">A tick appears when the volunteer is marked as attending a session on that core topic.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Volunteer</th>{topics.map(t => <th key={t.id} className="num">{t.name}</th>)}<th className="num">Done</th></tr></thead>
        <tbody>
          {vols.length === 0 && <tr><td colSpan={99} className="muted">No active volunteers.</td></tr>}
          {vols.map(v => (
            <tr key={v.id}>
              <td><b>{v.full_name}</b> <small className="muted">{v.code}</small></td>
              {topics.map(t => <td key={t.id} className="num">{done.has(v.id + '|' + t.id) ? <span className="yes" aria-label="Done">✓</span> : <span className="muted" aria-label="Not done">–</span>}</td>)}
              <td className="num"><b>{n(v)}/{topics.length}</b></td>
            </tr>
          ))}
        </tbody>
      </table></div>
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

function MyTraining() {
  const a = useAuth()
  const me = a.profile!.volunteer_id!
  const [sessions, setSessions] = useState<any[]>([])
  const [topics, setTopics] = useState<any[]>([])
  const [attended, setAttended] = useState<Set<string>>(new Set())
  const [given, setGiven] = useState<Set<string>>(new Set())
  const [fb, setFb] = useState<any | null>(null)
  const load = useCallback(async () => {
    const [s, t, at, f] = await Promise.all([
      supabase.from('training_sessions').select('*').order('session_date', { ascending: false }),
      supabase.from('training_topics').select('*').eq('active', true).eq('is_core', true).order('sort'),
      supabase.from('training_attendance').select('session_id').eq('volunteer_id', me),
      supabase.from('training_feedback').select('session_id').eq('volunteer_id', me),
    ])
    setSessions(s.data ?? []); setTopics(t.data ?? [])
    setAttended(new Set((at.data ?? []).map((r: any) => r.session_id)))
    setGiven(new Set((f.data ?? []).map((r: any) => r.session_id)))
  }, [me])
  useEffect(() => { load() }, [load])
  const coreDone = new Set(sessions.filter(s => attended.has(s.id) && s.topic_id).map(s => s.topic_id))
  return (
    <>
      <h1>Training</h1>
      <section className="card pad">
        <h2>Core trainings: {topics.filter(t => coreDone.has(t.id)).length} of {topics.length} done</h2>
        <div className="chips top-gap">{topics.map(t => <span key={t.id} className={'chip static' + (coreDone.has(t.id) ? ' on' : '')}>{coreDone.has(t.id) ? '✓ ' : ''}{t.name}</span>)}</div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Sessions</h2></div>
        <p className="muted hint">Your centre lead marks who attended. Once you are marked, you can leave feedback.</p>
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
