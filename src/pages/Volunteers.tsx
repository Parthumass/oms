import { useCallback, useEffect, useState } from 'react'
import Crud from '../components/Crud'
import { Field } from '../components/ui'
import { CreateLogin, ResetPassword } from '../components/Logins'
import { Applications } from '../components/Applications'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { loginName } from '../lib/util'
import { GENDERS, STATUS, useOptions } from './common'

export default function Volunteers() {
  const a = useAuth()
  const o = useOptions()
  const [logins, setLogins] = useState<Record<string, any>>({})
  const [give, setGive] = useState<any | null>(null)
  const [reset, setReset] = useState<any | null>(null)
  const [tick, setTick] = useState(0)

  const loadLogins = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, email, full_name, role, volunteer_id, active').not('volunteer_id', 'is', null)
    const m: Record<string, any> = {}
    for (const r of data ?? []) m[r.volunteer_id] = r
    setLogins(m)
  }, [])
  useEffect(() => { loadLogins() }, [loadLogins])

  const mine = (r: any) => a.isStaff || r.centre_id === a.profile?.centre_id
  const fields: Field[] = [
    { key: 'code', label: 'Code', form: false },
    { key: 'full_name', label: 'Name', required: true },
    { key: 'centre_id', label: 'Home centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: a.isLead, locked: a.isLead,
      list: r => a.lookups.centres.find(c => c.id === r.centre_id)?.name ?? '' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS, required: true, help: 'Setting Inactive also switches off their login.' },
    { key: 'verified', label: 'Verified', type: 'bool', list: false },
    { key: 'date_joined', label: 'Joined', type: 'date' },
    { key: 'inactive_date', label: 'Inactive since', type: 'date', list: false },
    { key: 'gender', label: 'Gender', type: 'select', options: GENDERS, list: false },
    { key: 'volunteer_type', label: 'Volunteer type', list: false },
    { key: 'education', label: 'Education', list: false },
    { key: 'occupation', label: 'Occupation', list: false },
    { key: 'company', label: 'Company', list: false },
    { key: 'subject_pref', label: 'Subject preference', list: false },
    { key: 'class_pref', label: 'Class preference', list: false },
    { key: 'location', label: 'Location', list: false },
    { key: 'notes', label: 'Notes', type: 'textarea', list: false },
    { key: '_login', label: 'Login name', form: false, list: r => logins[r.id] ? loginName(logins[r.id].email) + (logins[r.id].active ? '' : ' (off)') : <span className="muted">No login</span> },
  ]
  return (
    <>
      <Applications onAdded={() => { setTick(t => t + 1); a.reloadLookups() }} />
      <Crud key={tick} title="Volunteers" table="volunteers" fields={fields} order={{ col: 'full_name' }}
        canAdd canEdit={mine} canDelete={a.isAdmin}
        defaults={{ status: 'Active', centre_id: o.myCentre, verified: false }}
        onChanged={() => { a.reloadLookups(); loadLogins() }}
        hint="Give login creates a login name and first password for you to pass on. People can send the sign-up form, but only you can add them here and give them a login."
        actions={r => !mine(r) ? null : !logins[r.id]
          ? (r.status === 'Active' ? <button className="link" onClick={() => setGive(r)}>Give login</button> : null)
          : (logins[r.id].role === 'volunteer' || a.isStaff) && logins[r.id].id !== a.profile?.id && (a.isAdmin || logins[r.id].role !== 'admin')
            ? <button className="link" onClick={() => setReset(logins[r.id])}>Reset password</button> : null} />
      {give && <CreateLogin preset={{ role: 'volunteer', volunteer_id: give.id, full_name: give.full_name, login: (give.code ?? '').toLowerCase() }}
        centres={o.allCentres} volunteers={o.allVolunteers} partners={o.partners} onClose={() => setGive(null)} onDone={loadLogins} />}
      {reset && <ResetPassword profile={reset} onClose={() => setReset(null)} />}
    </>
  )
}
