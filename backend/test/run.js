require("./stub.js");

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name, extra !== undefined ? JSON.stringify(extra) : ""); }
};
const post = (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } })._t);

console.log("\nsetUp()");
logged.length = 0;
const cfg = setUp();
const TOKEN_AFTER_SETUP = PropertiesService.getScriptProperties().getProperty("PLUG_TOKEN");
check("returns a sheet id", !!cfg.sheetId);
check("confirms a token was made without returning it", cfg.tokenSet === true && cfg.token === undefined, cfg);
check("token never reaches the execution log", !logged.some((l) => String(l).includes(PropertiesService.getScriptProperties().getProperty("PLUG_TOKEN"))), logged);
check("all four tabs exist", ["jobs","contacts","outreach","settings"].every(t => !!ss_().getSheetByName(t)));
check("Sheet1 removed", !ss_().getSheetByName("Sheet1"));
check("DRY_RUN defaults on", getSetting_("DRY_RUN") === "true");
const rerun = setUp();
check("re-running keeps the same token", PropertiesService.getScriptProperties().getProperty("PLUG_TOKEN") === TOKEN_AFTER_SETUP);
check("re-running keeps the same sheet", rerun.sheetId === cfg.sheetId);

const TOKEN = TOKEN_AFTER_SETUP;

console.log("\nauth");
check("no token rejected", post({ action: "ping" }).error === "bad token");
check("wrong token rejected", post({ action: "ping", token: "x".repeat(TOKEN.length) }).error === "bad token");
check("right-length wrong token rejected", post({ action: "ping", token: TOKEN.slice(0,-1) + (TOKEN.slice(-1)==="a"?"b":"a") }).error === "bad token");
check("good token accepted", post({ action: "ping", token: TOKEN }).ok === true);
check("unknown action rejected", /unknown action/.test(post({ action: "nope", token: TOKEN }).error));
check("bad json rejected", JSON.parse(doPost({ postData: { contents: "{{" } })._t).error === "body is not json");
check("empty body rejected", JSON.parse(doPost({})._t).error === "empty request");

console.log("\nsaveJob");
const job = { company:"Ramp", role:"AI Solutions Strategist", location:"new york city, ny",
  url:"https://jobs.ashbyhq.com/ramp/abc", source:"generic", jd:"x".repeat(200),
  confidence:"high", capturedAt:"2026-09-24T10:00:00.000Z" };
const r1 = post({ action:"saveJob", token:TOKEN, payload:{ job } });
check("saved", r1.ok && r1.data.created === true, r1);
const savedId = r1.data.id;

const r2 = post({ action:"saveJob", token:TOKEN, payload:{ job: { ...job, role:"Solutions Strategist" } } });
check("same url updates, not duplicates", r2.data.created === false && r2.data.id === savedId, r2.data);
check("only one row on the jobs tab", readAll_("jobs").length === 1, readAll_("jobs").length);
check("role actually updated", readAll_("jobs")[0].role === "Solutions Strategist");
check("captured_at preserved on update", readAll_("jobs")[0].captured_at === "2026-09-24T10:00:00.000Z");
check("updated_at moved", readAll_("jobs")[0].updated_at !== "2026-09-24T10:00:00.000Z");
check("status defaults to draft", readAll_("jobs")[0].status === "draft");

const noUrl = post({ action:"saveJob", token:TOKEN, payload:{ job: { company:"x" } } });
check("url is required", noUrl.ok === false && /url is required/.test(noUrl.error), noUrl);

console.log("\nsaveJobs batch + listJobs");
const batch = post({ action:"saveJobs", token:TOKEN, payload:{ jobs: [
  { url:"https://a.com/1", role:"a", capturedAt:"2026-09-23T10:00:00.000Z" },
  { url:"https://b.com/2", role:"b", capturedAt:"2026-09-25T10:00:00.000Z" },
]}});
check("batch returns one result per job", batch.data.length === 2, batch);
const list = post({ action:"listJobs", token:TOKEN, payload:{ limit: 10 } }).data;
check("lists all three", list.length === 3, list.length);
check("newest first", list[0].url === "https://b.com/2", list.map(j=>j.url));
check("no _row leaks to the client", list.every(j => j._row === undefined));
check("limit respected", post({ action:"listJobs", token:TOKEN, payload:{ limit: 1 } }).data.length === 1);

