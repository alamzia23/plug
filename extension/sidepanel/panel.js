// plug — side panel.
// Day 1: capture the open job page, keep it in chrome.storage.local, show it as a ticket.
// Nothing leaves the browser yet.

const STORE_KEY = "jobs";

const els = {
  capture: document.getElementById("capture"),
  status: document.getElementById("status"),
  list: document.getElementById("list"),
  count: document.getElementById("count"),
  tpl: document.getElementById("ticket-tpl"),
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
    jobs.unshift({ ...kept, ...job, id: kept.id, status: kept.status || "draft" });
  } else {
    jobs.unshift({ ...job, id: crypto.randomUUID(), status: "draft" });
  }
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

  const conf = node.querySelector(".tag-conf");
  conf.dataset.conf = job.confidence;
  conf.textContent = job.confidence === "partial" ? "check fields" : "";

  const link = node.querySelector(".src-link");
  link.href = job.url;
  link.title = job.url;

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
}

// ---------- boot ----------

els.capture.addEventListener("click", capture);

loadJobs().then(render);
