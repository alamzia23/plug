# plug

A personal job-referral agent. Capture any job posting, find the right people at that
company, draft a referral email in your voice, and send it from your own Gmail after you
approve it. Follows up on a schedule and stops the moment someone replies.

Chrome extension + Google Apps Script + a Google Sheet as the database. No server.

> **Demo:** _(GIF/video link goes here)_

## How it works

**Job capture.** Click the extension on a posting and it extracts company, role, location
and the full description. Five adapters — LinkedIn, Naukri, Greenhouse, Lever, and a
generic one that reads JSON-LD `JobPosting` first (Workday, Ashby, SmartRecruiters,
Indeed) before falling back to OpenGraph and page structure.

**Referrer shortlist.** It resolves the employer's domain, queries a people directory
filtered to the role's department, and picks **three deliberately different people**
rather than the three highest scores:

| | reply rate | payoff |
| --- | --- | --- |
| **peer**, same function | highest | a ninety-second favour with a referral bonus attached |
| **senior**, same function | lower | their referral carries the most weight |
| **recruiter** | dependable | paid to reply, least incentive to champion you |

Three peers is one bet placed three times. Ranking favours a shared school, then
same-function overlap, then connection degree, and penalises VP-and-above — a VP
forwarding you to a recruiter is worth less than a peer clicking refer.

**Message drafting.** A referral email under 120 words, tied to one specific thing in the
job description and one in your resume. Plus three resume bullets rewritten for that role,
and a LinkedIn connection note under 280 characters that you send yourself.

**Sending.** Approval-gated, from your own Gmail. `DRY_RUN` is on by default: every email
goes to your own inbox with the real recipient in the subject as
`[DRY RUN → someone@company.com]`, so a mistake is something you see rather than something
a stranger receives. Every send is logged with both where it went and where it would have
gone.

**Follow-ups.** A daily trigger checks each thread. No reply after 3 days sends one nudge,
7 days a second and final one, 14 days marks it ghosted. A reply ends the sequence
immediately. Nudges reply inside the original thread, never as a new email.

## Design principles

- **Nothing sends without a human click.** A live send takes two — one to arm, one to
  confirm — and names the recipient before it fires.
- **The extension only reads pages.** It never sends a LinkedIn message or connection
  request. A connection request from a script is one you didn't write.
- **No secrets in the extension or in git.** Keys live in Apps Script Script Properties.
  The extension holds only the web app URL and a shared token, in browser storage.
- **Provider-neutral LLM layer.** Gemini, Anthropic and OpenAI behind one interface;
  switching is two settings. Adding one is a single entry in a map.
- **Guesses are labelled as guesses.** A pattern-derived email address is marked
  `unverified` and refused on a live send unless you explicitly override it.

## Tech stack

| | |
| --- | --- |
| extension | Manifest V3, plain HTML/CSS/JS, no framework, no build step |
| backend | Google Apps Script, deployed as a web app, developed with `clasp` |
| database | one Google Sheet — `jobs`, `contacts`, `outreach`, `settings` |
| mail | GmailApp, sending as you |
| LLM | Gemini · Anthropic · OpenAI, swappable |
| addresses | MX check over DNS-over-HTTPS (free), plus an optional verifier |
| site | Astro, static |

## Setup

```sh
npm i -g @google/clasp
clasp login
cd backend
clasp create-script --type standalone --title "plug backend"
clasp push
```

1. In the Apps Script editor, run **`setUp`**. It creates the Sheet, generates a token and
   seeds the settings. The token is in **Project Settings → Script Properties →
   `PLUG_TOKEN`** — deliberately not logged.
2. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*.
   "Anyone" is required because the extension has no Google identity; the token is what
   guards the endpoint.
3. Set your keys in **Script Properties**. See [`.env.example`](.env.example) for the full
   list and what each one does.
4. Load `extension/` unpacked at `chrome://extensions` (Developer mode on).
5. Open the side panel, paste the `/exec` URL and the token, hit **save + test**.
6. Replace the demo resume in `backend/Resume.gs` with your own — edit it in the Apps
   Script editor so it stays out of version control.

Re-running `setUp()` is safe; it never replaces an existing Sheet or token.

## Tests

```sh
node backend/test/run.js
```

273 tests, zero dependencies. The Apps Script globals — `SpreadsheetApp`, `GmailApp`,
`UrlFetchApp`, `ScriptApp`, `PropertiesService` — are replaced with in-memory stubs, so
the whole backend runs locally and no test ever sends mail or calls a provider.

Covers auth, upsert-by-url, per-provider request shapes, truncation, the dry-run redirect
and subject prefix, the daily cap, the follow-up cadence at every boundary, address
pattern generation and verification statuses, and the referrer slate.

## Status

Working end to end, verified against live pages: job capture (Greenhouse, Lever, Ashby,
generic careers sites), referrer lookup and ranking, address finding, drafting, and
sending in dry run.

Honest gaps:

- **The LinkedIn adapters are untested on a live logged-in page.** Both job capture and
  people reading have LinkedIn paths that need a signed-in session. They're written
  defensively with fallbacks, but they have never run for real.
- **The follow-up cadence has not run across real days.** Every boundary is unit-tested —
  day 3, day 7, day 14, replies stopping the sequence, the cap applying to nudges — but
  the trigger has not yet been observed over a genuine week.
- **Address finding is guesswork unless a verifier is configured.** The free MX check can
  only prove a domain accepts no mail; confirming a specific mailbox needs an API key.

## Licence

MIT.
