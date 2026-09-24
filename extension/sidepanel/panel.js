// plug — side panel.
// Day 1: capture the open job page, keep it in chrome.storage.local, show it as a ticket.
// Nothing leaves the browser yet.

const STORE_KEY = "jobs";

// Dummy until the people finder lands on day 7. Editable in the card.
const DUMMY_CONTACT = { name: "priya raman", title: "engineering manager" };

const els = {
  capture: document.getElementById("capture"),
  status: document.getElementById("status"),
  list: document.getElementById("list"),
  count: document.getElementById("count"),
  tpl: document.getElementById("ticket-tpl"),
  setup: document.getElementById("setup"),
  cfgUrl: document.getElementById("cfg-url"),
  cfgToken: document.getElementById("cfg-token"),
  cfgSave: document.getElementById("cfg-save"),
  cfgState: document.getElementById("cfg-state"),
  syncState: document.getElementById("sync-state"),
  syncAll: document.getElementById("sync-all"),
};

let jobs = [];

// ---------- storage ----------

async function loadJobs() {
  const bag = await chrome.storage.local.get(STORE_KEY);
  jobs = Array.isArray(bag[STORE_KEY]) ? bag[STORE_KEY] : [];
}

async function saveJobs() {
  await chrome.storage.local.set({ [STORE_KEY]: jobs });
}

// ---------- capture ----------

function say(msg, tone) {
  els.status.textContent = msg;
  els.status.dataset.tone = tone || "ok";
}

async function capture() {
  els.capture.disabled = true;
  say("reading the page…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      say("that tab isn't a web page. open a job posting first.", "bad");
      return;
    }

    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/capture.js"],
    });

    const res = frame && frame.result;
    if (!res || !res.ok) {
      say("couldn't read that page. " + ((res && res.error) || "try reloading it."), "bad");
      return;
    }

    const job = res.job;
    if (!job.role && !job.company) {
      say("nothing job-shaped on this page.", "bad");
      return;
    }

    upsert(job);
    await saveJobs();
    render();

    const where = [job.role, job.company].filter(Boolean).join(" at ") || "something";
    say(
      job.confidence === "high"
        ? "got it. " + where + "."
        : "got it, but some fields came back empty. fix them below."
    );

    // A capture is never lost to a backend problem: it's already on disk, and
    // an unsynced job just shows a "pending" tag you can push later.
    if (await backendReady()) {
      const pushed = await pushJobs([jobs[0]]);
      if (pushed.failed) say(els.status.textContent + " (not pushed: " + pushed.error + ")", "bad");
    }
  } catch (err) {
    // Usually a page Chrome refuses to inject into (web store, pdf viewer, another extension).
    say("capture failed: " + (err.message || err), "bad");
  } finally {
    els.capture.disabled = false;
  }
}

// Same URL = same job. Refresh it in place and float it to the top.
function upsert(job) {
  const i = jobs.findIndex((j) => j.url === job.url);
  if (i !== -1) {
    const kept = jobs[i];
    jobs.splice(i, 1);
    // the content changed, so it owes the sheet another push
    jobs.unshift({ ...kept, ...job, id: kept.id, status: kept.status || "draft", syncedAt: "" });
  } else {
    jobs.unshift({ ...job, id: crypto.randomUUID(), status: "draft" });
  }
}

// ---------- draft ----------

