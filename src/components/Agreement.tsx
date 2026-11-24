import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, friendly, LOGO } from '../lib/util'
import { AGREEMENT_PDF, DRAFT_BODY, DRAFT_TITLE } from '../lib/agreementDraft'
import { Modal } from './ui'

const pdfUrl = import.meta.env.BASE_URL + AGREEMENT_PDF
type Section = { heading: string; lines: string[] }

/** "## " starts a section. */
export function sections(body: string): Section[] {
  const out: Section[] = []
  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) out.push({ heading: line.slice(3).trim(), lines: [] })
    else { if (!out.length) out.push({ heading: '', lines: [] }); out[out.length - 1].lines.push(line) }
  }
  return out.filter(s => s.heading || s.lines.some(l => l.trim()))
}

/** Paragraphs, numbered lists and bullet lists from plain text. */
function Text({ lines }: { lines: string[] }) {
  const blocks: JSX.Element[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => { if (list) { const L = list; blocks.push(L.ordered ? <ol key={blocks.length}>{L.items.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul key={blocks.length}>{L.items.map((x, i) => <li key={i}>{x}</li>)}</ul>); list = null } }
  for (const raw of lines) {
    const l = raw.trim()
    const num = l.match(/^\d+\.\s+(.*)$/); const bul = l.match(/^[-•]\s+(.*)$/)
    if (num || bul) {
      const ordered = !!num
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((num ?? bul)![1])
    } else { flush(); if (l) blocks.push(<p key={blocks.length}>{l}</p>) }
  }
  flush()
  return <>{blocks}</>
}

export function AgreementText({ body }: { body: string }) {
  return <div className="agreement-text">{sections(body).map((s, i) => <section key={i}>{s.heading && <h3>{s.heading}</h3>}<Text lines={s.lines} /></section>)}</div>
}

/** Whether the signed-in volunteer still has to sign. */
export function useAgreementStatus(enabled: boolean, userId?: string) {
  const [status, setStatus] = useState<any | null>(null)
  const load = useCallback(() => {
    if (!enabled) { setStatus(null); return }
    supabase.rpc('my_agreement_status').then(({ data }) => setStatus(data ?? { needed: false }))
  }, [enabled])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [load, userId])
  return { status, reload: load }
}

/** Shown once, on sign-in, until the volunteer has signed the current agreement. */
export function AgreementGate({ status, onSigned, onSignOut }: { status: any; onSigned: () => void; onSignOut: () => void }) {
  const parts = useMemo(() => sections(status.body ?? ''), [status.body])
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const all = ticked.size === parts.length
  const sign = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!all) return setErr('Please tick every section to show you have read it.')
    setBusy(true)
    const { error } = await supabase.rpc('sign_agreement', { p_version: status.version, p_name: name })
    setBusy(false)
    if (error) return setErr(friendly(error))
    onSigned()
  }
  return (
    <div className="agreement-page">
      <div className="agreement-card">
        <div className="agreement-head"><img src={LOGO} alt="" /><div><h1>{status.title}</h1>
          <p className="muted">{status.resigning ? 'The volunteer agreement has been updated. Please read it and sign again to continue.' : 'Welcome to Pratyagra! Before you start, please read the volunteer agreement and sign it. You only need to do this once.'}</p>
          <p><a href={pdfUrl} target="_blank" rel="noreferrer noopener">Open the agreement as a PDF</a></p></div></div>
        <form onSubmit={sign}>
          {parts.map((s, i) => (
            <section key={i} className={'agreement-section' + (ticked.has(i) ? ' done' : '')}>
              {s.heading && <h3>{s.heading}</h3>}
              <div className="agreement-text"><Text lines={s.lines} /></div>
              <label className="check"><input type="checkbox" checked={ticked.has(i)} onChange={() => setTicked(t => { const n = new Set(t); n.has(i) ? n.delete(i) : n.add(i); return n })} /> I have read and understood {s.heading ? `"${s.heading}"` : 'this section'}</label>
            </section>
          ))}
          <div className="agreement-sign">
            <label htmlFor="ag_name">Type your full name to sign</label>
            <input id="ag_name" autoComplete="name" placeholder={status.name || 'Your full name'} value={name} onChange={e => setName(e.target.value)} required />
            <small className="muted">Signing records your name with today's date and time. You can see your signed copy any time under "My volunteer agreement".</small>
            {err && <p className="error">{err}</p>}
            <div className="actions"><button type="button" onClick={onSignOut}>Sign out</button><span className="grow" /><button className="primary" disabled={busy || !all || name.trim().length < 3}>{busy ? 'Signing…' : 'I agree and sign'}</button></div>
            {!all && <small className="muted">{parts.length - ticked.size} section{parts.length - ticked.size === 1 ? '' : 's'} left to tick.</small>}
          </div>
        </form>
      </div>
    </div>
  )
}

