// One place for everything that ends up in <head> or a sitemap.
// CHANGE `url` BEFORE DEPLOYING — canonical tags and the sitemap are built from it.
export const SITE = {
  url: "https://plug.tools",
  name: "plug",
  tagline: "find your plug, get the referral.",
  description:
    "plug is a free browser extension that turns any job posting into a referral. It finds the right people at the company, drafts a personal email in your voice, and follows up for you.",
  locale: "en_IN",
  storeUrl: "", // chrome web store listing, once it exists
  repoUrl: "https://github.com/alamzia23/job-referral-agent",
} as const;

export const NAV = [
  { href: "/#how", label: "how it works" },
  { href: "/blog", label: "writing" },
  { href: "/privacy", label: "privacy" },
] as const;
