import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Crud from '../components/Crud'
import { Field, LinkPicker } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { MODES, useOptions } from './common'
import { TimeRequests } from '../components/TimeRequests'
import { CoverList, CoverModal } from '../components/Cover'
import { RequestModal, RoomSchedule, ScheduleRequests, placeLabel } from '../components/Schedule'
import { useRooms } from './Training'

export default function Classes() {
  const a = useAuth()
  const o = useOptions()
  const [students, setStudents] = useState<any[]>([])
  const [roster, setRoster] = useState<any | null>(null)
  const [teachers, setTeachers] = useState<any | null>(null)
  const [cover, setCover] = useState<any | null>(null)
  const [coverTick, setCoverTick] = useState(0)
  const [tick, setTick] = useState(0)
  const [asking, setAsking] = useState<'room' | 'extra_class' | null>(null)
  const [showRooms, setShowRooms] = useState(false)
  const rooms = useRooms()
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
      help: 'The main teacher of the class. Use Teachers in the list to add more teachers to the same class.' },
    { key: '_t', label: 'Other teachers', form: false, list: r => r.class_teachers?.[0]?.count || '' },
    { key: 'weekdays', label: 'Class days', type: 'weekdays', locked: !(a.isLead || a.isStaff) },
    { key: 'start_time', label: 'Start time (India time)', type: 'time', locked: !(a.isLead || a.isStaff),
      help: 'Only the centre lead can set or change the class time. Volunteers can ask for a change from their home page.' },
    { key: 'class_type', label: 'Time of day', type: 'select', options: ['Morning', 'Afternoon', 'Evening'], list: false },
    { key: 'room_id', label: 'Room', type: 'select', locked: !(a.isLead || a.isStaff),
      options: [...rooms.map(r => ({ value: r.id, label: r.name })), { value: 'own', label: "Volunteer's own classroom (own link)" }],
      list: r => placeLabel(r, rooms),
      help: 'A room cannot be booked twice at the same time. If it is taken, saving tells you by what. See Room schedule above for free times.' },
    { key: 'meeting_link', label: "Own classroom link (only for the volunteer's own classroom)", list: false, locked: !(a.isLead || a.isStaff) },
    { key: 'mode', label: 'Mode', type: 'select', options: MODES, required: true, list: false },
    { key: 'duration_min', label: 'Minutes per class', type: 'number', required: true, list: false },
    { key: 'start_date', label: 'Starts', type: 'date', required: true, list: false },
    { key: 'end_date', label: 'Ends', type: 'date', list: false },
    { key: 'active', label: 'Active', type: 'bool' },
    { key: '_n', label: 'Students', form: false, list: r => r.class_students?.[0]?.count ?? 0 },
  ]
  const [all, setAll] = useState<any[]>([])
  useEffect(() => { supabase.from('classes').select('id, name, active, centre_id, start_time, duration_min, room_id, own_room, meeting_link').order('name').limit(2000).then(({ data }) => setAll(data ?? [])) }, [tick])
  return (
    <>
      <h1>Classes</h1>
      <div className="row wrap page-actions">
        <button onClick={() => setAsking('room')}>Book a room</button>
        <button onClick={() => setAsking('extra_class')}>Add an extra class</button>
        <button className={showRooms ? 'on' : ''} aria-pressed={showRooms} onClick={() => setShowRooms(s => !s)}>{showRooms ? 'Hide room schedule' : 'Room schedule'}</button>
      </div>
      {showRooms && <RoomSchedule key={tick} />}
      <ScheduleRequests tick={tick} onChanged={() => setTick(t => t + 1)} />
      <TimeRequests classes={all} onChanged={() => setTick(t => t + 1)} />
      <CoverList classes={all} tick={coverTick} />
      <Crud key={tick} title="Classes" table="classes" select="*, class_students(count), class_teachers(count)" fields={fields} order={{ col: 'name' }}
        canAdd canEdit canDelete={a.isStaff}
        prepare={r => ({ ...r, room_id: r.own_room ? 'own' : r.room_id ?? '' })}
        clean={v => { const own = v.room_id === 'own'; return { ...v, room_id: own ? null : v.room_id || null, own_room: own, meeting_link: own ? v.meeting_link || null : null } }}
        defaults={{ centre_id: o.myCentre, mode: 'Online', duration_min: 60, active: true, weekdays: [], start_date: new Date().toISOString().slice(0, 10) }}
        hint="A class links its teachers to a group of students. This is what decides which students a volunteer can see. Teachers adds more teachers to a class; Hand over gives one date to someone else."
        actions={r => (<>
          <button className="link" onClick={() => setRoster(r)}>Students</button>
          <button className="link" onClick={() => setTeachers(r)}>Teachers</button>
          <button className="link" onClick={() => setCover(r)}>Hand over</button>
          <Link className="link" to={`/attendance?class=${r.id}`}>Attendance</Link>
        </>)} />
      {roster && (
        <LinkPicker title={`Students in ${roster.name}`} table="class_students" parentKey="class_id" parentId={roster.id} childKey="student_id"
          canEdit note="Tick the students who attend this class. Changes save straight away."
          options={students.filter(s => s.centre_id === roster.centre_id).map(s => ({ value: s.id, label: s.full_name, sub: [s.code, s.standard && `Std ${s.standard}`].filter(Boolean).join(' · ') }))}
          onClose={() => { setRoster(null); setTick(t => t + 1) }} />
      )}
      {teachers && (
        <LinkPicker title={`Other teachers of ${teachers.name}`} table="class_teachers" parentKey="class_id" parentId={teachers.id} childKey="volunteer_id"
          canEdit note="Tick volunteers who also teach this class. They can see its students, mark attendance and enter marks, the same as the main volunteer."
          options={a.lookups.volunteers.filter(v => v.status === 'Active' && v.id !== teachers.volunteer_id && (!v.centre_id || v.centre_id === teachers.centre_id || a.isStaff))
            .map(v => ({ value: v.id, label: v.full_name, sub: v.code }))}
          onClose={() => { setTeachers(null); setTick(t => t + 1) }} />
      )}
      {asking && <RequestModal kind={asking} classes={all.filter(c => c.active)} onClose={() => setAsking(null)} onSaved={() => setTick(t => t + 1)} />}
      {cover && <CoverModal cls={cover} onClose={() => setCover(null)} onSaved={() => setCoverTick(t => t + 1)} />}
    </>
  )
}
