require("./stub.js");

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name, extra !== undefined ? JSON.stringify(extra) : ""); }
};
const post = (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } })._t);

console.log("\nsetUp()");
const cfg = setUp();
check("returns a sheet id", !!cfg.sheetId);
check("returns a token", typeof cfg.token === "string" && cfg.token.length > 20);
check("all four tabs exist", ["jobs","contacts","outreach","settings"].every(t => !!ss_().getSheetByName(t)));
check("Sheet1 removed", !ss_().getSheetByName("Sheet1"));
check("DRY_RUN defaults on", getSetting_("DRY_RUN") === "true");
const rerun = setUp();
check("re-running keeps the same token", rerun.token === cfg.token);
check("re-running keeps the same sheet", rerun.sheetId === cfg.sheetId);

const TOKEN = cfg.token;

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
