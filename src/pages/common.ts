import { useMemo } from 'react'
import { useAuth } from '../lib/auth'
import type { Opt } from '../components/ui'

/** Dropdown options built from the shared lookups, scoped to the signed-in role. */
export function useOptions() {
  const a = useAuth()
  return useMemo(() => {
    const centres: Opt[] = a.lookups.centres
      .filter(c => !a.isLead || c.id === a.profile?.centre_id)
      .map(c => ({ value: c.id, label: c.name }))
    const allCentres: Opt[] = a.lookups.centres.map(c => ({ value: c.id, label: c.name }))
    const programs: Opt[] = a.lookups.programs.map(p => ({ value: p.id, label: p.name }))
    const partners: Opt[] = a.lookups.partners.map(p => ({ value: p.id, label: p.name }))
    const volunteers: Opt[] = a.lookups.volunteers
      .filter(v => v.status === 'Active')
      .map(v => ({ value: v.id, label: `${v.full_name} (${v.code})` }))
    const allVolunteers: Opt[] = a.lookups.volunteers.map(v => ({ value: v.id, label: `${v.full_name} (${v.code})` }))
    return { centres, allCentres, programs, partners, volunteers, allVolunteers, myCentre: a.isLead ? a.profile?.centre_id ?? null : null }
  }, [a.lookups, a.isLead, a.profile])
}
export const GENDERS = ['Female', 'Male', 'Other']
export const STATUS = ['Active', 'Inactive']
export const MODES = ['Online', 'Offline']

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/** Classes the signed-in person may see, plus the one picked in the URL (?class=). */
export function useClasses() {
  const [classes, setClasses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    supabase.from('classes').select('*').order('name').limit(2000).then(({ data }) => { setClasses(data ?? []); setLoading(false) })
  }, [])
  const classId = params.get('class') || classes.find(c => c.active)?.id || classes[0]?.id || ''
  const cls = classes.find(c => c.id === classId) ?? null
  const setClassId = (id: string) => setParams(id ? { class: id } : {}, { replace: true })
  return { classes, classId, cls, setClassId, loading }
}