function wireDraft(node, job) {
  const draft = node.querySelector(".draft");
  const bodyBox = node.querySelector(".draft-body");
  const btnDraft = node.querySelector(".d-draft");
  const btnRegen = node.querySelector(".d-regen");
  const btnSend = node.querySelector(".d-send");
  const meta = node.querySelector(".draft-meta");

  // Drafting needs the backend; without it the section is just noise.
  if (!backendConfigured) return;
  draft.hidden = false;

  const contact = job.contact || { ...DUMMY_CONTACT };
  for (const input of node.querySelectorAll("[data-contact]")) {
    const field = input.dataset.contact;
    input.value = contact[field] || "";
    input.addEventListener("change", async () => {
      const target = jobs.find((j) => j.id === job.id);
      if (!target) return;
      target.contact = { ...(target.contact || DUMMY_CONTACT), [field]: input.value.trim() };
      await saveJobs();
    });
  }

  const paint = (d) => {
    bodyBox.hidden = false;
    btnRegen.hidden = false;
    btnSend.hidden = false;
    btnDraft.hidden = true;

    node.querySelector(".d-subject").value = d.subject;
    node.querySelector(".d-body").value = d.body;

    const list = node.querySelector(".bullet-list");
    list.replaceChildren();
    for (const [i, text] of (d.bullets || []).entries()) {
      const ta = document.createElement("textarea");
      ta.rows = 2;
      ta.value = text;
      ta.addEventListener("change", () => saveDraftEdit(job.id, "bullets", i, ta.value));
      list.append(ta);
    }

    const took = d.ms ? ` · ${(d.ms / 1000).toFixed(1)}s` : "";
    meta.textContent = `${d.words} words · ${d.provider}/${d.model}${took}` + (d.overLength ? " · over 120, trim it" : "");
    meta.dataset.over = String(Boolean(d.overLength));
  };

  node.querySelector(".d-subject").addEventListener("change", (e) => saveDraftEdit(job.id, "subject", null, e.target.value));
  node.querySelector(".d-body").addEventListener("change", (e) => saveDraftEdit(job.id, "body", null, e.target.value));

  if (job.draft) paint(job.draft);

  const run = async (btn, label) => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      const target = jobs.find((j) => j.id === job.id);
      const draftOut = await callBackend("draftEmail", {
        job: { company: target.company, role: target.role, location: target.location, jd: target.jd },
        contact: target.contact || DUMMY_CONTACT,
      });
      target.draft = draftOut;
      await saveJobs();
      paint(draftOut);
      say("drafted. read it before you send it.");
    } catch (err) {
      say("draft failed: " + (err.message || err), "bad");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  btnDraft.addEventListener("click", () => run(btnDraft, "writing…"));
  btnRegen.addEventListener("click", () => run(btnRegen, "rewriting…"));
}

// Edits are the point of the review step, so they're kept, not overwritten.
async function saveDraftEdit(jobId, field, index, value) {
  const target = jobs.find((j) => j.id === jobId);
  if (!target || !target.draft) return;
  if (field === "bullets") target.draft.bullets[index] = value;
  else target.draft[field] = value;
  if (field === "body") target.draft.words = value.trim() ? value.trim().split(/\s+/).length : 0;
  await saveJobs();
}

// ---------- render ----------

