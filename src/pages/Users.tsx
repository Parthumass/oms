import { useState } from 'react'
import Crud from '../components/Crud'
import { Field } from '../components/ui'
import { CreateLogin, ResetPassword, ROLES } from '../components/Logins'
import { useAuth } from '../lib/auth'
import { loginName } from '../lib/util'
import { useOptions } from './common'

export default function Users() {
  const a = useAuth()
  const o = useOptions()
  const [tick, setTick] = useState(0)
  const [creating, setCreating] = useState(false)
  const [reset, setReset] = useState<any | null>(null)
  const fields: Field[] = [
    { key: 'email', label: 'Login name', form: false, list: r => loginName(r.email) },
    { key: 'full_name', label: 'Name' },
    { key: 'role', label: 'Role', type: 'select', options: ROLES },
    { key: 'centre_id', label: 'Centre (centre lead)', type: 'select', options: o.allCentres },
    { key: 'volunteer_id', label: 'Volunteer record', type: 'select', options: o.allVolunteers,
      help: 'Needed for the Volunteer role. Also set it for an admin, board member or centre lead who teaches, so one login does both.' },
    { key: 'partner_id', label: 'Partner (partner)', type: 'select', options: o.partners },
    { key: 'active', label: 'Active', type: 'bool' },
  ]
  const canReset = (r: any) => r.role && (a.isAdmin || r.role !== 'admin') && r.id !== a.profile?.id
  return (
    <>
      <h1>Logins</h1>
      <Crud key={tick} title="Logins" table="profiles" order={{ col: 'email' }} canEdit={a.isAdmin} fields={fields}
        hint={'Nobody can sign themselves up. Create a login here and hand the login name and first password to the person. '
          + (a.isAdmin ? 'Switch Active off to block someone.' : 'Board members can create every kind of login except Admin.')}
        toolbar={<button className="primary" onClick={() => setCreating(true)}>Create login</button>}
        actions={r => canReset(r) ? <button className="link" onClick={() => setReset(r)}>Reset password</button> : null} />
      {creating && <CreateLogin centres={o.allCentres} volunteers={o.volunteers} partners={o.partners} onClose={() => setCreating(false)} onDone={() => setTick(t => t + 1)} />}
      {reset && <ResetPassword profile={reset} onClose={() => setReset(null)} />}
    </>
  )
}
