import { useEffect, useMemo, useState } from 'react'
import Crud from '../components/Crud'
import { Modal } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly } from '../lib/util'

/** Active teams the signed-in person may see: all of them for the admin team and board, otherwise the ones they are in. */
export function useTeams(tick = 0) {
  const [teams, setTeams] = useState<any[]>([])
  useEffect(() => {
    supabase.from('teams').select('id, name').eq('active', true).order('name').then(({ data }) => setTeams(data ?? []))
  }, [tick])
  return teams
}

export default function Teams() {
  const a = useAuth()
  const [members, setMembers] = useState<any | null>(null)
  const [tick, setTick] = useState(0)
  return (
    <>
      <h1>Teams</h1>
      <Crud key={tick} title="Teams" table="teams" select="*, team_members(count)" order={{ col: 'name' }}
        canAdd={a.isStaff} canEdit={a.isStaff} canDelete={a.isStaff} defaults={{ active: true }} addLabel="Add team"
        hint="A team is a named group of people, for example the English curriculum team. Use Members to choose who is in it. Team members can give each other tasks, and you can invite a whole team to a meeting or post an update to it."
        fields={[
          { key: 'name', label: 'Team name', required: true },
          { key: 'description', label: 'What the team does', type: 'textarea' },
          { key: 'active', label: 'Active', type: 'bool' },
          { key: '_n', label: 'Members', form: false, list: r => r.team_members?.[0]?.count ?? 0 },
        ]}
        actions={r => <button className="link" onClick={() => setMembers(r)}>Members</button>} />
      {members && <TeamMembers team={members} onClose={() => { setMembers(null); setTick(t => t + 1) }} />}
    </>
  )
}

type Person = { key: string; id: string; login: boolean; label: string; sub?: string }
const ROLE: Record<string, string> = { admin: 'Admin team', board: 'Board', centre_lead: 'Centre lead' }

function TeamMembers({ team, onClose }: { team: any; onClose: () => void }) {
  const a = useAuth()
  const [staff, setStaff] = useState<any[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, full_name, email, code, role, title, volunteer_id, active').limit(2000),
      supabase.from('team_members').select('volunteer_id, profile_id').eq('team_id', team.id),
    ]).then(([p, m]) => {
      setStaff((p.data ?? []).filter((x: any) => x.active && x.role && x.role !== 'partner' && !x.volunteer_id))
      setPicked(new Set((m.data ?? []).map((r: any) => (r.volunteer_id ? 'v:' + r.volunteer_id : 'p:' + r.profile_id))))
      setLoading(false)
    })
  }, [team.id])
  const centre = (id?: string | null) => a.lookups.centres.find(c => c.id === id)?.name
  const people: Person[] = useMemo(() => [
    ...staff.map(p => ({ key: 'p:' + p.id, id: p.id as string, login: true, label: p.full_name || p.email, sub: [p.code, p.title || ROLE[p.role]].filter(Boolean).join(' · ') })),
    ...a.lookups.volunteers.filter(v => v.status === 'Active').map(v => ({ key: 'v:' + v.id, id: v.id, login: false, label: v.full_name, sub: [v.code, centre(v.centre_id)].filter(Boolean).join(' · ') })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [staff, a.lookups.volunteers])
  const toggle = async (o: Person) => {
    setErr('')
    const on = picked.has(o.key)
    const next = new Set(picked); on ? next.delete(o.key) : next.add(o.key); setPicked(next)
    const col = o.login ? 'profile_id' : 'volunteer_id'
    const res = on
      ? await supabase.from('team_members').delete().eq('team_id', team.id).eq(col, o.id)
      : await supabase.from('team_members').insert({ team_id: team.id, [col]: o.id } as any)
    if (res.error) { setErr(friendly(res.error)); setPicked(picked) }
  }
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? people.filter(o => (o.label + ' ' + (o.sub ?? '')).toLowerCase().includes(s)) : people
    return [...list].sort((x, y) => Number(picked.has(y.key)) - Number(picked.has(x.key)) || x.label.localeCompare(y.label))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, people, loading])
  return (
    <Modal title={`Members of ${team.name}`} onClose={onClose}>
      <p className="muted">Tick everyone in this team. Changes save straight away. A person can be in more than one team.</p>
      <div className="row"><input placeholder="Search by name, ID, role or centre" value={q} onChange={e => setQ(e.target.value)} /><span className="muted">{picked.size} selected</span></div>
      {err && <p className="error">{err}</p>}
      <div className="ticklist">
        {loading ? <p className="muted">Loading…</p> : shown.map(o => (
          <label key={o.key} className="tick"><input type="checkbox" checked={picked.has(o.key)} onChange={() => toggle(o)} /><span>{o.label}</span><small>{o.sub}</small></label>
        ))}
      </div>
      <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  )
}
