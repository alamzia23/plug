# plug

find your plug, get the referral.

A personal referral agent: capture a job page, find the right people at that company,
draft a personal referral email + tailored resume, send it from your Gmail after you
approve, and follow up automatically.

Status: **all 7 days built.** Every email goes to your own test inbox until you turn
`DRY_RUN` off in the Sheet yourself.

## Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → pick the `extension/` folder in this repo.
4. Pin **plug** to the toolbar. Clicking the icon opens the side panel.

Requires Chrome 116+ (`sidePanel` API).

## Use it

Open a job posting, click the plug icon, hit **capture this job**.

Captured jobs are stored in `chrome.storage.local` and shown as ticket cards.
`company`, `role` and `where` are editable inline — edits save on blur. When a field
comes back empty the card is tagged `check fields` so a drifted selector is visible
rather than silent.

## Set up the backend (day 2)

You need this once. It takes about five minutes.

1. Create the Apps Script project and push the code:

   ```sh
   npm i -g @google/clasp
   clasp login
   cd backend
   clasp create --type standalone --title "plug backend"   # writes .clasp.json (gitignored)
   clasp push
   ```

   No clasp? Make a project at <https://script.google.com>, then paste in
   `Api.gs`, `Sheet.gs` and `Setup.gs` by hand.

2. In the Apps Script editor, pick **setUp** in the function dropdown and hit **Run**.
   Grant the scopes it asks for. The execution log prints your **sheet url**; the token
   is in **Project Settings → Script Properties → `PLUG_TOKEN`**. It is deliberately not
   logged — execution logs get pasted into chat and screenshots, and that token is the
   only thing guarding a public endpoint. `rotateToken()` replaces it if it leaks.

3. **Deploy → New deployment → Web app**, with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**

   Copy the `/exec` url. "Anyone" is required because the extension has no Google
   identity; the token is what actually guards the endpoint.

4. In the side panel, open **backend**, paste the `/exec` url and the token, and hit
   **save + test**. It should say `connected. dry run is on.`

Re-running `setUp()` is safe: it never replaces an existing sheet or token.

### What lands in the Sheet

Four tabs, created by `setUp()`. The header row *is* the schema — reads and writes map
column names to object keys, so adding a column later won't break old rows.

| tab | holds |
| --- | --- |
| `jobs` | one row per captured posting, upserted by url |
| `contacts` | people found for a job |
| `outreach` | one row per send, with `dry_run` and `real_to` |
| `settings` | `DRY_RUN` (starts `true`), `TEST_INBOX`, `DAILY_CAP`, caps |

### Testing the backend without deploying

```sh
node backend/test/run.js
```

Runs every `.gs` file against in-memory stubs of the Apps Script globals — auth,
upsert-by-url, ordering, the 45k JD cap, column migration, per-provider request shapes,
error paths, and JSON parsing. `UrlFetchApp` is scripted per test, so no provider is ever
actually called. Zero dependencies.

## Where capture gets its data

| site | how |
| --- | --- |
| linkedin | unified top-card selectors; the collapsed description already holds the full JD |
| naukri | class-*prefix* matching, since naukri hashes the class suffix on every build |
| greenhouse | both generations (`job-boards.` and `boards.`), plus `?for=` on embeds |
| lever | `posting-headline` / `posting-categories`; company from the url path |
| generic | JSON-LD `JobPosting` first (workday, ashby, smartrecruiters, indeed), then opengraph + `h1`, then page title + largest text block |

JD text is whitespace-collapsed and capped at 8000 characters.

## Drafting (day 3)

The LLM layer is **provider-neutral**. `Llm.gs` builds prompts and parses answers;
`Providers.gs` owns every provider-specific detail — url, auth header, body shape, where
the text lives in the reply. Nothing above `Providers.gs` knows which model answered.

| Script Property | values | default |
| --- | --- | --- |
| `LLM_PROVIDER` | `gemini` · `anthropic` · `openai` | `gemini` |
| `LLM_API_KEY` | that provider's key | — |
| `LLM_MODEL` | optional override | per-provider default |

Switching providers is two properties. Adding one is a single entry in `PROVIDERS` — no
prompt or caller changes. Gemini is the default only because of its free tier and the ₹0
target, not because anything is coupled to it.

One call returns the email and the tailored bullets together. The panel shows the draft
with subject, body and three bullets all editable, a live word count, which model wrote
it, and a **regenerate** button. Edits are kept — regenerate is explicit.

Model replies get parsed leniently (bare JSON, fenced JSON, or JSON with chatter around
it), because every provider ignores "no markdown fence" eventually.

## Sending (day 4)

Everything funnels through one function, `sendReferral_()` in `Mail.gs`. There is no
other path to Gmail, so `DRY_RUN` and the daily cap cannot be bypassed by a caller.

