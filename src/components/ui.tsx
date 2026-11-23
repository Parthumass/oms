import { ReactNode, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendly, fmtDate, WEEKDAYS } from '../lib/util'

export type Opt = { value: string; label: string; sub?: string }
export type Field = {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'date' | 'number' | 'select' | 'bool' | 'weekdays' | 'email'
  options?: Opt[] | string[]
  required?: boolean
  list?: boolean | ((row: any) => ReactNode)
  form?: boolean
  locked?: boolean
  help?: string
}
export const opts = (o?: Opt[] | string[]): Opt[] =>
  (o ?? []).map(x => (typeof x === 'string' ? { value: x, label: x } : x))

export function show(f: Field, row: any): ReactNode {
  if (typeof f.list === 'function') return f.list(row)
  const v = row[f.key]
  if (v == null || v === '') return ''
  if (f.type === 'bool') return v ? 'Yes' : 'No'
  if (f.type === 'date') return fmtDate(v)
  if (f.type === 'weekdays') return (v as number[]).map(d => WEEKDAYS[d]).join(', ')
  if (f.type === 'select') return opts(f.options).find(o => o.value === v)?.label ?? String(v)
  return String(v)
}
export function plain(f: Field, row: any): string {
  const s = show(f, row)
  return typeof s === 'string' || typeof s === 'number' ? String(s) : String(row[f.key] ?? '')
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Input({ f, value, onChange }: { f: Field; value: any; onChange: (v: any) => void }) {
  const common = { id: 'f_' + f.key, disabled: f.locked, required: f.required }
  switch (f.type) {
    case 'textarea':
      return <textarea {...common} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />
    case 'select':
      return (
        <select {...common} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
          <option value="">Select…</option>
          {opts(f.options).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'bool':
      return (
        <label className="check">
          <input type="checkbox" id={common.id} disabled={f.locked} checked={!!value} onChange={e => onChange(e.target.checked)} /> Yes
        </label>
      )
    case 'weekdays': {
      const cur: number[] = value ?? []
      return (
        <div className="chips">
          {WEEKDAYS.map((w, i) => (
            <button type="button" key={w} className={'chip' + (cur.includes(i) ? ' on' : '')}
              onClick={() => onChange(cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort())}>{w}</button>
          ))}
        </div>
      )
    }
    case 'number':
      return <input {...common} type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    default:
      return <input {...common} type={f.type ?? 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)} />
  }
}

export function FormFields({ fields, values, set }: { fields: Field[]; values: any; set: (k: string, v: any) => void }) {
  return (
    <div className="form-grid">
      {fields.filter(f => f.form !== false).map(f => (
        <div key={f.key} className={'field' + (f.type === 'textarea' ? ' span' : '')}>
          <label htmlFor={'f_' + f.key}>{f.label}{f.required && <span className="req"> *</span>}</label>
          <Input f={f} value={values[f.key]} onChange={v => set(f.key, v)} />
          {f.help && <small>{f.help}</small>}
        </div>
      ))}
    </div>
  )
}

/** Tick-list for a many-to-many link table, saved as you tick. */
export function LinkPicker(p: {
  title: string; table: string; parentKey: string; parentId: string; childKey: string
  options: Opt[]; canEdit: boolean; onClose: () => void; note?: string
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from(p.table).select(p.childKey).eq(p.parentKey, p.parentId).then(({ data, error }) => {
      if (error) setErr(friendly(error))
      setPicked(new Set((data ?? []).map((r: any) => r[p.childKey])))
      setLoading(false)
    })
  }, [p.table, p.parentId, p.parentKey, p.childKey])

  const toggle = async (id: string) => {
    setErr('')
    const on = picked.has(id)
    const next = new Set(picked); on ? next.delete(id) : next.add(id); setPicked(next)
    const res = on
      ? await supabase.from(p.table).delete().eq(p.parentKey, p.parentId).eq(p.childKey, id)
      : await supabase.from(p.table).insert({ [p.parentKey]: p.parentId, [p.childKey]: id } as any)
    if (res.error) { setErr(friendly(res.error)); setPicked(picked) }
  }
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? p.options.filter(o => (o.label + ' ' + (o.sub ?? '')).toLowerCase().includes(s)) : p.options
    return [...list].sort((a, b) => Number(picked.has(b.value)) - Number(picked.has(a.value)) || a.label.localeCompare(b.label))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, p.options, loading])

  return (
    <Modal title={p.title} onClose={p.onClose}>
      {p.note && <p className="muted">{p.note}</p>}
      <div className="row">
        <input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        <span className="muted">{picked.size} selected</span>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="ticklist">
        {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">Nothing to choose from yet.</p> :
          shown.map(o => (
            <label key={o.value} className="tick">
              <input type="checkbox" disabled={!p.canEdit} checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
            </label>
          ))}
      </div>
      <div className="actions"><button className="primary" onClick={p.onClose}>Done</button></div>
    </Modal>
  )
}

export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => <button key={t} role="tab" aria-selected={t === value} className={t === value ? 'on' : ''} onClick={() => onChange(t)}>{t}</button>)}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>
}
