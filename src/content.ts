// Everything the terminal says about me lives here. Source of truth: the resume and pramodburra-site-v2.

export const profile = {
  name: 'Pramod Burra',
  user: 'pramod',
  role: 'Technical Lead · AI Engineer',
  location: 'Hyderabad, India · IST',
  email: 'pramodburra@outlook.com',
  resume: '/resume.pdf',
  links: {
    github: 'https://github.com/pramod457',
    linkedin: 'https://linkedin.com/in/pramodburra',
  },
  summary:
    'Technical Lead and AI Engineer with 11+ years, including 7 on site in the US, designing, building and deploying production LLM powered applications, agentic and multi-agent workflows, and autonomous AI systems end to end. Currently architecting an AI native integration platform on Workato.',
  facts: [
    ['experience', '11+ years'],
    ['on-site US', '7 years'],
    ['domains', 'healthcare · banking · insurance · retail · government · energy'],
    ['arc', 'rules → workflows → AI → platforms'],
  ] as [string, string][],
  contactNote:
    'Open to conversations about conversational AI, LLM evaluation, integration platforms and anything involving making AI behave in production. The fastest way to reach me is email.',
};

export type Project = {
  id: string;
  name: string;
  tagline: string;
  status?: string;
  problem: string;
  stack: string[];
  highlights: string[];
  url?: string;
};

export const projects: Project[] = [
  {
    id: 'agent-platform',
    name: 'Local-first Agent Platform',
    tagline: 'Multi-model AI agents that execute tasks and operate the computer',
    status: 'In active development',
    problem:
      'A local-first, multi-model AI agent platform with autonomous task execution, tool orchestration, computer interaction, and secure execution environments.',
    stack: ['Agentic AI', 'Multi-model', 'Tool orchestration', 'Computer use', 'Local LLMs', 'Sandboxing'],
    highlights: [
      'Autonomous task execution with orchestrated tools.',
      'Computer interaction: agents act on the desktop, not only in chat.',
      'Secure, sandboxed execution environments.',
    ],
  },
  {
    id: 'agent-harness',
    name: 'AI Harness Engineering',
    tagline: 'Building and benchmarking agent execution frameworks',
    problem:
      'Built and benchmarked AI agent execution frameworks, evaluating task accuracy, reliability, debugging capabilities, tool integration, and cost efficiency.',
    stack: ['Agent harnesses', 'Benchmarking', 'Evaluation', 'Tool integration'],
    highlights: [
      'Scored on task accuracy and reliability, not demos.',
      'Debugging capability and tool integration measured side by side.',
      'Cost efficiency treated as a first-class metric.',
    ],
  },
  {
    id: 'llm-infra',
    name: 'LLM Infrastructure & Optimization',
    tagline: 'Local inference, GPU resources and model switching',
    problem:
      'Local LLM inference, GPU resource optimization, model-switching performance, and secure sandboxed execution.',
    stack: ['Local LLM inference', 'GPU optimization', 'Model switching', 'Sandboxing'],
    highlights: [
      'GPU resource optimization for local models.',
      'Model-switching performance.',
      'Secure sandboxed execution.',
    ],
  },
  {
    id: 'foundry-telemetry',
    name: 'Agent Telemetry on Azure AI Foundry',
    tagline: 'Enterprise AI agent observability POC',
    status: 'Proof of concept',
    problem:
      'An enterprise AI agent telemetry POC on Azure AI Foundry integrating business KPIs, technical performance metrics, and LLM usage analytics to support data-driven decision-making.',
    stack: ['Azure AI Foundry', 'Observability', 'Telemetry', 'LLM analytics'],
    highlights: [
      'Business KPIs next to technical performance metrics.',
      'LLM usage analytics for data-driven decisions.',
    ],
  },
  {
    id: 'ai-ipaas',
    name: 'AI-native iPaaS',
    tagline: 'An integration platform on Workato, built on Migration Studio',
    status: 'Migration Studio shipped · platform in design',
    problem:
      'Migration Studio reads an integration process from Boomi or Celigo into a canonical model of 53 entity types, and a target planner and generator emit native Workato recipes. Anything it cannot translate faithfully becomes a visible finding, never a silent drop. The question shaping the platform: where AI is reliable enough to act, and where it should only propose.',
    stack: ['Workato', 'Canonical models', 'Adapters', 'Revision store', 'LLMs', 'System architecture'],
    highlights: [
      'A new source platform = one new adapter, not a rewrite.',
      'Rule-based translation by choice: inspectable, repeatable, reviewable.',
      'Recipes are delivered stopped. A human turns them on after review.',
      'Every generated step traces back to the exact source shape it came from.',
    ],
  },
  {
    id: 'dialoglens',
    name: 'DialogLens',
    tagline: 'Automated LLM evaluation & bot-testing platform',
    problem:
      'Conversational AI ships on a demo and breaks in production. DialogLens parses a bot definition into a conversation graph, traverses every path, and auto-generates positive, negative, edge-case and regression suites, then scores intent accuracy, response quality and hallucination rate continuously.',
    stack: ['Python', 'FastAPI', 'RAG', 'Azure OpenAI', 'Supabase', 'pgvector'],
    highlights: [
      'Test generation is graph traversal, so coverage scales with the bot, not the QA team.',
      'Pluggable executors (Kore.ai XO, Zendesk): a suite written once survives a platform migration.',
      'Database-first with zero local state: any worker can pick up any run.',
      'Change the bot and the suite regenerates. Tests cannot drift from the thing they test.',
    ],
  },
  {
    id: 'conversational-ai',
    name: 'Enterprise Conversational AI',
    tagline: 'Kore.ai XO platform at customer-engagement scale',
    problem:
      'Enterprise conversational AI for large-scale customer engagement and self-service: agent nodes, search AI, knowledge AI and dialog tasks, integrated with enterprise APIs, auth, CRM and backend microservices, with RAG-style retrieval for grounding and hallucination reduction.',
    stack: ['Kore.ai XO', 'RAG', 'Docker', 'Kubernetes', 'Azure', 'CI/CD'],
    highlights: [
      'Evaluation built alongside the assistant, not bolted on afterwards.',
      'Fallback analysis: where an assistant gives up points straight at what to build next.',
      'Response-quality and hallucination monitoring in production.',
    ],
  },
  {
    id: 'decision-automation',
    name: 'Decision Automation',
    tagline: 'Enterprise business rules in IBM ODM, 2015 to 2023',
    problem:
      'Eight years converting complex regulatory policy into scalable, highly-available rule-based systems across healthcare, insurance, banking and government. The same discipline carries into AI evaluation: both are about making system behaviour provable.',
    stack: ['IBM ODM', 'Java', 'Camunda BPM', 'Microservices'],
    highlights: [
      'Humana, MetLife, PNC, Radian, NC Dept. of Revenue, PwC.',
      'Rules live apart from code, so a policy change is reviewable by the people who own the policy.',
    ],
  },
  {
    id: 'homelab',
    name: 'homelab-bootstrap',
    tagline: 'Secure Ubuntu homelab bootstrap and verification toolkit',
    problem:
      'The homelab that served the previous version of this site: k3s, Traefik, Flux GitOps, Cloudflare tunnel with nothing exposed inbound. This toolkit makes a fresh box secure and proves that it is.',
    stack: ['Shell', 'Ubuntu', 'k3s', 'Flux', 'Cloudflare'],
    highlights: ['Bootstrap and verification as code.'],
    url: 'https://github.com/pramod457/homelab-bootstrap',
  },
];

