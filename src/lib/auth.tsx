import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'admin' | 'board' | 'centre_lead' | 'volunteer' | 'partner'
export type Profile = {
  id: string; email: string; code: string | null; title: string | null; full_name: string | null; role: Role | null
  centre_id: string | null; partner_id: string | null; volunteer_id: string | null; active: boolean
}
type Lookups = { centres: any[]; programs: any[]; volunteers: any[]; partners: any[] }
type Ctx = {
  session: Session | null; profile: Profile | null; loading: boolean; recovering: boolean
  lookups: Lookups; reloadLookups: () => Promise<void>; doneRecovering: () => void
  isStaff: boolean; isAdmin: boolean; isLead: boolean; isVolunteer: boolean; isPartner: boolean
  canManage: boolean
  /** An admin, board member or centre lead whose login is also linked to a volunteer record. */
  alsoVolunteer: boolean
  /** Set while a board member or admin is looking at the portal as someone else. Everything is read-only then. */
  viewAs: { realName: string; expiresAt: string } | null
}
const empty: Lookups = { centres: [], programs: [], volunteers: [], partners: [] }
const AuthCtx = createContext<Ctx>(null as any)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)
  const [lookups, setLookups] = useState<Lookups>(empty)
  const [viewAs, setViewAs] = useState<Ctx['viewAs']>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
      if (!s) { setProfile(null); setLookups(empty); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const reloadLookups = useCallback(async () => {
    const [c, p, v, pa] = await Promise.all([
      supabase.from('centres').select('*').order('name'),
      supabase.from('programs').select('*').order('name'),
      supabase.from('volunteers').select('id, code, full_name, centre_id, status').order('full_name'),
      supabase.from('partners').select('*').order('name'),
    ])
    setLookups({ centres: c.data ?? [], programs: p.data ?? [], volunteers: v.data ?? [], partners: pa.data ?? [] })
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // "view as": the database then answers as the chosen person, so load that person's profile
      const st = (await supabase.rpc('view_as_status')).data as any
      const who = st?.target ?? uid
      const { data } = await supabase.from('profiles').select('*').eq('id', who).maybeSingle()
      if (cancelled) return
      setViewAs(st?.target ? { realName: st.real_name, expiresAt: st.expires_at } : null)
      setProfile(data as Profile | null)
      if (data?.role && data.active) await reloadLookups()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [uid, reloadLookups])

  const role = profile?.active ? profile.role : null
  const value: Ctx = {
    session, profile, loading, recovering, lookups, reloadLookups,
    doneRecovering: () => setRecovering(false),
    isAdmin: role === 'admin',
    isStaff: role === 'admin' || role === 'board',
    isLead: role === 'centre_lead',
    isVolunteer: role === 'volunteer',
    isPartner: role === 'partner',
    canManage: role === 'admin' || role === 'board' || role === 'centre_lead',
    alsoVolunteer: !!role && role !== 'volunteer' && !!profile?.volunteer_id,
    viewAs,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
