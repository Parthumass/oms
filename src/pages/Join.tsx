import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { LOGO } from '../lib/util'
import { AGREEMENT_PDF } from '../lib/agreementDraft'

const HELP = ['Teaching volunteer', 'Spoken English volunteer', 'Maths volunteer', 'Digital / computer skills volunteer', 'Life skills facilitator', 'Mentor', 'Curriculum volunteer (lesson plans and materials)', 'Substitute volunteer', 'Special educator', 'Extra-curricular (art, music, sport)', 'Social media and content', 'Operations and admin', 'Fundraising and partnerships', 'Anything that is needed']
const OCCUPATIONS = ['Student', 'Self Employed / Business', 'Homemaker', 'Retired', 'Teacher / Educator', 'Corporate job', 'Professional', 'Other']
const PAST = ['No, this is my first time', 'Yes, with Pratyagra before', 'Yes, with another organisation']
const SUBJECTS = ['English', 'Maths', 'Science', 'Computers / digital skills', 'Social studies', 'Hindi', 'Art, music or sport', 'Life skills', 'Any']
const CLASSES = ['Classes 1 to 5', 'Classes 6 to 8', 'Classes 9 to 10', 'Classes 11 to 12', 'Any']
const HOURS = ['1 to 2 hours', '3 to 5 hours', '6 to 10 hours', 'More than 10 hours']
const HEARD = ['A friend or family member', 'Instagram', 'LinkedIn', 'WhatsApp', 'My college or company', 'Pratyagra website', 'Other']

/** The public volunteer sign-up form, at /join. No login needed. */
export default function Join() {
  const [v, setV] = useState<Record<string, any>>({ consent: false, website: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const set = (k: string, x: any) => setV(s => ({ ...s, [k]: x }))
  const text = (k: string, label: string, o: { required?: boolean; type?: string; auto?: string; placeholder?: string } = {}) => (
    <div className="field"><label htmlFor={'j_' + k}>{label}{o.required && <span className="req"> *</span>}</label>
      <input id={'j_' + k} type={o.type ?? 'text'} required={o.required} autoComplete={o.auto} placeholder={o.placeholder} maxLength={200} value={v[k] ?? ''} onChange={e => set(k, e.target.value)} /></div>
  )
  const pick = (k: string, label: string, options: string[], required = false) => (
    <div className="field"><label htmlFor={'j_' + k}>{label}{required && <span className="req"> *</span>}</label>
      <select id={'j_' + k} required={required} value={v[k] ?? ''} onChange={e => set(k, e.target.value)}><option value="">Choose…</option>{options.map(x => <option key={x}>{x}</option>)}</select></div>
  )
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!v.consent) return setErr('Please tick the box to agree before sending.')
    setBusy(true)
    const { error } = await supabase.rpc('submit_volunteer_application', { p: v })
    setBusy(false)
    if (error) return setErr(error.message)
    setSent(true); window.scrollTo(0, 0)
  }
  return (
    <div className="auth-page join-page">
      <div className="auth-card join-card">
        <div className="auth-logo"><img src={LOGO} alt="Pratyagra Education Foundation" /><p>Volunteer with us</p></div>
        {sent ? (
          <div className="join-done">
            <h2>Thank you, {String(v.full_name ?? '').split(' ')[0] || 'friend'}!</h2>
            <p>We have your details. Someone from the Pratyagra team will contact you on your email or phone soon to talk about how you would like to help.</p>
            <p className="muted">If you do not hear from us within a week, please write to us through pratyagra.org.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="muted">Pratyagra Education Foundation runs free classes for children in children's homes and communities across India, taught online by volunteers. Tell us a little about yourself and we will be in touch. Fields marked * are needed.</p>
            <h3>About you</h3>
            <div className="form-grid">
              {text('full_name', 'Full name', { required: true, auto: 'name' })}
              {text('email', 'Email', { required: true, type: 'email', auto: 'email' })}
              {text('phone', 'Phone (WhatsApp if possible)', { required: true, type: 'tel', auto: 'tel' })}
              {text('date_of_birth', 'Date of birth', { required: true, type: 'date', auto: 'bday' })}
              {pick('gender', 'Gender', ['Female', 'Male', 'Other'], true)}
              {text('location', 'City and state', { required: true, auto: 'address-level2' })}
              {text('languages', 'Languages you speak', { placeholder: 'e.g. English, Hindi' })}
            </div>
            <h3>Study and work</h3>
            <div className="form-grid">
              {text('education', 'Highest education', { placeholder: 'e.g. B.Sc. Physics' })}
              {pick('occupation', 'Occupation', OCCUPATIONS)}
              {text('company', 'College or company')}
              {text('social_media', 'LinkedIn or Instagram (optional)', { placeholder: 'Link or handle' })}
            </div>
            <h3>How you would like to help</h3>
            <div className="form-grid">
              {pick('volunteer_type', 'I would like to volunteer as', HELP, true)}
              {pick('subject_pref', 'Subject I would like to teach', SUBJECTS, true)}
              {pick('class_pref', 'Classes I would like to teach', CLASSES, true)}
              {pick('hours_per_week', 'Time I can give each week', HOURS)}
              {text('availability', 'Days and times that suit you', { placeholder: 'e.g. Weekday evenings after 6 pm, Saturday mornings' })}
              {pick('heard_from', 'How did you hear about us?', HEARD)}
              {text('referred_by', 'Did a Pratyagra volunteer refer you? Their name')}
              {pick('past_volunteering', 'Have you volunteered before?', PAST)}
            </div>
            <h3>Emergency contact</h3>
            <div className="form-grid">
              {text('emergency_name', 'Name and relation', { required: true, placeholder: 'e.g. Asha Iyer (mother)' })}
              {text('emergency_phone', 'Phone', { required: true, type: 'tel' })}
            </div>
            <div className="field top-gap"><label htmlFor="j_motivation">Why would you like to volunteer?</label>
              <textarea id="j_motivation" rows={4} maxLength={2000} value={v.motivation ?? ''} onChange={e => set('motivation', e.target.value)} /></div>
            {/* left empty by people; bots fill it in */}
            <div className="hp" aria-hidden="true"><label htmlFor="j_website">Website</label><input id="j_website" tabIndex={-1} autoComplete="off" value={v.website} onChange={e => set('website', e.target.value)} /></div>
            <p className="muted top-gap">Because we work with children, every volunteer reads and signs our <a href={import.meta.env.BASE_URL + AGREEMENT_PDF} target="_blank" rel="noreferrer noopener">volunteer agreement and child protection policy</a> before starting. You will be asked to sign it in the portal once your login is ready.</p>
            <label className="check top-gap"><input type="checkbox" checked={!!v.consent} onChange={e => set('consent', e.target.checked)} />
              <span>I agree that Pratyagra Education Foundation may keep these details and contact me about volunteering. They are seen only by the Pratyagra team.<span className="req"> *</span></span></label>
            {err && <p className="error">{err}</p>}
            <button className="primary block top-gap" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
            <p className="muted auth-help">Already a Pratyagra volunteer? <a href={import.meta.env.BASE_URL}>Sign in to the portal</a>.</p>
          </form>
        )}
      </div>
    </div>
  )
}
