import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, friendly, loginName, today } from '../lib/util'
import { Modal, Tabs } from '../components/ui'

const BUCKET = 'task-files'
const MAX_MB = 20
const CATEGORIES = ['Social media', 'Program', 'General']
const OPEN = ['To do', 'Changes needed']
const pill = (s: string) => (s === 'Done' ? 'good' : s === 'Submitted' ? 'info' : s === 'Changes needed' ? 'warn' : 'todo')
const isImage = (n?: string | null) => /\.(png|jpe?g|gif|webp)$/i.test(n ?? '')
const size = (b?: number | null) => (b == null ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const safeUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined)

export default function Tasks() {
  const a = useAuth()
  const me = a.profile!.id
  const tabs = a.isStaff ? ['My tasks', 'Given by me', 'All tasks'] : a.isLead ? ['My tasks', 'Given by me'] : ['My tasks']
  const [tab, setTab] = useState(a.canManage ? 'Given by me' : 'My tasks')
  const [rows, setRows] = useState<any[]>([])
  const [people, setPeople] = useState<any[]>([])
  const [showDone, setShowDone] = useState(false)
  const [open, setOpen] = useState<any | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tasks').select('*, task_updates(count)').order('created_at', { ascending: false }).limit(2000)
    setErr(error ? friendly(error) : ''); setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!a.canManage) return
    supabase.from('profiles').select('id, full_name, email, code, role, volunteer_id, active').limit(2000).then(({ data }) => {
      const mine = new Set(a.lookups.volunteers.filter(v => v.centre_id === a.profile?.centre_id).map(v => v.id))
      setPeople((data ?? []).filter((p: any) => p.active && p.role && p.role !== 'partner' && p.id !== me
        && (a.isStaff || (p.role === 'volunteer' && mine.has(p.volunteer_id)))))
    })
  }, [a.canManage, a.isStaff, a.lookups.volunteers, a.profile, me])

  const shown = useMemo(() => rows
    .filter(r => (tab === 'My tasks' ? r.assignee === me : tab === 'Given by me' ? r.assigned_by === me : true))
    .filter(r => showDone || r.status !== 'Done'), [rows, tab, showDone, me])
  const late = (r: any) => r.due_date && r.due_date < today() && r.status !== 'Done' && r.status !== 'Submitted'

  return (
    <>
      <h1>Tasks</h1>
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      <section className="card">
        <div className="card-head wrap">
          <h2>{tab} <span className="count">{shown.length}</span></h2>
          <div className="row">
            <label className="check"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show finished</label>
            {a.canManage && <button className="primary" onClick={() => setCreating(true)}>New task</button>}
          </div>
        </div>
        <p className="muted hint">{tab === 'My tasks'
          ? 'Work given to you. Open a task to add your notes, links or files, then hand it in.'
          : 'Give someone a piece of work: a social media post, a report, a lesson plan. They add their work here and you review it.'}</p>
        {err && <p className="error">{err}</p>}
        <div className="table-wrap"><table>
          <thead><tr><th>Task</th><th>Type</th><th>{tab === 'My tasks' ? 'From' : 'For'}</th><th>Due</th><th>Status</th><th className="num">Items</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="muted">{tab === 'My tasks' ? 'Nothing to do right now.' : 'No tasks here yet.'}</td></tr>}
            {shown.map(r => (
              <tr key={r.id}>
                <td><b>{r.title}</b></td><td>{r.category}</td>
                <td>{tab === 'My tasks' ? r.assigned_by_name : r.assignee_name}</td>
                <td>{fmtDate(r.due_date)}{late(r) && <small className="late"> overdue</small>}</td>
                <td><span className={'pill ' + pill(r.status)}>{r.status}</span></td>
                <td className="num">{r.task_updates?.[0]?.count ?? 0}</td>
                <td className="row-actions"><button className="link" onClick={() => setOpen(r)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {creating && <TaskForm people={people} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}
      {open && <TaskDetail task={open} people={people} onClose={() => { setOpen(null); load() }} />}
    </>
  )
}

function who(p: any) { return `${p.full_name || loginName(p.email)}${p.code ? ` (${p.code})` : ''}` }

function TaskForm({ task, people, onClose, onSaved }: { task?: any; people: any[]; onClose: () => void; onSaved: () => void }) {
  const a = useAuth()
  const [v, setV] = useState<any>(task ? { ...task } : { category: 'Social media', assignee: '', title: '', details: '', due_date: '' })
  const [err, setErr] = useState('')
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const p = people.find(x => x.id === v.assignee)
    const body: any = { title: v.title.trim(), details: v.details || null, category: v.category, assignee: v.assignee, due_date: v.due_date || null,
      assignee_name: p ? who(p) : v.assignee_name }
    const res = task ? await supabase.from('tasks').update(body).eq('id', task.id)
      : await supabase.from('tasks').insert({ ...body, assigned_by: a.profile!.id, assigned_by_name: a.profile!.full_name || loginName(a.profile!.email) })
    if (res.error) setErr(friendly(res.error)); else onSaved()
  }
  const options = task && !people.some(p => p.id === task.assignee) ? [{ id: task.assignee, full_name: task.assignee_name, email: '' }, ...people] : people
  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field span"><label htmlFor="tk_title">What needs doing</label><input id="tk_title" required value={v.title} onChange={e => set('title', e.target.value)} /></div>
          <div className="field"><label htmlFor="tk_who">Give it to</label>
            <select id="tk_who" required value={v.assignee} onChange={e => set('assignee', e.target.value)}>
              <option value="">Select…</option>{options.map(p => <option key={p.id} value={p.id}>{who(p)}</option>)}</select>
            <small>{a.isStaff ? 'Anyone who has a login.' : 'Volunteers of your centre who have a login.'}</small></div>
          <div className="field"><label htmlFor="tk_cat">Type</label><select id="tk_cat" value={v.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="tk_due">Due date</label><input id="tk_due" type="date" value={v.due_date ?? ''} onChange={e => set('due_date', e.target.value)} /></div>
          <div className="field span"><label htmlFor="tk_details">Details</label><textarea id="tk_details" rows={4} value={v.details ?? ''} onChange={e => set('details', e.target.value)} /></div>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">{task ? 'Save' : 'Give task'}</button></div>
      </form>
    </Modal>
  )
}

function TaskDetail({ task: initial, people, onClose }: { task: any; people: any[]; onClose: () => void }) {
  const a = useAuth()
  const me = a.profile!.id
  const myName = a.profile!.full_name || loginName(a.profile!.email)
  const [task, setTask] = useState<any>(initial)
  const [items, setItems] = useState<any[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const mine = task.assignee === me
  const manage = a.isStaff || task.assigned_by === me
  const canHandIn = mine && OPEN.includes(task.status)

  const load = useCallback(async () => {
    const [t, u] = await Promise.all([
      supabase.from('tasks').select('*').eq('id', initial.id).maybeSingle(),
      supabase.from('task_updates').select('*').eq('task_id', initial.id).order('created_at'),
    ])
    if (t.data) setTask(t.data)
    const list = u.data ?? []
    setItems(list)
    const imgs = list.filter((x: any) => x.file_path && isImage(x.file_name)).map((x: any) => x.file_path)
    if (imgs.length) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(imgs, 3600)
      setThumbs(Object.fromEntries((data ?? []).filter(d => d.signedUrl && d.path).map(d => [d.path as string, d.signedUrl as string])) as Record<string, string>)
    }
  }, [initial.id])
  useEffect(() => { load() }, [load])

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!note.trim() && !link.trim() && !files.length) return setErr('Write a note, paste a link or choose a file first.')
    if (link.trim() && !safeUrl(link.trim())) return setErr('A link must start with http:// or https://')
    const big = files.find(f => f.size > MAX_MB * 1048576)
    if (big) return setErr(`${big.name} is larger than ${MAX_MB} MB. Share it as a link instead.`)
    setBusy('Saving…')
    const base = { task_id: task.id, author: me, author_name: myName }
    if (note.trim() || link.trim()) {
      const { error } = await supabase.from('task_updates').insert({ ...base, note: note.trim() || null, link: link.trim() || null })
      if (error) { setBusy(''); return setErr(friendly(error)) }
    }
    for (const f of files) {
      setBusy(`Uploading ${f.name}…`)
      const path = `${task.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, '_').slice(-80)}`
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined })
      if (up.error) { setBusy(''); await load(); return setErr(`${f.name} could not be uploaded: ${up.error.message}`) }
      const { error } = await supabase.from('task_updates').insert({ ...base, file_path: path, file_name: f.name, file_size: f.size })
      if (error) { setBusy(''); return setErr(friendly(error)) }
    }
    setNote(''); setLink(''); setFiles([]); setBusy('')
    const input = document.getElementById('tk_files') as HTMLInputElement | null; if (input) input.value = ''
    load()
  }
  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !data) return setErr('That file could not be opened.')
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  const removeItem = async (u: any) => {
    if (!window.confirm('Remove this item?')) return
    if (u.file_path) await supabase.storage.from(BUCKET).remove([u.file_path])
    const { error } = await supabase.from('task_updates').delete().eq('id', u.id)
    if (error) setErr(friendly(error)); else load()
  }
  const handIn = async () => {
    setErr('')
    const { error } = await supabase.rpc('submit_task', { p_task: task.id })
    if (error) setErr(friendly(error)); else load()
  }
  const setStatus = async (status: string) => {
    setErr('')
    if (status === 'Changes needed' && !feedback.trim()) return setErr('Say what needs changing first.')
    const { error } = await supabase.from('tasks').update({ status, feedback: status === 'Changes needed' ? feedback.trim() : task.feedback }).eq('id', task.id)
    if (error) setErr(friendly(error)); else { setFeedback(''); load() }
  }
  const removeTask = async () => {
    if (!window.confirm('Delete this task and everything added to it? This cannot be undone.')) return
    const paths = items.filter(x => x.file_path).map(x => x.file_path)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) setErr(friendly(error)); else onClose()
  }

  if (editing) return <TaskForm task={task} people={people} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />
  return (
    <Modal title={task.title} onClose={onClose} wide>
      <p className="task-meta">
        <span className={'pill ' + pill(task.status)}>{task.status}</span>
        <span>{task.category}</span>
        <span>For <b>{task.assignee_name}</b></span>
        <span>From <b>{task.assigned_by_name}</b></span>
        {task.due_date && <span>Due <b>{fmtDate(task.due_date)}</b></span>}
      </p>
      {task.details && <p className="task-details">{task.details}</p>}
      {task.feedback && task.status === 'Changes needed' && <p className="error">Changes asked for: {task.feedback}</p>}

      <h3>Work added</h3>
      <div className="thread">
        {items.length === 0 && <p className="muted">Nothing added yet.</p>}
        {items.map(u => (
          <div key={u.id} className="item">
            <div className="item-head"><b>{u.author_name}</b><small className="muted">{new Date(u.created_at).toLocaleString()}</small>
              {(a.isStaff || u.author === me) && task.status !== 'Done' && <button className="link danger-link" onClick={() => removeItem(u)}>Remove</button>}</div>
            {u.note && <p>{u.note}</p>}
            {u.link && (safeUrl(u.link) ? <p><a href={safeUrl(u.link)} target="_blank" rel="noreferrer noopener">{u.link}</a></p> : <p>{u.link}</p>)}
            {u.file_path && (
              <div className="file">
                {thumbs[u.file_path] && <img src={thumbs[u.file_path]} alt={u.file_name} />}
                <button className="link" onClick={() => openFile(u.file_path)}>{u.file_name}</button> <small className="muted">{size(u.file_size)}</small>
              </div>
            )}
          </div>
        ))}
      </div>

      {task.status !== 'Done' && (mine || manage) && (
        <form onSubmit={add} className="add-item">
          <div className="field"><label htmlFor="tk_note">{mine ? 'Add your work' : 'Add a note'}</label>
            <textarea id="tk_note" rows={2} placeholder={mine ? 'Caption, text of the post, or a note' : 'A note for them'} value={note} onChange={e => setNote(e.target.value)} /></div>
          <div className="form-grid top-gap">
            <div className="field"><label htmlFor="tk_link">Link (Canva, Drive, Instagram…)</label><input id="tk_link" inputMode="url" placeholder="https://" value={link} onChange={e => setLink(e.target.value)} /></div>
            <div className="field"><label htmlFor="tk_files">Files (up to {MAX_MB} MB each)</label><input id="tk_files" type="file" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} /></div>
          </div>
          <div className="actions"><span className="muted">{busy}</span><span className="grow" /><button disabled={!!busy}>Add</button></div>
        </form>
      )}
      {err && <p className="error">{err}</p>}

      {manage && task.status === 'Submitted' && (
        <div className="field top-gap"><label htmlFor="tk_fb">If it needs changes, say what</label>
          <textarea id="tk_fb" rows={2} value={feedback} onChange={e => setFeedback(e.target.value)} /></div>
      )}
      <div className="actions">
        {manage && <button className="danger" onClick={removeTask}>Delete task</button>}
        {manage && task.status !== 'Done' && <button onClick={() => setEditing(true)}>Edit</button>}
        <span className="grow" />
        {manage && task.status === 'Submitted' && <button onClick={() => setStatus('Changes needed')}>Ask for changes</button>}
        {manage && task.status !== 'Done' && <button className={task.status === 'Submitted' ? 'primary' : ''} onClick={() => setStatus('Done')}>Mark done</button>}
        {manage && task.status === 'Done' && <button onClick={() => setStatus('To do')}>Reopen</button>}
        {canHandIn && <button className="primary" onClick={handIn} disabled={!items.length} title={items.length ? '' : 'Add your work first'}>Hand in</button>}
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

/** Number of tasks waiting on the signed-in person, for the menu badge. */
export function useMyOpenTasks(enabled: boolean, userId?: string) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled || !userId) return
    let stop = false
    const run = () => supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee', userId).in('status', OPEN)
      .then(({ count }) => { if (!stop) setN(count ?? 0) })
    run(); const t = setInterval(run, 120000)
    return () => { stop = true; clearInterval(t) }
  }, [enabled, userId])
  return n
}