**While `DRY_RUN` is `true`** (the default, seeded by `setUp()`): every message goes to
`TEST_INBOX` and the real recipient is written into the subject —

```
[DRY RUN → priya@ramp.com] referral for the frontend role?
```

so a mistake lands in your own inbox, visibly, instead of on a stranger.

**Guards.** A live send refuses a missing address, a malformed address, or one marked
`unverified` unless you explicitly override. The daily cap (`DAILY_CAP`, default 25)
counts dry runs too, because they spend the same Gmail quota.

**The button says what it will do.** `send · dry run` next to a note naming your test
inbox, or `send for real` in the accent colour with the actual recipient. A live send
takes two clicks — one to arm, one to confirm, auto-disarming after six seconds. A dry
run takes one, because the worst case is mail to yourself.

Every send is logged to the `outreach` tab with both `to_email` (where it actually
went) and `real_to` (where it would have gone), plus a `dry_run` column — so reading
the Sheet can never leave you unsure whether something was a test.

### The Gmail scope

`appsscript.json` asks for `https://mail.google.com/`, which is **full mailbox access**.
That's needed because `GmailApp` has to search sent mail to capture a thread id, which
day 6 uses to detect replies. The narrower `script.send_mail` would send fine but makes
reply detection — and therefore follow-ups — impossible.

## Finding an address (day 5)

`EmailFinder.gs` guesses, and the code is honest that it's guessing.

**Domain.** If the posting is on the employer's own site, the domain comes from the url
(`careers.acme.com` → `acme.com`). If it's on an ATS — greenhouse, lever, linkedin,
naukri and a dozen others are recognised — the url tells you nothing, so it slugs the
company name (`Acme Technologies Pvt Ltd` → `acme`) and probes `.com`, `.io`, `.co`,
`.ai`, stopping at the first that answers. Capped at four probes.

**Patterns**, most common first: `first.last`, `first`, `firstlast`, `f.last`, `flast`,
`first_last`. Titles (`Dr.`) and suffixes (`PhD`) are stripped, since neither appears in
an address.

**Verification happens in two layers.**

*Free, always on, no signup:* an MX lookup over DNS-over-HTTPS (`dns.google`). Apps
Script has no sockets so a real SMTP probe is impossible, but a domain with no MX
records cannot receive mail from anyone — which makes every pattern guess against it
wrong. That's the most common way address guessing fails and it costs nothing to rule
out. A failed lookup returns `unknown`, never `no`: "the lookup broke" must not be
mistaken for "this domain rejects mail".

*Optional, needs a key:* a mailbox check, and the only thing that can return
`verified`. The adapters live in a `VERIFIERS` map with the same shape as the LLM
providers — nothing above it knows which service answered.

| Script Property | values |
| --- | --- |
| `VERIFIER` | `abstract` · `mailboxlayer` · `hunter` |
| `VERIFIER_API_KEY` | that service's key |

**With Hunter, it asks instead of guessing.** Hunter's Email Finder returns the
person's actual address with a confidence score, derived from addresses it has observed
on that domain — so it knows the company's real pattern rather than assuming the most
common one. A score of 90+ counts as `verified`; below that the address still ranks
first but is explicitly not a verification. If Hunter doesn't know them, it falls back
to guessing and verifies the top guess. Either way it's one API call.

