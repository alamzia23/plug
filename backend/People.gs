/**
 * plug — deciding who to ask.
 *
 * The extension reads whoever is visible; this decides which of them is worth
 * emailing. Ranking lives here because it needs the resume, and the resume
 * should not be shipped to the browser.
 *
 * The ordering reflects who actually says yes: someone who shares a specific
 * thing with you, then someone on the team, then a recruiter. Recruiters come
 * last, not first — they get the most of these and have the least incentive to
 * pass one along.
 */

// \w* on the stems: \brecruit\b does not match "recruiter", which is the word
// almost every one of these people actually has in their title.
var RECRUITER_WORDS = /\b(recruit\w*|talent|sourc\w*|staffing|hiring|people ops|peopleops|hr|human resources)\b/i;
var SENIOR_WORDS = /\b(vp|vice president|chief|cto|ceo|cfo|coo|head of|director|president)\b/i;

/**
 * Job titles say the same thing many ways. "Senior Software Developer" is a
 * same-function match for "DevOps Engineer" in every way that matters to a
 * referral, and scoring it "no strong signal" because the word "engineer" is
 * missing is a failure of vocabulary, not of judgement.
 */
var SYNONYMS = [
  ['engineer', 'developer', 'dev', 'programmer', 'swe', 'engineering'],
  ['devops', 'sre', 'platform', 'infrastructure', 'infra', 'cloud', 'reliability', 'ops'],
  ['frontend', 'front', 'ui', 'web', 'client'],
  ['backend', 'back', 'server', 'api'],
  ['data', 'analytics', 'ml', 'ai', 'machine'],
  ['security', 'appsec', 'infosec', 'cyber'],
  ['mobile', 'ios', 'android'],
  ['qa', 'test', 'testing', 'quality'],
];

/** Every word that means the same as one of these, for matching purposes. */
function expandKeywords_(words) {
  var out = {};
  words.forEach(function (w) {
    out[w] = true;
    SYNONYMS.forEach(function (group) {
      if (group.indexOf(w) !== -1) {
        group.forEach(function (g) { out[g] = true; });
      }
    });
  });
  return Object.keys(out);
}

