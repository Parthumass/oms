import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Crud from '../components/Crud'
import { Field, LinkPicker } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MODES, useOptions } from './common'
import { TimeRequests } from '../components/TimeRequests'

export default function Classes() {
  const a = useAuth()
  const o = useOptions()
  const [students, setStudents] = useState<any[]>([])
  const [roster, setRoster] = useState<any | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    supabase.from('students').select('id, code, full_name, centre_id, standard').eq('status', 'Active').order('full_name').limit(5000)
      .then(({ data }) => setStudents(data ?? []))
  }, [])
  const fields: Field[] = [
    { key: 'name', label: 'Class name', required: true },
    { key: 'centre_id', label: 'Centre', type: 'select', options: a.isLead ? o.centres : o.allCentres, required: true, locked: a.isLead },
    { key: 'program_id', label: 'Program', type: 'select', options: o.programs, required: true },
    { key: 'subject', label: 'Subject' },
    { key: 'volunteer_id', label: 'Volunteer', type: 'select', options: o.allVolunteers,
      help: 'Only this volunteer can mark the class. Inactive volunteers cannot sign in.' },
    { key: 'weekdays', label: 'Class days', type: 'weekdays', locked: !(a.isLead || a.isAdmin) },
    { key: 'start_time', label: 'Start time (India time)', type: 'time', locked: !(a.isLead || a.isAdmin),
      help: 'Only the centre lead can set or change the class time. Volunteers can ask for a change from their home page.' },
    { key: 'class_type', label: 'Time of day', type: 'select', options: ['Morning', 'Afternoon', 'Evening'], list: false },
    { key: 'mode', label: 'Mode', type: 'select', options: MODES, required: true, list: false },
    { key: 'duration_min', label: 'Minutes per class', type: 'number', required: true, list: false },
    { key: 'start_date', label: 'Starts', type: 'date', required: true, list: false },
    { key: 'end_date', label: 'Ends', type: 'date', list: false },
    { key: 'active', label: 'Active', type: 'bool' },
    { key: '_n', label: 'Students', form: false, list: r => r.class_students?.[0]?.count ?? 0 },
  ]
  const [all, setAll] = useState<any[]>([])
  useEffect(() => { supabase.from('classes').select('id, name').limit(2000).then(({ data }) => setAll(data ?? [])) }, [tick])
  return (
    <>
      <h1>Classes</h1>
      <TimeRequests classes={all} onChanged={() => setTick(t => t + 1)} />
      <Crud key={tick} title="Classes" table="classes" select="*, class_students(count)" fields={fields} order={{ col: 'name' }}
        canAdd canEdit canDelete={a.isStaff}
        defaults={{ centre_id: o.myCentre, mode: 'Online', duration_min: 60, active: true, weekdays: [], start_date: new Date().toISOString().slice(0, 10) }}
        hint="A class links one volunteer to a group of students. This is what decides which students a volunteer can see."
        actions={r => (<>
          <button className="link" onClick={() => setRoster(r)}>Students</button>
          <Link className="link" to={`/attendance?class=${r.id}`}>Attendance</Link>
        </>)} />
      {roster && (
        <LinkPicker title={`Students in ${roster.name}`} table="class_students" parentKey="class_id" parentId={roster.id} childKey="student_id"
          canEdit note="Tick the students who attend this class. Changes save straight away."
          options={students.filter(s => s.centre_id === roster.centre_id).map(s => ({ value: s.id, label: s.full_name, sub: [s.code, s.standard && `Std ${s.standard}`].filter(Boolean).join(' · ') }))}
          onClose={() => { setRoster(null); setTick(t => t + 1) }} />
      )}
    </>
  )
}