function ago(iso) {
  const then = new Date(iso).getTime();
  if (!then) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

function wordCount(s) {
  return s ? s.trim().split(/\s+/).length : 0;
}

function ticketFor(job) {
  const node = els.tpl.content.firstElementChild.cloneNode(true);

  // Page-supplied text only ever goes in via textContent / value — never innerHTML.
  node.dataset.id = job.id;
  node.querySelector(".role").textContent = job.role;
  node.querySelector(".source").textContent = job.source;
  node.querySelector(".when").textContent = ago(job.capturedAt);

  for (const input of node.querySelectorAll("[data-edit]")) {
    const field = input.dataset.edit;
    input.value = job[field] || "";
    input.addEventListener("change", async () => {
      const target = jobs.find((j) => j.id === job.id);
      if (!target) return;
      target[field] = input.value.trim();
      if (field === "role") node.querySelector(".role").textContent = target.role;
      await saveJobs();
      say("saved.");
    });
  }

  const words = wordCount(job.jd);
  const summary = node.querySelector(".jd-summary");
  const jdWrap = node.querySelector(".jd-wrap");
  if (words) {
    summary.textContent = "read jd (" + words.toLocaleString() + " words)";
    node.querySelector(".jd").textContent = job.jd;
  } else {
    jdWrap.remove();
  }

  node.querySelector(".tag-status").textContent = job.status || "draft";

  const sync = node.querySelector(".tag-sync");
  if (job.syncedAt) {
    sync.dataset.sync = "synced";
    sync.textContent = "on sheet";
  } else if (backendConfigured) {
    sync.dataset.sync = "pending";
    sync.textContent = "not pushed";
  }

  const conf = node.querySelector(".tag-conf");
  conf.dataset.conf = job.confidence;
  conf.textContent = job.confidence === "partial" ? "check fields" : "";

  const link = node.querySelector(".src-link");
  link.href = job.url;
  link.title = job.url;

  wireDraft(node, job);

  node.querySelector(".drop").addEventListener("click", async () => {
    jobs = jobs.filter((j) => j.id !== job.id);
    await saveJobs();
    render();
    say("dropped.");
  });

  return node;
}

function render() {
  els.list.replaceChildren();

  if (!jobs.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "no jobs yet. open a job page and hit capture.";
    els.list.append(p);
  } else {
    for (const job of jobs) els.list.append(ticketFor(job));
  }

  els.count.textContent = jobs.length === 1 ? "1 job" : jobs.length + " jobs";
  renderSyncState();
}

function pendingJobs() {
  return jobs.filter((j) => !j.syncedAt);
}

function renderSyncState() {
  if (!backendConfigured) {
    els.syncState.textContent = "local only";
    els.syncAll.hidden = true;
    return;
  }
  const pending = pendingJobs().length;
  els.syncState.textContent = pending ? pending + " not pushed" : "sheet in sync";
  els.syncAll.hidden = pending === 0;
}

// ---------- backend ----------

let backendConfigured = false;

// One request for the whole batch — Apps Script is slow to start and the daily
// quota counts invocations, not rows.
async function pushJobs(batch) {
  if (!batch.length) return { pushed: 0 };

  try {
    const results = await callBackend("saveJobs", {
      jobs: batch.map(({ id, company, role, location, url, source, jd, confidence, status, capturedAt }) => ({
        id, company, role, location, url, source, jd, confidence, status, capturedAt,
      })),
    });

    const now = new Date().toISOString();
    for (const r of results) {
      const job = jobs.find((j) => j.url === r.url);
      if (job) {
        job.syncedAt = now;
        job.remoteId = r.id;
      }
    }
    await saveJobs();
    render();
    return { pushed: results.length };
  } catch (err) {
    return { failed: true, error: err.message || String(err) };
  }
}

async function syncAll() {
  const pending = pendingJobs();
  if (!pending.length) return;

  els.syncAll.disabled = true;
  els.syncAll.textContent = "pushing…";
  const res = await pushJobs(pending);
  els.syncAll.disabled = false;
  els.syncAll.textContent = "push";

  say(res.failed ? "push failed: " + res.error : "pushed " + res.pushed + " to the sheet.", res.failed ? "bad" : "ok");
}

function cfgSay(msg, tone) {
  els.cfgState.textContent = msg;
  els.cfgState.dataset.tone = tone || "ok";
}

async function loadBackendForm() {
  const conf = await getBackend();
  els.cfgUrl.value = conf.url || "";
  els.cfgToken.value = conf.token || "";
  backendConfigured = Boolean(conf.url && conf.token);
  if (!backendConfigured) els.setup.open = true;
}

async function saveBackendForm() {
  const url = els.cfgUrl.value.trim();
  const token = els.cfgToken.value.trim();

  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
    cfgSay("that isn't a web app /exec url.", "bad");
    return;
  }
  if (!token) {
    cfgSay("token is empty.", "bad");
    return;
  }

  await setBackend({ url, token });
  els.cfgSave.disabled = true;
  cfgSay("testing…");

  try {
    const res = await callBackend("ping");
    backendConfigured = true;
    cfgSay(res.dryRun ? "connected. dry run is on." : "connected. dry run is OFF.", res.dryRun ? "ok" : "bad");
    render();
  } catch (err) {
    backendConfigured = false;
    cfgSay(err.message || String(err), "bad");
    render();
  } finally {
    els.cfgSave.disabled = false;
  }
}

// ---------- boot ----------

els.capture.addEventListener("click", capture);
els.cfgSave.addEventListener("click", saveBackendForm);
els.syncAll.addEventListener("click", syncAll);

loadBackendForm().then(loadJobs).then(render);