console.log("\njd cap");
post({ action:"saveJob", token:TOKEN, payload:{ job: { url:"https://big.com/1", jd:"y".repeat(60000) } } });
check("jd truncated below the 50k cell limit",
  readAll_("jobs").find(j=>j.url==="https://big.com/1").jd.length === 45000);

console.log("\ncolumn migration");
{
  // Simulate a later day adding a column to a sheet that already has rows.
  SCHEMAS.jobs.push("draft_subject");
  const before = readAll_("jobs").length;
  tab_("jobs"); // triggers the migration
  check("new column appended to header", headers_(tab_("jobs")).includes("draft_subject"));
  check("existing rows survive", readAll_("jobs").length === before);

  // The bug this guards: writes must follow the SHEET's column order, not the
  // schema's, or an appended column shifts every value one place.
  post({ action: "saveJob", token: TOKEN, payload: { job: {
    url: "https://after-migration.com/1", company: "Acme", role: "Engineer", jd: "z".repeat(120) } } });
  const row = readAll_("jobs").find((j) => j.url === "https://after-migration.com/1");
  check("company lands in the company column", row.company === "Acme", row.company);
  check("role lands in the role column", row.role === "Engineer", row.role);
  check("url lands in the url column", row.url === "https://after-migration.com/1");
  SCHEMAS.jobs.pop();
}

console.log("\nprovider routing");
const P = PropertiesService.getScriptProperties();
const geminiOk = { candidates: [{ content: { parts: [{ text: '{"subject":"referral for the frontend role?","body":"Hi Priya, I saw the posting.","bullets":["a","b","c"]}' }] } }] };

{
  P.setProperty("LLM_API_KEY", "test-key");
  P.setProperty("LLM_PROVIDER", "gemini");
  __resetFetch(); __queueFetch({ body: geminiOk });
  const d = post({ action: "draftEmail", token: TOKEN, payload: {
    job: { company: "Ramp", role: "Frontend Engineer", jd: "React, design systems" },
    contact: { name: "Priya", title: "EM" } } });
  check("gemini draft succeeds", d.ok === true, d);
  check("reports provider", d.data.provider === "gemini");
  check("reports model", d.data.model === "gemini-2.5-flash", d.data.model);
  check("subject parsed", d.data.subject.startsWith("referral"));
  check("3 bullets", d.data.bullets.length === 3);
  check("word count computed", d.data.words === 6, d.data.words);
  check("provider call is timed", typeof d.data.ms === "number" && d.data.ms >= 0, d.data.ms);
  const call = __fetchLog[0];
  check("gemini key goes in the query string", call.url.includes("key=test-key"));
  check("gemini gets systemInstruction", !!call.body.systemInstruction);
  check("gemini json mode on", call.body.generationConfig.responseMimeType === "application/json");
}

{
  P.setProperty("LLM_PROVIDER", "anthropic");
  __resetFetch();
  __queueFetch({ body: { content: [{ type: "text", text: '{"subject":"s","body":"b","bullets":["x"]}' }] } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "Engineer" }, contact: {} } });
  check("anthropic draft succeeds", d.ok === true, d);
  check("anthropic default model", d.data.model === "claude-opus-5", d.data.model);
  const call = __fetchLog[0];
  check("anthropic auth header", call.params.headers["x-api-key"] === "test-key");
  check("anthropic version header", call.params.headers["anthropic-version"] === "2023-06-01");
  check("anthropic system is top-level", typeof call.body.system === "string" && call.body.system.length > 0);
  check("anthropic budgets for thinking tokens too", call.body.max_tokens === 8000, call.body.max_tokens);
  check("no prefill assistant turn", call.body.messages.every((m) => m.role !== "assistant"));
}

{
  P.setProperty("LLM_PROVIDER", "openai");
  __resetFetch();
  __queueFetch({ body: { choices: [{ message: { content: '{"subject":"s","body":"b","bullets":[]}' } }] } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "Engineer" }, contact: {} } });
  check("openai draft succeeds", d.ok === true, d);
  const call = __fetchLog[0];
  check("openai bearer auth", call.params.headers.Authorization === "Bearer test-key");
  check("openai system as a message", call.body.messages[0].role === "system");
  check("openai json mode on", call.body.response_format.type === "json_object");
}

