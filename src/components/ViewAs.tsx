import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly } from '../lib/util'
import { Modal } from './ui'

const ROLE: Record<string, string> = { volunteer: 'Volunteer', centre_lead: 'Centre lead', partner: 'Partner' }
const home = () => window.location.assign(import.meta.env.BASE_URL)

/** Go back to your own view. */
export async function stopViewAs() {
  await supabase.rpc('view_as_stop')
  home()
}

/** The bar shown across the top while looking at the portal as someone else. */
export function ViewAsBanner() {
  const a = useAuth()
  const until = a.viewAs?.expiresAt
  useEffect(() => {
    if (!until) return
    // it switches itself off after an hour: reload then, so the screen matches
    const ms = new Date(until).getTime() - Date.now()
    const t = setTimeout(home, Math.max(1000, ms + 1000))
    return () => clearTimeout(t)
  }, [until])
  if (!a.viewAs) return null
  const p = a.profile
  return (
    <div className="viewas-bar" role="status">
      <span>Viewing as <b>{p?.full_name || 'this person'}</b>{p?.role ? ` (${p.title || ROLE[p.role] || p.role})` : ''}. This is what they see. Nothing can be changed in this view.</span>
      <button onClick={stopViewAs}>Back to my view ({a.viewAs.realName})</button>
    </div>
  )
}

/** Board and admin: choose whose view to look at. */
export function ViewAsPicker({ onClose }: { onClose: () => void }) {
  const [people, setPeople] = useState<any[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.rpc('view_as_choices').then(({ data, error }) => { if (error) setErr(friendly(error)); setPeople(data ?? []) })
  }, [])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (people ?? []).filter(p => !s || [p.full_name, p.code, ROLE[p.role], p.title, p.centre].filter(Boolean).join(' ').toLowerCase().includes(s))
  }, [people, q])
  const start = async (p: any) => {
    setErr(''); setBusy(true)
    const { error } = await supabase.rpc('view_as_start', { p_target: p.id })
    if (error) { setBusy(false); return setErr(friendly(error)) }
    home()
  }
  return (
    <Modal title="View the portal as someone else" onClose={onClose}>
      <p className="muted">See exactly what a volunteer, centre lead or partner sees: their menu, their classes, their students. You cannot change anything while viewing, and it switches off by itself after an hour.</p>
      <input placeholder="Search by name, ID, role or centre" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" />
      {err && <p className="error">{err}</p>}
      <div className="ticklist">
        {!people ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">{people.length ? 'No one matches.' : 'No volunteer, centre lead or partner has a login yet.'}</p> :
          shown.map(p => (
            <button key={p.id} type="button" className="tick pick" disabled={busy} onClick={() => start(p)}>
              <span><b>{p.full_name}</b></span><small>{[p.code, p.title || ROLE[p.role], p.centre].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
      </div>
      <p className="muted hint">Only people who have a login are listed, because the view is built from their login.</p>
      <div className="actions"><span className="grow" /><button onClick={onClose}>Cancel</button></div>
    </Modal>
  )
}
