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
  check("anthropic sends max_tokens", call.body.max_tokens === 1600);
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