export type Role = { period: string; role: string; org: string; client?: string; current?: boolean; points: string[] };

export const experience: Role[] = [
  {
    period: 'Apr 2025 — present',
    role: 'Technical Lead / Kore.ai Developer',
    org: 'Nitco Inc',
    client: 'Enterprise conversational AI',
    current: true,
    points: [
      'Enterprise conversational AI on Kore.ai XO integrated with APIs, auth, CRM and microservices.',
      'RAG-style semantic search; prompt strategies for grounding and hallucination reduction.',
      'Automated LLM evaluation: intent accuracy, regression, positive/negative test generation.',
      'Now designing an AI-native integration platform on Workato.',
    ],
  },
  {
    period: 'Mar 2023 — May 2025',
    role: 'Java / Camunda Developer',
    org: 'Nitco Inc',
    client: 'PepsiCo',
    points: ['Workflow automation on Camunda BPM and Java with scalable microservices and REST integrations.'],
  },
  {
    period: 'Sep 2022 — Mar 2023',
    role: 'Java Developer',
    org: 'Nitco Inc',
    client: 'BPX Energy',
    points: ['Automation and regression-testing frameworks in Java and Selenium.'],
  },
  {
    period: 'May 2015 — Mar 2023',
    role: 'IBM ODM Consultant',
    org: 'Nitco Inc',
    client: 'Humana · MetLife · PNC · Radian · NC Dept. of Revenue · PwC',
    points: ['Business-rule and decision-automation services turning regulatory policy into provable systems.'],
  },
];

export const education = {
  period: '2013 — 2015',
  degree: 'M.S., Management Information Systems',
  school: 'Central Michigan University',
};

export const skills: Record<string, string[]> = {
  'AI / LLM': ['Agentic AI', 'Agent harnesses', 'RAG', 'LLM evaluation', 'Prompt engineering', 'Azure OpenAI', 'Azure AI Foundry', 'Local LLM inference', 'MCP'],
  'Conversational AI': ['Kore.ai XO', 'Search AI', 'Knowledge AI', 'Dialog design', 'Containment metrics'],
  Integration: ['Workato', 'Boomi', 'Celigo', 'Camunda BPM', 'IBM ODM', 'REST'],
  Engineering: ['Python', 'FastAPI', 'Java', 'TypeScript', 'Supabase', 'pgvector'],
  Platform: ['GPU optimization', 'Sandboxed execution', 'LLM observability', 'Docker', 'Kubernetes / k3s', 'Flux GitOps', 'Traefik', 'Cloudflare', 'CI/CD'],
};
