import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { LOGO, toEmail } from '../lib/util'

export default function Login() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(login), password })
    if (error) setErr(/invalid login credentials/i.test(error.message) ? 'Wrong login name or password.' : error.message)
    setBusy(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src={LOGO} alt="Pratyagra Education Foundation" />
          <p>Operations Portal</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <h2>Sign in</h2>
          <label htmlFor="email">Login name</label>
          <input id="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={e => setLogin(e.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          {err && <p className="error">{err}</p>}
          <button className="primary block" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
          <p className="muted auth-help">No login yet, or forgot your password? Ask your centre lead or the Pratyagra admin team. Logins are given out by them.</p>
        </form>
      </div>
    </div>
  )
}
