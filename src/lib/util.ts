export const today = () => { const d = new Date(); return iso(d) }
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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
  if (/row-level security/i.test(m)) return 'You do not have permission to do that.'
  if (/duplicate key/i.test(m)) return 'That already exists.'
  if (/violates foreign key/i.test(m)) return 'This is still in use elsewhere, so it cannot be removed.'
  if (/violates check constraint/i.test(m)) return 'One of the values is not allowed. Please check the form.'
  return m
}
