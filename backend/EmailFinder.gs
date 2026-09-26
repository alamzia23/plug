/**
 * plug — working out someone's work email.
 *
 * This is guesswork and the code says so. Every address comes back with a
 * status, and Mail.gs refuses to send to an 'unverified' one without an
 * explicit override. A confident-looking wrong address is worse than no
 * address: it bounces, or worse, it reaches a stranger.
 *
 * Optional Script Property:
 *   HUNTER_API_KEY   free tier verifies ~25/month. Without it everything
 *                    stays 'unverified', which is honest rather than broken.
 */

// Hosts that belong to an applicant tracking system, not to the employer.
var ATS_HOSTS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'smartrecruiters.com',
  'workable.com', 'recruitee.com', 'teamtailor.com', 'breezy.hr',
  'jobvite.com', 'bamboohr.com', 'myworkdayjobs.com', 'linkedin.com',
  'naukri.com', 'indeed.com', 'glassdoor.com', 'wellfound.com',
];

// Suffixes that are part of a legal name but never part of a domain.
var COMPANY_NOISE = /\b(inc|llc|ltd|limited|corp|corporation|gmbh|pvt|private|plc|co|company|technologies|technology|labs|group|holdings|solutions|systems|software|india)\b/gi;

function isAtsHost_(host) {
  return ATS_HOSTS.some(function (h) {
    return host === h || host.slice(-(h.length + 1)) === '.' + h;
  });
}

