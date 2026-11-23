import Crud from '../components/Crud'
import { useAuth } from '../lib/auth'
import { useOptions } from './common'

const TOPICS = ['Lesson planning', 'Making teaching material', 'Parent or student meeting', 'Centre support', 'Administration', 'Mentoring other volunteers', 'Other']

export default function OtherTime() {
  const a = useAuth()
  const o = useOptions()
  const me = a.profile?.volunteer_id ?? null
  const mine = a.lookups.volunteers.filter(v => a.isStaff || v.centre_id === a.profile?.centre_id).map(v => ({ value: v.id, label: `${v.full_name} (${v.code})` }))
  return (
    <Crud title="Other volunteer time" table="non_teaching_logs" select="*, volunteers(full_name, code)" order={{ col: 'log_date', asc: false }}
      canAdd canEdit canDelete defaults={{ volunteer_id: me, log_date: new Date().toISOString().slice(0, 10), duration_min: 60 }}
      hint="Time given outside teaching: planning, meetings, centre support. It counts towards total volunteer hours."
      fields={[
        { key: 'log_date', label: 'Date', type: 'date', required: true },
        { key: 'volunteer_id', label: 'Volunteer', type: 'select', required: true, locked: a.isVolunteer,
          options: a.isVolunteer ? o.allVolunteers.filter(v => v.value === me) : mine,
          list: r => r.volunteers?.full_name ?? '' },
        { key: 'topic', label: 'What', type: 'select', options: TOPICS, required: true },
        { key: 'duration_min', label: 'Minutes', type: 'number', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
      ]} />
  )
}
