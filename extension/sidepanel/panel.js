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
  tracker: document.getElementById("tracker"),
  streak: document.getElementById("streak"),
  trackerCounts: document.getElementById("tracker-counts"),
  trackerNote: document.getElementById("tracker-note"),
  trackerRefresh: document.getElementById("tracker-refresh"),
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

  const toInput = node.querySelector(".d-to");
  const sendNote = node.querySelector(".send-note");
  const btnFind = node.querySelector(".d-find");
  const findNote = node.querySelector(".find-note");
  const guesses = node.querySelector(".guesses");

  // A guessed address carries its status all the way to the send, where an
  // unverified one is refused. Typing one by hand is treated as deliberate.
  const setAddress = (email, status, reason) => {
    toInput.value = email;
    const target = jobs.find((j) => j.id === job.id);
    if (target) {
      target.contact = { ...(target.contact || DUMMY_CONTACT), email, email_status: status };
      saveJobs();
    }
    findNote.dataset.status = status;
    findNote.textContent =
      reason ||
      (status === "verified"
        ? "verified. safe to send."
        : status === "invalid"
        ? "that address is bad."
        : "a guess, not checked. it won't go out on a live send unless you say so.");
    paintSendState();
  };

  // ---- who to ask ----

  const btnPeople = node.querySelector(".d-people");
  const peopleNote = node.querySelector(".people-note");
  const peopleList = node.querySelector(".people-list");
  const noteBox = node.querySelector(".note-box");
  const noteArea = node.querySelector(".d-note");
  const noteChars = node.querySelector(".note-chars");
  const noteCopy = node.querySelector(".d-note-copy");

  const pickPerson = async (p) => {
    const target = jobs.find((j) => j.id === job.id);
    if (!target) return;
    target.contact = {
      ...(target.contact || DUMMY_CONTACT),
      name: p.name,
      title: p.title,
      profileUrl: p.profileUrl,
      // the directory already knows the address; a page-read person doesn't,
      // and their predecessor's address would be worse than none
      email: p.email || "",
      email_status: p.email_status || "",
    };
    await saveJobs();
    node.querySelector('[data-contact="name"]').value = p.name;
    node.querySelector('[data-contact="title"]').value = p.title;
    toInput.value = p.email || "";
    if (p.email) {
      findNote.dataset.status = p.email_status;
      findNote.textContent =
        p.email_status === "verified"
          ? `from the directory, ${p.confidence}% confidence. safe to send.`
          : `from the directory, ${p.confidence}% confidence — still a guess.`;
    } else {
      findNote.textContent = "";
      findNote.dataset.status = "";
    }
    guesses.hidden = true;
    peopleList.hidden = true;

    // The note is theirs to send. plug never sends it — reading a page is the
    // only thing this extension does on linkedin.
    peopleNote.textContent = "writing a connection note…";
    peopleNote.dataset.tone = "ok";
    try {
      const res = await callBackend("connectionNote", {
        person: { name: p.name, title: p.title },
        job: { role: target.role, company: target.company },
      });
      noteBox.hidden = false;
      noteArea.value = res.note;
      noteChars.textContent = `${res.chars}/280 · copy it, send it yourself`;
      peopleNote.textContent = `${p.name} · ${p.title || "no title"}`;
    } catch (err) {
      peopleNote.textContent = "note failed: " + (err.message || err);
      peopleNote.dataset.tone = "bad";
    }
  };

  noteCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(noteArea.value);
      noteCopy.textContent = "copied";
      setTimeout(() => { noteCopy.textContent = "copy"; }, 1500);
    } catch {
      noteArea.select();
      noteCopy.textContent = "select + ⌘c";
    }
  });

  const showPeople = (list) => {
    peopleList.replaceChildren();
    for (const p of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "person";

        const who = document.createElement("div");
        who.className = "who";
        const nm = document.createElement("span");
        nm.className = "pname";
        nm.textContent = p.name;
        const ti = document.createElement("span");
        ti.className = "ptitle";
        ti.textContent = p.title || "no title visible";
        who.append(nm, ti);

        const why = document.createElement("span");
        why.className = "why";
        why.textContent = p.reasons.length ? p.reasons.join(" · ") : "no strong signal";

      b.append(who, why);
      b.addEventListener("click", () => pickPerson(p));
      peopleList.append(b);
    }
    peopleList.hidden = list.length === 0;
  };

  // Ask the directory first — it needs no navigation and comes back with
  // addresses attached. Reading the open tab is the fallback, not the plan.
  const readOpenTab = async (target) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || "")) {
      throw new Error("open a linkedin people search or a google search first");
    }
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/people.js"],
    });
    const res = frame && frame.result;
    if (!res || !res.ok) throw new Error((res && res.error) || "couldn't read that page");

    const ranked = await callBackend("rankPeople", {
      people: res.people,
      job: { role: target.role, company: target.company },
    });
    showPeople(ranked.top);
    peopleNote.textContent = `read ${res.people.length} profiles on that page. best ${ranked.top.length}:`;
  };

  const domainRow = node.querySelector(".domain-row");
  const domainInput = node.querySelector(".d-domain");
  const domainGo = node.querySelector(".d-domain-go");

  const lookUpPeople = async (domainOverride) => {
    const target = jobs.find((j) => j.id === job.id);
    if (!target) return;

    btnPeople.disabled = true;
    btnPeople.textContent = "looking…";
    peopleList.hidden = true;
    peopleNote.dataset.tone = "ok";
    peopleNote.textContent = "asking the directory…";

    // Why the directory didn't answer is the useful half of a failure here —
    // "no profiles on this page" is the fallback's complaint, not the cause.
    let directory = null;
    let why = "";

    const ask = () =>
      callBackend("findPeople", {
        company: target.company,
        jobUrl: target.url,
        role: target.role,
        domain: domainOverride || target.domain || "",
      });

    try {
      directory = await ask();
    } catch (err) {
      // Apps Script sleeps between uses and the first call after idle can die
      // on the way out. One quiet retry turns "click it twice" into "it works".
      try {
        peopleNote.textContent = "waking the backend up…";
        directory = await ask();
      } catch (err2) {
        why = "directory: " + (err2.message || String(err2));
      }
    }

    if (directory && directory.top.length) {
      showPeople(directory.top);
      const where = directory.department ? `${directory.domain} · ${directory.department}` : directory.domain;
      peopleNote.textContent = directory.weak
        ? `${directory.found} at ${where}, but none of them look like a good ask. try another domain?`
        : `${directory.found} people at ${where}. best ${directory.top.length}:`;
      peopleNote.dataset.tone = directory.weak ? "bad" : "ok";
      domainRow.hidden = !directory.weak;
      domainInput.value = directory.domain;
      if (domainOverride) {
        target.domain = domainOverride; // remember the correction for this job
        await saveJobs();
      }
      btnPeople.disabled = false;
      btnPeople.textContent = "who?";
      return;
    }

    if (!why && directory) {
      why = directory.reason || `nobody listed for ${directory.domain}`;
    }

    // The url's host and the employer's domain are often different — a posting
    // on careers.capgemini.com can be a Sogeti job. Offer the correction rather
    // than insisting the guess was right.
    if (directory && directory.domain) {
      domainRow.hidden = false;
      domainInput.value = domainOverride || directory.domain;
    }

    peopleNote.textContent = why + " — reading the open tab instead…";
    try {
      await readOpenTab(target);
    } catch (err2) {
      // Both halves, so the real cause isn't hidden behind the fallback's.
      peopleNote.dataset.tone = "bad";
      peopleNote.textContent = why + " · " + (err2.message || String(err2));
    } finally {
      btnPeople.disabled = false;
      btnPeople.textContent = "who?";
    }
  };

  btnPeople.addEventListener("click", () => lookUpPeople(""));
  domainGo.addEventListener("click", () => lookUpPeople(domainInput.value.trim()));
  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lookUpPeople(domainInput.value.trim());
    }
  });

  btnFind.addEventListener("click", async () => {
    const target = jobs.find((j) => j.id === job.id);
    if (!target) return;
    const who = (target.contact && target.contact.name) || "";
    if (!who) {
      findNote.textContent = "put a name in the 'to' field first.";
      findNote.dataset.status = "invalid";
      return;
    }

    btnFind.disabled = true;
    btnFind.textContent = "looking…";
    guesses.hidden = true;
    findNote.dataset.status = "";
    findNote.textContent = "";

    try {
      const res = await callBackend("findEmail", {
        name: who,
        company: target.company,
        jobUrl: target.url,
      });

      setAddress(res.best.email, res.best.status, res.best.reason);

      // Show the alternatives: the top pattern is the most common, not the
      // most likely for any particular company.
      guesses.replaceChildren();
      for (const c of res.candidates.slice(1)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "guess";
        const addr = document.createElement("span");
        addr.textContent = c.email;
        const shape = document.createElement("span");
        shape.className = "shape";
        shape.textContent = c.pattern;
        b.append(addr, shape);
        b.addEventListener("click", () => setAddress(c.email, "unverified"));
        guesses.append(b);
      }
      guesses.hidden = res.candidates.length < 2;

      const src = res.domainSource === "guessed" ? " (domain guessed)" : "";
      say(
        res.askedDirectly
          ? `${res.domain}${src} · hunter knew this one.`
          : `${res.domain}${src} · ${res.candidates.length} possible addresses.`
      );
    } catch (err) {
      findNote.dataset.status = "invalid";
      findNote.textContent = err.message || String(err);
    } finally {
      btnFind.disabled = false;
      btnFind.textContent = "find";
    }
  });

  toInput.value = (job.contact && job.contact.email) || "";
  toInput.addEventListener("change", async () => {
    const target = jobs.find((j) => j.id === job.id);
    if (!target) return;
    target.contact = {
      ...(target.contact || DUMMY_CONTACT),
      email: toInput.value.trim(),
      email_status: "typed", // typing it yourself is the override
    };
    await saveJobs();
    paintSendState();
  });

  // The button has to say what it will actually do. "send" next to a live
  // mailbox and "send" next to a dry run are not the same promise.
  function paintSendState() {
    if (job.sent) {
      btnSend.textContent = "sent";
      btnSend.disabled = true;
      sendNote.textContent = job.sent.dryRun
        ? `dry run · landed in ${job.sent.sentTo}`
        : `sent to ${job.sent.sentTo}`;
      sendNote.dataset.tone = "ok";
      return;
    }

    const left = sendInfo.remaining === null ? "" : ` · ${sendInfo.remaining} left today`;
    if (sendInfo.dryRun) {
      btnSend.textContent = "send · dry run";
      sendNote.textContent = `goes to ${sendInfo.testInbox || "your test inbox"}, not the real person${left}`;
      sendNote.dataset.tone = "ok";
    } else {
      btnSend.textContent = "send for real";
      sendNote.textContent = `DRY RUN IS OFF — this emails ${toInput.value.trim() || "the address above"}${left}`;
      sendNote.dataset.tone = "live";
    }
  }

  const paint = (d) => {
    bodyBox.hidden = false;
    btnRegen.hidden = false;
    btnSend.hidden = false;
    btnDraft.hidden = true;
    paintSendState();

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

  // A live send takes two clicks: one to arm, one to confirm. A dry run takes
  // one, because the worst case is mail to your own inbox.
  let armed = false;
  const disarm = () => {
    armed = false;
    btnSend.dataset.armed = "false";
    paintSendState();
  };

  btnSend.addEventListener("click", async () => {
    const target = jobs.find((j) => j.id === job.id);
    if (!target || !target.draft) return;

    const status = (target.contact && target.contact.email_status) || "";
    const guessed = status === "unverified";

    // The arming click is where the warning belongs. Confirming it IS the
    // override — there's no separate checkbox to miss, and no way to send to
    // a guessed address without having been told it was a guess.
    if (!sendInfo.dryRun && !armed) {
      armed = true;
      btnSend.dataset.armed = "true";
      btnSend.textContent = guessed ? "that address is a guess — send anyway?" : "click again to send for real";
      setTimeout(() => { if (armed) disarm(); }, 6000);
      return;
    }

    btnSend.disabled = true;
    btnSend.textContent = "sending…";
    try {
      const result = await callBackend("sendEmail", {
        job: { id: target.remoteId || target.id, company: target.company, role: target.role },
        contact: { ...(target.contact || DUMMY_CONTACT), email: toInput.value.trim() },
        // only ever true on the second, confirmed click of a live send
        overrideUnverified: armed,
        subject: target.draft.subject,
        body: target.draft.body,
      });
      target.sent = result;
      target.status = "sent";
      node.querySelector(".tag-status").textContent = "sent";
      node.querySelector(".tag-status").dataset.status = "sent";
      await saveJobs();
      sendInfo.remaining = Math.max(0, (sendInfo.remaining ?? 1) - 1);
      paintSendState();
      say(result.dryRun ? `dry run sent to ${result.sentTo}. check that inbox.` : `sent to ${result.sentTo}.`);
      refreshTracker();
    } catch (err) {
      say("send failed: " + (err.message || err), "bad");
      btnSend.disabled = false;
      disarm();
    }
  });
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
// Cached from the backend so the send button can say what it will actually do.
let sendInfo = { dryRun: true, testInbox: "", remaining: null, cap: null };

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
    await refreshSendInfo();
    render();
  } catch (err) {
    backendConfigured = false;
    cfgSay(err.message || String(err), "bad");
    render();
  } finally {
    els.cfgSave.disabled = false;
  }
}

