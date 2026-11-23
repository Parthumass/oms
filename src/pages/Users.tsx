import { useState } from 'react'
import Crud from '../components/Crud'
import { Field, Tabs } from '../components/ui'
import { useOptions } from './common'

const ROLES = [
  { value: 'admin', label: 'Admin' }, { value: 'board', label: 'Board' }, { value: 'centre_lead', label: 'Centre Lead' },
  { value: 'volunteer', label: 'Volunteer' }, { value: 'partner', label: 'Partner' },
]

export default function Users() {
  const o = useOptions()
  const [tab, setTab] = useState('Logins')
  const [tick, setTick] = useState(0)
  const scope: Field[] = [
    { key: 'role', label: 'Role', type: 'select', options: ROLES },
    { key: 'centre_id', label: 'Centre (centre lead)', type: 'select', options: o.allCentres },
    { key: 'volunteer_id', label: 'Volunteer record (volunteer)', type: 'select', options: o.allVolunteers },
    { key: 'partner_id', label: 'Partner (partner)', type: 'select', options: o.partners },
  ]
  return (
    <>
      <h1>Logins</h1>
      <Tabs tabs={['Logins', 'Approved emails']} value={tab} onChange={setTab} />
      {tab === 'Logins' && (
        <Crud key={tick} title="Logins" table="profiles" order={{ col: 'email' }} canEdit
          hint="Everyone who has signed up. A login with no role is waiting and can see nothing. Switch Active off to block someone."
          fields={[
            { key: 'email', label: 'Email', locked: true },
            { key: 'full_name', label: 'Name' },
            ...scope,
            { key: 'active', label: 'Active', type: 'bool' },
          ]} />
      )}
      {tab === 'Approved emails' && (
        <Crud title="Approved emails" table="invites" pk="email" order={{ col: 'email' }} canAdd canEdit canDelete addLabel="Approve an email"
          clean={v => ({ ...v, email: (v.email ?? '').trim().toLowerCase() })} onChanged={() => setTick(t => t + 1)}
          hint="Approve an email with a role here. When that person creates their login with the same email, the role is applied and the line disappears from this list."
          fields={[
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'full_name', label: 'Name' },
            ...scope.map(f => (f.key === 'role' ? { ...f, required: true } : f)),
          ]} />
      )}
    </>
  )
}
