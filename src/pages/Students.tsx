import { useEffect, useState } from 'react'
import Crud from '../components/Crud'
import { Field, FormFields, Modal } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly } from '../lib/util'
import { GENDERS, STATUS, useOptions } from './common'

const CONTACT: Field[] = [
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'school_name', label: 'School' },
  { key: 'medium', label: 'Medium of instruction' },
  { key: 'guardian1_name', label: 'Parent / guardian 1' },
  { key: 'guardian1_phone', label: 'Phone 1' },
  { key: 'guardian2_name', label: 'Parent / guardian 2' },
  { key: 'guardian2_phone', label: 'Phone 2' },
  { key: 'consent_signed', label: 'Consent form signed', type: 'bool' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
]

export default function Students() {
  const a = useAuth()
  const o = useOptions()
  const [contact, setContact] = useState<any | null>(null)
  const fields: Field[] = [
    { key: 'code', label: 'Code', form: false },
    { key: 'full_name', label: 'Name', required: true },
    { key: 'centre_id', label: 'Centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: true, locked: a.isLead },
    { key: 'standard', label: 'Class / standard' },
    { key: 'gender', label: 'Gender', type: 'select', options: GENDERS },
    { key: 'status', label: 'Status', type: 'select', options: STATUS, required: true },
    { key: 'verified', label: 'Verified', type: 'bool' },
    { key: 'date_joined', label: 'Joined', type: 'date' },
    { key: 'inactive_date', label: 'Inactive since', type: 'date', list: false },
    { key: 'inactive_reason', label: 'Reason for leaving', list: false },
  ]
  return (
    <>
      <Crud title="Students" table="students" fields={fields} order={{ col: 'full_name' }}
        canAdd canEdit canDelete={a.isAdmin}
        defaults={{ status: 'Active', centre_id: o.myCentre, verified: false }}
        hint="Volunteers and partners see only the name, code and class of their own students. Family details stay with centre leads and the admin team."
        actions={r => <button className="link" onClick={() => setContact(r)}>Family details</button>} />
      {contact && <ContactForm student={contact} onClose={() => setContact(null)} />}
    </>
  )
}

function ContactForm({ student, onClose }: { student: any; onClose: () => void }) {
  const [v, setV] = useState<any>({ consent_signed: false })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('student_contacts').select('*').eq('student_id', student.id).maybeSingle().then(({ data }) => {
      if (data) setV(data); setLoading(false)
    })
  }, [student.id])
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: any = { student_id: student.id }
    for (const f of CONTACT) body[f.key] = v[f.key] === '' ? null : v[f.key] ?? null
    body.consent_signed = !!v.consent_signed
    const { error } = await supabase.from('student_contacts').upsert(body)
    if (error) setErr(friendly(error)); else onClose()
  }
  return (
    <Modal title={`Family details: ${student.full_name}`} onClose={onClose} wide>
      {loading ? <p className="muted">Loading…</p> : (
        <form onSubmit={save}>
          <FormFields fields={CONTACT} values={v} set={(k, x) => setV((s: any) => ({ ...s, [k]: x }))} />
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
        </form>
      )}
    </Modal>
  )
}