/** "Acme Technologies Pvt Ltd" -> "acme" */
function companySlug_(company) {
  return String(company || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(COMPANY_NOISE, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** The job url is only useful when the posting is on the employer's own site. */
function domainFromJobUrl_(url) {
  try {
    var host = String(url || '').split('/')[2] || '';
    host = host.replace(/^www\./, '').toLowerCase();
    if (!host || isAtsHost_(host)) return '';
    // careers.acme.com -> acme.com
    var parts = host.split('.');
    if (parts.length > 2 && ['careers', 'jobs', 'apply', 'work', 'hire', 'join'].indexOf(parts[0]) !== -1) {
      parts.shift();
    }
    return parts.join('.');
  } catch (err) {
    return '';
  }
}

/**
 * Does this domain accept mail at all?
 *
 * Apps Script has no sockets, so a real SMTP probe is impossible — but DNS over
 * HTTPS is a plain GET and needs no key, no signup and no quota. A domain with
 * no MX records cannot receive email from anyone, which makes every pattern
 * guess against it wrong. That is the single most common way address guessing
 * fails, and it is free to rule out.
 *
 * Returns 'yes' | 'no' | 'unknown' — never a boolean, because "the lookup
 * failed" must not be mistaken for "this domain rejects mail".
 */
function hasMx_(domain) {
  if (!domain) return 'no';
  try {
    var res = UrlFetchApp.fetch(
      'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=MX',
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return 'unknown';
    var data = JSON.parse(res.getContentText());
    if (data.Status === 3) return 'no'; // NXDOMAIN — the domain doesn't exist
    if (data.Status !== 0) return 'unknown';
    var answers = data.Answer || [];
    var mx = answers.filter(function (a) { return a.type === 15; });
    return mx.length ? 'yes' : 'no';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Prefer the employer's own host when the posting was there; otherwise try the
 * obvious spellings, cheapest guess first. Capped at four probes so a bad
 * company name can't spend the whole execution budget.
 */
function resolveDomain_(company, jobUrl) {
  var fromUrl = domainFromJobUrl_(jobUrl);
  if (fromUrl) return { domain: fromUrl, source: 'job url' };

  var slug = companySlug_(company);
  if (!slug) return { domain: '', source: 'none' };

  // Probe by MX, not by whether a website loads: we want a domain that receives
  // mail, which is not the same question.
  var guesses = [slug + '.com', slug + '.io', slug + '.co', slug + '.ai'];
  for (var i = 0; i < guesses.length; i++) {
    if (hasMx_(guesses[i]) === 'yes') return { domain: guesses[i], source: 'guessed' };
  }
  return { domain: guesses[0], source: 'unresolved' };
}

/** Ordered by how common each shape is, so the first candidate is the best bet. */
function patternsFor_(fullName, domain) {
  var clean = String(fullName || '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, '')
    // LinkedIn names carry titles and suffixes that are never in an address
    .replace(/^\s*(dr|mr|mrs|ms|miss|prof|sir)\s+/, '')
    .replace(/\s+(jr|sr|ii|iii|iv|phd|mba|cfa)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || !domain) return [];

  var parts = clean.split(' ').filter(Boolean);
  var first = (parts[0] || '').replace(/[^a-z]/g, '');
  var last = (parts.length > 1 ? parts[parts.length - 1] : '').replace(/[^a-z]/g, '');
  if (!first) return [];

  var shapes = last
    ? [
        { pattern: 'first.last', local: first + '.' + last },
        { pattern: 'first', local: first },
        { pattern: 'firstlast', local: first + last },
        { pattern: 'f.last', local: first[0] + '.' + last },
        { pattern: 'flast', local: first[0] + last },
        { pattern: 'first_last', local: first + '_' + last },
      ]
    : [{ pattern: 'first', local: first }];

  return shapes.map(function (s, i) {
    return { email: s.local + '@' + domain, pattern: s.pattern, rank: i + 1 };
  });
}

/**
 * Mailbox verifiers, same shape as the LLM providers: nothing above this map
 * knows which service answered. Add one by adding an entry.
 *
 * Script Properties:
 *   VERIFIER          hunter | abstract | mailboxlayer   (default: none)
 *   VERIFIER_API_KEY  that service's key
 *
 * HUNTER_API_KEY is still read for backwards compatibility.
 *
 * Every adapter returns 'verified' | 'invalid' | 'unverified'. A maybe is
 * always 'unverified': catch-all domains, greylisting and rate limits all look
 * like uncertainty, and none of them are permission to email a stranger.
 */
var VERIFIERS = {
  hunter: {
    // note: hunter refuses free email addresses at signup
    url: function (email, key) {
      return 'https://api.hunter.io/v2/email-verifier?email=' +
        encodeURIComponent(email) + '&api_key=' + encodeURIComponent(key);
    },
    read: function (data) {
      var status = (data.data || {}).status;
      if (status === 'valid') return { status: 'verified', reason: 'hunter: valid' };
      if (status === 'invalid') return { status: 'invalid', reason: 'hunter: invalid' };
      return { status: 'unverified', reason: 'hunter: ' + (status || 'unknown') };
    },
  },

  abstract: {
    // accepts free email addresses at signup — app.abstractapi.com
    url: function (email, key) {
      return 'https://emailvalidation.abstractapi.com/v1/?api_key=' +
        encodeURIComponent(key) + '&email=' + encodeURIComponent(email);
    },
    read: function (data) {
      var deliverable = data.deliverability;
      if (deliverable === 'DELIVERABLE') return { status: 'verified', reason: 'abstract: deliverable' };
      if (deliverable === 'UNDELIVERABLE') return { status: 'invalid', reason: 'abstract: undeliverable' };
      return { status: 'unverified', reason: 'abstract: ' + (deliverable || 'unknown') };
    },
  },

  mailboxlayer: {
    // also accepts free email addresses at signup
    url: function (email, key) {
      return 'https://apilayer.net/api/check?access_key=' + encodeURIComponent(key) +
        '&email=' + encodeURIComponent(email) + '&smtp=1&format=1';
    },
    read: function (data) {
      if (data.smtp_check === true && data.format_valid === true) {
        // a catch-all domain accepts everything, so it proves nothing
        if (data.catch_all === true) return { status: 'unverified', reason: 'mailboxlayer: catch-all domain' };
        return { status: 'verified', reason: 'mailboxlayer: smtp ok' };
      }
      if (data.smtp_check === false) return { status: 'invalid', reason: 'mailboxlayer: smtp rejected' };
      return { status: 'unverified', reason: 'mailboxlayer: inconclusive' };
    },
  },
};

function verifierConfig_() {
  var key = getProp_('VERIFIER_API_KEY') || getProp_('HUNTER_API_KEY') || '';
  var name = getProp_('VERIFIER') || (getProp_('HUNTER_API_KEY') ? 'hunter' : '');
  return { name: name, key: key, adapter: VERIFIERS[name] || null };
}

/**
 * Two layers. The MX check is free and always runs; it can only ever prove a
 * domain is hopeless, which is the most common way a guessed address is wrong.
 * The mailbox check needs a key and is the only thing that can say 'verified'.
 */
function verifyEmail_(email) {
  var domain = String(email).split('@')[1] || '';

  var mx = hasMx_(domain);
  if (mx === 'no') {
    return { status: 'invalid', reason: domain + ' does not accept email at all' };
  }

  var cfg = verifierConfig_();
  if (!cfg.adapter || !cfg.key) {
    return {
      status: 'unverified',
      reason: mx === 'yes'
        ? 'domain accepts mail, mailbox unchecked (no verifier configured)'
        : 'no verifier configured',
    };
  }

  try {
    var res = UrlFetchApp.fetch(cfg.adapter.url(email, cfg.key), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { status: 'unverified', reason: cfg.name + ' http ' + res.getResponseCode() };
    }
    var verdict = cfg.adapter.read(JSON.parse(res.getContentText()));
    return verdict;
  } catch (err) {
    // A verifier being down must never block a send that the user could make
    // by hand. Degrade to unverified, which still gates the live send.
    return { status: 'unverified', reason: cfg.name + ' failed: ' + err };
  }
}

/**
 * Ask Hunter for the address outright.
 *
 * This is strictly better than guessing when it works: Hunter derives the
 * answer from addresses it has actually observed on that domain, so it knows
 * the company's real pattern rather than assuming the most common one. Six
 * guesses and a shrug becomes one address and a number.
 *
 * Returns null when it can't help, so the caller falls back to guessing.
 */
function hunterFind_(domain, fullName) {
  var cfg = verifierConfig_();
  if (cfg.name !== 'hunter' || !cfg.key || !domain || !fullName) return null;

  try {
    var url =
      'https://api.hunter.io/v2/email-finder?domain=' + encodeURIComponent(domain) +
      '&full_name=' + encodeURIComponent(fullName) +
      '&api_key=' + encodeURIComponent(cfg.key);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;

    var data = (JSON.parse(res.getContentText()) || {}).data || {};
    if (!data.email) return null;

    var score = Number(data.score) || 0;
    var sources = (data.sources || []).length;

    // A high score means Hunter has seen this address, which is stronger
    // evidence than an SMTP probe. Below that it's still the best candidate,
    // but it is not a verification and must not be labelled as one.
    var status = score >= 90 ? 'verified' : 'unverified';

    return {
      email: data.email,
      pattern: 'hunter',
      rank: 0,
      status: status,
      score: score,
      reason: 'hunter found this, ' + score + '% confidence' +
        (sources ? ' from ' + sources + ' source' + (sources === 1 ? '' : 's') : ''),
    };
  } catch (err) {
    return null; // never let the finder break the fallback
  }
}

/**
 * Ask Hunter who works at a company.
 *
 * This is the only route to finding people without crawling LinkedIn: give it
 * a domain and it returns names, titles and addresses it has already observed.
 *
 * CREDITS ARE PER REVEALED ADDRESS, not per company. Asking for 25 people can
 * therefore cost 25 of a 50-a-month allowance in a single click, and we only
 * ever use MAX_CONTACTS_PER_JOB of them. The limit is deliberately small and
 * tunable — a wide net here is someone's whole month.
 *
 * Returns an empty list rather than throwing — no key, no coverage and a rate
 * limit all mean the same thing to the caller: fall back to reading a page.
 */
/**
 * Which of Hunter's departments a job title belongs to.
 *
 * Without this the directory returns whoever it happens to know best, which
 * skews heavily to executives — a DevOps search came back with a Workplace
 * Services Partner, a Director of Talent Acquisition and a Director of Data.
 * Ranking cannot rescue a candidate list with no engineers in it.
 */
function departmentFor_(role) {
  var r = String(role || '').toLowerCase();
  if (/\b(engineer|developer|devops|sre|software|backend|frontend|full.?stack|data|cloud|infrastructure|platform|security|qa|architect|programmer)\b/.test(r)) return 'it';
  if (/\b(design|designer|ux|ui|product design)\b/.test(r)) return 'design';
  if (/\b(product manager|product owner|program manager|project manager)\b/.test(r)) return 'management';
  if (/\b(sales|account executive|business development)\b/.test(r)) return 'sales';
  if (/\b(marketing|growth|content|brand)\b/.test(r)) return 'marketing';
  if (/\b(recruit\w*|talent|people ops)\b/.test(r)) return 'hr'; // \brecruit\b misses "recruiter"
  if (/\b(finance|accounting|controller)\b/.test(r)) return 'finance';
  if (/\b(support|success|operations)\b/.test(r)) return 'operations';
  return '';
}

function hunterDomainSearch_(domain, limit, role) {
  var cfg = verifierConfig_();
  if (cfg.name !== 'hunter' || !cfg.key || !domain) {
    return { people: [], reason: 'no directory key configured' };
  }

  // Enough to rank meaningfully, few enough that a click can't empty a month.
  var want = limit || numSetting_('DIRECTORY_LIMIT', 10);

  try {
    // Ask for the right people rather than filtering afterwards: a filtered
    // request spends credits on candidates worth ranking, an unfiltered one
    // spends them on whoever Hunter happens to know.
    // Recruiters live in hr, so filtering to the role's own department alone
    // makes the recruiter slot unfillable. Asking for both in one request
    // costs one call rather than two.
    var department = departmentFor_(role);
    if (department && department !== 'hr') department = department + ',hr';
    var url =
      'https://api.hunter.io/v2/domain-search?domain=' + encodeURIComponent(domain) +
      '&limit=' + want +
      // junior + senior deliberately omits 'executive'. A VP forwarding you to
      // a recruiter is worth less than a peer clicking refer.
      '&seniority=junior,senior' +
      (department ? '&department=' + encodeURIComponent(department) : '') +
      '&api_key=' + encodeURIComponent(cfg.key);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var raw = res.getContentText();

    // An empty list and a refused request look identical to the caller unless
    // the reason travels with it — "nobody works there" and "your quota is
    // spent" need completely different responses from the user.
    if (res.getResponseCode() !== 200) {
      return {
        people: [],
        reason: 'hunter http ' + res.getResponseCode() + ': ' + errorMessage_(raw).slice(0, 160),
      };
    }

    var data = (JSON.parse(raw) || {}).data || {};
    var people = (data.emails || [])
      .filter(function (e) { return e && e.value; })
      .map(function (e) {
        var name = [e.first_name, e.last_name].filter(Boolean).join(' ');
        return {
          name: name || e.value.split('@')[0].replace(/[._]/g, ' '),
          title: e.position || '',
          email: e.value,
          // Hunter's own confidence in the address, reused as the status so the
          // send gate keeps working on people we never guessed at.
          email_status: Number(e.confidence) >= 90 ? 'verified' : 'unverified',
          confidence: Number(e.confidence) || 0,
          department: e.department || '',
          seniority: e.seniority || '',
          profileUrl: e.linkedin || '',
          degree: '',
          source: 'hunter',
        };
      });

    return {
      people: people,
      department: department,
      reason: people.length
        ? people.length + ' of ' + want + ' requested'
        : 'nobody matching' + (department ? ' in ' + department : '') + ' at ' + domain +
          ' — try a different domain, or widen DIRECTORY_LIMIT',
    };
  } catch (err) {
    return { people: [], reason: 'hunter failed: ' + err };
  }
}

/**
 * payload: { company, jobUrl, role }
 * Who to ask at this company, ranked, with addresses already attached.
 */
function findPeople_(payload) {
  var job = payload || {};
  var resolved = job.domain
    ? { domain: String(job.domain).trim().toLowerCase(), source: 'you typed it' }
    : resolveDomain_(job.company, job.jobUrl);

  if (!resolved.domain) throw new Error("couldn't work out the company's domain — type one in");

  var lookup = hunterDomainSearch_(resolved.domain, 0, job.role);
  var people = lookup.people;
  if (!people.length) {
    return {
      domain: resolved.domain,
      domainSource: resolved.source,
      source: verifierConfig_().name === 'hunter' ? 'hunter-empty' : 'no-directory',
      reason: lookup.reason,
      top: [],
      rest: [],
    };
  }

  var ranked = rankPeople_({ people: people, job: job });
  // rankPeople_ only keeps ranking fields, so put the addresses back.
  var byName = {};
  people.forEach(function (p) { byName[p.name] = p; });
  function rejoin(list) {
    return list.map(function (r) {
      var src = byName[r.name] || {};
      r.email = src.email || '';
      r.email_status = src.email_status || '';
      r.confidence = src.confidence || 0;
      return r;
    });
  }

  return {
    domain: resolved.domain,
    domainSource: resolved.source,
    source: 'hunter',
    reason: lookup.reason,
    department: lookup.department || '',
    found: people.length,
    // Say when the best available person still isn't a good ask, rather than
    // presenting three weak options as though they were a shortlist.
    weak: (ranked.top[0] || {}).score < 20,
    top: rejoin(ranked.top),
    rest: rejoin(ranked.rest),
  };
}

/**
 * payload: { name, company, jobUrl, domain? }
 * Returns every candidate with its status. The caller picks; nothing is
 * assumed to be right just because it ranked first.
 */
function findEmail_(payload) {
  var name = String((payload && payload.name) || '').trim();
  if (!name) throw new Error('need a contact name to guess an address');

  var resolved = payload.domain
    ? { domain: String(payload.domain).trim().toLowerCase(), source: 'you typed it' }
    : resolveDomain_(payload.company, payload.jobUrl);

  if (!resolved.domain) throw new Error("couldn't work out a domain — type one in");

  var candidates = patternsFor_(name, resolved.domain);
  if (!candidates.length) throw new Error('could not build any address from "' + name + '"');

  for (var i = 0; i < candidates.length; i++) {
    candidates[i].status = 'unverified';
    candidates[i].reason = 'not checked';
  }

  // Ask outright before guessing. One call either way, and a known address
  // beats the most popular pattern every time.
  var found = hunterFind_(resolved.domain, name);
  if (found) {
    candidates = [found].concat(
      candidates.filter(function (c) { return c.email !== found.email; })
    );
  } else {
    // No answer, so fall back to checking the top guess. Only the top one:
    // free tiers are small and six checks per person empties one fast.
    var top = verifyEmail_(candidates[0].email);
    candidates[0].status = top.status;
    candidates[0].reason = top.reason;
  }

  return {
    domain: resolved.domain,
    domainSource: resolved.source,
    verifierConfigured: Boolean(verifierConfig_().adapter && verifierConfig_().key),
    verifier: verifierConfig_().name || 'none (mx check only)',
    candidates: candidates,
    best: candidates[0],
    askedDirectly: Boolean(found),
  };
}
