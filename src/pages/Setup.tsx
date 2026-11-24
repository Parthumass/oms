import { useCallback, useEffect, useState } from 'react'
import Crud from '../components/Crud'
import { Modal, Tabs } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { friendly } from '../lib/util'
import { useOptions } from './common'
import { MailSettings } from '../components/Mail'

export default function Setup() {
  const a = useAuth()
  const [tab, setTab] = useState('Centres')
  const [scope, setScope] = useState<any | null>(null)
  return (
    <>
      <h1>Setup</h1>
      <Tabs tabs={['Centres', 'Programs', 'Partners', 'Rooms', 'Email']} value={tab} onChange={setTab} />
      {tab === 'Centres' && (
        <Crud title="Centres" table="centres" order={{ col: 'name' }} canAdd canEdit canDelete onChanged={a.reloadLookups}
          defaults={{ active: true }} clean={v => ({ ...v, code: (v.code ?? '').toUpperCase() })}
          hint="The code starts every student and volunteer code at this centre, for example BPL0001S."
          fields={[
            { key: 'code', label: 'Code', required: true, help: '2 to 6 capital letters or digits' },
            { key: 'name', label: 'Name', required: true },
            { key: 'city', label: 'City' }, { key: 'state', label: 'State' },
            { key: 'active', label: 'Active', type: 'bool' },
          ]} />
      )}
      {tab === 'Programs' && (
        <Crud title="Programs" table="programs" order={{ col: 'name' }} canAdd canEdit canDelete onChanged={a.reloadLookups}
          defaults={{ active: true }}
          fields={[{ key: 'name', label: 'Name', required: true }, { key: 'active', label: 'Active', type: 'bool' }]} />
      )}
      {tab === 'Rooms' && (
        <Crud title="Meeting rooms" table="meeting_rooms" order={{ col: 'sort' }} canAdd canEdit canDelete defaults={{ active: true, sort: 10 }}
          hint="The fixed Zoom rooms used for meetings and trainings. Picking a room on a meeting puts its link and passcode in the calendar invite. Changing a room here updates the invites for upcoming meetings in it."
          fields={[
            { key: 'name', label: 'Room', required: true },
            { key: 'link', label: 'Zoom link', required: true },
            { key: 'passcode', label: 'Passcode' },
            { key: 'sort', label: 'Order', type: 'number', required: true, list: false },
            { key: 'active', label: 'Active', type: 'bool' },
          ]} />
      )}
      {tab === 'Partners' && (
        <Crud title="Partners" table="partners" order={{ col: 'name' }} canAdd canEdit canDelete onChanged={a.reloadLookups}
          defaults={{ active: true }}
          hint="A partner login can only read attendance and assessments for the centres or programs you list under Access."
          fields={[{ key: 'name', label: 'Name', required: true }, { key: 'active', label: 'Active', type: 'bool' }]}
          actions={r => <button className="link" onClick={() => setScope(r)}>Access</button>} />
      )}
      {tab === 'Email' && <MailSettings />}
      {scope && <Scopes partner={scope} onClose={() => setScope(null)} />}
    </>
  )
}

function Scopes({ partner, onClose }: { partner: any; onClose: () => void }) {
  const o = useOptions()
  const [rows, setRows] = useState<any[]>([])
  const [centre, setCentre] = useState('')
  const [program, setProgram] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    supabase.from('partner_scopes').select('*').eq('partner_id', partner.id).then(({ data }) => setRows(data ?? []))
  }, [partner.id])
  useEffect(load, [load])
  const add = async () => {
    setErr('')
    if (!centre && !program) return setErr('Choose a centre, a program, or both.')
    const { error } = await supabase.from('partner_scopes').insert({ partner_id: partner.id, centre_id: centre || null, program_id: program || null })
    if (error) setErr(friendly(error)); else { setCentre(''); setProgram(''); load() }
  }
  const name = (list: any[], id: string | null, all: string) => (id ? list.find(x => x.value === id)?.label ?? '?' : all)
  return (
    <Modal title={`Access: ${partner.name}`} onClose={onClose}>
      <p className="muted">Each line is something this partner may read. Centre only = everything at that centre. Program only = that program at every centre.</p>
      <table>
        <thead><tr><th>Centre</th><th>Program</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="muted">No access yet. This partner sees nothing.</td></tr>}
          {rows.map(r => (
            <tr key={r.id}>
              <td>{name(o.allCentres, r.centre_id, 'All centres')}</td>
              <td>{name(o.programs, r.program_id, 'All programs')}</td>
              <td><button className="link" onClick={async () => { await supabase.from('partner_scopes').delete().eq('id', r.id); load() }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row top-gap">
        <select value={centre} onChange={e => setCentre(e.target.value)} aria-label="Centre"><option value="">All centres</option>{o.allCentres.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        <select value={program} onChange={e => setProgram(e.target.value)} aria-label="Program"><option value="">All programs</option>{o.programs.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        <button onClick={add}>Add</button>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  )
}