/** A signed copy: the exact version signed, with the name and date. */
export function SignedCopy({ signature, personName, onClose }: { signature: any; personName?: string; onClose: () => void }) {
  const [doc, setDoc] = useState<any | null>(null)
  useEffect(() => { supabase.from('volunteer_agreements').select('*').eq('version', signature.version).maybeSingle().then(({ data }) => setDoc(data)) }, [signature.version])
  return (
    <Modal title={personName ? `Volunteer agreement: ${personName}` : 'My volunteer agreement'} onClose={onClose} wide>
      <div className="printable">
        {!doc ? <p className="muted">Loading…</p> : (<>
          <h2>{doc.title}</h2>
          <AgreementText body={doc.body} />
          <div className="signature-box">
            <p>Signed by <b className="signed-name">{signature.signed_name}</b></p>
            <p className="muted">on {new Date(signature.signed_at).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })} · version {signature.version}, published {fmtDate(doc.published_at)}</p>
          </div>
        </>)}
      </div>
      <div className="actions no-print"><a className="btn" href={pdfUrl} target="_blank" rel="noreferrer noopener">Original PDF</a><span className="grow" /><button onClick={() => window.print()}>Print or save as PDF</button><button className="primary" onClick={onClose}>Close</button></div>
    </Modal>
  )
}

/** Sidebar link for volunteers: their own signed copy. */
export function MyAgreement({ onClose }: { onClose: () => void }) {
  const a = useAuth()
  const [sig, setSig] = useState<any | null | undefined>(undefined)
  useEffect(() => {
    supabase.from('agreement_signatures').select('*').eq('profile_id', a.profile!.id).order('version', { ascending: false }).limit(1)
      .then(({ data }) => setSig(data?.[0] ?? null))
  }, [a.profile])
  if (sig === undefined) return null
  if (!sig) return (
    <Modal title="My volunteer agreement" onClose={onClose}>
      <p>You have not signed the volunteer agreement in the portal yet. You will be asked to when it is ready.</p>
      <p><a href={pdfUrl} target="_blank" rel="noreferrer noopener">Read the agreement (PDF)</a></p>
      <div className="actions"><span className="grow" /><button className="primary" onClick={onClose}>Close</button></div>
    </Modal>
  )
  return <SignedCopy signature={sig} onClose={onClose} />
}

/** Admin team / board: publish the agreement and see who has signed. */
export function AgreementAdmin({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [latest, setLatest] = useState<any | null | undefined>(undefined)
  const [title, setTitle] = useState(DRAFT_TITLE)
  const [body, setBody] = useState(DRAFT_BODY)
  const [resign, setResign] = useState(true)
  const [preview, setPreview] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(() => {
    supabase.from('volunteer_agreements').select('*').order('version', { ascending: false }).limit(1).then(({ data }) => {
      const l = data?.[0] ?? null
      setLatest(l)
      if (l) { setTitle(l.title); setBody(l.body) }
    })
  }, [])
  useEffect(load, [load])
  const publish = async () => {
    setErr(''); setMsg('')
    const { data, error } = await supabase.rpc('publish_agreement', { p_title: title, p_body: body, p_resign: resign })
    if (error) return setErr(friendly(error))
    setMsg(`Published as version ${data}. ${!latest || resign ? 'Every volunteer will be asked to sign it the next time they sign in.' : 'Nobody is asked to sign again.'}`)
    load(); onChanged?.()
  }
  const n = sections(body).length
  return (
    <Modal title="Volunteer agreement" onClose={onClose} wide>
      {latest === undefined ? <p className="muted">Loading…</p> : (<>
        <p className="muted">{latest
          ? <>Version {latest.version} is in use, published {fmtDate(latest.published_at)}{latest.published_by_name ? ` by ${latest.published_by_name}` : ''}. Changes below are published as a new version; copies already signed never change.</>
          : <>Not published yet, so nobody is asked to sign. Below is the agreement you use today (from the PDF). Check it, then press Publish: every volunteer with a login is asked to read and sign it the next time they sign in, once.</>}</p>
        <div className="field"><label htmlFor="ag_title">Title</label><input id="ag_title" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="row top-gap"><span className="muted">Start each section with "## " and a heading. Volunteers tick each section ({n} now). Lines starting "1." or "-" become lists.</span><span className="grow" />
          <button type="button" onClick={() => setPreview(p => !p)}>{preview ? 'Edit text' : 'Preview'}</button></div>
        {preview ? <div className="agreement-preview"><AgreementText body={body} /></div>
          : <textarea className="agreement-editor" rows={22} value={body} onChange={e => setBody(e.target.value)} aria-label="Agreement text" />}
        {latest && <label className="check top-gap"><input type="checkbox" checked={resign} onChange={e => setResign(e.target.checked)} /> Ask everyone to sign this new version (untick for small corrections like a typo)</label>}
        {err && <p className="error">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <div className="actions"><a className="btn" href={pdfUrl} target="_blank" rel="noreferrer noopener">Original PDF</a><span className="grow" /><button onClick={onClose}>Close</button>
          <button className="primary" onClick={publish}>{latest ? 'Publish new version' : 'Publish'}</button></div>
      </>)}
    </Modal>
  )
}
