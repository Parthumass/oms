/**
 * Pratyagra portal: sends the reminder emails the portal has prepared.
 *
 * Set up once, signed in to Google as the account that should send the mail
 * (for example pratyagrafoundation@gmail.com):
 *   1. Go to script.google.com > New project. Paste this whole file. Save.
 *   2. Project Settings (gear) > Script properties > Add property:
 *        name  MAIL_SECRET
 *        value the secret from Supabase. To see it, run this in the SQL Editor:
 *              select secret from app.mail_secret;
 *   3. Back in the editor, choose the function sendPortalEmails and press Run.
 *      Google asks you to allow it to send email as you. Allow.
 *   4. Triggers (clock icon) > Add trigger > sendPortalEmails > Time-driven >
 *      Hour timer > Every hour. Save.
 *   5. In the portal, Setup > Email > switch reminders on.
 *
 * A free Gmail account may send to about 100 recipients a day from a script.
 * The portal's daily cap (Setup > Email) is 90 to stay under that.
 */
const SUPABASE_URL = 'https://gltbumkkyzddcfytnoby.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BPB3-jSGfXgKDkAkXejt0Q_8G9QUoC-';   // public key, safe to keep here
const FROM_NAME = 'Pratyagra Portal';

function call_(fn, payload) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(fn + ' failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

function sendPortalEmails() {
  const secret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');
  if (!secret) throw new Error('Add the MAIL_SECRET script property first (see the notes at the top).');
  const waiting = call_('mail_run', { p_secret: secret });
  const sent = [];
  for (const m of waiting) {
    if (MailApp.getRemainingDailyQuota() < 1) break;          // Gmail's own daily limit reached; the rest go tomorrow
    try {
      GmailApp.sendEmail(m.to_email, m.subject, m.body, { name: FROM_NAME });
      sent.push(m.id);
    } catch (e) {
      console.error('Could not send to ' + m.to_email + ': ' + e);
    }
  }
  if (sent.length) call_('mail_done', { p_secret: secret, p_ids: sent });
  console.log('Waiting: ' + waiting.length + ', sent: ' + sent.length);
}
