import { useEffect, useState } from 'react'
import Crud from '../components/Crud'
import { Field, LinkPicker } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useOptions } from './common'

const SDGS = ['No poverty', 'Zero hunger', 'Good health and well-being', 'Quality education', 'Gender equality', 'Clean water and sanitation',
  'Affordable and clean energy', 'Decent work and economic growth', 'Industry, innovation and infrastructure', 'Reduced inequalities',
  'Sustainable cities and communities', 'Responsible consumption and production', 'Climate action', 'Life below water', 'Life on land',
  'Peace, justice and strong institutions', 'Partnerships for the goals']

export default function Events() {
  const a = useAuth()
  const o = useOptions()
  const [students, setStudents] = useState<any[]>([])
  const [pick, setPick] = useState<{ ev: any; who: 'students' | 'volunteers' } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (a.canManage) supabase.from('students').select('id, code, full_name, centre_id').eq('status', 'Active').order('full_name').limit(5000).then(({ data }) => setStudents(data ?? []))
  }, [a.canManage])
  const fields: Field[] = [
    { key: 'event_date', label: 'Date', type: 'date', required: true },
    { key: 'name', label: 'Event', required: true },
    { key: 'centre_id', label: 'Centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: true, locked: a.isLead },
    { key: 'duration_min', label: 'Minutes', type: 'number' },
    { key: 'sdg', label: 'UN goal (SDG)', type: 'select', options: SDGS, list: false },
    { key: 'outcome', label: 'Impact / outcome', type: 'textarea', list: false },
    ...(a.canManage ? [
      { key: '_s', label: 'Students', form: false, list: (r: any) => r.event_students?.[0]?.count ?? 0 },
      { key: '_v', label: 'Volunteers', form: false, list: (r: any) => r.event_volunteers?.[0]?.count ?? 0 },
    ] as Field[] : []),
  ]
  return (
    <>
      <Crud key={tick} title="Events" table="events" select={a.canManage ? '*, event_students(count), event_volunteers(count)' : '*'} fields={fields}
        order={{ col: 'event_date', asc: false }} canAdd={a.canManage} canEdit={a.canManage} canDelete={a.canManage}
        defaults={{ centre_id: o.myCentre }}
        actions={a.canManage ? r => (<>
          <button className="link" onClick={() => setPick({ ev: r, who: 'students' })}>Students</button>
          <button className="link" onClick={() => setPick({ ev: r, who: 'volunteers' })}>Volunteers</button>
        </>) : undefined} />
      {pick && pick.who === 'students' && (
        <LinkPicker title={`Students at ${pick.ev.name}`} table="event_students" parentKey="event_id" parentId={pick.ev.id} childKey="student_id" canEdit
          options={students.filter(s => s.centre_id === pick.ev.centre_id).map(s => ({ value: s.id, label: s.full_name, sub: s.code }))}
          onClose={() => { setPick(null); setTick(t => t + 1) }} />
      )}
      {pick && pick.who === 'volunteers' && (
        <LinkPicker title={`Volunteers at ${pick.ev.name}`} table="event_volunteers" parentKey="event_id" parentId={pick.ev.id} childKey="volunteer_id" canEdit
          options={a.lookups.volunteers.filter(v => v.status === 'Active').map(v => ({ value: v.id, label: v.full_name, sub: v.code }))}
          onClose={() => { setPick(null); setTick(t => t + 1) }} />
      )}
    </>
  )
}
