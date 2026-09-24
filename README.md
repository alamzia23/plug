# plug

find your plug, get the referral.

A personal referral agent: capture a job page, find the right people at that company,
draft a personal referral email + tailored resume, send it from your Gmail after you
approve, and follow up automatically.

Status: **day 1 — extension skeleton + job capture.** Nothing sends. Nothing leaves your browser.

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

## Where capture gets its data

| site | how |
| --- | --- |
| linkedin | unified top-card selectors; the collapsed description already holds the full JD |
| naukri | class-*prefix* matching, since naukri hashes the class suffix on every build |
| greenhouse | both generations (`job-boards.` and `boards.`), plus `?for=` on embeds |
| lever | `posting-headline` / `posting-categories`; company from the url path |
| generic | JSON-LD `JobPosting` first (workday, ashby, smartrecruiters, indeed), then opengraph + `h1`, then page title + largest text block |

JD text is whitespace-collapsed and capped at 8000 characters.

## Layout

```
extension/
  manifest.json
  background.js          # opens the side panel on icon click
  content/capture.js     # site adapters, injected on demand
  sidepanel/             # index.html, panel.css, panel.js
  assets/                # icons
backend/                 # apps script — day 2
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

- No backend, no sheet, no drafting, no sending. Days 2–4.
- `host_permissions` is `<all_urls>` so capture works on any job board without a
  permission prompt mid-flow. Narrow it once the site list settles.
- LinkedIn and Naukri obfuscate/rotate class names, and neither was testable without a
  login. Selectors are best-effort with fallbacks; when a field comes back empty, edit it
  in the card and file the selector.
- Pages that render the JD only after a click (some Workday tabs) capture short.
- Fonts are system serif/mono stacks for now, not Instrument Serif / JetBrains Mono.
