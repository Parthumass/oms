import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadCsv, friendly } from '../lib/util'
import { Field, FormFields, Modal, plain, show } from './ui'

type Props = {
  title: string
  table: string
  select?: string
  fields: Field[]
  order?: { col: string; asc?: boolean }
  canAdd?: boolean
  canEdit?: boolean | ((row: any) => boolean)
  canDelete?: boolean
  defaults?: Record<string, any>
  filter?: (q: any) => any
  filterKey?: string
  actions?: (row: any, reload: () => void) => ReactNode
  toolbar?: ReactNode
  hint?: string
  addLabel?: string
  pk?: string
  onChanged?: () => void
  clean?: (values: any) => any
  /** Turn a saved row into form values (the opposite of clean). */
  prepare?: (row: any) => any
}

export default function Crud(p: Props) {
  const pk = p.pk ?? 'id'
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [formErr, setFormErr] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let query: any = supabase.from(p.table).select(p.select ?? '*')
    if (p.filter) query = p.filter(query)
    if (p.order) query = query.order(p.order.col, { ascending: p.order.asc ?? true })
    const { data, error } = await query.limit(2000)
    setErr(error ? friendly(error) : '')
    setRows(data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.table, p.select, p.filterKey])
  useEffect(() => { load() }, [load])

  const listFields = p.fields.filter(f => f.list !== false)
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r => listFields.some(f => plain(f, r).toLowerCase().includes(s)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q])

  const editable = (r: any) => (typeof p.canEdit === 'function' ? p.canEdit(r) : !!p.canEdit)
  const isNew = editing && editing[pk] == null

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setFormErr('')
    const body: any = {}
    for (const f of p.fields) if (f.form !== false) body[f.key] = editing[f.key] === '' ? null : editing[f.key]
    const values = p.clean ? p.clean(body) : body
    const res = isNew
      ? await supabase.from(p.table).insert(values)
      : await supabase.from(p.table).update(values).eq(pk, editing[pk])
    setSaving(false)
    if (res.error) return setFormErr(friendly(res.error))
    setEditing(null); load(); p.onChanged?.()
  }
  const remove = async (row?: any) => {
    const target = row ?? editing
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    const { error } = await supabase.from(p.table).delete().eq(pk, target[pk])
    if (error) return row ? setErr(friendly(error)) : setFormErr(friendly(error))
    setEditing(null); load(); p.onChanged?.()
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{p.title} <span className="count">{shown.length}</span></h2>
        <div className="row">
          {p.toolbar}
          <input className="search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label={'Search ' + p.title} />
          <button onClick={() => downloadCsv(p.title.toLowerCase().replace(/\W+/g, '-'), listFields.map(f => f.label), shown.map(r => listFields.map(f => plain(f, r))))}>Export</button>
          {p.canAdd && <button className="primary" onClick={() => { setFormErr(''); setEditing({ ...(p.defaults ?? {}) }) }}>{p.addLabel ?? 'Add'}</button>}
        </div>
      </div>
      {p.hint && <p className="muted hint">{p.hint}</p>}
      {err && <p className="error">{err}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr>{listFields.map(f => <th key={f.key}>{f.label}</th>)}{(p.actions || p.canEdit) && <th />}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={99} className="muted">Loading…</td></tr> :
              shown.length === 0 ? <tr><td colSpan={99} className="muted">Nothing here yet.</td></tr> :
                shown.map(r => (
                  <tr key={r[pk]}>
                    {listFields.map(f => <td key={f.key}>{show(f, r)}</td>)}
                    {(p.actions || p.canEdit) && (
                      <td className="row-actions">
                        {p.actions?.(r, load)}
                        {editable(r) && <button className="link" onClick={() => { setFormErr(''); setEditing(p.prepare ? p.prepare({ ...r }) : { ...r }) }}>Edit</button>}
                        {editable(r) && p.canDelete && <button className="link danger-link" onClick={() => remove(r)}>Delete</button>}
                      </td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={(isNew ? 'Add: ' : 'Edit: ') + p.title} onClose={() => setEditing(null)} wide>
          <form onSubmit={save}>
            <FormFields fields={p.fields} values={editing} set={(k, v) => setEditing((e: any) => ({ ...e, [k]: v }))} />
            {formErr && <p className="error">{formErr}</p>}
            <div className="actions">
              {!isNew && p.canDelete && <button type="button" className="danger" onClick={() => remove()}>Delete</button>}
              <span className="grow" />
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
