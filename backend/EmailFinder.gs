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

/** Does anything actually answer on this domain? Cheap sanity check, not proof. */
function domainResolves_(domain) {
  try {
    var res = UrlFetchApp.fetch('https://' + domain, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      validateHttpsCertificates: false,
    });
    return res.getResponseCode() < 400;
  } catch (err) {
    return false; // dns failure, timeout, refused
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

  var guesses = [slug + '.com', slug + '.io', slug + '.co', slug + '.ai'];
  for (var i = 0; i < guesses.length; i++) {
    if (domainResolves_(guesses[i])) return { domain: guesses[i], source: 'guessed' };
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
 * Hunter's verifier, if a key is set. Anything other than a clear yes stays
 * 'unverified' — this function must never upgrade a guess on a maybe.
 */
function verifyEmail_(email) {
  var key = getProp_('HUNTER_API_KEY');
  if (!key) return { status: 'unverified', reason: 'no verifier configured' };

  try {
    var url =
      'https://api.hunter.io/v2/email-verifier?email=' +
      encodeURIComponent(email) +
      '&api_key=' +
      encodeURIComponent(key);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { status: 'unverified', reason: 'verifier http ' + res.getResponseCode() };
    }
    var data = JSON.parse(res.getContentText()).data || {};
    if (data.status === 'valid') return { status: 'verified', reason: 'verifier says valid' };
    if (data.status === 'invalid') return { status: 'invalid', reason: 'verifier says invalid' };
    return { status: 'unverified', reason: 'verifier says ' + (data.status || 'unknown') };
  } catch (err) {
    return { status: 'unverified', reason: 'verifier failed: ' + err };
  }
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

  // Only the top guess is verified: the free tier is ~25 checks a month and
  // burning six on one person would empty it in four contacts.
  var top = verifyEmail_(candidates[0].email);
  candidates[0].status = top.status;
  candidates[0].reason = top.reason;
  for (var i = 1; i < candidates.length; i++) {
    candidates[i].status = 'unverified';
    candidates[i].reason = 'not checked';
  }

  return {
    domain: resolved.domain,
    domainSource: resolved.source,
    verifierConfigured: Boolean(getProp_('HUNTER_API_KEY')),
    candidates: candidates,
    best: candidates[0],
  };
}
