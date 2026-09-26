/**
 * plug — drafting.
 *
 * Provider-neutral on purpose: this file builds prompts and parses answers.
 * Which model answers is Providers.gs's problem.
 */

var DRAFT_SYSTEM = [
  'You write short referral request emails for a job seeker.',
  '',
  'Rules, all of them hard:',
  '- The email body is UNDER 120 words. Shorter is better.',
  '- Write like one person emailing another. Plain sentences.',
  '- Name one specific thing from the job description and one specific thing from',
  '  the resume, and connect them. Generic praise is worse than no praise.',
  '- Ask for a referral explicitly, and make it easy to say no.',
  '- No buzzwords. Banned: passionate, synergy, leverage, dynamic, rockstar,',
  '  ninja, guru, thrilled, excited to, reach out, circle back, touch base,',
  '  "I hope this email finds you well", "As you can see from my resume".',
  '- No em dashes. No exclamation marks. No emoji.',
  '- Do not invent employers, dates, numbers or facts that are not in the resume.',
  '- Subject line: under 8 words, lowercase, says what the email is.',
  '',
  'Also rewrite three resume bullets so they target THIS job. Keep every number',
  'and fact truthful to the original resume — reframe, never fabricate.',
  '',
  'Answer with JSON only. No prose, no markdown fence:',
  '{"subject": "...", "body": "...", "bullets": ["...", "...", "..."]}',
].join('\n');

function buildDraftPrompt_(job, contact, resume) {
  var recent = (resume.experience || [])[0] || {};
  return [
    'THE JOB',
    'company: ' + (job.company || 'unknown'),
    'role: ' + (job.role || 'unknown'),
    'location: ' + (job.location || 'unspecified'),
    '',
    'job description:',
    String(job.jd || '').slice(0, 6000),
    '',
    'THE PERSON I AM EMAILING',
    'name: ' + (contact.name || 'there'),
    'title: ' + (contact.title || 'unknown'),
    '',
    'ME',
    'name: ' + resume.name,
    'headline: ' + resume.headline,
    'years of experience: ' + resume.years,
    'skills: ' + (resume.skills || []).join(', '),
    'current role: ' + (recent.title || '') + ' at ' + (recent.company || ''),
    '',
    'my resume bullets:',
    (resume.experience || [])
      .map(function (job_) {
        return (job_.bullets || [])
          .map(function (b) { return '- (' + job_.company + ') ' + b; })
          .join('\n');
      })
      .join('\n'),
    '',
    // A hackathon win can be more distinctive than a job bullet, especially to
    // a startup. Offered, not forced — the model picks whichever fits the job.
    (resume.projects || []).length ? 'things i built outside work:' : '',
    (resume.projects || [])
      .map(function (pr) {
        return '- ' + pr.name + ': ' + pr.what + (pr.result ? ' (' + pr.result + ')' : '');
      })
      .join('\n'),
  ].filter(function (line) { return line !== ''; }).join('\n');
}

/**
 * Models wrap JSON in code fences even when told not to, so strip the fence
 * and fall back to the outermost braces before giving up.
 */
function parseJsonLoose_(text) {
  var t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(t);
  } catch (err) {
    var start = t.indexOf('{');
    var end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch (err2) {
        // fall through
      }
    }
    throw new Error('model did not return usable json: ' + t.slice(0, 200));
  }
}

function wordCount_(s) {
  var t = String(s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * payload: { job: {...}, contact: {name, title} }
 * Returns the draft plus which model made it, so the panel can show that.
 */
function draftReferral_(payload) {
  var job = payload.job || {};
  var contact = payload.contact || {};
  if (!job.role && !job.company) throw new Error('job needs at least a role or a company');

  var resume = MASTER_RESUME;
  var out = llmComplete_({
    system: DRAFT_SYSTEM,
    user: buildDraftPrompt_(job, contact, resume),
    maxTokens: 1600,
    temperature: 0.7,
    json: true,
  });

  var parsed = parseJsonLoose_(out.text);

  var subject = String(parsed.subject || '').trim();
  var body = String(parsed.body || '').trim();
  var bullets = (Array.isArray(parsed.bullets) ? parsed.bullets : [])
    .map(function (b) { return String(b).trim(); })
    .filter(Boolean)
    .slice(0, 3);

  if (!subject || !body) throw new Error('model returned a draft with no subject or body');

  var words = wordCount_(body);
  return {
    subject: subject,
    body: body,
    bullets: bullets,
    words: words,
    // Surfaced rather than enforced: a 130-word draft you can trim beats a
    // failed request and another API call.
    overLength: words > 120,
    provider: out.provider,
    model: out.model,
    ms: out.ms,
    draftedAt: new Date().toISOString(),
  };
}
