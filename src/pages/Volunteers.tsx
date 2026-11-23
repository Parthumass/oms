import { useCallback, useEffect, useState } from 'react'
import Crud from '../components/Crud'
import { Field, Modal } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly } from '../lib/util'
import { GENDERS, STATUS, useOptions } from './common'

export default function Volunteers() {
  const a = useAuth()
  const o = useOptions()
  const [logins, setLogins] = useState<Record<string, string>>({})
  const [give, setGive] = useState<any | null>(null)

  const loadLogins = useCallback(async () => {
    const [p, i] = await Promise.all([
      supabase.from('profiles').select('volunteer_id, active').eq('role', 'volunteer'),
      supabase.from('invites').select('volunteer_id').eq('role', 'volunteer'),
    ])
    const m: Record<string, string> = {}
    for (const r of i.data ?? []) if (r.volunteer_id) m[r.volunteer_id] = 'Invited'
    for (const r of p.data ?? []) if (r.volunteer_id) m[r.volunteer_id] = r.active ? 'Has login' : 'Login off'
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
    { key: '_login', label: 'Login', form: false, list: r => logins[r.id] ?? 'No login' },
  ]
  return (
    <>
      <Crud title="Volunteers" table="volunteers" fields={fields} order={{ col: 'full_name' }}
        canAdd canEdit={mine} canDelete={a.isAdmin}
        defaults={{ status: 'Active', centre_id: o.myCentre, verified: false }}
        onChanged={() => { a.reloadLookups(); loadLogins() }}
        actions={r => mine(r) && !logins[r.id] && r.status === 'Active'
          ? <button className="link" onClick={() => setGive(r)}>Give login</button> : null} />
      {give && <GiveLogin vol={give} onClose={() => { setGive(null); loadLogins() }} />}
    </>
  )
}

function GiveLogin({ vol, onClose }: { vol: any; onClose: () => void }) {
  const [email, setEmail] = useState(vol.email ?? '')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('invites').insert({
      email: email.trim().toLowerCase(), role: 'volunteer', volunteer_id: vol.id, full_name: vol.full_name,
    })
    if (error) setErr(friendly(error)); else setDone(true)
  }
  return (
    <Modal title={`Give login: ${vol.full_name}`} onClose={onClose}>
      {done ? (
        <>
          <p className="ok">{email.trim().toLowerCase()} is approved.</p>
          <p>Ask {vol.full_name} to open the portal, choose <b>Create your login</b> and sign up with this exact email. They will see only the classes assigned to them.</p>
          <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <form onSubmit={save}>
          <div className="field"><label htmlFor="gl">Volunteer's email</label>
            <input id="gl" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Approve email</button></div>
        </form>
      )}
    </Modal>
  )
}
