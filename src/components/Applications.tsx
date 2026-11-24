import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, friendly } from '../lib/util'
import { useOptions } from '../pages/common'

/** Admin team / board: forms sent in through the public sign-up page. */
export function Applications({ onAdded }: { onAdded?: () => void }) {
  const a = useAuth()
  const o = useOptions()
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [centre, setCentre] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/join`
  const load = useCallback(() => {
    supabase.from('volunteer_applications').select('*').eq('status', 'New').order('created_at').limit(500).then(({ data }) => setRows(data ?? []))
  }, [])
  useEffect(load, [load])
  if (!a.isStaff) return null
  const add = async (r: any) => {
    setErr(''); setMsg('')
    const { error } = await supabase.rpc('add_volunteer_from_application', { p_id: r.id, p_centre: centre[r.id] || null })
    if (error) return setErr(friendly(error))
    setMsg(`${r.full_name} is now in the volunteer list below. Use Give login on their row when you are ready to issue their login.`)
    load(); onAdded?.()
  }
  const close = async (r: any) => {
    setErr(''); setMsg('')
    const { error } = await supabase.rpc('close_volunteer_application', { p_id: r.id, p_note: null })
    if (error) setErr(friendly(error)); else load()
  }
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ } }
  const line = (label: string, v?: string | null) => (v ? <p><span className="muted">{label}:</span> {v}</p> : null)
  return (
    <section className="card">
      <div className="card-head wrap">
        <h2>New volunteer sign-ups <span className="count">{rows.length}</span></h2>
        <div className="row"><span className="muted">Sign-up form:</span> <a href={link} target="_blank" rel="noreferrer noopener">{link}</a><button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button></div>
      </div>
      <p className="muted hint">Share the sign-up form link with people who want to volunteer. What they send appears here. Add as volunteer puts them in the volunteer list with a code; it does not give them a login. Not now closes the form.</p>
      {err && <p className="error">{err}</p>}
      {msg && <p className="ok pad">{msg}</p>}
      {rows.length === 0 ? <p className="muted pad">No new sign-ups.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Contact</th><th>Wants to help with</th><th>Sent</th><th>Home centre</th><th /></tr></thead>
          <tbody>{rows.map(r => (<Fragment key={r.id}>
            <tr>
              <td><b>{r.full_name}</b>{r.location && <small className="block muted">{r.location}</small>}</td>
              <td>{r.email}<small className="block muted">{r.phone}</small></td>
              <td>{[r.volunteer_type, r.subject_pref].filter(Boolean).join(' · ')}<small className="block muted">{r.hours_per_week}</small></td>
              <td>{fmtDate(r.created_at)}</td>
              <td><select value={centre[r.id] ?? ''} onChange={e => setCentre(c => ({ ...c, [r.id]: e.target.value }))} aria-label={`Home centre for ${r.full_name}`}>
                <option value="">Not yet</option>{o.allCentres.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></td>
              <td className="row-actions">
                <button className="link" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</button>
                <button className="link" onClick={() => add(r)}>Add as volunteer</button>
                <button className="link danger-link" onClick={() => close(r)}>Not now</button>
              </td>
            </tr>
            {open === r.id && (
              <tr className="detail-row"><td colSpan={6}>
                <div className="detail-grid">
                  {line('Date of birth', r.date_of_birth ? `${fmtDate(r.date_of_birth)} (age ${Math.floor((Date.now() - new Date(r.date_of_birth).getTime()) / 31557600000)})` : null)}{line('Gender', r.gender)}{line('Languages', r.languages)}{line('Education', r.education)}{line('Does now', r.occupation)}
                  {line('College or company', r.company)}{line('Age group', r.class_pref)}{line('Days and times', r.availability)}{line('Heard about us', r.heard_from)}
                  {line('Referred by', r.referred_by)}{line('Volunteered before', r.past_volunteering)}{line('Social media', r.social_media)}{line('Emergency contact', [r.emergency_name, r.emergency_phone].filter(Boolean).join(' · '))}
                </div>
                {line('Why', r.motivation)}
              </td></tr>
            )}
          </Fragment>))}</tbody>
        </table></div>
      )}
    </section>
  )
}
