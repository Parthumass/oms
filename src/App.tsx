import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { configured, supabase } from './lib/supabase'
import { LOGO, loginName } from './lib/util'
import { useState } from 'react'
import Login from './pages/Login'
import { ChangeMyPassword } from './components/Logins'
import { MyMailPrefs } from './components/Mail'
import { ViewAsBanner, ViewAsPicker, stopViewAs } from './components/ViewAs'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Volunteers from './pages/Volunteers'
import Classes from './pages/Classes'
import Attendance from './pages/Attendance'
import Assessments from './pages/Assessments'
import Holistic from './pages/Holistic'

/** Holistic assessment is hidden for now. Set to true to bring the page back; nothing is deleted. */
const SHOW_HOLISTIC = false
import Training, { MyTraining } from './pages/Training'
import Events from './pages/Events'
import OtherTime from './pages/OtherTime'
import Checklist from './pages/Checklist'
import Reports from './pages/Reports'
import Setup from './pages/Setup'
import Users from './pages/Users'
import Tasks, { useMyOpenTasks } from './pages/Tasks'
import Updates, { useUnreadUpdates } from './pages/Updates'
import Calendar from './pages/Calendar'
import TimeOff, { useTimeOffToNote } from './pages/TimeOff'
import Teams from './pages/Teams'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', board: 'Board', centre_lead: 'Centre Lead', volunteer: 'Volunteer', partner: 'Partner',
}

export default function App() {
  const a = useAuth()
  const [changing, setChanging] = useState(false)
  const [mailPrefs, setMailPrefs] = useState(false)
  const [viewing, setViewing] = useState(false)
  const updates = useUnreadUpdates(!!a.profile?.role && a.profile.active && !a.isPartner, a.profile?.id)
  const toNote = useTimeOffToNote(!!a.profile?.role && a.profile.active && a.canManage, a.profile?.id)
  const openTasks = useMyOpenTasks(!!a.profile?.role && a.profile.active && !a.isPartner, a.profile?.id)
  if (!configured) return <Center><h1>Not connected</h1><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.</p></Center>
  if (a.loading) return <Center><p className="muted">Loading…</p></Center>
  if (!a.session) return <Login />
  const role = a.profile?.active ? a.profile.role : null
  if (!role) {
    return (
      <Center>
        <h1>Waiting for access</h1>
        <p>You are signed in as <b>{loginName(a.session.user.email)}</b>, but this login has no role or has been switched off.</p>
        <p className="muted">Ask your centre lead or the Pratyagra admin team.</p>
        {a.viewAs && <button className="primary" onClick={stopViewAs}>Back to my view</button>}
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </Center>
    )
  }

  const nav: [string, string, boolean][] = [
    ['/', a.isVolunteer ? 'My classes' : 'Dashboard', true],
    ['/announcements', updates.unread ? `Announcements (${updates.unread})` : 'Announcements', !a.isPartner],
    ['/calendar', 'Calendar', !a.isPartner],
    ['/students', 'Students', a.canManage],
    ['/volunteers', 'Volunteers', a.canManage],
    ['/classes', 'Classes', a.canManage],
    ['/tasks', openTasks ? `Tasks (${openTasks})` : 'Tasks', !a.isPartner],
    ['/time-off', toNote ? `Time off (${toNote})` : 'Time off', !a.isPartner],
    ['/attendance', 'Attendance', true],
    ['/assessments', 'Assessments', true],
    ['/holistic', 'Holistic assessment', SHOW_HOLISTIC && !a.isPartner],
    ['/training', 'Trainings / Meetings', !a.isPartner],
    ['/my-training', 'My trainings / meetings', a.alsoVolunteer],
    ['/events', 'Events', !a.isPartner],
    ['/other-time', 'Other volunteer time', !a.isPartner],
    ['/checklist', 'Monthly checklist', a.canManage],
    ['/reports', 'Reports', !a.isVolunteer],
    ['/setup', 'Setup', a.isAdmin],
    ['/teams', 'Teams', a.isStaff],
    ['/users', 'Logins', a.isStaff],
  ]
  const centre = a.lookups.centres.find(c => c.id === a.profile?.centre_id)
  const partner = a.lookups.partners.find(x => x.id === a.profile?.partner_id)

  return (
    <div className={'shell' + (a.viewAs ? ' viewing' : '')}>
      <ViewAsBanner />
      <aside className="side">
        <div className="brand"><img src={LOGO} alt="" /><span>Pratyagra<small>Operations Portal</small></span></div>
        <nav>
          {nav.filter(n => n[2]).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>{label}</NavLink>
          ))}
        </nav>
        <div className="who">
          <b>{a.profile?.full_name || loginName(a.profile?.email)}</b>
          <span>{a.profile?.code ? a.profile.code + ' · ' : ''}{a.profile?.title || ROLE_LABEL[role]}{a.alsoVolunteer && !a.profile?.title ? ' + Volunteer' : ''}{centre ? ` · ${centre.name}` : ''}{partner ? ` · ${partner.name}` : ''}</span>
          {a.isStaff && !a.viewAs && <button className="link" onClick={() => setViewing(true)}>View as…</button>}
          {a.viewAs && <button className="link" onClick={stopViewAs}>Back to my view</button>}
          {!a.isPartner && !a.viewAs && <button className="link" onClick={() => setMailPrefs(true)}>Email reminders</button>}
          {!a.viewAs && <button className="link" onClick={() => setChanging(true)}>Change password</button>}
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      {changing && <ChangeMyPassword onClose={() => setChanging(false)} />}
      {mailPrefs && <MyMailPrefs onClose={() => setMailPrefs(false)} />}
      {viewing && <ViewAsPicker onClose={() => setViewing(false)} />}
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {a.canManage && <Route path="/students" element={<Students />} />}
          {a.canManage && <Route path="/volunteers" element={<Volunteers />} />}
          {a.canManage && <Route path="/classes" element={<Classes />} />}
          {!a.isPartner && <Route path="/announcements" element={<Updates onSeen={updates.refresh} />} />}
          <Route path="/updates" element={<Navigate to="/announcements" replace />} />
          {!a.isPartner && <Route path="/calendar" element={<Calendar />} />}
          {!a.isPartner && <Route path="/tasks" element={<Tasks />} />}
          {!a.isPartner && <Route path="/time-off" element={<TimeOff />} />}
          {a.isStaff && <Route path="/teams" element={<Teams />} />}
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/assessments" element={<Assessments />} />
          {SHOW_HOLISTIC && !a.isPartner && <Route path="/holistic" element={<Holistic />} />}
          {!a.isPartner && <Route path="/training" element={<Training />} />}
          {a.alsoVolunteer && <Route path="/my-training" element={<MyTraining />} />}
          {!a.isPartner && <Route path="/events" element={<Events />} />}
          {!a.isPartner && <Route path="/other-time" element={<OtherTime />} />}
          {a.canManage && <Route path="/checklist" element={<Checklist />} />}
          {!a.isVolunteer && <Route path="/reports" element={<Reports />} />}
          {a.isAdmin && <Route path="/setup" element={<Setup />} />}
          {a.isStaff && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="auth-page"><div className="auth-card">{children}</div></div>
}
