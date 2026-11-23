import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LOGO } from '../lib/util'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src={LOGO} alt="Pratyagra Education Foundation" />
          <p>Operations Portal</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg(''); setBusy(true)
    const redirect = window.location.origin + import.meta.env.BASE_URL
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
    } else if (mode === 'up') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirect } })
      if (error) setErr(error.message)
      else if (!data.session) { setMsg('Check your email for a confirmation link, then come back and sign in.'); setMode('in') }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect })
      if (error) setErr(error.message)
      else setMsg('If that email has an account, a reset link is on its way.')
    }
    setBusy(false)
  }

  return (
    <Frame>
      <form onSubmit={submit} className="auth-form">
        <h2>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your login' : 'Reset password'}</h2>
        {mode === 'up' && <p className="muted">Use the email your centre lead or the admin team registered for you.</p>}
        {mode === 'up' && (<><label htmlFor="name">Full name</label><input id="name" value={name} onChange={e => setName(e.target.value)} required /></>)}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
        {mode !== 'forgot' && (<>
          <label htmlFor="password">Password</label>
          <input id="password" type="password" minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required />
        </>)}
        {err && <p className="error">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button className="primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create login' : 'Send reset link'}</button>
        <div className="auth-links">
          {mode !== 'in' && <button type="button" className="link" onClick={() => setMode('in')}>Back to sign in</button>}
          {mode === 'in' && <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>}
          {mode === 'in' && <button type="button" className="link" onClick={() => setMode('up')}>First time here? Create your login</button>}
        </div>
      </form>
    </Frame>
  )
}

export function NewPassword() {
  const { doneRecovering } = useAuth()
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setErr(error.message); else doneRecovering()
  }
  return (
    <Frame>
      <form onSubmit={save} className="auth-form">
        <h2>Choose a new password</h2>
        <label htmlFor="np">New password</label>
        <input id="np" type="password" minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <p className="error">{err}</p>}
        <button className="primary block">Save password</button>
      </form>
    </Frame>
  )
}
