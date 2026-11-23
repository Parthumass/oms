import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, Role } from '../lib/auth'
import { friendly, genPassword, loginName } from '../lib/util'
import { Modal, Opt } from './ui'

export const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' }, { value: 'board', label: 'Board' }, { value: 'centre_lead', label: 'Centre Lead' },
  { value: 'volunteer', label: 'Volunteer' }, { value: 'partner', label: 'Partner' },
]

function Handover({ login, password, onClose, isReset }: { login: string; password: string; onClose: () => void; isReset?: boolean }) {
  const [copied, setCopied] = useState(false)
  const text = `Pratyagra portal: ${window.location.origin}${import.meta.env.BASE_URL}\nLogin name: ${login}\nPassword: ${password}`
  return (
    <>
      <p className="ok">{isReset ? 'Password changed.' : 'Login created.'} Pass these details on now; the password is not shown again.</p>
      <pre className="creds">{text}</pre>
      <p className="muted">They can change the password themselves after signing in, using <b>Change password</b> at the bottom of the menu.</p>
      <div className="actions">
        <button onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) } }}>{copied ? 'Copied' : 'Copy details'}</button>
        <span className="grow" /><button className="primary" onClick={onClose}>Done</button>
      </div>
    </>
  )
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field span">
      <label htmlFor="lg_pw">First password</label>
      <div className="row"><input id="lg_pw" className="grow" required minLength={8} autoComplete="off" value={value} onChange={e => onChange(e.target.value)} />
        <button type="button" onClick={() => onChange(genPassword())}>New suggestion</button></div>
      <small>At least 8 characters. You hand this to the person; they can change it later.</small>
    </div>
  )
}

/** Create a login. `preset` fixes the role and volunteer when opened from a volunteer's row. */
export function CreateLogin(p: {
  preset?: { role: Role; volunteer_id?: string; full_name?: string; login?: string }
  centres: Opt[]; volunteers: Opt[]; partners: Opt[]; onClose: () => void; onDone: () => void
}) {
  const a = useAuth()
  const roles = ROLES.filter(r => (a.isAdmin ? true : a.profile?.role === 'board' ? r.value !== 'admin' : r.value === 'volunteer'))
  const [v, setV] = useState<any>({
    role: p.preset?.role ?? (a.isLead ? 'volunteer' : ''), volunteer_id: p.preset?.volunteer_id ?? '', full_name: p.preset?.full_name ?? '',
    login: p.preset?.login ?? '', password: genPassword(), centre_id: '', partner_id: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const { error } = await supabase.rpc('create_login', {
      p_login: v.login, p_password: v.password, p_full_name: v.full_name, p_role: v.role,
      p_centre: v.role === 'centre_lead' ? v.centre_id || null : null,
      p_volunteer: v.volunteer_id || null,
      p_partner: v.role === 'partner' ? v.partner_id || null : null,
    })
    setBusy(false)
    if (error) return setErr(friendly(error))
    setDone(true)
  }
  const finish = () => { p.onDone(); p.onClose() }
  return (
    <Modal title="Create login" onClose={done ? finish : p.onClose}>
      {done ? <Handover login={v.login.trim().toLowerCase()} password={v.password} onClose={finish} /> : (
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="field"><label htmlFor="lg_name">Full name</label><input id="lg_name" required value={v.full_name} onChange={e => set('full_name', e.target.value)} /></div>
            <div className="field"><label htmlFor="lg_login">Login name</label><input id="lg_login" required autoComplete="off" value={v.login} onChange={e => set('login', e.target.value)} />
              <small>What they type to sign in, for example asha.rao</small></div>
            <div className="field"><label htmlFor="lg_role">Role</label>
              <select id="lg_role" required disabled={!!p.preset || roles.length === 1} value={v.role} onChange={e => set('role', e.target.value)}>
                <option value="">Select…</option>{roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
            {v.role === 'centre_lead' && <div className="field"><label htmlFor="lg_centre">Centre</label>
              <select id="lg_centre" required value={v.centre_id} onChange={e => set('centre_id', e.target.value)}><option value="">Select…</option>{p.centres.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
            {v.role === 'partner' && <div className="field"><label htmlFor="lg_partner">Partner</label>
              <select id="lg_partner" required value={v.partner_id} onChange={e => set('partner_id', e.target.value)}><option value="">Select…</option>{p.partners.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
            {v.role && v.role !== 'partner' && <div className="field"><label htmlFor="lg_vol">Volunteer record{v.role === 'volunteer' ? '' : ' (if they also teach)'}</label>
              <select id="lg_vol" required={v.role === 'volunteer'} disabled={!!p.preset?.volunteer_id} value={v.volunteer_id} onChange={e => set('volunteer_id', e.target.value)}>
                <option value="">{v.role === 'volunteer' ? 'Select…' : 'None'}</option>{p.volunteers.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
            <PasswordField value={v.password} onChange={x => set('password', x)} />
          </div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={p.onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button></div>
        </form>
      )}
    </Modal>
  )
}

/** Set a new password for someone else (they forgot theirs). */
export function ResetPassword({ profile, onClose }: { profile: { id: string; email: string; full_name?: string | null }; onClose: () => void }) {
  const [pw, setPw] = useState(genPassword())
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('reset_login_password', { p_user: profile.id, p_password: pw })
    if (error) setErr(friendly(error)); else setDone(true)
  }
  return (
    <Modal title={`Reset password: ${profile.full_name || loginName(profile.email)}`} onClose={onClose}>
      {done ? <Handover isReset login={loginName(profile.email)} password={pw} onClose={onClose} /> : (
        <form onSubmit={save}>
          <p className="muted">This replaces their current password straight away.</p>
          <div className="form-grid"><PasswordField value={pw} onChange={setPw} /></div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Set new password</button></div>
        </form>
      )}
    </Modal>
  )
}

/** Change your own password. */
export function ChangeMyPassword({ onClose }: { onClose: () => void }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (a !== b) return setErr('The two passwords do not match.')
    const { error } = await supabase.auth.updateUser({ password: a })
    if (error) setErr(error.message); else setDone(true)
  }
  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (<><p className="ok">Your password has been changed.</p><div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div></>) : (
        <form onSubmit={save}>
          <div className="field"><label htmlFor="cp1">New password</label><input id="cp1" type="password" required minLength={8} autoComplete="new-password" value={a} onChange={e => setA(e.target.value)} /></div>
          <div className="field top-gap"><label htmlFor="cp2">Type it again</label><input id="cp2" type="password" required minLength={8} autoComplete="new-password" value={b} onChange={e => setB(e.target.value)} /></div>
          {err && <p className="error">{err}</p>}
          <div className="actions"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Change password</button></div>
        </form>
      )}
    </Modal>
  )
}