{
  P.setProperty("LLM_MODEL", "some-other-model");
  __resetFetch(); __queueFetch({ body: { choices: [{ message: { content: '{"subject":"s","body":"b"}' } }] } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("LLM_MODEL overrides the default", d.data.model === "some-other-model", d.data.model);
  P.setProperty("LLM_MODEL", "");
}

console.log("\nprovider failures");
{
  P.setProperty("LLM_PROVIDER", "nope");
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("unknown provider is named in the error", /unknown LLM_PROVIDER/.test(d.error), d.error);
  P.setProperty("LLM_PROVIDER", "gemini");
}
{
  __resetFetch(); __queueFetch({ code: 429, body: { error: { message: "rate limit hit" } } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("http error surfaces provider message", /429/.test(d.error) && /rate limit hit/.test(d.error), d.error);
}
{
  __resetFetch(); __queueFetch({ body: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("truncated reply is an error, not a bad draft", /token cap/.test(d.error), d.error);
}
{
  __resetFetch(); __queueFetch({ body: { candidates: [{ content: { parts: [{ text: "sorry, here you go: not json" }] } }] } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("unparseable reply is an error", /usable json/.test(d.error), d.error);
}
{
  P.setProperty("LLM_API_KEY", "");
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("missing key is a clear error", /LLM_API_KEY/.test(d.error), d.error);
  P.setProperty("LLM_API_KEY", "test-key");
}
{
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: {}, contact: {} } });
  check("empty job rejected before any api call", /role or a company/.test(d.error), d.error);
}

console.log("\ntruncation");
{
  P.setProperty("LLM_PROVIDER", "anthropic");
  __resetFetch();
  __queueFetch({ body: { stop_reason: "max_tokens", content: [{ type: "text", text: '{"subject":"s","body":"hi pri' }] } });
  const d = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("anthropic truncation names the cause", /cut off at the token cap/.test(d.error), d.error);

  __resetFetch();
  __queueFetch({ body: { content: [{ type: "text", text: '{"subject":"s","body":"b","bullets":[]}' }] } });
  post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("thinking gets budget headroom", __fetchLog[0].body.max_tokens >= 8000, __fetchLog[0].body.max_tokens);

  P.setProperty("LLM_PROVIDER", "openai");
  __resetFetch();
  __queueFetch({ body: { choices: [{ finish_reason: "length", message: { content: '{"subject":"s","body":"cut' } }] } });
  const o = post({ action: "draftEmail", token: TOKEN, payload: { job: { role: "E" }, contact: {} } });
  check("openai truncation names the cause", /cut off at the token cap/.test(o.error), o.error);
  P.setProperty("LLM_PROVIDER", "gemini");
}

console.log("\njson tolerance");
check("bare json", parseJsonLoose_('{"a":1}').a === 1);
check("fenced json", parseJsonLoose_('```json\n{"a":2}\n```').a === 2);
check("unlabelled fence", parseJsonLoose_('```\n{"a":3}\n```').a === 3);
check("json with chatter around it", parseJsonLoose_('Sure!\n{"a":4}\nHope that helps').a === 4);

console.log("\nprompt content");
{
  __resetFetch(); __queueFetch({ body: geminiOk });
  post({ action: "draftEmail", token: TOKEN, payload: {
    job: { company: "Ramp", role: "Frontend Engineer", jd: "x".repeat(9000) },
    contact: { name: "Priya", title: "EM" } } });
  const body = __fetchLog[0].body;
  const user = body.contents[0].parts[0].text;
  const system = body.systemInstruction.parts[0].text;
  check("jd truncated into the prompt", user.length < 8000, user.length);
  check("contact name in prompt", user.includes("Priya"));
  check("resume name in prompt", user.includes(MASTER_RESUME.name));
  check("resume bullets in prompt", user.includes("design system"));
  check("word limit stated", /UNDER 120 words/.test(system));
  check("buzzwords banned", /synergy/.test(system));
}

console.log("\nllmInfo");
{
  const info = post({ action: "llmInfo", token: TOKEN, payload: {} }).data;
  check("reports configured provider", info.provider === "gemini");
  check("reports key is set without leaking it", info.keySet === true && !JSON.stringify(info).includes("test-key"));
}

console.log("\nsending — dry run");
const draft = { subject: "referral for the frontend role?", body: "Hi Priya, short and human." };
const realContact = { name: "Priya", title: "EM", email: "priya@ramp.com" };
{
  __resetSent();
  const r = post({ action: "sendEmail", token: TOKEN, payload: {
    job: { id: "job-1", company: "Ramp" }, contact: realContact, ...draft } });
  check("send succeeds", r.ok === true, r);
  check("reports it was a dry run", r.data.dryRun === true);
  check("went to TEST_INBOX, not the contact", __sent[0].to === getSetting_("TEST_INBOX"), __sent[0].to);
  check("never reached the real address", __sent[0].to !== "priya@ramp.com");
  check("real recipient is in the subject", __sent[0].subject.startsWith("[DRY RUN → priya@ramp.com] "), __sent[0].subject);
  check("original subject preserved after the prefix", __sent[0].subject.endsWith(draft.subject));
  check("body sent unchanged", __sent[0].body === draft.body);
  check("sends plain text, not html", !__sent[0].opts.htmlBody);
}

console.log("\nsending — outreach log");
{
  const row = readAll_("outreach").slice(-1)[0];
  check("logged to the outreach tab", !!row, row);
  check("dry_run recorded as true", String(row.dry_run) === "true", row.dry_run);
  check("real_to kept alongside the redirect", row.real_to === "priya@ramp.com", row.real_to);
  check("to_email is where it actually went", row.to_email === getSetting_("TEST_INBOX"));
  check("status sent", row.status === "sent");
  check("thread id captured for day 6", !!row.thread_id, row.thread_id);
  check("job id linked", row.job_id === "job-1");
}

console.log("\nsending — guards");
{
  const noDraft = post({ action: "sendEmail", token: TOKEN, payload: { job: {}, contact: realContact, subject: "", body: "" } });
  check("refuses to send an empty draft", /draft the email first/.test(noDraft.error), noDraft.error);
}
{
  // dry run tolerates a missing address; a live send must not
  __resetSent();
  const r = post({ action: "sendEmail", token: TOKEN, payload: { job: {}, contact: { name: "x" }, ...draft } });
  check("dry run works without a recipient", r.ok === true, r);
  check("subject says there's no recipient", /\[DRY RUN → no recipient\]/.test(__sent[0].subject), __sent[0].subject);

  setSetting_("DRY_RUN", "false");
  const live = post({ action: "sendEmail", token: TOKEN, payload: { job: {}, contact: { name: "x" }, ...draft } });
  check("live send refuses a missing address", /no recipient address/.test(live.error), live.error);
  const bad = post({ action: "sendEmail", token: TOKEN, payload: { job: {}, contact: { email: "not-an-email" }, ...draft } });
  check("live send refuses a malformed address", /does not look like an email/.test(bad.error), bad.error);
  const unver = post({ action: "sendEmail", token: TOKEN, payload: {
    job: {}, contact: { email: "guess@ramp.com", email_status: "unverified" }, ...draft } });
  check("live send refuses an unverified address", /unverified/.test(unver.error), unver.error);
  const override = post({ action: "sendEmail", token: TOKEN, payload: {
    job: {}, contact: { email: "guess@ramp.com", email_status: "unverified" }, overrideUnverified: true, ...draft } });
  check("explicit override lets it through", override.ok === true, override);
  check("a live send really does go to the contact", __sent.slice(-1)[0].to === "guess@ramp.com");
  check("live subject has no dry-run prefix", !/DRY RUN/.test(__sent.slice(-1)[0].subject));
  setSetting_("DRY_RUN", "true");
}

{
  // Regression: the fallback used to be an eagerly-evaluated default argument,
  // so a scope the send never needed was pulled in on every single send.
  const realSession = global.Session;
  global.Session = { getEffectiveUser: () => { throw new Error("Session must not be touched when TEST_INBOX is set"); } };
  __resetSent();
  const r = post({ action: "sendEmail", token: TOKEN, payload: { job: {}, contact: realContact, ...draft } });
  check("send never touches Session when TEST_INBOX is set", r.ok === true, r.error);
  global.Session = realSession;
}

console.log("\nsending — daily cap");
{
  setSetting_("DAILY_CAP", "3");
  const before = countSentToday_();
  const sheet = tab_("outreach");
  // top the day up to the cap
  for (let i = before; i < 3; i++) {
    sheet.appendRow(rowFor_(sheet, { id: "pad" + i, sent_at: new Date().toISOString(), status: "sent" }));
  }
  const capped = post({ action: "sendEmail", token: TOKEN, payload: { job: {}, contact: realContact, ...draft } });
  check("cap blocks the send", /daily cap reached/.test(capped.error), capped.error);
  check("cap error shows the numbers", /\d+\/3\b/.test(capped.error), capped.error);

  const status = post({ action: "sendStatus", token: TOKEN, payload: {} }).data;
  check("sendStatus reports nothing left", status.remaining === 0, status);
  check("sendStatus reports dry run", status.dryRun === true);
  setSetting_("DAILY_CAP", "25");
}

console.log("\nemail finder — domain");
check("company slug strips legal noise", companySlug_("Acme Technologies Pvt Ltd") === "acme", companySlug_("Acme Technologies Pvt Ltd"));
check("slug handles ampersands", companySlug_("Ben & Jerry's") === "benandjerrys", companySlug_("Ben & Jerry's"));
check("ats host is not the employer", domainFromJobUrl_("https://job-boards.greenhouse.io/anthropic/jobs/1") === "");
check("linkedin is not the employer", domainFromJobUrl_("https://www.linkedin.com/jobs/view/123") === "");
check("employer's own careers page resolves", domainFromJobUrl_("https://careers.acme.com/jobs/7") === "acme.com");
check("plain employer host kept", domainFromJobUrl_("https://acme.com/jobs/7") === "acme.com");
check("www stripped", domainFromJobUrl_("https://www.acme.co.uk/jobs/7") === "acme.co.uk");

console.log("\nemail finder — patterns");
{
  const p = patternsFor_("Priya Raman", "acme.com");
  check("first.last ranked first", p[0].email === "priya.raman@acme.com", p[0]);
  check("six shapes generated", p.length === 6, p.length);
  check("f.last included", p.some((c) => c.email === "p.raman@acme.com"));
  check("firstlast included", p.some((c) => c.email === "priyaraman@acme.com"));
  const single = patternsFor_("Madonna", "acme.com");
  check("one-word name yields only first", single.length === 1 && single[0].email === "madonna@acme.com", single);
  const messy = patternsFor_("  Dr. Priya   RAMAN ", "acme.com");
  check("titles and case cleaned up", messy[0].email === "priya.raman@acme.com", messy[0].email);
  check("suffixes dropped too", patternsFor_("Priya Raman PhD", "acme.com")[0].email === "priya.raman@acme.com",
    patternsFor_("Priya Raman PhD", "acme.com")[0].email);
  check("hyphenated surnames survive", patternsFor_("Priya Raman-Iyer", "acme.com")[0].email === "priya.ramaniyer@acme.com",
    patternsFor_("Priya Raman-Iyer", "acme.com")[0].email);
  check("no name yields nothing", patternsFor_("", "acme.com").length === 0);
  check("no domain yields nothing", patternsFor_("Priya Raman", "").length === 0);
}

console.log("\nemail finder — statuses");
{
  P.setProperty("HUNTER_API_KEY", "");
  __resetFetch();
  const r = post({ action: "findEmail", token: TOKEN, payload: {
    name: "Priya Raman", company: "Acme", jobUrl: "https://careers.acme.com/jobs/7" } });
  check("finds candidates", r.ok === true, r.error);
  check("uses the employer domain from the url", r.data.domain === "acme.com", r.data.domain);
  check("says where the domain came from", r.data.domainSource === "job url");
  check("no verifier means unverified, not verified", r.data.best.status === "unverified", r.data.best);
  check("says why it is unverified", /no verifier/.test(r.data.best.reason), r.data.best.reason);
  check("reports the verifier is absent", r.data.verifierConfigured === false);
  check("every candidate carries a status", r.data.candidates.every((c) => !!c.status));
}
{
  P.setProperty("HUNTER_API_KEY", "hk");
  __resetFetch();
  __queueFetch({ body: { data: { status: "valid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: {
    name: "Priya Raman", company: "Acme", domain: "acme.com" } });
  check("a valid verdict verifies the top guess", r.data.best.status === "verified", r.data.best);
  const verifierCalls = __fetchLog.filter((c) => c.url.indexOf("dns.google") === -1);
  check("only the top candidate is checked", verifierCalls.length === 1, verifierCalls.length);
  check("the rest stay unverified", r.data.candidates.slice(1).every((c) => c.status === "unverified"));
  check("typed domain is used as-is", r.data.domainSource === "you typed it");
}
{
  __resetFetch();
  __queueFetch({ body: { data: { status: "invalid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("an invalid verdict is reported as invalid", r.data.best.status === "invalid", r.data.best);
}
{
  // "accept_all" and friends must never be treated as a yes
  __resetFetch();
  __queueFetch({ body: { data: { status: "accept_all" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("a maybe is not upgraded to verified", r.data.best.status === "unverified", r.data.best);
}
{
  __resetFetch();
  __queueFetch({ code: 401, body: { errors: [{ details: "bad key" }] } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("a broken verifier downgrades rather than throws", r.ok === true && r.data.best.status === "unverified", r.data.best);
  P.setProperty("HUNTER_API_KEY", "");
}
{
  const noName = post({ action: "findEmail", token: TOKEN, payload: { company: "Acme" } });
  check("refuses without a name", /need a contact name/.test(noName.error), noName.error);
}

console.log("\nemail finder — mx layer (free, no key)");
{
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", ""); P.setProperty("HUNTER_API_KEY", "");
  __resetFetch(); __queueMx({ Status: 0, Answer: [] }); // domain exists, accepts no mail
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("a domain with no MX is invalid, not a guess", r.data.best.status === "invalid", r.data.best);
  check("says why in plain words", /does not accept email/.test(r.data.best.reason), r.data.best.reason);
}
{
  __resetFetch(); __queueMx({ Status: 3 }); // NXDOMAIN
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "nope.invalid" } });
  check("a domain that doesn't exist is invalid", r.data.best.status === "invalid", r.data.best);
}
{
  __resetFetch();
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("mx present but no key stays unverified", r.data.best.status === "unverified", r.data.best);
  check("and says the mailbox is what's unchecked", /mailbox unchecked/.test(r.data.best.reason), r.data.best.reason);
  check("reports mx-only mode", r.data.verifier === "none (mx check only)", r.data.verifier);
}
{
  // a failed DNS lookup must not be read as "this domain rejects mail"
  __resetFetch(); __queueMx({ Status: 2 }); // SERVFAIL
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("an unknown dns result is not treated as invalid", r.data.best.status === "unverified", r.data.best);
}

console.log("\nemail finder — pluggable verifiers");
{
  P.setProperty("VERIFIER", "abstract"); P.setProperty("VERIFIER_API_KEY", "ak");
  __resetFetch(); __queueFetch({ body: { deliverability: "DELIVERABLE" } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("abstract deliverable verifies", r.data.best.status === "verified", r.data.best);
  const call = __fetchLog.filter((c) => c.url.indexOf("dns.google") === -1)[0];
  check("hits abstract's endpoint", /emailvalidation\.abstractapi\.com/.test(call.url), call.url);
  check("reports which verifier answered", r.data.verifier === "abstract");
}
{
  __resetFetch(); __queueFetch({ body: { deliverability: "UNDELIVERABLE" } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("abstract undeliverable is invalid", r.data.best.status === "invalid", r.data.best);
}
{
  P.setProperty("VERIFIER", "mailboxlayer");
  __resetFetch(); __queueFetch({ body: { smtp_check: true, format_valid: true, catch_all: false } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("mailboxlayer smtp ok verifies", r.data.best.status === "verified", r.data.best);
}
{
  // a catch-all accepts every address, so it proves nothing about this one
  __resetFetch(); __queueFetch({ body: { smtp_check: true, format_valid: true, catch_all: true } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("a catch-all domain is not a verification", r.data.best.status === "unverified", r.data.best);
  check("and says so", /catch-all/.test(r.data.best.reason), r.data.best.reason);
}
{
  P.setProperty("VERIFIER", "nonsense");
  __resetFetch();
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("an unknown verifier degrades instead of throwing", r.ok === true && r.data.best.status === "unverified", r.data.best);
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", "");
}
{
  // the old property still works for anyone who set it up before
  P.setProperty("HUNTER_API_KEY", "hk");
  __resetFetch(); __queueFetch({ body: { data: { status: "valid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("HUNTER_API_KEY alone still selects hunter", r.data.verifier === "hunter" && r.data.best.status === "verified", r.data);
  P.setProperty("HUNTER_API_KEY", "");
}

console.log("\nemail finder — the send gate");
{
  // the whole point of the status: an unverified guess must not go out silently
  setSetting_("DRY_RUN", "false");
  const blocked = post({ action: "sendEmail", token: TOKEN, payload: {
    job: {}, contact: { email: "priya.raman@acme.com", email_status: "unverified" },
    subject: "s", body: "b" } });
  check("a guessed address is blocked on a live send", /unverified/.test(blocked.error), blocked.error);
  setSetting_("DRY_RUN", "true");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
