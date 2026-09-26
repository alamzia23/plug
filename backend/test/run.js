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
  // The cap is on the jd, not the whole prompt — a longer resume shouldn't
  // look like a truncation failure.
  // Longest run of x, not every x — "Linux" and "an LLM platform" are in the resume.
  const jdRun = Math.max.apply(null, user.split(/[^x]+/).map((r) => r.length));
  check("jd truncated into the prompt", jdRun === 6000, jdRun);
  check("contact name in prompt", user.includes("Priya"));
  check("resume name in prompt", user.includes(MASTER_RESUME.name));
  check("resume bullets in prompt", user.includes(MASTER_RESUME.experience[0].bullets[0].slice(0, 30)));
  check("side projects offered to the model", user.includes(MASTER_RESUME.projects[0].name));
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
  __queueFetch({ body: { data: { email: null } } }); // finder: no idea
  __queueFetch({ body: { data: { status: "valid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: {
    name: "Priya Raman", company: "Acme", domain: "acme.com" } });
  check("a valid verdict verifies the top guess", r.data.best.status === "verified", r.data.best);
  const verifyCalls = __fetchLog.filter((c) => c.url.indexOf("email-verifier") !== -1);
  check("only the top candidate is checked", verifyCalls.length === 1, verifyCalls.length);
  check("the rest stay unverified", r.data.candidates.slice(1).every((c) => c.status === "unverified"));
  check("typed domain is used as-is", r.data.domainSource === "you typed it");
}
{
  __resetFetch();
  __queueFetch({ body: { data: { email: null } } }); // finder: no idea
  __queueFetch({ body: { data: { status: "invalid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("an invalid verdict is reported as invalid", r.data.best.status === "invalid", r.data.best);
}
{
  // "accept_all" and friends must never be treated as a yes
  __resetFetch();
  __queueFetch({ body: { data: { email: null } } }); // finder: no idea
  __queueFetch({ body: { data: { status: "accept_all" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("a maybe is not upgraded to verified", r.data.best.status === "unverified", r.data.best);
}
{
  __resetFetch();
  __queueFetch({ body: { data: { email: null } } }); // finder: no idea
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
  __resetFetch();
  __queueFetch({ body: { data: { email: null } } }); // finder: no idea
  __queueFetch({ body: { data: { status: "valid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("HUNTER_API_KEY alone still selects hunter", r.data.verifier === "hunter" && r.data.best.status === "verified", r.data);
  P.setProperty("HUNTER_API_KEY", "");
}

console.log("\nemail finder — hunter asks outright");
{
  P.setProperty("VERIFIER", "hunter"); P.setProperty("VERIFIER_API_KEY", "hk");
  __resetFetch();
  __queueFetch({ body: { data: { email: "praman@acme.com", score: 97, sources: [{}, {}, {}] } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("uses the address hunter knows, not the popular pattern",
    r.data.best.email === "praman@acme.com", r.data.best.email);
  check("a 97% hit counts as verified", r.data.best.status === "verified", r.data.best);
  check("says where it came from", /hunter found this, 97%/.test(r.data.best.reason), r.data.best.reason);
  check("names the source count", /3 sources/.test(r.data.best.reason), r.data.best.reason);
  check("flags that it asked rather than guessed", r.data.askedDirectly === true);
  check("guesses are kept as alternatives", r.data.candidates.length > 1);
  check("one call, not one per pattern",
    __fetchLog.filter((c) => c.url.indexOf("dns.google") === -1).length === 1);
  check("hit the finder endpoint",
    /email-finder/.test(__fetchLog.filter((c) => c.url.indexOf("dns.google") === -1)[0].url));
}
{
  // a middling score is the best candidate but is NOT a verification
  __resetFetch();
  __queueFetch({ body: { data: { email: "p.raman@acme.com", score: 62, sources: [] } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("62% ranks first but stays unverified", r.data.best.email === "p.raman@acme.com" && r.data.best.status === "unverified", r.data.best);
  check("the score is shown either way", /62%/.test(r.data.best.reason), r.data.best.reason);
}
{
  // hunter doesn't know them -> fall back to guessing, then verify the top guess
  __resetFetch();
  __queueFetch({ body: { data: { email: null } } });     // finder: no idea
  __queueFetch({ body: { data: { status: "valid" } } }); // verifier on the top guess
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("falls back to the pattern guess", r.data.best.email === "priya.raman@acme.com", r.data.best.email);
  check("and verifies that guess", r.data.best.status === "verified", r.data.best);
  check("reports it had to guess", r.data.askedDirectly === false);
}
{
  // the finder being down must not break the fallback
  __resetFetch();
  __queueFetch({ code: 429, body: { errors: [{ details: "rate limited" }] } });
  __queueFetch({ body: { data: { status: "valid" } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("a rate-limited finder degrades to guessing", r.ok === true && r.data.best.email === "priya.raman@acme.com", r.data.best);
}
{
  // no duplicate when hunter returns the same address the pattern would have
  __resetFetch();
  __queueFetch({ body: { data: { email: "priya.raman@acme.com", score: 95, sources: [{}] } } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  const dupes = r.data.candidates.filter((c) => c.email === "priya.raman@acme.com");
  check("no duplicate candidate when they agree", dupes.length === 1, r.data.candidates.map((c) => c.email));
}
{
  // other verifiers have no finder, so nothing should change for them
  P.setProperty("VERIFIER", "abstract");
  __resetFetch();
  __queueFetch({ body: { deliverability: "DELIVERABLE" } });
  const r = post({ action: "findEmail", token: TOKEN, payload: { name: "Priya Raman", domain: "acme.com" } });
  check("non-hunter verifiers still just verify the top guess",
    r.data.askedDirectly === false && r.data.best.email === "priya.raman@acme.com", r.data.best);
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", "");
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

console.log("\nfollow-ups");
// Build outreach rows directly so the clock can be controlled.
function seedOutreach(daysAgo, extra) {
  const sheet = tab_("outreach");
  const sentAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const row = Object.assign(
    { id: "o-" + Math.random().toString(36).slice(2), job_id: "j1", to_email: "priya@acme.com",
      subject: "referral for the frontend role?", thread_id: "t1", status: "sent",
      sent_at: sentAt, followups: 0, dry_run: "false", real_to: "priya@acme.com",
      contact_name: "Priya Raman", company: "Acme", role: "Frontend Engineer" },
    extra || {}
  );
  sheet.appendRow(rowFor_(sheet, row));
  return row.id;
}
const rowById = (id) => readAll_("outreach").find((r) => r.id === id);

{
  // fresh send: too early for a nudge
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(1);
  dailyReplyCheck();
  check("day 1 is left alone", rowById(id).status === "sent" && __replies.length === 0, rowById(id).status);
}
{
  __resetThreads(); __resetSent(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(3);
  const out = dailyReplyCheck();
  check("day 3 gets the first nudge", Number(rowById(id).followups) === 1, rowById(id).followups);
  check("status becomes nudged", rowById(id).status === "nudged");
  check("it replies in-thread, not as a new email", __replies.length === 1 && __sent.length === 0, { replies: __replies.length, sent: __sent.length });
  check("the nudge is short", __replies[0].split(/\s+/).length < 45, __replies[0].split(/\s+/).length);
  check("it names the role", /Frontend Engineer/.test(__replies[0]));
  check("it offers an exit", /fine to be told no/i.test(__replies[0]), __replies[0]);
  check("summary counts it", out.nudged >= 1, out);
}
{
  // same day, second pass: must not nudge twice
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(3);
  dailyReplyCheck();
  const after = __replies.length;
  dailyReplyCheck();
  check("running twice in a day nudges once", __replies.length === after, { after, now: __replies.length });
  check("still one follow-up recorded", Number(rowById(id).followups) === 1);
}
{
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(7, { followups: 1, status: "nudged" });
  dailyReplyCheck();
  check("day 7 gets the second nudge", Number(rowById(id).followups) === 2, rowById(id).followups);
  check("the last one says it is the last", /Last nudge/i.test(__replies[__replies.length - 1]), __replies[__replies.length - 1]);
}
{
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(9, { followups: 2, status: "nudged" });
  dailyReplyCheck();
  check("two is the ceiling — no third nudge", __replies.length === 0, __replies);
  check("not ghosted yet at day 9", rowById(id).status === "nudged", rowById(id).status);
}
{
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(15, { followups: 2, status: "nudged" });
  dailyReplyCheck();
  check("silence past 14 days is ghosted", rowById(id).status === "ghosted", rowById(id).status);
}

console.log("\nfollow-ups — replies stop everything");
{
  __resetThreads(); __setThread({ from: ["you@example.com", "priya@acme.com"] });
  const id = seedOutreach(5);
  dailyReplyCheck();
  check("a message from someone else is a reply", rowById(id).status === "replied", rowById(id).status);
  check("a replied thread is never nudged", __replies.length === 0, __replies);
}
{
  // our own messages are not replies, however many there are
  __resetThreads(); __setThread({ from: ["you@example.com", "Alamzia <you@example.com>"] });
  const id = seedOutreach(3);
  dailyReplyCheck();
  check("our own follow-ups don't count as a reply", rowById(id).status !== "replied", rowById(id).status);
}
{
  // on a dry run every message is from us, so a longer thread is the signal
  __resetThreads(); __setThread({ from: ["you@example.com", "you@example.com"] });
  const id = seedOutreach(5, { dry_run: "true" });
  dailyReplyCheck();
  check("dry run treats a grown thread as a reply", rowById(id).status === "replied", rowById(id).status);
}
{
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(5, { status: "replied" });
  dailyReplyCheck();
  check("a replied row is skipped entirely", __replies.length === 0);
}

console.log("\nfollow-ups — degrading safely");
{
  // thread_id gone: fall back to the subject search rather than give up
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(3, { thread_id: "" });
  dailyReplyCheck();
  check("a missing thread_id still nudges via subject search", Number(rowById(id).followups) === 1, rowById(id));
}
{
  __resetThreads(); // no thread findable at all
  const id = seedOutreach(3, { thread_id: "" });
  const out = dailyReplyCheck();
  check("no thread means skip, not crash", rowById(id).status === "sent" && out.skipped >= 1, out);
}
{
  __resetThreads(); __setThread({ from: ["you@example.com"], replyThrows: true });
  const id = seedOutreach(3);
  const out = dailyReplyCheck();
  check("a failed reply doesn't count as sent", Number(rowById(id).followups) === 0, rowById(id).followups);
  check("and is reported as skipped", out.skipped >= 1, out);
}
{
  setSetting_("DAILY_CAP", "0");
  __resetThreads(); __setThread({ from: ["you@example.com"] });
  const id = seedOutreach(3);
  dailyReplyCheck();
  check("the daily cap applies to nudges too", Number(rowById(id).followups) === 0, rowById(id).followups);
  check("a cap of 0 means 0, not the default", numSetting_("DAILY_CAP", 25) === 0, numSetting_("DAILY_CAP", 25));
  setSetting_("DAILY_CAP", "25");
}

console.log("\ntrigger + tracker");
{
  __triggers.length = 0;
  installDailyTrigger();
  check("trigger installed", __triggers.length === 1, __triggers.length);
  installDailyTrigger();
  check("installing twice doesn't stack triggers", __triggers.length === 1, __triggers.length);
  check("tracker reports it is installed", post({ action: "tracker", token: TOKEN, payload: {} }).data.triggerInstalled === true);
  removeDailyTrigger();
  check("trigger removable", __triggers.length === 0);
}
{
  const t = post({ action: "tracker", token: TOKEN, payload: {} }).data;
  check("tracker returns rows", Array.isArray(t.rows) && t.rows.length > 0, t.total);
  check("tracker counts statuses", typeof t.counts.replied === "number", t.counts);
  check("streak counts today", t.streak >= 1, t.streak);
  check("tracker hides sheet row numbers", t.rows.every((r) => r._row === undefined));
}

console.log("\npeople — ranking");
const crowd = [
  { name: "Ravi Menon", title: "Technical Recruiter at Acme", degree: "3rd" },
  { name: "Priya Raman", title: "Senior Frontend Engineer at Acme", degree: "2nd" },
  { name: "Sam Whitfield", title: "VP of Engineering at Acme", degree: "2nd" },
  { name: "Asha Kapoor", title: "Frontend Engineer, " + MASTER_RESUME.education[0].aliases[0] + " alum", degree: "2nd" },
  { name: "No Title Person", title: "", degree: "" },
];
{
  const r = post({ action: "rankPeople", token: TOKEN, payload: {
    people: crowd, job: { role: "Senior Frontend Engineer", company: "Acme" } } });
  check("ranks people", r.ok === true, r.error);
  const names = r.data.top.map((p) => p.name);
  check("caps at MAX_CONTACTS_PER_JOB", r.data.top.length === 3, r.data.top.length);
  check("alumni ranks first", names[0] === "Asha Kapoor", names);
  check("same-function engineer beats the recruiter",
    names.indexOf("Priya Raman") < names.indexOf("Ravi Menon") || names.indexOf("Ravi Menon") === -1, names);

  // the slate is one of each kind, not three of the best kind
  const kinds = r.data.top.map((p) => p.kind);
  check("the shortlist mixes kinds", new Set(kinds).size === kinds.length, kinds);
  check("a peer is picked first", kinds[0] === "peer", kinds);
  check("a recruiter still gets a slot", kinds.indexOf("recruiter") !== -1, kinds);
  {
    const lead = post({ action: "rankPeople", token: TOKEN, payload: {
      people: [{ name: "L", title: "Engineering Manager" }], job: { role: "DevOps Engineer" } } });
    check("a manager is senior", lead.data.top[0].kind === "senior", lead.data.top[0].kind);
    const staff = post({ action: "rankPeople", token: TOKEN, payload: {
      people: [{ name: "S", title: "Staff Platform Engineer" }], job: { role: "DevOps Engineer" } } });
    check("a staff engineer is still a peer", staff.data.top[0].kind === "peer", staff.data.top[0].kind);
  }
  check("a VP counts as senior, not a peer",
    [].concat(r.data.top, r.data.rest).find((p) => p.name === "Sam Whitfield").kind === "senior");
  const vp = [].concat(r.data.top, r.data.rest).find((p) => p.name === "Sam Whitfield");
  check("a VP is marked too senior", vp.reasons.indexOf("probably too senior") !== -1, vp.reasons);
  const recruiter = [].concat(r.data.top, r.data.rest).find((p) => p.name === "Ravi Menon");
  check("recruiter is recognised", recruiter.reasons.indexOf("recruiter") !== -1, recruiter.reasons);
  // the stems have to match real titles, not just the bare verb
  ["Technical Recruiter", "Recruiting Lead", "Talent Partner", "Sourcer", "Head of People Ops"].forEach((t) => {
    const one = post({ action: "rankPeople", token: TOKEN, payload: {
      people: [{ name: "X", title: t }], job: { role: "Engineer" } } }).data.top[0];
    check('"' + t + '" reads as a recruiter', one.reasons.indexOf("recruiter") !== -1, one.reasons);
  });
  const blank = [].concat(r.data.top, r.data.rest).find((p) => p.name === "No Title Person");
  check("no title is penalised, not dropped", blank.reasons.indexOf("no title visible") !== -1, blank.reasons);
  check("every ranked person says why", r.data.top.every((p) => Array.isArray(p.reasons)));
  check("overflow kept separately", r.data.rest.length === 2, r.data.rest.length);
}
{
  // the job's own words should drive "same function", not a fixed list
  const r = post({ action: "rankPeople", token: TOKEN, payload: {
    people: [
      { name: "Data Person", title: "Data Engineer at Acme" },
      { name: "Front Person", title: "Frontend Engineer at Acme" },
    ],
    job: { role: "Data Engineer" } } });
  check("ranking follows the job title", r.data.top[0].name === "Data Person", r.data.top.map((p) => p.name));
}
{
  // "Senior" and "Lead" are noise — they shouldn't create a false match
  // "Senior Software Developer" is a same-function match for "DevOps Engineer"
  {
    const r2 = post({ action: "rankPeople", token: TOKEN, payload: {
      people: [{ name: "Sam Rivera", title: "Senior Software Developer" }],
      job: { role: "DevOps Engineer" } } });
    check("developer matches engineer", r2.data.top[0].reasons.indexOf("same function") !== -1, r2.data.top[0]);
    // "Senior" is an IC level, not a leadership one — this is the best person to ask
    check("a senior developer is a peer", r2.data.top[0].kind === "peer", r2.data.top[0].kind);
  }
  {
    const r3 = post({ action: "rankPeople", token: TOKEN, payload: {
      people: [{ name: "X", title: "Site Reliability Engineer" }],
      job: { role: "DevOps Engineer" } } });
    check("sre matches devops", r3.data.top[0].reasons.indexOf("same function") !== -1, r3.data.top[0]);
  }
  check("seniority words are stripped from the role",
    roleKeywords_("Senior Staff Lead Frontend Engineer II").join(",") === "frontend,engineer",
    roleKeywords_("Senior Staff Lead Frontend Engineer II"));
}
{
  const empty = post({ action: "rankPeople", token: TOKEN, payload: { people: [], job: {} } });
  check("refuses an empty list", /no people to rank/.test(empty.error), empty.error);
}

{
  // the alumni signal has to fire on how people actually write their school
  const full = post({ action: "rankPeople", token: TOKEN, payload: {
    people: [{ name: "A", title: "SRE · " + MASTER_RESUME.education[0].school }],
    job: { role: "DevOps Engineer" } } }).data.top[0];
  check("the full school name matches", full.reasons.indexOf("alumni") !== -1, full.reasons);

  const alias = post({ action: "rankPeople", token: TOKEN, payload: {
    people: [{ name: "B", title: "Platform Engineer, EIT alum" }],
    job: { role: "DevOps Engineer" } } }).data.top[0];
  check("an abbreviation matches too", alias.reasons.indexOf("alumni") !== -1, alias.reasons);

  const stranger = post({ action: "rankPeople", token: TOKEN, payload: {
    people: [{ name: "C", title: "Platform Engineer, IIT Delhi" }],
    job: { role: "DevOps Engineer" } } }).data.top[0];
  check("a different school does not", stranger.reasons.indexOf("alumni") === -1, stranger.reasons);
}

console.log("\npeople — directory search");
{
  P.setProperty("VERIFIER", "hunter"); P.setProperty("VERIFIER_API_KEY", "hk");
  __resetFetch();
  __queueFetch({ body: { data: { emails: [
    { value: "priya@acme.com", first_name: "Priya", last_name: "Raman", position: "Senior Frontend Engineer", confidence: 92 },
    { value: "sam@acme.com", first_name: "Sam", last_name: "Whitfield", position: "VP of Engineering", confidence: 71 },
  ] } } });
  __queueFetch({ body: { data: { emails: [
    { value: "ravi@acme.com", first_name: "Ravi", last_name: "Menon", position: "Technical Recruiter", confidence: 95 },
  ] } } });
  const r = post({ action: "findPeople", token: TOKEN, payload: {
    company: "Acme", domain: "acme.com", role: "Senior Frontend Engineer" } });
  check("finds people without any page open", r.ok === true, r.error);
  check("reports the directory answered", r.data.source === "hunter", r.data.source);
  check("returns the ranked best", r.data.top.length === 3, r.data.top.length);
  check("the engineer outranks the VP",
    r.data.top.findIndex((p) => p.name === "Priya Raman") < r.data.top.findIndex((p) => p.name === "Sam Whitfield"),
    r.data.top.map((p) => p.name));
  const priya = r.data.top.find((p) => p.name === "Priya Raman");
  check("addresses come back attached", priya.email === "priya@acme.com", priya);
  check("high confidence is verified", priya.email_status === "verified", priya);
  const sam = r.data.top.find((p) => p.name === "Sam Whitfield");
  check("71% stays unverified", sam.email_status === "unverified", sam);
  const ds = __fetchLog.filter((c) => c.url.indexOf("domain-search") !== -1);
  // Two targeted requests cost the same as one mixed one — credits are per
  // address — and stop hr dominating the results.
  check("splits the budget across two requests", ds.length === 2, ds.length);
  check("most of the budget goes to the role's department",
    /[?&]limit=8\b/.test(ds[0].url) && /[?&]department=it\b/.test(ds[0].url), ds[0].url);
  check("a small slice goes to hr",
    /[?&]limit=2\b/.test(ds[1].url) && /[?&]department=hr\b/.test(ds[1].url), ds[1].url);
  check("the two together stay within DIRECTORY_LIMIT",
    Number(ds[0].url.match(/limit=(\d+)/)[1]) + Number(ds[1].url.match(/limit=(\d+)/)[1]) === 10);
  check("executives excluded from both", ds.every((c) => /seniority=junior,senior/.test(c.url)));
  check("excludes executives from the ask", /seniority=junior,senior/.test(ds[0].url), ds[0].url);
}
{
  setSetting_("DIRECTORY_LIMIT", "3");
  __resetFetch(); __queueFetch({ body: { data: { emails: [] } } }); __queueFetch({ body: { data: { emails: [] } } });
  post({ action: "findPeople", token: TOKEN, payload: { company: "Acme", domain: "acme.com" } });
  const ds2 = __fetchLog.filter((c) => c.url.indexOf("domain-search") !== -1);
  check("DIRECTORY_LIMIT is respected", /[?&]limit=3\b/.test(ds2[0].url), ds2[0].url);
  setSetting_("DIRECTORY_LIMIT", "10");
}
{
  // hunter knows the domain but lists nobody
  __resetFetch(); __queueFetch({ body: { data: { emails: [] } } }); __queueFetch({ body: { data: { emails: [] } } });
  const r = post({ action: "findPeople", token: TOKEN, payload: { company: "Acme", domain: "acme.com" } });
  check("an empty directory is reported, not an error", r.ok === true && r.data.source === "hunter-empty", r.data);
  check("and says the listing was genuinely empty", /nobody matching/.test(r.data.reason), r.data.reason);
  check("and returns no one rather than inventing anyone", r.data.top.length === 0);
}
{
  __resetFetch(); __queueFetch({ code: 429, body: { errors: [{ details: "rate limited" }] } });
  const r = post({ action: "findPeople", token: TOKEN, payload: { company: "Acme", domain: "acme.com" } });
  check("a rate limit degrades to empty, not a crash", r.ok === true && r.data.top.length === 0, r.data);
  check("a refused request is not reported as an empty company",
    /http 429/.test(r.data.reason) && !/no addresses on record/.test(r.data.reason), r.data.reason);
}
{
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", "");
  __resetFetch();
  const r = post({ action: "findPeople", token: TOKEN, payload: { company: "Acme", domain: "acme.com" } });
  check("no key means no-directory, so the panel can fall back", r.data.source === "no-directory", r.data.source);
  P.setProperty("VERIFIER", "hunter"); P.setProperty("VERIFIER_API_KEY", "hk");
}
{
  // a name-less entry still has to be usable
  __resetFetch();
  __queueFetch({ body: { data: { emails: [{ value: "dev.ops@acme.com", position: "DevOps Engineer", confidence: 88 }] } } });
  __queueFetch({ body: { data: { emails: [] } } });
  const r = post({ action: "findPeople", token: TOKEN, payload: { company: "Acme", domain: "acme.com", role: "DevOps Engineer" } });
  check("a missing name falls back to the address local-part", r.data.top[0].name === "dev ops", r.data.top[0].name);
}
{
  const noDomain = post({ action: "findPeople", token: TOKEN, payload: { company: "" } });
  check("refuses without a domain it can work out", /domain/.test(noDomain.error), noDomain.error);
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", "");
}

{
  // the department follows the job, and an unknown role asks for everyone
  check("engineering roles map to it", departmentFor_("Senior DevOps Engineer") === "it");
  check("design roles map to design", departmentFor_("Product Designer") === "design");
  check("recruiting roles map to hr", departmentFor_("Technical Recruiter") === "hr");
  check("an unrecognised role asks for no department", departmentFor_("Chief Vibes Officer") === "");
}
{
  // three weak candidates should be labelled weak, not presented as a shortlist
  P.setProperty("VERIFIER", "hunter"); P.setProperty("VERIFIER_API_KEY", "hk");
  __resetFetch();
  __queueFetch({ body: { data: { emails: [
    { value: "a@acme.com", first_name: "A", last_name: "One", position: "Workplace Services Partner", confidence: 90 },
  ] } } });
  __queueFetch({ body: { data: { emails: [
    { value: "b@acme.com", first_name: "B", last_name: "Two", position: "Director of Talent Acquisition", confidence: 90 },
  ] } } });
  const r = post({ action: "findPeople", token: TOKEN, payload: {
    company: "Acme", domain: "acme.com", role: "DevOps Engineer" } });
  check("a shortlist of bad matches is flagged weak", r.data.weak === true, r.data.top);
}
{
  __resetFetch();
  __queueFetch({ body: { data: { emails: [
    { value: "c@acme.com", first_name: "C", last_name: "Three", position: "Senior DevOps Engineer", confidence: 90 },
  ] } } });
  __queueFetch({ body: { data: { emails: [] } } });
  const r = post({ action: "findPeople", token: TOKEN, payload: {
    company: "Acme", domain: "acme.com", role: "DevOps Engineer" } });
  check("a real match is not flagged weak", r.data.weak === false, r.data.top);
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", "");
}

{
  // the failure this fixes: one engineer and two HR managers in a three-slot slate
  P.setProperty("VERIFIER", "hunter"); P.setProperty("VERIFIER_API_KEY", "hk");
  __resetFetch();
  __queueFetch({ body: { data: { emails: [
    { value: "j@acme.com", first_name: "Sam", last_name: "Rivera", position: "Senior Software Developer", confidence: 95 },
  ] } } });
  __queueFetch({ body: { data: { emails: [
    { value: "r@acme.com", first_name: "Robin", last_name: "Clarke", position: "Human Resources Manager", confidence: 95 },
    { value: "s@acme.com", first_name: "Sasha", last_name: "Bell", position: "HR Manager", confidence: 95 },
  ] } } });
  const r = post({ action: "findPeople", token: TOKEN, payload: {
    company: "Acme", domain: "acme.com", role: "DevOps Engineer" } });
  const recruiters = r.data.top.filter((p) => p.kind === "recruiter");
  check("never more than one recruiter in the slate", recruiters.length <= 1, r.data.top.map((p) => p.title));
  check("the engineer keeps the peer slot", r.data.top[0].kind === "peer", r.data.top[0]);
  P.setProperty("VERIFIER", ""); P.setProperty("VERIFIER_API_KEY", "");
}

console.log("\npeople — connection note");
{
  P.setProperty("LLM_PROVIDER", "gemini"); P.setProperty("LLM_API_KEY", "test-key");
  __resetFetch();
  __queueFetch({ body: { candidates: [{ content: { parts: [{ text: '{"note":"Hi Priya, I am applying to the Senior Frontend Engineer role at Acme. I built the design system at Nutmeg Pay, which looks close to what your team owns. Would be glad to connect."}' }] } }] } });
  const r = post({ action: "connectionNote", token: TOKEN, payload: {
    person: { name: "Priya Raman", title: "Senior Frontend Engineer" },
    job: { role: "Senior Frontend Engineer", company: "Acme" } } });
  check("writes a note", r.ok === true, r.error);
  check("under linkedin's limit", r.data.chars <= 280, r.data.chars);
  check("not truncated when it already fits", r.data.truncated === false);
  const system = __fetchLog[0].body.systemInstruction.parts[0].text;
  check("the limit is in the prompt", /UNDER 280 characters/.test(system));
  check("it must not ask for the referral in a connection note", /Do not ask for the referral/.test(system));
}
{
  // a model that ignores the limit gets cut, and says so
  __resetFetch();
  __queueFetch({ body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ note: "x".repeat(400) }) }] } }] } });
  const r = post({ action: "connectionNote", token: TOKEN, payload: {
    person: { name: "Priya" }, job: { role: "Engineer" } } });
  check("an over-long note is cut to 280", r.data.note.length === 280, r.data.note.length);
  check("and flagged as truncated", r.data.truncated === true);
}
{
  const noPerson = post({ action: "connectionNote", token: TOKEN, payload: { person: {}, job: {} } });
  check("refuses without a person", /need a person/.test(noPerson.error), noPerson.error);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
