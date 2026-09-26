/**
 * plug — the master resume.
 *
 * This is a .gs file rather than resume.json because clasp only pushes
 * .gs / .html / appsscript.json — a .json file would never reach the project.
 *
 * Everything here is sent to whichever LLM provider is configured, and nothing
 * else. Bullets with numbers in them are what make a draft specific: "improved
 * CI/CD" produces a vague email, "cut deploy time from 40 minutes to 6"
 * produces one worth reading.
 */

var MASTER_RESUME = {
  name: 'Jane Doe',
  headline: 'devops engineer · kubernetes, gitops, ci/cd',
  location: 'Example City, India',
  years: 2,
  links: {
    linkedin: 'https://linkedin.com/in/example',
    github: 'https://github.com/example',
  },

  summary:
    'DevOps engineer with 2+ years on the Fabrikam file-transfer product, first as a ' +
    'Contoso Labs intern and then full-time after IBM acquired the business. Runs production ' +
    'Kubernetes on AWS EKS and Azure OpenShift. Looking at startup and product DevOps roles.',

  skills: [
    'Kubernetes', 'AWS EKS', 'Azure OpenShift', 'Terraform', 'Helm',
    'Argo CD', 'Tekton', 'GitHub Actions', 'Docker', 'Python', 'Bash',
    'Prometheus', 'Grafana', 'OpenSearch', 'AWS Secrets Manager', 'IAM', 'Linux',
  ],

  experience: [
    {
      company: 'Northwind Systems',
      title: 'DevOps Engineer, Fabrikam Managed Transfer',
      period: 'Jul 2024 — present',
      note: 'product acquired from Contoso Labs, Jul 2024',
      bullets: [
        'Owned Kubernetes and OpenShift for a multi-tenant file-transfer product across AWS EKS and Azure OpenShift — Helm, GitOps with Argo CD, networking, TLS, image rollouts and production troubleshooting.',
        'Built and maintained 15+ GitHub Actions and Tekton pipelines used by 30+ engineers for CI, tenant workflows, validation, security scanning and deploys.',
        'Implemented HPA on custom metrics and cut infrastructure cost by about 25%.',
        'Built tenant lifecycle workflows (provision and suspend for SVC1, SVC2, SVC3) that cut cloud cost about 30% between peak and idle.',
        'Automated migration of 150+ secrets during a regional move, replacing roughly 1.5–2 days of manual work with a pipeline.',
        'Led the a search-cluster migration move across AWS and Azure dev/test/stage with a Python reindex and health checks, with zero downtime for collector services.',
      ],
    },
    {
      company: 'Contoso Labs',
      title: 'DevOps Intern',
      period: 'Jan 2024 — Jun 2024',
      bullets: [
        'Built an internal Q&A chatbot over product and support content using IBM an LLM platform and a document search service.',
        'Added GitHub Actions workflows for pull-request validation — lint and test gates on every PR.',
      ],
    },
  ],

  // Hackathons and side projects often say more than a job bullet does,
  // especially to a startup. Kept separate so the model can reach for one when
  // the job calls for it rather than treating it as work history.
  projects: [
    {
      name: 'Repo Triage Bot',
      what: 'AI triage for GitHub repos — stale-PR detection and duplicate-issue clustering across GitHub, Slack and Notion.',
      result: 'top 50 of 3,000+ entries; won the a sponsor prize.',
    },
    {
      name: 'Platform Catalogathon',
      what: 'Shipped two catalog services on OpenShift: a RabbitMQ health agent and a Gitea + Tekton + Argo CD pipeline.',
      result: 'both merged upstream.',
    },
    {
      name: 'Review Agents',
      what: 'Multi-agent performance-review pipeline.',
      result: 'selected from 10,000 applicants at the OpenAI x Outskill hackathon.',
    },
    {
      name: 'Incident Memory',
      what: 'Knowledge-graph incident memory for on-call — surfaces prior root causes via Cognee Cloud and signed webhooks.',
      result: '',
    },
  ],

  education: [
    {
      school: 'Example Institute of Technology',
      // A LinkedIn headline says "EIT", never the full name. Without the
      // aliases the alumni signal never fires.
      aliases: ['EIT', 'Example Institute of Technology'],
      degree: 'B.Tech, Electronics and Communication Engineering',
      year: '2024',
    },
  ],
};
