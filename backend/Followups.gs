/**
 * plug — replies and follow-ups.
 *
 * A daily trigger walks the outreach log, notices replies, and nudges the
 * silent ones twice before giving up. The cadence and the ceiling are the
 * point: two nudges is where the curve flattens, and the cost of annoying
 * someone at a company you want to work at outlasts the application.
 *
 * Follow-ups reply inside the original thread, never as a new email, so the
 * recipient has the first message one scroll away.
 */

var FOLLOWUP_DAYS = [3, 7];  // first nudge, then the last one
var GHOST_AFTER_DAYS = 14;   // silence past this is an answer

function daysSince_(iso) {
  var then = new Date(iso).getTime();
  if (!then) return 0;
  return Math.floor((Date.now() - then) / 86400000);
}

/**
 * Find the thread for an outreach row.
 *
 * thread_id is the reliable route, but it can be empty — Gmail sometimes
 * hasn't indexed a just-sent message when we look for it. Falling back to a
 * subject search means a missing id degrades the feature instead of killing it.
 */
function threadFor_(row) {
  if (row.thread_id) {
    try {
      var byId = GmailApp.getThreadById(String(row.thread_id));
      if (byId) return byId;
    } catch (err) {
      // deleted, or an id from another account — fall through to the search
    }
  }
  if (!row.subject) return null;
  try {
    var hits = GmailApp.search('subject:"' + String(row.subject).replace(/"/g, '') + '"', 0, 1);
    return hits.length ? hits[0] : null;
  } catch (err) {
    return null;
  }
}

/**
 * Did anyone answer?
 *
 * On a real send, a reply is a message from someone who isn't us. On a dry run
 * every message is from us — so there the signal is simply that the thread grew,
 * which keeps follow-ups testable without pretending a test is a real reply.
 */
function repliedOn_(thread, isDryRun) {
  if (!thread) return false;
  var messages = thread.getMessages();
  if (isDryRun) return messages.length > 1;

  var me = String(Session.getEffectiveUser().getEmail()).toLowerCase();
  return messages.some(function (m) {
    return String(m.getFrom()).toLowerCase().indexOf(me) === -1;
  });
}

/** Short, no new arguments, and an explicit exit. The last one says it's the last. */
function followupBody_(row, which) {
  var name = String(row.contact_name || '').split(' ')[0] || 'there';
  var role = row.role || 'the role';

  if (which === 1) {
    return [
      'Hi ' + name + ',',
      '',
      'Bumping this once in case it got buried. Still keen on ' + role + ', and',
      'still completely fine to be told no.',
      '',
      'Thanks,',
      MASTER_RESUME.name,
    ].join('\n');
  }
  return [
    'Hi ' + name + ',',
    '',
    "Last nudge from me on this, then I'll stop. If the timing is bad or it's",
    'not a fit, no explanation needed.',
    '',
    'Thanks,',
    MASTER_RESUME.name,
  ].join('\n');
}

/**
 * The daily pass. Safe to run by hand — it decides everything from the sheet,
 * so running it twice in a day changes nothing the second time.
 */
function dailyReplyCheck() {
  var rows = readAll_('outreach');
  var sheet = tab_('outreach');
  var cols = headers_(sheet);
  var cap = numSetting_('DAILY_CAP', 25);
  var maxFollowups = numSetting_('MAX_FOLLOWUPS', 2);
  var dryRun = getSetting_('DRY_RUN', 'true') === 'true';
  var sentToday = countSentToday_();

  var summary = { checked: 0, replied: 0, nudged: 0, ghosted: 0, skipped: 0 };

  function write(row, field, value) {
    var col = cols.indexOf(field);
    if (col !== -1) sheet.getRange(row._row, col + 1).setValue(value);
  }

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.sent_at) continue;
    if (row.status === 'replied' || row.status === 'ghosted') continue;

    summary.checked++;
    var age = daysSince_(row.sent_at);
    var thread = threadFor_(row);

    if (repliedOn_(thread, String(row.dry_run) === 'true')) {
      write(row, 'status', 'replied');
      write(row, 'last_action_at', new Date().toISOString());
      summary.replied++;
      continue;
    }

    var done = Number(row.followups) || 0;

    if (done >= maxFollowups) {
      if (age >= GHOST_AFTER_DAYS) {
        write(row, 'status', 'ghosted');
        write(row, 'last_action_at', new Date().toISOString());
        summary.ghosted++;
      }
      continue;
    }

    // Due only once the next step's day has arrived.
    if (age < FOLLOWUP_DAYS[done]) continue;

    if (sentToday >= cap) {
      summary.skipped++;
      continue; // tomorrow's pass will pick it up
    }
    if (!thread) {
      summary.skipped++;
      continue; // no thread means no way to reply in-thread
    }

    try {
      // Always a reply on the same thread. A new email makes them rebuild the
      // context, and reads as a third stranger rather than a second nudge.
      thread.reply(followupBody_(row, done + 1));
      write(row, 'followups', done + 1);
      write(row, 'status', 'nudged');
      write(row, 'last_action_at', new Date().toISOString());
      sentToday++;
      summary.nudged++;
    } catch (err) {
      console.warn('follow-up failed for ' + row.id + ': ' + err);
      summary.skipped++;
    }
  }

  console.log(JSON.stringify(summary));
  return summary;
}

/** Idempotent: clears our old trigger before adding one, so it can't stack up. */
function installDailyTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'dailyReplyCheck') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('dailyReplyCheck').timeBased().everyDays(1).atHour(9).create();
  console.log('daily reply check installed — runs around 9am ' + Session.getScriptTimeZone());
  return true;
}

function removeDailyTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'dailyReplyCheck') {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  console.log('removed ' + removed + ' trigger(s)');
  return removed;
}

/**
 * The tracker the panel shows: every outreach row plus a streak.
 *
 * The streak counts consecutive days ending today or yesterday — yesterday
 * still counts, because a streak shouldn't break at midnight before you've
 * had a chance to act.
 */
function tracker_() {
  var rows = readAll_('outreach').filter(function (r) { return r.sent_at; });

  var days = {};
  rows.forEach(function (r) {
    days[String(r.sent_at).slice(0, 10)] = true;
  });

  var streak = 0;
  var cursor = new Date();
  if (!days[cursor.toISOString().slice(0, 10)]) {
    cursor.setDate(cursor.getDate() - 1); // yesterday still counts
  }
  while (days[cursor.toISOString().slice(0, 10)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  var counts = { draft: 0, sent: 0, nudged: 0, replied: 0, ghosted: 0 };
  rows.forEach(function (r) {
    if (counts[r.status] !== undefined) counts[r.status]++;
  });

  return {
    streak: streak,
    counts: counts,
    total: rows.length,
    triggerInstalled: ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'dailyReplyCheck';
    }),
    rows: rows.slice(-25).reverse().map(function (r) {
      delete r._row;
      return r;
    }),
  };
}
