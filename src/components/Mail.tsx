import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly, LOGIN_DOMAIN } from '../lib/util'
import { Modal } from './ui'

const TYPES: [string, string][] = [
  ['class_reminders', "Today's classes, to the volunteer taking them"],
  ['attendance_nudges', "Yesterday's classes with no attendance marked"],
  ['task_emails', 'Tasks: new, due, changes asked for, handed in'],
  ['update_emails', 'New announcements the person has not read'],
  ['training_emails', 'Trainings assigned and not done yet'],
  ['cover_emails', 'Class hand-overs: asked, accepted, approved or declined'],
  ['time_off_emails', 'Time off: noted to the person, sent to supervisors, and the reply'],
  ['agreement_emails', 'Volunteer agreement: each volunteer gets a copy of what they signed'],
  ['calendar_invites', 'Calendar invites for meetings (sent from the email script\'s Google account)'],
  ['checklist_reminders', 'Monthly checklist reminder to centre leads'],
]

/** Admin: switch email reminders on or off and see what has gone out. */
export function MailSettings() {
  const a = useAuth()
  const [s, setS] = useState<any | null>(null)
  const [stats, setStats] = useState({ waiting: 0, sentToday: 0 })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const day = new Date(); day.setHours(0, 0, 0, 0)
    const [st, w, d] = await Promise.all([
      supabase.from('mail_settings').select('*').maybeSingle(),
      supabase.from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', day.toISOString()),
    ])
    setS(st.data); setStats({ waiting: w.count ?? 0, sentToday: d.count ?? 0 })
  }, [])
  useEffect(() => { load() }, [load])
  if (!s) return <p className="card pad muted">Loading…</p>
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }))
  const save = async () => {
    setErr(''); setMsg('')
    const body: any = { enabled: s.enabled, send_hour_ist: Number(s.send_hour_ist), daily_cap: Number(s.daily_cap), portal_url: s.portal_url }
    for (const [k] of TYPES) body[k] = s[k]
    const { error } = await supabase.from('mail_settings').update(body).eq('id', true)
    if (error) setErr(friendly(error)); else { setMsg('Saved.'); load() }
  }
  return (
    <section className="card">
      <div className="card-head wrap"><h2>Email reminders</h2>{a.isAdmin && <button className="primary" onClick={save}>Save</button>}</div>
      <div className="pad">
        <p className="muted">Each person gets at most one summary email a day, plus an email when a task is given to them, sent back for changes, or handed in to them. Emails are sent by a small script running under your Gmail account; see <b>email/apps-script.gs</b> in the project for the one-time setup. Nothing goes out until this is switched on and that script is running.</p>
        <fieldset disabled={!a.isAdmin} className="plain">
          <label className="check"><input type="checkbox" checked={!!s.enabled} onChange={e => set('enabled', e.target.checked)} /> <b>Send email reminders</b></label>
          <div className="traits top-gap">
            {TYPES.map(([k, label]) => (
              <label key={k} className="check trait"><span>{label}</span><input type="checkbox" checked={!!s[k]} onChange={e => set(k, e.target.checked)} aria-label={label} /></label>
            ))}
          </div>
          <div className="form-grid top-gap">
            <div className="field"><label htmlFor="ms_hour">Send the daily summary from (hour, India time)</label><input id="ms_hour" type="number" min={0} max={23} value={s.send_hour_ist} onChange={e => set('send_hour_ist', e.target.value)} /></div>
            <div className="field"><label htmlFor="ms_cap">Most emails in one day</label><input id="ms_cap" type="number" min={1} max={2000} value={s.daily_cap} onChange={e => set('daily_cap', e.target.value)} />
              <small>A free Gmail account allows about 100 a day from a script.</small></div>
            <div className="field span"><label htmlFor="ms_url">Portal address used in emails</label><input id="ms_url" value={s.portal_url} onChange={e => set('portal_url', e.target.value)} /></div>
          </div>
        </fieldset>
        <p className="top-gap">Waiting to send: <b>{stats.waiting}</b> · Sent today: <b>{stats.sentToday}</b> · Script last checked in: <b>{s.last_run ? new Date(s.last_run).toLocaleString() : 'never'}</b></p>
        {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
      </div>
    </section>
  )
}

/** Anyone: where my reminders go, or switch them off. */
export function MyMailPrefs({ onClose }: { onClose: () => void }) {
  const a = useAuth()
  const [email, setEmail] = useState('')
  const [off, setOff] = useState(false)
  const [fallback, setFallback] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    supabase.from('profiles').select('contact_email, email_off, email, volunteer_id').eq('id', a.profile!.id).maybeSingle().then(async ({ data }) => {
      if (!data) return
      setEmail(data.contact_email ?? ''); setOff(!!data.email_off)
      let fb = data.email?.endsWith(LOGIN_DOMAIN) ? '' : data.email ?? ''
      if (data.volunteer_id) { const v = await supabase.from('volunteers').select('email').eq('id', data.volunteer_id).maybeSingle(); if (v.data?.email) fb = v.data.email }
      setFallback(fb)
    })
  }, [a.profile])
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('set_my_mail_prefs', { p_email: email, p_off: off })
    if (error) setErr(friendly(error)); else setDone(true)
  }
  return (
    <Modal title="Email reminders" onClose={onClose}>
      {done ? (<><p className="ok">Saved.</p><div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div></>) : (
        <form onSubmit={save}>
          <p className="muted">The portal can email you a short summary on days when there is something for you: classes, tasks, new announcements, trainings.</p>
          <div className="field"><label htmlFor="mp_email">Send my reminders to</label>
            <input id="mp_email" type="email" placeholder={fallback || 'your email address'} value={email} onChange={e => setEmail(e.target.value)} />
            <small>{fallback ? `Leave empty to use ${fallback}.` : 'No address on file yet, so nothing is sent until you add one.'}</small></div>
          <label className="check top-gap"><input type="checkbox" checked={off} onChange={e => setOff(e.target.checked)} /> Do not email me</label>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
        </form>
      )}
    </Modal>
  )
}
