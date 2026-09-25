// plug — job capture.
//
// Injected on demand by the side panel via chrome.scripting.executeScript({ files }).
// The whole file is one IIFE so re-injecting on every click never redeclares anything,
// and so the returned object becomes the executeScript result.
//
// Every adapter returns the same shape. Missing fields come back "" rather than a guess —
// the panel makes them editable so a bad selector is visible, not silent.

(() => {
  const MAX_JD = 8000;

  // ---------- small helpers ----------

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const cleanBlock = (s) =>
    (s || "")
      .replace(/\r/g, "")
      .replace(/[ \t ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_JD);

  // First selector that matches non-empty text wins.
  const pick = (selectors) => {
    for (const sel of selectors) {
      let els;
      try {
        els = document.querySelectorAll(sel);
      } catch {
        continue; // one bad selector must not kill the whole capture
      }
      for (const el of els) {
        const v = clean(el.innerText || el.textContent);
        if (v) return v;
      }
    }
    return "";
  };

  // Same, but for long text. Short matches are stub containers, so skip them.
  const pickBlock = (selectors) => {
    for (const sel of selectors) {
      let els;
      try {
        els = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of els) {
        const v = cleanBlock(el.innerText || el.textContent);
        if (v.length > 80) return v;
      }
    }
    return "";
  };

  // Turn an HTML string into readable text without touching the live DOM.
  const htmlToText = (html) => {
    if (!html) return "";
    const withBreaks = String(html)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n- ")
      .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|ul|ol|section)\s*>/gi, "\n");
    // DOMParser decodes entities and drops the remaining tags for us.
    const doc = new DOMParser().parseFromString(withBreaks, "text/html");
    return cleanBlock(doc.body ? doc.body.textContent : "");
  };

  const pathParts = () =>
    location.pathname.split("/").filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });

  const slugToName = (s) => clean(String(s || "").replace(/[-_+]+/g, " "));

  const attr = (selector, name) => {
    const el = document.querySelector(selector);
    return el ? clean(el.getAttribute(name)) : "";
  };

  const meta = (name) => {
    const el =
      document.querySelector('meta[property="' + name + '"]') ||
      document.querySelector('meta[name="' + name + '"]');
    return el ? clean(el.getAttribute("content")) : "";
  };

  // ---------- company from the URL, when the page itself will not say ----------

  // ATS hosts where the company is the first path segment, not the hostname.
  const ATS_PATH_HOSTS = [
    "ashbyhq.com",
    "smartrecruiters.com",
    "greenhouse.io",
    "lever.co",
    "workable.com",
    "recruitee.com",
    "teamtailor.com",
    "breezy.hr",
    "jobvite.com",
    "bamboohr.com",
  ];

  const HOST_NOISE = new Set([
    "www", "careers", "career", "jobs", "job", "apply", "boards", "board",
    "hire", "hiring", "talent", "work", "join", "recruiting", "recruit",
    "my", "app", "web", "en", "in", "us",
  ]);

  const companyFromUrl = () => {
    const host = location.hostname.replace(/^www\./, "");

    if (ATS_PATH_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
      const seg = pathParts()[0];
      if (seg && !/^\d+$/.test(seg)) return slugToName(seg);
    }

    // Workday looks like acme.wd3.myworkdayjobs.com — the first label is the company.
    const labels = host.split(".");
    labels.pop(); // tld
    if (labels.length > 1 && /^(co|com|org|net|gov|ac)$/.test(labels[labels.length - 1])) {
      labels.pop(); // second-level tld, e.g. .co.in
    }
    for (const label of labels) {
      if (!HOST_NOISE.has(label) && !/^wd\d+$/.test(label)) return slugToName(label);
    }
    return slugToName(labels[0] || host);
  };

  // ---------- JSON-LD JobPosting ----------

  // Workday, Ashby, SmartRecruiters, Indeed and most ATSs emit this. When it is
  // there it is the most reliable source on the page, so the generic adapter tries it first.
  const fromJsonLd = () => {
    const nodes = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(script.textContent);
      } catch {
        continue; // some sites ship invalid JSON-LD
      }
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
        nodes.push(node);
      }
    }

    const post = nodes.find((n) => {
      const t = n["@type"];
      return Array.isArray(t) ? t.includes("JobPosting") : t === "JobPosting";
    });
    if (!post) return null;

    const org = post.hiringOrganization;
    const company = clean(typeof org === "string" ? org : org && org.name);

    const loc = [].concat(post.jobLocation || []).map((l) => {
      const addr = (l && l.address) || l || {};
      if (typeof addr === "string") return clean(addr);
      return clean(
        [addr.addressLocality, addr.addressRegion, addr.addressCountry]
          .filter((p) => typeof p === "string" && p)
          .join(", ")
      );
    });
    const remote = post.jobLocationType === "TELECOMMUTE" ? "remote" : "";

    return {
      role: clean(post.title),
      company,
      location: clean([loc.filter(Boolean)[0], remote].filter(Boolean).join(" · ")),
      jd: htmlToText(post.description),
    };
  };

  // ---------- adapters ----------

  const adapters = [
    {
      name: "linkedin",
      match: (h) => h === "linkedin.com" || h.endsWith(".linkedin.com"),
      run: () => ({
        role: pick([
          ".job-details-jobs-unified-top-card__job-title h1",
          ".job-details-jobs-unified-top-card__job-title",
          ".jobs-unified-top-card__job-title",
          ".top-card-layout__title",
          "h1.topcard__title",
        ]),
        company: pick([
          ".job-details-jobs-unified-top-card__company-name a",
          ".job-details-jobs-unified-top-card__company-name",
          ".jobs-unified-top-card__company-name",
          ".topcard__org-name-link",
          ".topcard__flavor",
        ]),
        location: pick([
          ".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
          ".job-details-jobs-unified-top-card__bullet",
          ".jobs-unified-top-card__bullet",
          ".topcard__flavor--bullet",
        ]),
        // The collapsed description still holds the full text, so "see more" is not needed.
        jd: pickBlock([
          ".jobs-description__content",
          ".jobs-box__html-content",
          "#job-details",
          ".show-more-less-html__markup",
          ".description__text",
        ]),
      }),
    },

    {
      name: "naukri",
      match: (h) => h === "naukri.com" || h.endsWith(".naukri.com"),
      // Naukri hashes the class suffix on every build, so match by prefix.
      run: () => ({
        role: pick([
          '[class^="styles_jd-header-title"]',
          ".jd-header-title",
          "h1",
        ]),
        company: pick([
          '[class^="styles_jd-header-comp-name"] a',
          '[class^="styles_jd-header-comp-name"]',
          ".jd-header-comp-name",
        ]),
        location: pick([
          '[class^="styles_jhc__location"] a',
          '[class^="styles_jhc__location"]',
          '[class*="loc"] .location',
        ]),
        jd: pickBlock([
          '[class^="styles_JDC__dang-inner-html"]',
          '[class^="styles_job-desc-container"]',
          ".dang-inner-html",
          ".job-desc",
        ]),
      }),
    },

    {
      name: "greenhouse",
      match: (h) => h.includes("greenhouse.io"),
      run: () => {
        // Two generations live side by side: job-boards.greenhouse.io (new) and
        // boards.greenhouse.io (older, also what embeds use).
        const parts = pathParts();
        const slug =
          new URLSearchParams(location.search).get("for") ||
          (parts[0] && parts[0] !== "embed" ? parts[0] : "");
        return {
          role: pick([".job__title h1", "h1.app-title", "#header .app-title", "h1"]),
          company:
            pick([".company-name", "#header .company-name", '[class*="company-name"]']).replace(
              /^at\s+/i,
              ""
            ) || slugToName(slug),
          location: pick([".job__location div", ".job__location", "#header .location", ".location"]),
          jd: pickBlock([".job__description", "#content", ".job-post .body", "#app_body"]),
        };
      },
    },

    {
      name: "lever",
      match: (h) => h.includes("lever.co"),
      run: () => ({
        role: pick(['[data-qa="posting-name"]', ".posting-headline h2", "h2"]),
        company:
          pick([".posting-company"]) ||
          // the header logo's alt is usually "<company> logo"
          attr(".main-header-logo img", "alt").replace(/\s+logo$/i, "") ||
          slugToName(pathParts()[0]),
        location: pick([
          ".posting-categories .location",
          '[class*="posting-category"].location',
          ".sort-by-time.posting-category",
        ]),
        jd: pickBlock([
          '[data-qa="job-description"]',
          ".section-wrapper.page-full-width",
          ".content .section-wrapper",
          ".section-wrapper",
        ]),
      }),
    },

    {
      name: "generic",
      match: () => true,
      run: () => {
        const ld = fromJsonLd();
        if (ld && ld.role) {
          return {
            role: ld.role,
            company: ld.company || companyFromUrl(),
            location: ld.location,
            jd: ld.jd,
          };
        }

        // No JSON-LD: fall back to OpenGraph + headings, then to the page title.
        const ogTitle = meta("og:title");
        const h1 = pick(["h1"]);
        let role = h1 || ogTitle;
        let company = meta("og:site_name");

        if (!role) {
          // "Senior Engineer at Acme" / "Senior Engineer | Acme Careers"
          const parts = document.title.split(/\s+[|–—-]\s+|\s+\bat\b\s+/i);
          role = clean(parts[0]);
          if (!company && parts[1]) company = clean(parts[1]);
        }

        return {
          role: clean(role),
          company: clean(company) || companyFromUrl(),
          location: meta("og:locality") || pick(['[class*="location"]', '[id*="location"]']),
          jd: pickBlock([
            '[class*="job-description"]',
            '[id*="job-description"]',
            '[class*="jobDescription"]',
            '[data-testid*="description"]',
            "article",
            "main",
            '[role="main"]',
            "body",
          ]),
        };
      },
    },
  ];

  // ---------- run ----------

  try {
    const host = location.hostname.replace(/^www\./, "");
    const adapter = adapters.find((a) => a.match(host)) || adapters[adapters.length - 1];
    const found = adapter.run() || {};

    const job = {
      company: clean(found.company),
      role: clean(found.role),
      location: clean(found.location),
      jd: cleanBlock(found.jd),
      url: location.href.split("#")[0],
      source: adapter.name,
      capturedAt: new Date().toISOString(),
    };
    // A real posting has a real description. 40 words is well below any genuine
    // JD and well above a board blurb, so it separates the two cleanly.
    const jdWords = job.jd ? job.jd.trim().split(/\s+/).length : 0;
    job.confidence = job.company && job.role && jdWords >= 40 ? "high" : "partial";

    return { ok: true, job };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
})();