els.capture.addEventListener("click", capture);
els.cfgSave.addEventListener("click", saveBackendForm);
els.syncAll.addEventListener("click", syncAll);
els.trackerRefresh.addEventListener("click", async () => {
  els.trackerRefresh.textContent = "…";
  await refreshTracker();
  els.trackerRefresh.textContent = "refresh";
});

// Statuses live on the backend, not in chrome.storage — a reply is noticed by
// the daily trigger, which the panel never sees happen.
async function refreshTracker() {
  if (!backendConfigured) {
    els.tracker.hidden = true;
    return;
  }
  try {
    const t = await callBackend("tracker");
    els.tracker.hidden = false;

    els.streak.textContent = t.streak > 0 ? `🔥 ${t.streak} day streak` : "no streak yet";
    els.streak.dataset.hot = String(t.streak >= 3);

    els.trackerCounts.replaceChildren();
    for (const [kind, n] of Object.entries(t.counts)) {
      if (!n) continue;
      const el = document.createElement("span");
      el.className = "count";
      el.dataset.kind = kind;
      el.textContent = `${n} ${kind}`;
      els.trackerCounts.append(el);
    }
    if (!t.total) {
      const el = document.createElement("span");
      el.className = "count";
      el.textContent = "nothing sent yet";
      els.trackerCounts.append(el);
    }

    els.trackerNote.textContent = t.triggerInstalled
      ? "checking for replies daily. no reply in 3 days? it nudges once, then once more, then stops."
      : "the daily reply check isn't installed — run installDailyTrigger() in apps script.";
    els.trackerNote.dataset.tone = t.triggerInstalled ? "ok" : "bad";
  } catch {
    els.tracker.hidden = true;
  }
}

async function refreshSendInfo() {
  if (!backendConfigured) return;
  try {
    sendInfo = await callBackend("sendStatus");
  } catch {
    // A stale count is better than a dead panel; the send itself re-checks anyway.
  }
}

// ---------- boot ----------

(async () => {
  await loadBackendForm();
  await loadJobs();
  render();
  await refreshSendInfo();
  render();
  await refreshTracker();
})();
