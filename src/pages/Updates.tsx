import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly, loginName } from '../lib/util'
import { Modal } from '../components/ui'
import { useOptions } from './common'
import { useTeams } from './Teams'

const ROLE_NAMES: Record<string, string> = { admin: 'Admin team', board: 'Board', centre_lead: 'Centre leads', volunteer: 'Volunteers', partner: 'Partners' }
const safeUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined)
const who = (p: any) => `${p.full_name || loginName(p.email)}${p.code ? ` (${p.code})` : ''}`

export default function Updates({ onSeen }: { onSeen?: () => void }) {
  const a = useAuth()
  const o = useOptions()
  const me = a.profile!.id
  const [rows, setRows] = useState<any[]>([])
  const [, setRead] = useState<Set<string>>(new Set())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [posting, setPosting] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const seenCb = useRef(onSeen)
  seenCb.current = onSeen

  const load = useCallback(async () => {
    const [an, rd] = await Promise.all([
      supabase.from('announcements').select('*, announcement_reads(count), announcement_recipients(count)').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('announcement_reads').select('announcement_id').eq('profile_id', me).limit(5000),
    ])
    setErr(an.error ? friendly(an.error) : '')
    const list = an.data ?? []
    const seen = new Set((rd.data ?? []).map((r: any) => r.announcement_id))
    const unread = list.filter((r: any) => !seen.has(r.id) && r.author !== me)
    setRows(list); setRead(seen)
    // keep the New marker for as long as this page stays open
    setFresh(prev => new Set([...prev, ...unread.map((r: any) => r.id)]))
    if (unread.length) {
      await supabase.from('announcement_reads').upsert(unread.map((r: any) => ({ announcement_id: r.id, profile_id: me })), { onConflict: 'announcement_id,profile_id', ignoreDuplicates: true })
      seenCb.current?.()
    }
  }, [me])
  useEffect(() => { load() }, [load])

  const audience = (r: any) => {
    if (r.audience === 'everyone') return 'Everyone'
    if (r.audience === 'people') { const n = r.announcement_recipients?.[0]?.count; return n && (a.isStaff || r.author === me) ? `${n} selected ${n === 1 ? 'person' : 'people'}` : 'Selected people' }
    const centre = o.allCentres.find(c => c.value === r.centre_id)?.label
    return (r.roles as string[]).map(x => ROLE_NAMES[x]).join(', ') + (centre ? ` · ${centre}` : '')
  }
  const remove = async (r: any) => {
    if (!window.confirm('Delete this update for everyone? This cannot be undone.')) return
    const { error } = await supabase.from('announcements').delete().eq('id', r.id)
    if (error) setErr(friendly(error)); else load()
  }
  const manage = (r: any) => a.isStaff || r.author === me

  return (
    <>
      <div className="title-row"><h1>Updates</h1>{a.canManage && <button className="primary" onClick={() => setPosting({})}>New update</button>}</div>
      {err && <p className="error">{err}</p>}
      {rows.length === 0 && <p className="card pad muted">No updates yet.{a.canManage ? ' Post one to reach everyone, a group, a team, or selected people.' : ''}</p>}
      <div className="feed">
        {rows.map(r => (
          <article key={r.id} className={'card pad post' + (fresh.has(r.id) ? ' new' : '')}>
            <div className="post-head">
              <h2>{r.pinned && <span className="pin" title="Pinned">Pinned</span>}{r.title}</h2>
              {fresh.has(r.id) && <span className="pill info">New</span>}
            </div>
            <p className="post-body">{r.body}</p>
            {safeUrl(r.link) && <p><a href={safeUrl(r.link)} target="_blank" rel="noreferrer noopener">{r.link}</a></p>}
            <p className="post-meta muted">
              <span>{r.author_name}</span><span>{new Date(r.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span>To: {audience(r)}</span>
              {manage(r) && <span>Seen by {r.announcement_reads?.[0]?.count ?? 0}</span>}
              {manage(r) && <button className="link" onClick={() => setPosting(r)}>Edit</button>}
              {manage(r) && <button className="link danger-link" onClick={() => remove(r)}>Delete</button>}
            </p>
          </article>
        ))}
      </div>
      {posting && <PostForm post={posting} onClose={() => setPosting(null)} onSaved={() => { setPosting(null); load() }} />}
    </>
  )
}

function PostForm({ post, onClose, onSaved }: { post: any; onClose: () => void; onSaved: () => void }) {
  const a = useAuth()
  const o = useOptions()
  const me = a.profile!.id
  const isNew = !post.id
  const [v, setV] = useState<any>(isNew
    ? { title: '', body: '', link: '', pinned: false, audience: a.isStaff ? 'everyone' : 'team', roles: a.isStaff ? [] : ['volunteer'], centre_id: a.isLead ? a.profile?.centre_id : '' }
    : { ...post, link: post.link ?? '', centre_id: post.centre_id ?? '' })
  const [people, setPeople] = useState<any[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const roleChoices = a.isStaff ? ['volunteer', 'centre_lead', 'board', 'admin', 'partner'] : ['volunteer', 'centre_lead']

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email, code, role, volunteer_id, active').limit(2000).then(({ data }) => {
      const mine = new Set(a.lookups.volunteers.filter(x => x.centre_id === a.profile?.centre_id).map(x => x.id))
      setPeople((data ?? []).filter((p: any) => p.active && p.role && p.id !== me && (a.isStaff || (p.role === 'volunteer' && mine.has(p.volunteer_id))))
        .sort((x: any, y: any) => who(x).localeCompare(who(y))))
    })
    if (!isNew && post.audience === 'people') {
      supabase.from('announcement_recipients').select('profile_id').eq('announcement_id', post.id).then(({ data }) => setPicked(new Set((data ?? []).map((r: any) => r.profile_id))))
    }
  }, [a.isStaff, a.lookups.volunteers, a.profile, isNew, me, post.audience, post.id])

  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? people.filter(p => who(p).toLowerCase().includes(s)) : people }, [people, q])
  const teams = useTeams()
  // tick every member of a team who has a login
  const addTeam = async (teamId: string) => {
    if (!teamId) return
    const { data } = await supabase.rpc('team_people', { p_team: teamId })
    setPicked(s => new Set([...s, ...((data ?? []) as any[]).map(m => m.profile_id).filter((id: string) => id && id !== me)]))
  }
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (v.link.trim() && !safeUrl(v.link.trim())) return setErr('A link must start with http:// or https://')
    if (v.audience === 'team' && !v.roles.length) return setErr('Choose at least one group.')
    if (v.audience === 'people' && !picked.size) return setErr('Tick at least one person.')
    setBusy(true)
    const id = isNew ? crypto.randomUUID() : post.id
    const body: any = {
      title: v.title.trim(), body: v.body.trim(), link: v.link.trim() || null, pinned: !!v.pinned, audience: v.audience,
      roles: v.audience === 'team' ? v.roles : [], centre_id: v.audience === 'team' ? v.centre_id || null : null,
    }
    const res = isNew
      ? await supabase.from('announcements').insert({ ...body, id, author: me, author_name: a.profile!.full_name || loginName(a.profile!.email) })
      : await supabase.from('announcements').update(body).eq('id', id)
    if (res.error) { setBusy(false); return setErr(friendly(res.error)) }
    if (!isNew) await supabase.from('announcement_recipients').delete().eq('announcement_id', id)
    if (v.audience === 'people') {
      const { error } = await supabase.from('announcement_recipients').insert([...picked].map(p => ({ announcement_id: id, profile_id: p })))
      if (error) { setBusy(false); return setErr(friendly(error)) }
    }
    setBusy(false); onSaved()
  }

  return (
    <Modal title={isNew ? 'New update' : 'Edit update'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="field"><label htmlFor="up_title">Title</label><input id="up_title" required value={v.title} onChange={e => set('title', e.target.value)} /></div>
        <div className="field top-gap"><label htmlFor="up_body">Message</label><textarea id="up_body" rows={5} required value={v.body} onChange={e => set('body', e.target.value)} /></div>
        <div className="field top-gap"><label htmlFor="up_link">Link (optional)</label><input id="up_link" inputMode="url" placeholder="https://" value={v.link} onChange={e => set('link', e.target.value)} /></div>

        <h3>Who should see it</h3>
        <div className="chips" role="radiogroup" aria-label="Who should see it">
          {a.isStaff && <button type="button" className={'chip' + (v.audience === 'everyone' ? ' on' : '')} aria-pressed={v.audience === 'everyone'} onClick={() => set('audience', 'everyone')}>Everyone</button>}
          <button type="button" className={'chip' + (v.audience === 'team' ? ' on' : '')} aria-pressed={v.audience === 'team'} onClick={() => set('audience', 'team')}>A group</button>
          <button type="button" className={'chip' + (v.audience === 'people' ? ' on' : '')} aria-pressed={v.audience === 'people'} onClick={() => set('audience', 'people')}>Selected people</button>
        </div>
        {v.audience === 'everyone' && <p className="muted">Everyone with a login, except partner logins.</p>}
        {v.audience === 'team' && (
          <div className="form-grid top-gap">
            <div className="field"><label>Groups</label>
              <div className="chips">{roleChoices.map(r => (
                <button type="button" key={r} className={'chip' + (v.roles.includes(r) ? ' on' : '')} aria-pressed={v.roles.includes(r)}
                  onClick={() => set('roles', v.roles.includes(r) ? v.roles.filter((x: string) => x !== r) : [...v.roles, r])}>{ROLE_NAMES[r]}</button>
              ))}</div></div>
            <div className="field"><label htmlFor="up_centre">Centre</label>
              <select id="up_centre" disabled={a.isLead} value={v.centre_id ?? ''} onChange={e => set('centre_id', e.target.value)}>
                {!a.isLead && <option value="">All centres</option>}{(a.isLead ? o.centres : o.allCentres).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              <small>Volunteers are matched by their home centre.</small></div>
          </div>
        )}
        {v.audience === 'people' && (
          <>
            <div className="row top-gap"><input placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} />
              {teams.length > 0 && <select value="" onChange={e => addTeam(e.target.value)} aria-label="Tick a whole team"><option value="">Tick a whole team…</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
              <span className="muted">{picked.size} selected</span></div>
            <div className="ticklist">
              {shown.length === 0 && <p className="muted pad">{a.isStaff ? 'Nobody else has a login yet.' : 'None of your volunteers has a login yet.'}</p>}
              {shown.map(p => (
                <label key={p.id} className="tick"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} /><span>{who(p)}</span><small>{ROLE_NAMES[p.role]}</small></label>
              ))}
            </div>
          </>
        )}
        <label className="check top-gap"><input type="checkbox" checked={!!v.pinned} onChange={e => set('pinned', e.target.checked)} /> Keep at the top (pinned)</label>
        {err && <p className="error">{err}</p>}
        <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Posting…' : isNew ? 'Post update' : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

/** Number of updates the signed-in person has not opened yet, for the menu badge. */
export function useUnreadUpdates(enabled: boolean, userId?: string) {
  const [n, setN] = useState(0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled || !userId) return
    let stop = false
    const run = async () => {
      const [an, rd] = await Promise.all([
        supabase.from('announcements').select('id, author').limit(200),
        supabase.from('announcement_reads').select('announcement_id').eq('profile_id', userId).limit(5000),
      ])
      if (stop) return
      const seen = new Set((rd.data ?? []).map((r: any) => r.announcement_id))
      setN((an.data ?? []).filter((r: any) => r.author !== userId && !seen.has(r.id)).length)
    }
    run(); const t = setInterval(run, 120000)
    return () => { stop = true; clearInterval(t) }
  }, [enabled, userId, tick])
  return { unread: n, refresh: () => setTick(t => t + 1) }
}
