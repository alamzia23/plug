// plug — talking to the Apps Script web app.
//
// Content-Type is text/plain on purpose: it keeps the request "simple" so the
// browser skips the CORS preflight, which Apps Script can't answer anyway.
// The web app deployment is public, so the shared token is the only thing
// guarding it — it lives in chrome.storage.local, never in this repo.

const BACKEND_KEY = "backend";

async function getBackend() {
  const bag = await chrome.storage.local.get(BACKEND_KEY);
  return bag[BACKEND_KEY] || { url: "", token: "" };
}

async function setBackend(conf) {
  await chrome.storage.local.set({ [BACKEND_KEY]: conf });
}

async function backendReady() {
  const { url, token } = await getBackend();
  return Boolean(url && token);
}

async function callBackend(action, payload = {}) {
  const { url, token } = await getBackend();
  if (!url || !token) throw new Error("backend not set up");

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      // Apps Script answers with a 302 to script.googleusercontent.com; fetch follows it.
      redirect: "follow",
      body: JSON.stringify({ action, token, payload }),
    });
  } catch {
    throw new Error("can't reach the backend — check the web app url");
  }

  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Almost always Google's sign-in page: the deployment isn't set to "anyone".
    throw new Error("backend returned a page, not json — redeploy with access: anyone");
  }

  if (!body.ok) throw new Error(body.error || "backend said no");
  return body.data;
}
