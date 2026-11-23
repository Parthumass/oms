// manage-login: creates portal logins and resets passwords.
//
// People do not sign up themselves. An admin, a board member or a centre lead
// creates the login here and passes the password on. Who may do what:
//   admin        any login
//   board        centre lead, volunteer and partner logins
//   centre lead  volunteer logins for volunteers whose home centre is theirs
//
// The function runs with the project's service key (provided by Supabase to
// every Edge Function), so it must check the caller itself. It does.

const BASE = Deno.env.get('SUPABASE_URL') ?? ''
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const USERNAME_DOMAIN = 'login.pratyagra.org' // for logins given as a plain username

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
const fail = (error) => reply({ ok: false, error })

const service = (path, init = {}) =>
  fetch(BASE + path, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
const uuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

function toEmail(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
  return /^[a-z0-9._-]{3,40}$/.test(s) ? `${s}@${USERNAME_DOMAIN}` : null
}

async function one(table, id, columns) {
  const r = await service(`/rest/v1/${table}?id=eq.${id}&select=${columns}`)
  if (!r.ok) return null
  return (await r.json())[0] ?? null
}

export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ ok: false, error: 'Method not allowed' }, 405)
  if (!BASE || !KEY) return fail('The server is not configured.')

  // Who is calling?
  const auth = req.headers.get('authorization') ?? ''
  const who = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: KEY, authorization: auth } })
  if (!who.ok) return reply({ ok: false, error: 'Please sign in again.' }, 401)
  const callerId = (await who.json()).id
  const me = uuid(callerId) ? await one('profiles', callerId, 'role,centre_id,active') : null
  if (!me || !me.active || !['admin', 'board', 'centre_lead'].includes(me.role)) return fail('You are not allowed to manage logins.')

  let body
  try { body = await req.json() } catch { return fail('Bad request.') }
  const password = String(body.password ?? '')
  if (password.length < 8 || password.length > 72) return fail('The password must be 8 to 72 characters.')

  // Can the caller manage a login with this role and volunteer link?
  async function allowed(role, volunteerId) {
    if (me.role === 'admin') return true
    if (me.role === 'board') return ['centre_lead', 'volunteer', 'partner'].includes(role)
    if (role !== 'volunteer' || !uuid(volunteerId)) return false
    const vol = await one('volunteers', volunteerId, 'centre_id')
    return !!vol && !!me.centre_id && vol.centre_id === me.centre_id
  }

  if (body.action === 'create') {
    const role = body.role
    if (!['admin', 'board', 'centre_lead', 'volunteer', 'partner'].includes(role)) return fail('Choose a role.')
    const email = toEmail(body.login)
    if (!email) return fail('Enter an email address, or a username of 3 to 40 letters, digits, dots or dashes.')
    const centre_id = uuid(body.centre_id) ? body.centre_id : null
    const partner_id = uuid(body.partner_id) ? body.partner_id : null
    const volunteer_id = uuid(body.volunteer_id) ? body.volunteer_id : null
    if (role === 'centre_lead' && !centre_id) return fail('Choose the centre this person leads.')
    if (role === 'partner' && !partner_id) return fail('Choose the partner.')
    if (role === 'volunteer' && !volunteer_id) return fail('Choose the volunteer record.')
    if (!(await allowed(role, volunteer_id))) return fail('You are not allowed to create this kind of login.')
    const full_name = String(body.full_name ?? '').trim().slice(0, 120) || null

    const made = await service('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } }),
    })
    if (!made.ok) {
      const t = await made.text()
      return fail(/already|registered|exists/i.test(t) ? 'A login with this email or username already exists.' : 'Could not create the login.')
    }
    const id = (await made.json()).id

    // The sign-up trigger has made the profile row; give it the role.
    const set = await service(`/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        role, full_name, active: true,
        centre_id: role === 'centre_lead' ? centre_id : null,
        partner_id: role === 'partner' ? partner_id : null,
        volunteer_id,
      }),
    })
    const rows = set.ok ? await set.json() : []
    if (!rows.length) {
      await service(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }) // undo, so no half-made login is left
      const t = set.ok ? '' : await set.text()
      return fail(/volunteer_id/.test(t) ? 'That volunteer already has a login.' : 'Could not set up the login. Nothing was created.')
    }
    return reply({ ok: true, id, login: email })
  }

  if (body.action === 'reset_password') {
    if (!uuid(body.user_id)) return fail('Bad request.')
    const target = await one('profiles', body.user_id, 'role,volunteer_id')
    if (!target) return fail('Login not found.')
    if (!(await allowed(target.role ?? 'admin', target.volunteer_id))) return fail('You are not allowed to reset this password.')
    const r = await service(`/auth/v1/admin/users/${body.user_id}`, { method: 'PUT', body: JSON.stringify({ password }) })
    return r.ok ? reply({ ok: true }) : fail('Could not reset the password.')
  }

  return fail('Unknown action.')
}

Deno.serve(handle)