**Hunter refuses free email addresses at signup**, so on a Gmail-only account use
`abstract` ([app.abstractapi.com](https://app.abstractapi.com), 100/month free) or
`mailboxlayer`. Skipping it entirely is fine too — you just confirm each live send.

Only the top candidate is checked, because free tiers are small and six checks per
person would empty one in four contacts. A maybe is always `unverified`: catch-all
domains, greylisting and rate limits all look like uncertainty, and none of them are
permission to email a stranger.

**The gate.** `Mail.gs` refuses to send to an `unverified` address on a live send
without an explicit override. Typing an address by hand counts as vouching for it.
A confident wrong address is worse than none: it bounces, or it reaches a stranger.

The override lives in the arming click. A live send always takes two clicks, and when
the address is a guess the first click says so — *"that address is a guess — send
anyway?"*. Confirming is the override. There's no separate checkbox to overlook, and no
path to a guessed address that doesn't pass through being told it's a guess.

**Hunter rejects free email addresses at signup**, so if you only have a Gmail account
you can't get a key. That's fine: skip it, everything stays `unverified`, and you
confirm each live send. Verification is a convenience, not a dependency.

## Replies and follow-ups (day 6)

A daily trigger (`dailyReplyCheck`, ~9am) walks the `outreach` log:

- **someone who isn't you replied** → status `replied`, and it never nudges again
- **3 days of silence** → one nudge
- **7 days** → the second and final one, which says it's the last
- **14 days** → `ghosted`

Two nudges is the ceiling. That's where the curve flattens: the first recovers the
emails that were simply missed, the second catches the genuinely busy, and a third only
reaches people who have already decided.

**Follow-ups reply inside the original thread**, never as a new email. A new email makes
the recipient rebuild the context and reads like a third stranger rather than a second
nudge.

**Reply detection degrades rather than failing.** `thread_id` is the reliable route, but
Gmail sometimes hasn't indexed a just-sent message when we look for it, so a missing id
falls back to a subject search. On a dry run every message is from you, so there the
signal is simply that the thread grew — which keeps follow-ups testable without
pretending a test is a real reply.

Nudges count against `DAILY_CAP` like any other send. Running the check twice in a day
changes nothing the second time; every decision comes from the sheet.

### Setting up the trigger

Run **`installDailyTrigger`** once from the Apps Script editor. It clears its own old
trigger first, so running it again never stacks duplicates. `removeDailyTrigger()`
turns it off.

The panel shows a tracker: a streak, a count per status, and a warning when the trigger
isn't installed.

## Finding the right person (day 7)

**With Hunter configured it finds people on its own.** `findPeople` resolves the
company's domain and asks Hunter's Domain Search who works there — names, titles and
addresses, no page to open and no LinkedIn involved. Addresses come back attached, so
the `find` step is already done.

**It asks for the right people, not just any people.** The request carries a
`department` derived from the job title (`DevOps Engineer` → `it`) and
`seniority=junior,senior`, which omits executives. Without those filters a DevOps
search came back with a Workplace Services Partner, a Director of Talent Acquisition
and a Director of Data & AI — ranking can't rescue a candidate list with no engineers
in it. When the best available person still isn't a good ask, the panel says so rather
than presenting three weak options as a shortlist.

**Hunter charges one credit per revealed address**, not per company. A free plan is
about 50 a month, so a lookup asking for 25 people could cost half a month in one
click — and only `MAX_CONTACTS_PER_JOB` of them ever get used. `DIRECTORY_LIMIT`
(default 10) caps it; lower it to 5 if you're rationing.

**The domain often isn't the one in the url.** A job on `careers.capgemini.com` can be
a Sogeti role, and `sogeti.com` is where those people are listed. When the directory
comes back empty the panel offers a domain field, and a correction that works is
remembered for that job.

When there's no key, nobody listed, or the quota is spent, it falls back to reading
whatever page you have open:

`content/people.js` reads whoever is already visible on the page — a LinkedIn people
search, a LinkedIn job page's "people you can reach out to", or a Google
`site:linkedin.com/in` search. It is anchored on `/in/` profile links rather than class
names, because LinkedIn rewrites its markup constantly and every `/in/` link is a person.

**It only reads.** It never opens a profile, never sends a message, and never sends a
connection request. A connection request from a script is one you didn't write.

`People.gs` ranks them, because ranking needs the resume and the resume shouldn't be
shipped to the browser:

| signal | weight | why |
| --- | --- | --- |
| shared school | +50 | the strongest opener a stranger has |
| same function | +30 and up | they can judge whether the work matches; a recruiter can't |
| 1st / 2nd degree | +35 / +20 | a warm path |
| recruiter | +10 | last, not first — they get the most of these and have the least incentive |
| VP and above | −15 | a VP forwarding you to a recruiter is worth less than a peer clicking refer |

Job titles say the same thing many ways, so matching runs over synonym groups:
`developer` ≈ `engineer`, `sre` ≈ `devops` ≈ `platform`. Without that, a Senior Software
Developer scores "no strong signal" against a DevOps Engineer role, which is a failure
of vocabulary rather than judgement.

### The shortlist is a portfolio, not a top three

Picking the three highest scores tends to return three similar people — and three peers
is one bet placed three times. The slate takes **one of each kind** before a second of
any:

| kind | reply rate | payoff |
| --- | --- | --- |
| **peer**, same function | highest | medium — a ninety-second favour with a bonus attached |
| **senior**, same function | lower | highest — their referral carries weight |
| **recruiter** | dependable | lowest — paid to reply, least incentive to champion you |

"Senior", "Staff" and "Principal" are individual-contributor levels, not leadership —
a Senior Software Developer is the archetypal peer and the best single person to ask.
Only `lead`, `manager`, `head`, `director` and above count as senior.

Recruiters live in HR, so the budget is **split across two requests** — most of it to
the role's own department, one or two to `hr`. Asking for `it,hr` in a single request
let HR dominate: a DevOps search returned one engineer and two HR managers. Credits are
per address, not per call, so two targeted requests cost exactly the same and guarantee
the composition. At most one recruiter ever reaches the slate — a second is an ask spent
on someone who can't refer you either way.

If a company has nobody of a given kind, the slot is filled by score rather than left
empty. Capped at `MAX_CONTACTS_PER_JOB` (3) — three asks at one company is the limit
before it reads as a mailshot.

Picking someone generates a **LinkedIn connection note** under 280 characters, which you
copy and send yourself. It deliberately doesn't ask for the referral — the note is to
connect; the ask comes after.

## End-to-end, in dry run

The whole loop, with nothing able to reach a stranger:

1. Open a job posting → **capture this job**
2. Open a LinkedIn or Google people search for that company → **who?** → pick someone
3. Copy the connection note if you want it; send it yourself
4. **find** → resolves their work address, with a status
5. **write the email** → a referral ask under 120 words, tied to the JD and your resume
6. Edit anything. **send · dry run** → lands in your own inbox, subject prefixed
   `[DRY RUN → their@address]`
7. Check the `outreach` tab: `dry_run` is `true`, `to_email` is you, `real_to` is them
8. Reply to that email yourself → next morning the trigger marks it `replied`

To go live, set `DRY_RUN` to `false` in the `settings` tab. Nothing else changes.

## The site (`site/`)

The public landing page and blog, built with **Astro 5** — static output, zero JS by
default. SEO applies here and nowhere else in the project: a Chrome extension's pages
live at `chrome-extension://…` and cannot be crawled.

```sh
cd site
npm install
npm run dev      # localhost:4321
npm run build    # -> site/dist
```

**Before deploying, set `url` in `src/consts.ts`.** Canonical tags and the sitemap are
built from it; it currently points at a placeholder domain.

What's wired up: a unique title + hand-written meta description per page, canonical tags
that match the sitemap exactly, `SoftwareApplication` / `BlogPosting` JSON-LD, OpenGraph
with a 1200×630 image, `robots.txt`, `@astrojs/sitemap`, and `noindex` on the 404. Total
JS shipped: one 4KB prefetch script.

Deploy target is Cloudflare Pages or Netlify — build `npm run build`, publish `dist`.

## Layout

```
extension/
  manifest.json
  background.js          # opens the side panel on icon click
  content/capture.js     # site adapters, injected on demand
  sidepanel/             # index.html, panel.css, panel.js
  assets/                # icons
site/                    # astro landing page + blog (the only crawlable surface)
backend/
  appsscript.json        # web app manifest (execute as me, access anyone)
  Api.gs                 # doPost router + shared-token auth
  Sheet.gs               # the Sheet as a database
  Providers.gs           # gemini | anthropic | openai, behind one call
  Mail.gs                # the only path to gmail: dry run, caps, outreach log
  EmailFinder.gs         # domain + pattern guessing, optional verification
  Followups.gs           # daily reply check, nudges, ghosting, tracker
  People.gs              # rank who to ask, write the connection note
  Llm.gs                 # provider-neutral prompts + parsing
  Resume.gs              # dummy master resume
  Setup.gs               # setUp(): makes the sheet, token and defaults
  test/                  # node stubs — run the .gs logic without deploying
```

## What's been verified against live pages

Selectors were run against real postings, not guessed:

- **lever** — `jobs.lever.co/leverdemo/…`: role, location, JD all resolved.
- **greenhouse** — `job-boards.greenhouse.io/anthropic/jobs/…`: role, location, JD all resolved;
  company falls back to the url slug, which is correct there.
- **generic / JSON-LD** — `jobs.ashbyhq.com/ramp/…`: `JobPosting` parsed; role, company,
  location and a 6.8k-char tag-free, entity-decoded JD.

**linkedin and naukri are untested** — both need a logged-in session, so they are yours to check.

## Known gaps (day 1)

- The master resume in `backend/Resume.gs` is still dummy data. Swap it for yours.
- The contact is dummy data (`priya raman`), editable per card, until the people finder
  lands on day 7.
- Drafts live in `chrome.storage.local`, not the Sheet. Day 4 logs sends to `outreach`.
- `listJobs` exists on the backend but the panel never calls it — the panel is still
  the source of truth and pushes one way. Two-way sync isn't needed until there's a
  second client.
- `host_permissions` is `<all_urls>` so capture works on any job board without a
  permission prompt mid-flow. Narrow it once the site list settles.
- LinkedIn and Naukri obfuscate/rotate class names, and neither was testable without a
  login. Selectors are best-effort with fallbacks; when a field comes back empty, edit it
  in the card and file the selector.
- Pages that render the JD only after a click (some Workday tabs) capture short.
- Fonts are system serif/mono stacks for now, not Instrument Serif / JetBrains Mono.
