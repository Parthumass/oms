export const LOGO = import.meta.env.BASE_URL + 'logo.jpg'
export const today = () => { const d = new Date(); return iso(d) }
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const addDaysIso = (s: string, n: number) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d) }
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const fmtDate = (s?: string | null) => {
  if (!s) return ''
  const d = parseISO(s.slice(0, 10))
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
export const fmtDay = (s: string) => { const d = parseISO(s); return { day: d.getDate(), wd: WEEKDAYS[d.getDay()], mon: MONTHS[d.getMonth()] } }
export const monthLabel = (y: number, m: number) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]} ${y}`
export const monthRange = (y: number, m: number) => ({ from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) })
export const hours = (min?: number | null) => ((min ?? 0) / 60).toFixed(1)
export const by = <T,>(rows: T[], key: (r: T) => string) => Object.fromEntries(rows.map(r => [key(r), r])) as Record<string, T>
export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
export const pct = (n: number | null | undefined) => (n == null ? '–' : `${Number(n).toFixed(1)}%`)

export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\-@]/.test(s)) s = "'" + s          // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [header, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }))
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function friendly(err: any): string {
  const m: string = err?.message ?? String(err)
  if (/read-only transaction/i.test(m)) return 'You are viewing the portal as someone else, so nothing can be changed. Go back to your own view first.'
  if (/row-level security/i.test(m)) return 'You do not have permission to do that.'
  if (/duplicate key/i.test(m)) return 'That already exists.'
  if (/violates foreign key/i.test(m)) return 'This is still in use elsewhere, so it cannot be removed.'
  if (/violates check constraint/i.test(m)) return 'One of the values is not allowed. Please check the form.'
  return m
}

// ----- logins -----
// People sign in with a login name. Behind the scenes it is stored as an
// address at this domain, which receives no mail.
export const LOGIN_DOMAIN = '@portal.pratyagra.org'
export const toEmail = (login: string) => { const v = login.trim().toLowerCase(); return v.includes('@') ? v : v + LOGIN_DOMAIN }
export const loginName = (email?: string | null) => (email ?? '').endsWith(LOGIN_DOMAIN) ? (email as string).slice(0, -LOGIN_DOMAIN.length) : email ?? ''
/** A first password that is easy to read out: three groups of four, no look-alike characters. */
export function genPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = new Uint32Array(12); crypto.getRandomValues(r)
  const c = Array.from(r, n => abc[n % abc.length])
  return `${c.slice(0, 4).join('')}-${c.slice(4, 8).join('')}-${c.slice(8).join('')}`
}
