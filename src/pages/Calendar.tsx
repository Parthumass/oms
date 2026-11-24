import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, iso, monthLabel, today, WEEKDAYS } from '../lib/util'
import { Modal } from '../components/ui'
import { useOptions } from './common'

type Item = { date: string; time?: string; end?: string; kind: 'class' | 'task' | 'training' | 'event' | 'leave'; title: string; sub?: string; link?: string; linkLabel?: string; centre?: string | null; mine: boolean; done?: boolean }
const KIND: Record<Item['kind'], string> = { class: 'Class', task: 'Task due', training: 'Training / meeting', event: 'Event', leave: 'Time off' }
const KINDS: Record<Item['kind'], string> = { class: 'Classes', task: 'Tasks due', training: 'Trainings / meetings', event: 'Events', leave: 'Time off' }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const startOfWeek = (d: Date) => addDays(d, -d.getDay())

/** Class times are stored in India time. Show them on the viewer's own clock. */
export function localTime(date: string, hhmm?: string | null): { date: string; time?: string } {
  if (!hhmm) return { date }
  const d = new Date(`${date}T${hhmm.slice(0, 5)}:00+05:30`)
  return { date: iso(d), time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
}
export const istLabel = (hhmm?: string | null) => (hhmm ? hhmm.slice(0, 5) + ' IST' : '')

export default function Calendar() {
  const a = useAuth()
  const o = useOptions()
  const me = a.profile!.id
  const [view, setView] = useState<'Month' | 'Week' | 'Day'>('Month')
  const [cursor, setCursor] = useState(new Date())
  const [scope, setScope] = useState<string>(a.isStaff ? 'all' : a.isLead ? 'centre' : 'mine')
  const [data, setData] = useState<any>(null)
  const [open, setOpen] = useState<Item | null>(null)
  const [kinds, setKinds] = useState<Set<string>>(new Set(['class', 'task', 'training', 'event']))
  const [away, setAway] = useState('all')   // time off: 'all', 'none' or one person's login id

  useEffect(() => {
    Promise.all([
      supabase.from('classes').select('*').eq('active', true).limit(2000),
      supabase.from('tasks').select('id, title, due_date, status, assignee, assignee_name, assigned_by, category').not('due_date', 'is', null).limit(5000),
      supabase.from('training_sessions').select('*').limit(2000),
      supabase.from('events').select('*').limit(2000),
      a.canManage ? supabase.from('profiles').select('id, centre_id, volunteer_id').limit(5000) : Promise.resolve({ data: [] as any[] }),
      supabase.from('class_teachers').select('class_id, volunteer_id').limit(5000),
      supabase.from('class_covers').select('class_id, cover_date, volunteer_id, volunteer_name').limit(5000),
      supabase.from('time_off').select('id, profile_id, person_name, person_code, centre_id, kind, start_date, end_date, noted_at').limit(5000),
    ]).then(([c, t, tr, ev, p, ct, cv, off]) => setData({ timeOff: off.data ?? [], classes: c.data ?? [], tasks: t.data ?? [], trainings: tr.data ?? [], events: ev.data ?? [], profiles: p.data ?? [], teachers: ct.data ?? [], covers: cv.data ?? [] }))
  }, [a.canManage])

  // the dates on screen
  const range = useMemo(() => {
    if (view === 'Day') return { from: cursor, days: 1 }
    if (view === 'Week') return { from: startOfWeek(cursor), days: 7 }
    return { from: startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), days: 42 }
  }, [view, cursor])
  const dates = useMemo(() => Array.from({ length: range.days }, (_, i) => iso(addDays(range.from, i))), [range])

  const items = useMemo(() => {
    if (!data) return [] as Item[]
    const out: Item[] = []
    const volCentre = Object.fromEntries(a.lookups.volunteers.map(v => [v.id, v.centre_id]))
    const loginCentre: Record<string, string | null> = Object.fromEntries(data.profiles.map((p: any) => [p.id, p.centre_id ?? volCentre[p.volunteer_id] ?? null]))
    const volName = (id: string) => a.lookups.volunteers.find(v => v.id === id)?.full_name
    const centreName = (id?: string | null) => o.allCentres.find(c => c.value === id)?.label
    // classes repeat on their weekdays; look one day either side because of time zones
    const first = iso(addDays(range.from, -1)), last = iso(addDays(range.from, range.days))
    for (const c of data.classes) {
      for (let d = addDays(range.from, -1); iso(d) <= last; d = addDays(d, 1)) {
        const ds = iso(d)
        if (ds < first || !c.weekdays?.includes(d.getDay()) || ds < c.start_date || (c.end_date && ds > c.end_date)) continue
        const lt = localTime(ds, c.start_time)
        const myVol = a.profile?.volunteer_id
        const cover = data.covers.find((k: any) => k.class_id === c.id && k.cover_date === ds)
        const teach = !!myVol && (c.volunteer_id === myVol || data.teachers.some((t: any) => t.class_id === c.id && t.volunteer_id === myVol))
        out.push({ date: lt.date, time: lt.time, kind: 'class', title: c.name, centre: c.centre_id, mine: cover ? cover.volunteer_id === myVol : teach,
          sub: [centreName(c.centre_id), cover ? `taken by ${cover.volunteer_name ?? 'another teacher'} (handed over)` : volName(c.volunteer_id), c.start_time ? istLabel(c.start_time) + ` · ${c.duration_min} min` : 'Time not set'].filter(Boolean).join(' · '),
          link: `/attendance?class=${c.id}`, linkLabel: 'Open attendance' })
      }
    }
    for (const t of data.tasks) out.push({ date: t.due_date, kind: 'task', title: t.title, done: t.status === 'Done', centre: loginCentre[t.assignee] ?? null,
      mine: t.assignee === me || t.assigned_by === me, sub: `${t.category} · for ${t.assignee_name} · ${t.status}`, link: '/tasks', linkLabel: 'Open tasks' })
    for (const t of data.trainings) { const lt = t.start_time ? localTime(t.session_date, t.start_time) : { date: t.session_date, time: undefined }; out.push({ date: lt.date, time: lt.time, kind: 'training', title: t.title, centre: t.centre_id, mine: true,
      sub: [centreName(t.centre_id) ?? 'All centres', t.kind, t.mode, istLabel(t.start_time)].filter(Boolean).join(' · '), link: '/training', linkLabel: 'Open' }) }
    for (const e of data.events) out.push({ date: e.event_date, kind: 'event', title: e.name, centre: e.centre_id, mine: true,
      sub: centreName(e.centre_id), link: '/events', linkLabel: 'Open events' })
    for (const r of data.timeOff) {
      if (away === 'none' || (away !== 'all' && r.profile_id !== away)) continue
      for (const ds of dates) if (ds >= r.start_date && ds <= r.end_date) out.push({ date: ds, kind: 'leave', title: `Away: ${r.person_name ?? 'Someone'}`, centre: r.centre_id, mine: r.profile_id === me,
        sub: [r.kind, r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} to ${fmtDate(r.end_date)}`, centreName(r.centre_id), r.noted_at ? 'noted' : 'not yet noted'].filter(Boolean).join(' · '), link: '/time-off', linkLabel: 'Open time off' })
    }
    return out
      .filter(i => i.kind === 'leave' || kinds.has(i.kind))
      .filter(i => (scope === 'mine' ? i.mine : scope === 'all' || scope === 'centre' ? true : i.centre === scope || (i.kind === 'training' && !i.centre)))
      .sort((x, y) => (x.time ? 0 : 1) - (y.time ? 0 : 1) || (x.time ?? '').localeCompare(y.time ?? '', undefined, { numeric: true }) || x.title.localeCompare(y.title))
  }, [data, range, dates, scope, kinds, away, a.lookups.volunteers, a.profile, me, o.allCentres])
  const awayPeople = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data?.timeOff ?? []) if (r.end_date >= today()) m.set(r.profile_id, r.person_name ?? 'Someone')
    return [...m].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name))
  }, [data])
  const byDate = useMemo(() => { const m: Record<string, Item[]> = {}; for (const i of items) (m[i.date] ??= []).push(i); return m }, [items])

  const step = (n: number) => setCursor(c => view === 'Month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, n * (view === 'Week' ? 7 : 1)))
  const heading = view === 'Month' ? monthLabel(cursor.getFullYear(), cursor.getMonth())
    : view === 'Day' ? cursor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${range.from.toLocaleDateString([], { day: 'numeric', month: 'short' })} to ${addDays(range.from, 6).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
  const chip = (i: Item, k: number) => (
    <button key={k} className={`cal-item ${i.kind}${i.done ? ' done' : ''}`} onClick={() => setOpen(i)} title={i.title}>
      {i.time && <b>{i.time}</b>} {i.title}
    </button>
  )

  return (
    <>
      <h1>Calendar</h1>
      <section className="card">
        <div className="card-head wrap">
          <div className="row">
            <button onClick={() => setCursor(new Date())}>Today</button>
            <div className="month"><button onClick={() => step(-1)} aria-label="Previous">‹</button><b className="cal-heading">{heading}</b><button onClick={() => step(1)} aria-label="Next">›</button></div>
          </div>
          <div className="row wrap">
            {a.isLead && (
              <div className="seg" role="group" aria-label="Whose schedule">
                <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>My schedule</button>
                <button className={scope === 'centre' ? 'on' : ''} onClick={() => setScope('centre')}>Whole centre</button>
              </div>
            )}
            {a.isStaff && (
              <select value={scope} onChange={e => setScope(e.target.value)} aria-label="Centre">
                <option value="all">All centres</option><option value="mine">My schedule</option>
                {o.allCentres.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
            <div className="seg" role="group" aria-label="View">{(['Month', 'Week', 'Day'] as const).map(v => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v}</button>)}</div>
          </div>
        </div>
        <div className="row wrap hint">
          {(Object.keys(KIND) as Item['kind'][]).filter(k => k !== 'leave').map(k => (
            <label key={k} className="check"><input type="checkbox" checked={kinds.has(k)} onChange={() => setKinds(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })} />
              <span className={`dot ${k}`} /> {KINDS[k]}</label>
          ))}
          <label className="check"><span className="dot leave" />
            <select value={away} onChange={e => setAway(e.target.value)} aria-label="Time off">
              <option value="all">Time off: everyone</option><option value="none">Time off: hide</option>
              {awayPeople.map(p => <option key={p.id} value={p.id}>Time off: {p.name}</option>)}
            </select></label>
          <span className="muted">Class times are shown in your own time zone.</span>
        </div>
        {!data ? <p className="muted pad">Loading…</p> : view === 'Month' ? (
          <div className="cal-month">
            {WEEKDAYS.map(w => <div key={w} className="cal-dow">{w}</div>)}
            {dates.map(d => { const dt = new Date(d + 'T00:00:00'); const list = byDate[d] ?? []; return (
              <div key={d} className={'cal-cell' + (dt.getMonth() !== cursor.getMonth() ? ' out' : '') + (d === today() ? ' today' : '')}>
                <button className="cal-num" onClick={() => { setCursor(dt); setView('Day') }} aria-label={`Open ${d}`}>{dt.getDate()}</button>
                {list.slice(0, 3).map(chip)}
                {list.length > 3 && <button className="cal-more" onClick={() => { setCursor(dt); setView('Day') }}>+{list.length - 3} more</button>}
              </div>
            ) })}
          </div>
        ) : (
          <div className={'cal-cols' + (view === 'Day' ? ' one' : '')}>
            {dates.map(d => { const dt = new Date(d + 'T00:00:00'); const list = byDate[d] ?? []; return (
              <div key={d} className={'cal-col' + (d === today() ? ' today' : '')}>
                <div className="cal-col-head"><small>{WEEKDAYS[dt.getDay()]}</small><b>{dt.getDate()}</b></div>
                {list.length === 0 && <p className="muted cal-empty">Nothing</p>}
                {list.map((i, k) => (
                  <button key={k} className={`cal-item big ${i.kind}${i.done ? ' done' : ''}`} onClick={() => setOpen(i)}>
                    <b>{i.time ?? KIND[i.kind]}</b><span>{i.title}</span>{view === 'Day' && i.sub && <small>{i.sub}</small>}
                  </button>
                ))}
              </div>
            ) })}
          </div>
        )}
      </section>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <p><span className={`dot ${open.kind}`} /> <b>{KIND[open.kind]}</b> · {new Date(open.date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}{open.time ? ` · ${open.time}` : ''}</p>
          {open.sub && <p className="muted">{open.sub}</p>}
          <div className="actions"><span className="grow" />{open.link && <Link className="btn primary" to={open.link}>{open.linkLabel}</Link>}<button onClick={() => setOpen(null)}>Close</button></div>
        </Modal>
      )}
    </>
  )
}