/** Words in the job title that say something, once the noise is dropped. */
function roleKeywords_(role) {
  var stop = /\b(senior|sr|junior|jr|staff|principal|lead|i|ii|iii|the|and|of|at|for|remote|full|time|intern)\b/gi;
  return String(role || '')
    .toLowerCase()
    .replace(stop, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(function (w) { return w.length > 2; });
}

function scorePerson_(person, job, resume) {
  var title = String(person.title || '').toLowerCase();
  var reasons = [];
  var score = 0;

  // A shared school is the strongest opener a stranger can have — but a
  // headline says the abbreviation, never the full institution name,
  // so the full name alone almost never matches. Aliases are how this fires.
  var schools = [];
  (resume.education || []).forEach(function (e) {
    [].concat(e.school || [], e.aliases || []).forEach(function (name) {
      var n = String(name || '').toLowerCase().trim();
      if (n.length > 2) schools.push(n);
    });
  });
  var alumni = schools.some(function (s) {
    return title.indexOf(s) !== -1;
  });
  if (alumni) {
    score += 50;
    reasons.push('alumni');
  }

  // Same function: they can judge whether the work matches, which a recruiter can't.
  var keywords = expandKeywords_(roleKeywords_(job.role));
  var overlap = keywords.filter(function (k) { return title.indexOf(k) !== -1; });
  if (overlap.length) {
    score += 30 + overlap.length * 5;
    reasons.push('same function');
  }

  if (person.degree === '2nd') {
    score += 20;
    reasons.push('2nd degree');
  } else if (person.degree === '1st') {
    score += 35;
    reasons.push('1st degree');
  }

  if (RECRUITER_WORDS.test(title)) {
    score += 10;
    reasons.push('recruiter');
  }

  // A VP forwarding your email to a recruiter is worth less than a peer
  // clicking the referral button.
  if (SENIOR_WORDS.test(title)) {
    score -= 15;
    reasons.push('probably too senior');
  }

  if (!title) {
    score -= 10;
    reasons.push('no title visible');
  }

  return { score: score, reasons: reasons };
}

/**
 * payload: { people: [...], job: { role, company } }
 * Returns them ranked, capped at MAX_CONTACTS_PER_JOB.
 */
function rankPeople_(payload) {
  var people = (payload && payload.people) || [];
  if (!people.length) throw new Error('no people to rank');

  var job = payload.job || {};
  var resume = MASTER_RESUME;
  var cap = numSetting_('MAX_CONTACTS_PER_JOB', 3);

  var ranked = people
    .filter(function (p) { return p && p.name; })
    .map(function (p) {
      var s = scorePerson_(p, job, resume);
      return {
        name: p.name,
        title: p.title || '',
        degree: p.degree || '',
        profileUrl: p.profileUrl || '',
        score: s.score,
        reasons: s.reasons,
        kind: kindOf_(p, job),
      };
    })
    .sort(function (a, b) { return b.score - a.score; });

  var slate = buildSlate_(ranked, cap);
  var chosen = {};
  slate.forEach(function (p) { chosen[p.name] = true; });

  return {
    top: slate,
    rest: ranked.filter(function (p) { return !chosen[p.name]; }),
    cap: cap,
  };
}

/**
 * Words that mean this person leads people — not merely that they are
 * experienced.
 *
 * "Senior", "Staff" and "Principal" are individual-contributor levels: a
 * Senior Software Developer is the archetypal peer, the single best person to
 * ask, and treating their title as leadership put them in the wrong slot and
 * left the peer slot empty. SENIOR_WORDS (vp, chief, head of…) is checked
 * alongside this.
 */
var LEADER_WORDS = /\b(lead|leader|manager|managing|head|director|architect)\b/i;

/**
 * Which bet this person represents. They pay off differently, which is the
 * whole reason to pick one of each.
 */
function kindOf_(person, job) {
  var title = String(person.title || '').toLowerCase();
  if (RECRUITER_WORDS.test(title)) return 'recruiter';

  var keywords = expandKeywords_(roleKeywords_(job.role));
  var sameFunction = keywords.some(function (k) { return title.indexOf(k) !== -1; });
  if (!sameFunction) return 'other';
  return LEADER_WORDS.test(title) || SENIOR_WORDS.test(title) ? 'senior' : 'peer';
}

/**
 * One of each kind before a second of any.
 *
 * Three peers is one bet placed three times: if that kind of person doesn't
 * reply, nothing else was tried. A peer is likeliest to answer, a senior in
 * the same function carries the most weight if they do, and a recruiter is
 * the dependable floor — they are paid to reply even when they won't champion
 * you. Spreading the asks across all three is worth more than three copies of
 * the best-scoring one.
 */
function buildSlate_(ranked, cap) {
  var order = ['peer', 'senior', 'recruiter'];
  var picked = [];
  var used = {};

  order.forEach(function (kind) {
    if (picked.length >= cap) return;
    for (var i = 0; i < ranked.length; i++) {
      if (used[i]) continue;
      if (ranked[i].kind !== kind) continue;
      used[i] = true;
      picked.push(ranked[i]);
      return;
    }
  });

  // Nothing of a given kind exists at this company — fill by score rather than
  // leaving a slot empty. One recruiter is a fallback channel; two is an ask
  // spent on someone who cannot refer you either way.
  var haveRecruiter = picked.some(function (p) { return p.kind === 'recruiter'; });
  for (var j = 0; j < ranked.length && picked.length < cap; j++) {
    if (used[j]) continue;
    if (ranked[j].kind === 'recruiter' && haveRecruiter) continue;
    if (ranked[j].kind === 'recruiter') haveRecruiter = true;
    used[j] = true;
    picked.push(ranked[j]);
  }
  return picked;
}

var NOTE_SYSTEM = [
  'Write a LinkedIn connection note.',
  '',
  'Hard rules:',
  '- UNDER 280 characters. LinkedIn will not accept more.',
  '- One specific reason you are reaching out to THIS person.',
  '- Mention the role by name.',
  '- No buzzwords, no flattery, no exclamation marks, no emoji.',
  '- Do not ask for the referral here. The note is to connect; the ask comes after.',
  '',
  'Answer with JSON only: {"note": "..."}',
].join('\n');

/**
 * A note the user sends themselves. Never sent by plug — hard rule, and the
 * right one: a connection request from a script is one the user didn't write.
 */
function connectionNote_(payload) {
  var person = payload.person || {};
  var job = payload.job || {};
  if (!person.name) throw new Error('need a person to write to');

  var out = llmComplete_({
    system: NOTE_SYSTEM,
    user: [
      'THEM',
      'name: ' + person.name,
      'title: ' + (person.title || 'unknown'),
      '',
      'THE ROLE I AM AFTER',
      (job.role || 'unknown') + ' at ' + (job.company || 'unknown'),
      '',
      'ME',
      MASTER_RESUME.name + ', ' + MASTER_RESUME.headline,
      'skills: ' + (MASTER_RESUME.skills || []).slice(0, 6).join(', '),
    ].join('\n'),
    maxTokens: 1200,
    temperature: 0.7,
    json: true,
  });

  var note = String(parseJsonLoose_(out.text).note || '').trim();
  if (!note) throw new Error('model returned an empty note');

  return {
    note: note.slice(0, 280),
    chars: Math.min(note.length, 280),
    truncated: note.length > 280,
    provider: out.provider,
    model: out.model,
  };
}
