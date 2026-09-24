// Minimal in-memory stand-ins for the Apps Script globals the backend touches,
// so the .gs logic can be exercised with `node backend/test/run.js` instead of
// a deploy-and-squint cycle. No dependencies.
const fs = require("fs");

const logged = [];
global.logged = logged;
const origLog = console.log;
console.log = (...a) => { logged.push(a.join(" ")); origLog(...a); };

const props = new Map();
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => props.set(k, String(v)),
  }),
};

let uuidN = 0;
// real Apps Script uuids are 36 chars (32 hex + 4 dashes)
global.Utilities = { getUuid: () => { const n = String(++uuidN).padStart(8, "0"); return `${n}-aaaa-bbbb-cccc-ddddeeeeffff`; } };

global.Session = { getEffectiveUser: () => ({ getEmail: () => "you@example.com" }) };

global.ContentService = {
  MimeType: { JSON: "json", TEXT: "text" },
  createTextOutput: (t) => ({ _t: t, setMimeType() { return this; } }),
};

function makeSheet(name) {
  const grid = []; // array of arrays
  return {
    name,
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => (grid[0] ? grid[0].length : 0),
    setFrozenRows() {},
    appendRow: (row) => grid.push([...row]),
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(vals) {
          vals.forEach((row, i) => {
            grid[r - 1 + i] = grid[r - 1 + i] || [];
            row.forEach((v, j) => (grid[r - 1 + i][c - 1 + j] = v));
          });
          return this;
        },
        setValue(v) {
          grid[r - 1] = grid[r - 1] || [];
          grid[r - 1][c - 1] = v;
          return this;
        },
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = grid[r - 1 + i] || [];
            out.push(Array.from({ length: nc }, (_, j) => (row[c - 1 + j] ?? "")));
          }
          return out;
        },
        setFontWeight() { return this; },
      };
    },
  };
}

const books = new Map();
global.SpreadsheetApp = {
  create: (title) => {
    const id = `sheet-${books.size + 1}`;
    const tabs = [makeSheet("Sheet1")];
    const book = {
      getId: () => id,
      getSheetByName: (n) => tabs.find((t) => t.name === n) || null,
      insertSheet: (n) => { const s = makeSheet(n); tabs.push(s); return s; },
      deleteSheet: (s) => tabs.splice(tabs.indexOf(s), 1),
      _tabs: tabs,
    };
    books.set(id, book);
    return book;
  },
  openById: (id) => {
    if (!books.has(id)) throw new Error("no such spreadsheet: " + id);
    return books.get(id);
  },
};

// Apps Script files share one global scope; emulate that with indirect eval.
// UrlFetchApp is scripted per-test: push a response, the next fetch pops it.
const fetchLog = [];
let fetchQueue = [];
global.__queueFetch = (r) => fetchQueue.push(r);
global.__fetchLog = fetchLog;
global.__resetFetch = () => { fetchQueue = []; fetchLog.length = 0; };
global.UrlFetchApp = {
  fetch: (url, params) => {
    fetchLog.push({ url, params, body: params.payload ? JSON.parse(params.payload) : null });
    const next = fetchQueue.shift();
    if (!next) throw new Error("no queued fetch response for " + url);
    return {
      getResponseCode: () => next.code ?? 200,
      getContentText: () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
    };
  },
};

for (const f of ["Sheet.gs", "Providers.gs", "Resume.gs", "Llm.gs", "Api.gs", "Setup.gs"]) {
  (0, eval)(fs.readFileSync(require("path").join(__dirname, "..", f), "utf8"));
}
module.exports = { props, books };
