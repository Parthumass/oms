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
 * Calendar invites for meetings also need the Google Calendar API service:
 *   Editor > Services (+) > Google Calendar API > Add. (Already added if this
 *   project was copied with "Make a copy".) The first Run after that asks to
 *   allow access to the calendar. Invites are sent from this account's
 *   own calendar, and the meetings appear on it.
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
  const code = res.getResponseCode();
  if (code < 200 || code > 299) {
    throw new Error(fn + ' failed (' + code + '): ' + res.getContentText().slice(0, 300));
  }
  const text = res.getContentText();
  return text ? JSON.parse(text) : null;   // 204 = done, nothing to return
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
  syncMeetingInvites_(secret);
}

// ---------------------------------------------------------------- calendar invites

const TIME_ZONE = 'Asia/Kolkata';   // meeting times in the portal are India time

function syncMeetingInvites_(secret) {
  if (typeof Calendar === 'undefined') {
    console.warn('Calendar invites skipped: add the Google Calendar API service (see the notes at the top).');
    return;
  }
  const work = call_('cal_run', { p_secret: secret });
  for (const m of work.meetings) {
    let eventId = m.event_id;
    try {
      const body = eventBody_(m);
      if (!eventId) eventId = findEvent_(m.id);          // created before, but the reply did not reach the portal
      if (eventId) {
        Calendar.Events.patch(body, 'primary', eventId, { sendUpdates: 'all' });
      } else {
        eventId = Calendar.Events.insert(body, 'primary', { sendUpdates: 'all' }).id;
      }
      call_('cal_done', { p_secret: secret, p_session: m.id, p_version: m.version, p_event_id: eventId, p_error: null });
    } catch (e) {
      console.error('Calendar invite for "' + m.title + '" failed: ' + e);
      call_('cal_done', { p_secret: secret, p_session: m.id, p_version: m.version, p_event_id: eventId || null, p_error: String(e).slice(0, 300) });
    }
  }
  for (const eventId of work.cancel) {
    try {
      Calendar.Events.remove('primary', eventId, { sendUpdates: 'all' });
    } catch (e) {
      console.error('Could not cancel calendar event ' + eventId + ': ' + e);   // already gone: nothing to do
    }
    call_('cal_done', { p_secret: secret, p_session: null, p_version: 0, p_event_id: eventId, p_error: null });
  }
  console.log('Calendar: ' + work.meetings.length + ' meeting(s) sent or updated, ' + work.cancel.length + ' cancelled');
}

function eventBody_(m) {
  const lines = [];
  if (m.description) lines.push(m.description, '');
  if (m.room) lines.push('Room: ' + m.room);
  else if (m.mode) lines.push('Mode: ' + m.mode);
  if (m.link) lines.push('Join: ' + m.link);
  if (m.passcode) lines.push('Passcode: ' + m.passcode);
  lines.push('', 'Details in the Pratyagra portal: ' + m.portal_url);
  const body = {
    summary: m.title,
    description: lines.join('\n'),
    location: m.link ? (m.room ? m.room + ' (Zoom): ' : '') + m.link : (m.mode === 'Offline' ? 'In person' : ''),
    attendees: m.guests.map(function (e) { return { email: e }; }),
    guestsCanSeeOtherGuests: false,              // volunteers do not see each other's email addresses
    guestsCanInviteOthers: false,
    extendedProperties: { private: { portalSession: m.id } },
    reminders: { useDefault: true },
  };
  if (m.start_time) {
    const start = m.date + 'T' + m.start_time + ':00+05:30';
    const end = new Date(new Date(start).getTime() + m.minutes * 60000);
    body.start = { dateTime: start, timeZone: TIME_ZONE };
    body.end = { dateTime: Utilities.formatDate(end, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss") + '+05:30', timeZone: TIME_ZONE };
  } else {
    // no start time set: an all-day event on that date
    const next = new Date(new Date(m.date + 'T00:00:00+05:30').getTime() + 86400000);
    body.start = { date: m.date };
    body.end = { date: Utilities.formatDate(next, TIME_ZONE, 'yyyy-MM-dd') };
  }
  return body;
}

function findEvent_(sessionId) {
  const found = Calendar.Events.list('primary', { privateExtendedProperty: 'portalSession=' + sessionId, showDeleted: false, maxResults: 1 });
  return found.items && found.items.length ? found.items[0].id : null;
}
