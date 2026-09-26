/**
 * plug — sending.
 *
 * Every send passes through sendReferral_(). There is no other path to Gmail,
 * so the DRY_RUN check and the daily cap cannot be bypassed by a caller.
 *
 * DRY_RUN is true until you deliberately turn it off in the settings tab. While
 * it is on, every message goes to TEST_INBOX and the real recipient is written
 * into the subject, so a mistake is visible in your own inbox instead of
 * landing on a stranger.
 */

/** A send is logged even when it fails, so the daily count can't be gamed by retrying. */
function sendReferral_(payload) {
  var job = payload.job || {};
  var contact = payload.contact || {};
  var subject = String(payload.subject || '').trim();
  var body = String(payload.body || '').trim();

  if (!subject || !body) throw new Error('nothing to send — draft the email first');

  var dryRun = getSetting_('DRY_RUN', 'true') === 'true';
  // Deliberately not passed as a default argument: JavaScript evaluates those
  // eagerly, so Session.getEffectiveUser() would run on every send even when
  // TEST_INBOX is set — dragging in a scope this function never actually needs.
  var testInbox = getSetting_('TEST_INBOX', '') || Session.getEffectiveUser().getEmail();
  var cap = numSetting_('DAILY_CAP', 25);

  var realTo = String(contact.email || '').trim();

  // In dry run a missing address is fine — that's the point of dry run.
  if (!dryRun && !realTo) throw new Error('no recipient address for this contact');
  if (!dryRun && !isEmail_(realTo)) throw new Error('that does not look like an email address: ' + realTo);
  if (dryRun && !testInbox) throw new Error('TEST_INBOX is not set — check the settings tab');

  // Day 5 resolves addresses by pattern; unverified ones need an explicit override.
  if (!dryRun && contact.email_status === 'unverified' && !payload.overrideUnverified) {
    throw new Error('that address is unverified. tick the override if you want to send anyway');
  }

  var sentToday = countSentToday_();
  if (sentToday >= cap) {
    throw new Error('daily cap reached (' + sentToday + '/' + cap + '). try again tomorrow');
  }

  var recipient = dryRun ? testInbox : realTo;
  var finalSubject = dryRun
    ? '[DRY RUN → ' + (realTo || 'no recipient') + '] ' + subject
    : subject;

  GmailApp.sendEmail(recipient, finalSubject, body, {
    name: MASTER_RESUME.name,
    // A referral ask is a personal email. HTML would make it look like a mailshot.
    noReply: false,
  });

  var threadId = findThreadId_(recipient, finalSubject);

  var row = {
    id: Utilities.getUuid(),
    job_id: job.id || '',
    contact_id: contact.id || '',
    to_email: recipient,
    subject: finalSubject,
    thread_id: threadId,
    status: 'sent',
    sent_at: new Date().toISOString(),
    followups: 0,
    last_action_at: new Date().toISOString(),
    dry_run: dryRun ? 'true' : 'false',
    real_to: realTo,
    contact_name: contact.name || '',
    company: job.company || '',
    role: job.role || '',
  };
  var sheet = tab_('outreach');
  sheet.appendRow(rowFor_(sheet, row));

  return {
    dryRun: dryRun,
    sentTo: recipient,
    realRecipient: realTo,
    subject: finalSubject,
    threadId: threadId,
    sentToday: sentToday + 1,
    cap: cap,
  };
}

/**
 * The thread is needed on day 6 to spot replies. GmailApp.sendEmail doesn't
 * return one, so find it by searching our own sent mail.
 */
function findThreadId_(recipient, subject) {
  try {
    var query = 'in:sent to:' + recipient + ' subject:"' + subject.replace(/"/g, '') + '"';
    var threads = GmailApp.search(query, 0, 1);
    return threads.length ? threads[0].getId() : '';
  } catch (err) {
    // A missing thread id is survivable; a failed send is not. Don't let this throw.
    console.warn('could not resolve thread id: ' + err);
    return '';
  }
}

/** Counts real and dry-run sends alike — a dry run still costs Gmail quota. */
function countSentToday_() {
  var today = new Date().toISOString().slice(0, 10);
  return readAll_('outreach').filter(function (r) {
    return String(r.sent_at || '').slice(0, 10) === today;
  }).length;
}

function isEmail_(s) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(s || ''));
}

/** What the panel needs to label the send button honestly. */
function sendStatus_() {
  var cap = numSetting_('DAILY_CAP', 25);
  var sent = countSentToday_();
  return {
    dryRun: getSetting_('DRY_RUN', 'true') === 'true',
    testInbox: getSetting_('TEST_INBOX', ''),
    sentToday: sent,
    cap: cap,
    remaining: Math.max(0, cap - sent),
  };
}

/**
 * Run this once from the editor after the Gmail scope is added to the manifest.
 *
 * Declaring a scope doesn't grant it — Google only asks when you run something
 * in the editor. The web app executes as you, so it can only use permissions
 * you have already approved; without this it fails at the moment of sending,
 * which is the worst possible time to find out.
 *
 * It only reads, and sends nothing.
 */
function checkGmailAccess() {
  var address = Session.getEffectiveUser().getEmail(); // editor-run, so the scope is present
  var threads = GmailApp.search('in:sent', 0, 1); // forces the Gmail grant
  console.log('gmail access is granted for: ' + address);
  console.log('sent threads visible: ' + threads.length);
  console.log('dry-run mail will be delivered to: ' + (getSetting_('TEST_INBOX', '') || address));
  console.log('you can now send from the extension.');
  return true;
}
