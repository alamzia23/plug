# plug

find your plug, get the referral.

A personal referral agent: capture a job page, find the right people at that company,
draft a personal referral email + tailored resume, send it from your Gmail after you
approve, and follow up automatically.

Status: **day 2 done — apps script backend + sheet.** Landing site scaffolded in `site/`. Nothing sends mail yet; captured jobs
sync to a Google Sheet you own.

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
   Grant the scopes it asks for. The execution log prints your **sheet url** and your
   **token** — keep the token, you'll need it in step 4. (`showToken()` prints it again.)

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
| `contacts` | day 7 |
| `outreach` | day 4 |
| `settings` | `DRY_RUN` (starts `true`), `TEST_INBOX`, `DAILY_CAP`, caps |

### Testing the backend without deploying

```sh
node backend/test/run.js
```

Runs `Api.gs` / `Sheet.gs` / `Setup.gs` against in-memory stubs of the Apps Script
globals — auth, upsert-by-url, ordering, the 45k JD cap. Zero dependencies.

## Where capture gets its data

| site | how |
| --- | --- |
| linkedin | unified top-card selectors; the collapsed description already holds the full JD |
| naukri | class-*prefix* matching, since naukri hashes the class suffix on every build |
| greenhouse | both generations (`job-boards.` and `boards.`), plus `?for=` on embeds |
| lever | `posting-headline` / `posting-categories`; company from the url path |
| generic | JSON-LD `JobPosting` first (workday, ashby, smartrecruiters, indeed), then opengraph + `h1`, then page title + largest text block |

JD text is whitespace-collapsed and capped at 8000 characters.

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

- No drafting, no email, no people finder. Days 3–7.
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
