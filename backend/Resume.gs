/**
 * plug — the master resume, as dummy data.
 *
 * This is a .gs file rather than resume.json because clasp only pushes
 * .gs / .html / appsscript.json — a .json file would never reach the project.
 *
 * Replace the contents with your real resume when you're ready. Nothing here
 * is sent anywhere except to the LLM provider you configured.
 */

var MASTER_RESUME = {
  name: 'Asha Nair',
  headline: 'frontend engineer · design systems',
  location: 'Example City, IN',
  years: 4,
  links: {
    github: 'https://github.com/example',
    site: 'https://example.com',
  },
  skills: [
    'TypeScript', 'React', 'design systems', 'accessibility',
    'performance', 'Node.js', 'Playwright',
  ],
  experience: [
    {
      company: 'Nutmeg Pay',
      title: 'Senior Frontend Engineer',
      period: '2023 — present',
      bullets: [
        'Built the shared component library used by 6 product teams; cut new-screen build time from ~3 days to under 1.',
        'Took the checkout flow from 4.1s to 1.6s LCP by removing render-blocking third parties and code-splitting the payment module.',
        'Introduced visual regression tests in CI, which caught 30+ layout breaks before release in the first quarter.',
      ],
    },
    {
      company: 'Kettle',
      title: 'Frontend Engineer',
      period: '2021 — 2023',
      bullets: [
        'Rebuilt the onboarding funnel; completion rose from 52% to 68% over two quarters.',
        'Made the dashboard keyboard-navigable and screen-reader clean, closing a WCAG AA audit with no outstanding issues.',
      ],
    },
  ],
  education: [{ school: 'NIT Trichy', degree: 'B.Tech, Computer Science', year: '2021' }],
};
