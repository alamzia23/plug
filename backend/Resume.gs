/**
 * plug — the master resume.
 *
 * This is a .gs file rather than resume.json because clasp only pushes
 * .gs / .html / appsscript.json — a .json file would never reach the project.
 *
 * WHAT'S HERE IS DEMO DATA. Replace it with your own in the Apps Script editor,
 * where it stays in your project and out of version control. Everything in this
 * object is sent to whichever LLM provider you configured, and nowhere else.
 *
 * Bullets with numbers in them are what make a draft specific: "improved CI/CD"
 * produces a vague email, "cut deploy time from 40 minutes to 6" produces one
 * worth reading. The demo data below is written that way on purpose.
 */

var MASTER_RESUME = {
  name: 'Jane Doe',
  headline: 'devops engineer · kubernetes, gitops, ci/cd',
  location: 'Example City',
  years: 3,
  links: {
    linkedin: 'https://linkedin.com/in/example',
    github: 'https://github.com/example',
  },

  summary:
    'DevOps engineer with 3 years on a multi-tenant SaaS platform. Runs production ' +
    'Kubernetes across two clouds. Looking at startup and product DevOps roles.',

  skills: [
    'Kubernetes', 'AWS EKS', 'Azure OpenShift', 'Terraform', 'Helm',
    'Argo CD', 'Tekton', 'GitHub Actions', 'Docker', 'Python', 'Bash',
    'Prometheus', 'Grafana', 'OpenSearch', 'IAM', 'Linux',
  ],

  experience: [
    {
      company: 'Northwind Systems',
      title: 'DevOps Engineer',
      period: '2023 — present',
      bullets: [
        'Owned Kubernetes and OpenShift for a multi-tenant product across two clouds — Helm, GitOps with Argo CD, networking, TLS, image rollouts and production troubleshooting.',
        'Built and maintained 15+ CI/CD pipelines used by 30+ engineers for builds, tenant workflows, security scanning and deploys.',
        'Implemented autoscaling on custom metrics and cut infrastructure cost by about 25%.',
        'Automated migration of 150+ secrets during a regional move, replacing roughly two days of manual work with a pipeline.',
        'Led a search-cluster migration across dev, test and stage with a scripted reindex and health checks, with zero downtime for dependent services.',
      ],
    },
    {
      company: 'Contoso Labs',
      title: 'DevOps Intern',
      period: '2022 — 2023',
      bullets: [
        'Built an internal Q&A chatbot over product and support documentation.',
        'Added CI workflows for pull-request validation — lint and test gates on every PR.',
      ],
    },
  ],

  // Hackathons and side projects often say more than a job bullet does,
  // especially to a startup. Kept separate so the model can reach for one when
  // the job calls for it rather than treating it as work history.
  projects: [
    {
      name: 'Repo Triage Bot',
      what: 'Stale-PR detection and duplicate-issue clustering across GitHub, Slack and Notion.',
      result: 'placed in the top 50 of 3,000+ entries at a public hackathon.',
    },
    {
      name: 'Platform Catalog Services',
      what: 'Two catalog services on OpenShift: a queue health agent and a Git + CI + GitOps pipeline.',
      result: 'both merged upstream.',
    },
  ],

  education: [
    {
      school: 'Example Institute of Technology',
      // A headline says the abbreviation, never the full name. Without the
      // aliases the alumni signal never fires.
      aliases: ['EIT'],
      degree: 'B.Tech, Electronics and Communication Engineering',
      year: '2022',
    },
  ],
};
