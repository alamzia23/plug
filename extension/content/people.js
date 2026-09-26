// plug — reading people off a page.
//
// Injected on demand, same as capture.js: one IIFE, returns its value.
//
// This only ever READS what is already on screen. It never opens a profile,
// never sends a message, never sends a connection request. LinkedIn is hostile
// to automation and, more to the point, a connection request sent by a script
// is a connection request the user didn't write.
//
// Anchored on profile links rather than class names. LinkedIn rewrites its
// markup constantly — every /in/ link is a person, and that has stayed true.

(() => {
  const MAX_PEOPLE = 25;

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const profileId = (href) => {
    const m = String(href || "").match(/\/in\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  };

  // Lines of visible text around a person's link — their title and degree live
  // in there somewhere, and which element holds them changes week to week.
  const linesNear = (anchor) => {
    let box = anchor;
    for (let i = 0; i < 5 && box.parentElement; i++) {
      box = box.parentElement;
      const t = clean(box.innerText);
      if (t.length > clean(anchor.innerText).length + 10) break;
    }
    return clean(box.innerText)
      .split(/\s{2,}|\n/)
      .map(clean)
      .filter(Boolean);
  };

  const DEGREE = /(^|\s)(1st|2nd|3rd)(\s|$)/i;
  const NOISE = /^(connect|follow|message|view|see|status is|•|·|linkedin member)/i;

  const fromLinkedIn = () => {
    const seen = new Set();
    const people = [];

    for (const a of document.querySelectorAll('a[href*="/in/"]')) {
      const id = profileId(a.getAttribute("href"));
      if (!id || seen.has(id)) continue;

      const name = clean(a.innerText).split("\n")[0];
      // Anchors wrapping an avatar have no text; the named one comes later.
      if (!name || name.length > 60 || /^\d/.test(name)) continue;

      const lines = linesNear(a);
      const degree = (lines.find((l) => DEGREE.test(l)) || "").match(DEGREE);
      const title =
        lines.find(
          (l) =>
            l !== name &&
            l.length > 8 &&
            l.length < 140 &&
            !DEGREE.test(l) &&
            !NOISE.test(l) &&
            l !== clean(a.innerText)
        ) || "";

      seen.add(id);
      people.push({
        name,
        title,
        degree: degree ? degree[2].toLowerCase() : "",
        profileUrl: "https://www.linkedin.com/in/" + id,
        source: "linkedin",
      });
      if (people.length >= MAX_PEOPLE) break;
    }
    return people;
  };

  // "Priya Raman - Engineering Manager - Acme | LinkedIn"
  const fromGoogle = () => {
    const people = [];
    const seen = new Set();

    for (const a of document.querySelectorAll('a[href*="linkedin.com/in/"]')) {
      const id = profileId(a.getAttribute("href"));
      if (!id || seen.has(id)) continue;

      const heading = a.querySelector("h3") || a.closest("div")?.querySelector("h3");
      const text = clean(heading ? heading.innerText : a.innerText);
      if (!text) continue;

      const parts = text.split(/\s+[-–|]\s+/).map(clean).filter(Boolean);
      const name = parts[0] || "";
      if (!name || name.length > 60) continue;

      seen.add(id);
      people.push({
        name,
        title: parts[1] && !/linkedin/i.test(parts[1]) ? parts[1] : "",
        degree: "",
        profileUrl: "https://www.linkedin.com/in/" + id,
        source: "google",
      });
      if (people.length >= MAX_PEOPLE) break;
    }
    return people;
  };

  try {
    const host = location.hostname.replace(/^www\./, "");
    const onLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
    const people = onLinkedIn ? fromLinkedIn() : fromGoogle();

    if (!people.length) {
      return {
        ok: false,
        error: onLinkedIn
          ? "no profiles visible here. try a people search for the company."
          : "no linkedin profiles on this page. search google for the company's people.",
      };
    }
    return { ok: true, people, source: onLinkedIn ? "linkedin" : "google", pageUrl: location.href };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
})();
