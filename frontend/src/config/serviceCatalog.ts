
export type PlanCode = "Test" | "Starter" | "Business" | "Enterprise";

export type ServiceCategory =
  | "Website Hosting"
  | "App Hosting"
  | "ERP Hosting"
  | "CRM & Helpdesk"
  | "Email Hosting"
  | "Database Hosting"
  | "Domain Registration"
  | "Storage"
  | "E-Signature"
  | "Invoicing"
  | "Scheduling"
  | "Apps"
  | "Security & Backup"
  | "POS & Inventory"
  | "Analytics"
  | "CCTV"
  | "Domains & SSL"
  | "Performance"
  | "Support & SLA";

export type DomainChoice =
  | "Use Murzak Subdomain"
  | "Bring My Domain"
  | "Register New Domain";

/**
 * Capacity class — drives both economics and provisioning:
 *  - "volume":   light, shared slices of the KVM 2. High density, high aggregate margin.
 *  - "premium":  managed Frappe-class apps (Murzak ERP/POS/CRM). Low density (~2–4GB RAM each),
 *                so only one or two fit on this box. Priced high.
 *  - "scalable": high-availability, horizontally scalable workloads via Kubernetes.
 *  - "dedicated":too large for the shared KVM 2 — provisioning a separate/bigger server.
 *                Always quote-based ("custom"), never self-serve.
 */
export type CapacityClass = "volume" | "premium" | "scalable" | "dedicated";

/**
 * Real budget of the production box: ONE upstream KVM node sourced wholesale
 * (2 vCPU / 8 GB RAM / 100 GB NVMe / 8 TB bandwidth — confirmed against
 * hPanel 2026-08-15; an earlier "KVM 4" figure here was wrong on every axis
 * by exactly 2x and went uncaught until an infra audit compared it against
 * the actual server).
 * `sellable*` = what's left after OS + control plane + backups overhead
 * (kept at the same ~78%/80% fraction of the box the original sizing used).
 * Used for internal capacity tracking so we don't oversell beyond the hardware.
 * NOTE: white-label — never surface the upstream provider name to customers.
 */
export const SERVER_CAPACITY = {
  plan: "Murzak Cloud — Standard Node",
  totalRamMb: 8192,
  totalDiskGb: 100,
  vcpu: 2,
  bandwidthTb: 8,
  // ~1.8GB RAM and ~20GB disk reserved for OS/panel/proxy/backups
  sellableRamMb: 6400,
  sellableDiskGb: 80,
  // Approx wholesale cost to cover (KES/mo) — used to sanity-check margin.
  // NOT re-verified against the KVM 2's actual price during this resize —
  // confirm with Hostinger billing before trusting margin math against this.
  wholesaleKesPerMonth: 3000,
} as const;

export type ServiceOption = {
  id: string;
  name: string;
  description: string;
  category: ServiceCategory;

  tier: "Demo" | "Light" | "Medium" | "Large" | "Enterprise";

  /** Which part of the infrastructure this is sold from. */
  capacityClass: CapacityClass;

  specs: {
    ram: string;
    storage: string;
    cpu: string;
    bandwidth: string;
    backups: string;
    sla: string;
  };

  /**
   * Real resource footprint for capacity math (NOT shown to customers).
   * Omitted for "dedicated" items — they live on their own box.
   */
  resources?: {
    ramMb: number;
    diskGb: number;
  };

  pricing: {
    model: "included" | "addon" | "custom"; // custom = dedicated quote
    monthlyKes?: number; // retail monthly price (KES)
    setupKes?: number; // one-time setup fee (KES)
    domainAddonKes?: number; // optional domain add-on
  };

  requiresDomainChoice?: boolean;

  /**
   * This service deploys the CUSTOMER'S OWN app from a Git repository (BYOA).
   * The configurator asks for the repo URL and provisioning deploys from it —
   * an account with no repo URL escalates to a human instead of faking a build.
   */
  requiresRepo?: boolean;

  /** Short benefit bullets shown in the configurator. */
  highlights?: string[];

  tags?: string[];
  sortOrder?: number;

  /** Hidden from new self-serve purchases (cloudLaunchCatalog), but still
   * resolvable by getService/getServiceMeta so existing customers' pricing
   * and renewals keep working. Never delete a catalog id a customer might
   * already own — deprecate it instead. */
  deprecated?: boolean;
};

export type ServiceItem = ServiceOption;

export type SelectedService = {
  serviceId: string;
  domainChoice?: DomainChoice;
  notes?: string;

  serviceName?: string;
  category?: ServiceCategory;
  tier?: ServiceOption["tier"];
  specs?: Partial<ServiceOption["specs"]>;
};

/**
 * Plan archetypes used as marketing entry points. In the reseller model there is
 * no flat "plan fee" — the real price is the sum of configured services + domain.
 * `startingKes` is the cheapest sensible bundle for that tier (a "from" anchor).
 */
export type PlanMeta = {
  code: PlanCode;
  label: string;
  startingKes: number | null; // DERIVED at load from the catalog (see planStartingKes); literals below are placeholders
  period: string;
  blurb: string;
  bestFor: string;
  cta: string;
  featured?: boolean;
  /** Headline bullets for the pricing card. */
  features: string[];
};

export const PLAN_META: Record<PlanCode, PlanMeta> = {
  Test: {
    code: "Test",
    label: "Test Drive",
    startingKes: 0,
    period: "36-hour trial",
    blurb: "Spin up a real environment and see the performance for yourself — no card required.",
    bestFor: "Evaluating before you commit",
    cta: "Start free trial",
    features: ["36h live environment", "Engineer-assisted setup", "Live monitoring", "No card required"],
  },
  Starter: {
    code: "Starter",
    label: "Infrastructure Core",
    startingKes: 1200,
    period: "/mo",
    blurb: "Fast, managed infrastructure: Website hosting, business email, and databases — billed in KES.",
    bestFor: "Websites, email & standalone infrastructure",
    cta: "Configure infrastructure",
    features: ["Managed website hosting", "Business email", "Daily backups + SSL", "M-Pesa billing in KES"],
  },
  Business: {
    code: "Business",
    label: "Business Suite (SaaS)",
    startingKes: 4500,
    period: "/mo",
    blurb: "Fully managed SaaS applications (Murzak ERP, POS, CRM). Configured, hosted, and supported from Nairobi.",
    bestFor: "Growing teams needing POS, ERP & CRM",
    cta: "Configure SaaS apps",
    featured: true,
    features: ["Murzak Retail POS", "Managed Murzak ERP & CRM", "Pre-configured & migrated", "Priority Nairobi support"],
  },
  Enterprise: {
    code: "Enterprise",
    label: "Enterprise",
    startingKes: null,
    period: "",
    blurb: "Dedicated capacity for large ERPs, databases, multi-branch POS and high-load platforms.",
    bestFor: "High-load & multi-site operations",
    cta: "Talk to sales",
    features: ["Dedicated server / cluster", "Custom scaling & DR", "Security hardening", "Account-managed SLA"],
  },
};

/**
 * What a plan actually buys you now: a response time and a level of care.
 *
 * Plans used to cap how many services an account could hold (PLAN_LIMITS,
 * removed) and which tiers it could add (allowedAddonTiers, removed). Neither
 * was ever a real constraint — the box's RAM and disk are, and those are
 * enforced by exceedsSelfServeCap / orderCapacity.js. Worse, the frontend and
 * backend copies of the limits had drifted apart (Starter was 3 here and 2 on
 * the server), so the number a customer saw was not the one that would refuse
 * them.
 *
 * Every product is now buyable standalone at its own price. What differs by
 * plan is how fast we answer and how much we hold.
 */
export type SlaTier = {
  firstResponse: string;
  backupRetention: string;
  namedContact: boolean;
  channels: string[];
};

export const PLAN_SLA: Record<PlanCode, SlaTier> = {
  Test: {
    firstResponse: "Best effort",
    backupRetention: "None",
    namedContact: false,
    channels: ["Email"],
  },
  Starter: {
    firstResponse: "1 business day",
    backupRetention: "7 days",
    namedContact: false,
    channels: ["Email", "Portal"],
  },
  Business: {
    firstResponse: "4 business hours",
    backupRetention: "30 days",
    namedContact: false,
    channels: ["Email", "Portal", "WhatsApp"],
  },
  Enterprise: {
    firstResponse: "1 hour, 24/7",
    backupRetention: "90 days + DR",
    namedContact: true,
    channels: ["Email", "Portal", "WhatsApp", "Phone"],
  },
};

// =====================================================================
//  CATALOG — right-sized to one upstream KVM node (16GB RAM / 200GB NVMe).
//  Prices are margin-driven proposals (server costs ~KES 3,000/mo).
//  TUNE the monthlyKes / setupKes numbers freely.
// =====================================================================
export const SERVICE_CATALOG: Record<PlanCode, ServiceItem[]> = {
  // ---- TEST: free demo slices (volume class) ----
  Test: [
    {
      id: "test-web-hosting-demo",
      name: "Website Hosting Demo",
      description: "Trial environment to validate performance & deployment flow.",
      category: "Website Hosting",
      tier: "Demo",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "8GB NVMe", cpu: "1 vCPU", bandwidth: "Fair-use", backups: "None", sla: "Best effort" },
      resources: { ramMb: 512, diskGb: 8 },
      pricing: { model: "included", monthlyKes: 0 },
      requiresDomainChoice: false,
      highlights: ["Live in minutes", "Real NVMe storage", "Auto-expires after 36h"],
      sortOrder: 10,
    },
    {
      id: "test-erpnext-demo",
      name: "Murzak ERP Demo Sandbox",
      description: "Pre-seeded Murzak ERP sandbox to explore modules and workflows.",
      category: "ERP Hosting",
      tier: "Demo",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "15GB NVMe", cpu: "1 vCPU", bandwidth: "Fair-use", backups: "Daily snapshot", sla: "Best effort" },
      resources: { ramMb: 2048, diskGb: 15 },
      pricing: { model: "included", monthlyKes: 0 },
      highlights: ["Sample company data", "All core modules", "Reset anytime"],
      sortOrder: 20,
    },
    {
      id: "test-crm-demo",
      name: "CRM & Helpdesk Demo",
      description: "CRM/helpdesk demo environment to evaluate customer workflows.",
      category: "CRM & Helpdesk",
      tier: "Demo",
      capacityClass: "premium",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "1 vCPU", bandwidth: "Fair-use", backups: "None", sla: "Best effort" },
      resources: { ramMb: 1024, diskGb: 10 },
      pricing: { model: "included", monthlyKes: 0 },
      sortOrder: 30,
    },
  ],

  // ---- STARTER: volume class — light shared slices, high density ----
  Starter: [
    {
      id: "starter-web-hosting",
      name: "Website Hosting (Starter)",
      description: "Managed hosting for a company site, portfolio or light e-commerce.",
      category: "Website Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "1 vCPU (shared)", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 1200, setupKes: 500, domainAddonKes: 1500 },
      requiresDomainChoice: true,
      highlights: ["Free SSL", "Daily backups", "1-click WordPress", "Managed setup"],
      sortOrder: 10,
    },
    {
      id: "starter-web-hosting-plus",
      name: "Website Hosting (Growth)",
      description: "More headroom for busier sites and growing e-commerce.",
      category: "Website Hosting",
      tier: "Medium",
      capacityClass: "volume",
      specs: { ram: "2GB", storage: "20GB NVMe", cpu: "1–2 vCPU (shared)", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1536, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 2500, setupKes: 1000, domainAddonKes: 1500 },
      requiresDomainChoice: true,
      highlights: ["Free SSL + CDN", "Daily backups", "Staging area", "Priority email support"],
      sortOrder: 20,
    },
    {
      id: "starter-app-hosting",
      name: "App Hosting (Node.js / Docker)",
      description: "We deploy your own app straight from its Git repository — Node.js, Python, PHP or any Dockerfile — and keep it running.",
      category: "App Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "1 vCPU (shared)", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1024, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2200, setupKes: 1000, domainAddonKes: 1500 },
      requiresDomainChoice: true,
      requiresRepo: true,
      highlights: ["Deploys from your GitHub/GitLab repo", "Websockets & background jobs supported", "Free SSL + daily backups", "Managed restarts & monitoring"],
      sortOrder: 25,
    },
    {
      id: "starter-email",
      name: "Business Email",
      description: "Professional email on your domain — up to 5 mailboxes, 5GB each.",
      category: "Email Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "Shared", storage: "5GB / mailbox", cpu: "Shared", bandwidth: "Fair-use", backups: "Standard", sla: "99.5%" },
      resources: { ramMb: 256, diskGb: 25 },
      pricing: { model: "addon", monthlyKes: 1500, setupKes: 0 },
      highlights: ["Your-name@your-domain", "Webmail + IMAP/SMTP", "Spam filtering", "Up to 5 mailboxes"],
      sortOrder: 30,
    },
    {
      id: "starter-storage",
      name: "File Storage (25GB)",
      description: "Private cloud drive for files & team sharing.",
      category: "Storage",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "Shared", storage: "25GB", cpu: "Shared", bandwidth: "Generous", backups: "Weekly", sla: "99.5%" },
      // ramMb 0: this product runs on one shared MinIO bucket, not a
      // per-customer container — see
      // docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
      resources: { ramMb: 0, diskGb: 25 },
      pricing: { model: "addon", monthlyKes: 1200, setupKes: 0 },
      highlights: ["Drive-style sharing", "Access controls", "Weekly backups"],
      sortOrder: 40,
    },
    {
      id: "starter-db-light",
      name: "Database Hosting (Shared)",
      description: "Managed MySQL/Postgres for a small app or website.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["MySQL or Postgres", "Daily backups", "Remote access"],
      sortOrder: 50,
      deprecated: true,
    },
    {
      id: "starter-db-mongo",
      name: "Database Hosting (MongoDB)",
      description: "Managed MongoDB for apps built on a document database.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["MongoDB 7", "Daily backups", "Remote access"],
      sortOrder: 55,
      deprecated: true,
    },
    {
      id: "db-mysql",
      name: "MySQL Database",
      description: "Managed MySQL for your app or website.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["Daily backups", "Remote access", "Managed by us"],
      sortOrder: 51,
    },
    {
      id: "db-postgres",
      name: "PostgreSQL Database",
      description: "Managed PostgreSQL for your app or website.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["Daily backups", "Remote access", "Managed by us"],
      sortOrder: 52,
    },
    {
      id: "db-mongo",
      name: "MongoDB Database",
      description: "Managed MongoDB for apps built on a document database.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["MongoDB 7", "Daily backups", "Remote access"],
      sortOrder: 53,
    },
    {
      id: "db-redis",
      name: "Redis Database",
      description: "Managed Redis for caching, queues, and session storage.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "5GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 5 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["In-memory speed", "Daily backups", "Remote access"],
      sortOrder: 54,
    },
    {
      id: "starter-esign",
      name: "E-Signature",
      description: "Send documents for signature and track status — your own e-signature tool.",
      category: "E-Signature",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "512MB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 512, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 1800, setupKes: 0 },
      highlights: ["Unlimited documents", "Signer tracking", "Your own domain"],
      sortOrder: 56,
    },
    {
      id: "starter-invoicing",
      name: "Invoicing",
      description: "Send invoices, track payments, and manage clients — your own invoicing tool.",
      category: "Invoicing",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1.25GB", storage: "15GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1280, diskGb: 15 },
      pricing: { model: "addon", monthlyKes: 3800, setupKes: 0 },
      highlights: ["Unlimited clients", "Payment tracking", "Your own domain"],
      sortOrder: 57,
    },
    {
      id: "starter-scheduling",
      name: "Scheduling",
      description: "Booking pages, calendar sync, and meeting scheduling — your own scheduling tool.",
      category: "Scheduling",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1024, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 3200, setupKes: 0 },
      highlights: ["Unlimited booking pages", "Calendar sync", "Your own domain"],
      sortOrder: 58,
    },
    {
      id: "starter-hrpay",
      name: "HR & Payroll (Light)",
      description: "Payroll + basic HR workflows for small teams.",
      category: "Apps",
      tier: "Light",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "15GB NVMe", cpu: "1 vCPU", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1536, diskGb: 15 },
      pricing: { model: "addon", monthlyKes: 3000, setupKes: 1500 },
      highlights: ["Payroll runs", "Leave & attendance", "Managed updates"],
      sortOrder: 60,
    },
  ],

  // ---- BUSINESS: premium class — managed Frappe apps (low density) ----
  Business: [
    {
      id: "biz-erp-light",
      name: "Murzak ERP (1–3 users)",
      description: "Fully managed Murzak ERP for a small operation — we host, configure and back it up.",
      category: "ERP Hosting",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "20GB NVMe", cpu: "1–2 vCPU", bandwidth: "Generous", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 6000, setupKes: 5000 },
      highlights: ["Managed Murzak ERP", "Daily backups", "SSL + custom domain", "Email support"],
      sortOrder: 10,
    },
    {
      id: "biz-erp-configured",
      name: "Murzak ERP (5–20 users, configured)",
      description: "Murzak ERP tailored to your departments (KE tax, inventory, accounting) and migrated for you.",
      category: "ERP Hosting",
      tier: "Large",
      capacityClass: "premium",
      specs: { ram: "4GB", storage: "40GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 4096, diskGb: 40 },
      pricing: { model: "addon", monthlyKes: 12000, setupKes: 12000 },
      highlights: ["Configured to your workflows", "Data migration included", "KE tax & compliance", "Priority support"],
      sortOrder: 20,
    },
    {
      id: "biz-pos-inventory",
      name: "POS & Inventory",
      description: "Point of sale + inventory for a shop or branch, managed and hosted.",
      category: "POS & Inventory",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "25GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 25 },
      pricing: { model: "addon", monthlyKes: 4500, setupKes: 3000 },
      highlights: ["Touch POS", "Stock tracking", "Receipts & reports", "M-Pesa-ready"],
      sortOrder: 30,
    },
    {
      id: "biz-crm-helpdesk",
      name: "CRM + Helpdesk",
      description: "Sales CRM and support desk workflows for customer-facing teams.",
      category: "CRM & Helpdesk",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "20GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 4000, setupKes: 3000 },
      highlights: ["Pipeline & deals", "Ticketing", "Email integration"],
      sortOrder: 40,
    },
    {
      id: "biz-accounting",
      name: "Accounting System",
      description: "Hosted accounting app with daily backups.",
      category: "Apps",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "20GB NVMe", cpu: "1–2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 1536, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 3500, setupKes: 2000 },
      highlights: ["Invoicing & ledgers", "Tax reports", "Managed backups"],
      sortOrder: 50,
    },
    {
      id: "biz-webapps",
      name: "Web App / Internal Tools Hosting",
      description: "Host internal tools, portals and custom web apps.",
      category: "Apps",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "1.5GB", storage: "20GB NVMe", cpu: "1–2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 1536, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 3500, setupKes: 2000 },
      highlights: ["Node/PHP/Python", "CI deploy", "Managed runtime"],
      sortOrder: 60,
    },
    {
      id: "biz-scalable-webapp",
      name: "Scalable Web App (Kubernetes)",
      description: "High-availability, horizontally scalable app hosting backed by Kubernetes. Auto-scales with traffic.",
      category: "App Hosting",
      tier: "Large",
      capacityClass: "scalable",
      specs: { ram: "Auto-scaling", storage: "20GB NVMe", cpu: "Auto-scaling", bandwidth: "High", backups: "Daily", sla: "99.99%" },
      resources: { ramMb: 2048, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 8000, setupKes: 2000, domainAddonKes: 1500 },
      requiresDomainChoice: true,
      requiresRepo: true,
      highlights: ["Kubernetes backed", "Auto-scaling", "Self-healing", "Zero-downtime deploys"],
      sortOrder: 65,
    },
    {
      id: "biz-docs",
      name: "Document Management",
      description: "DMS for documents, workflows and access control.",
      category: "Apps",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "1.5GB", storage: "30GB NVMe", cpu: "1–2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 1536, diskGb: 30 },
      pricing: { model: "addon", monthlyKes: 3500, setupKes: 2000 },
      highlights: ["Versioning", "Access control", "Full-text search"],
      sortOrder: 70,
    },
    {
      id: "biz-db-medium",
      name: "Database Hosting (Dedicated)",
      description: "Dedicated managed database for production workloads.",
      category: "Database Hosting",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "4GB", storage: "40GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 4096, diskGb: 40 },
      pricing: { model: "addon", monthlyKes: 4000, setupKes: 2000 },
      highlights: ["MySQL/Postgres", "Daily backups", "Tuning included"],
      sortOrder: 80,
    },
    {
      id: "biz-email",
      name: "Business Email (Teams)",
      description: "Professional email on your domain for the whole team — larger mailboxes and admin controls.",
      category: "Email Hosting",
      tier: "Medium",
      capacityClass: "volume",
      specs: { ram: "Shared", storage: "15GB / mailbox", cpu: "Shared", bandwidth: "Generous", backups: "Standard", sla: "99.9%" },
      resources: { ramMb: 384, diskGb: 40 },
      pricing: { model: "addon", monthlyKes: 2500, setupKes: 500 },
      highlights: ["Unlimited team mailboxes", "Admin console", "Spam & malware filtering", "Webmail + IMAP/SMTP"],
      sortOrder: 85,
    },
    {
      id: "biz-web-hosting",
      name: "Website Hosting (Business)",
      description: "Higher-performance website hosting for busier sites.",
      category: "Website Hosting",
      tier: "Medium",
      capacityClass: "volume",
      specs: { ram: "2GB", storage: "25GB NVMe", cpu: "1–2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 1536, diskGb: 25 },
      pricing: { model: "addon", monthlyKes: 2500, setupKes: 1000, domainAddonKes: 1500 },
      requiresDomainChoice: true,
      highlights: ["Free SSL + CDN", "Staging", "Daily backups"],
      sortOrder: 90,
    },
  ],

  // ---- ENTERPRISE: dedicated class — quote only, provisions separate capacity ----
  Enterprise: [
    {
      id: "ent-erp-large",
      name: "Large ERP Hosting (Dedicated)",
      description: "Enterprise Murzak ERP on dedicated capacity with hardening and scale.",
      category: "ERP Hosting",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "16–64GB", storage: "500GB–2TB NVMe", cpu: "8–32 vCPU", bandwidth: "Very High", backups: "Daily + DR", sla: "99.95%" },
      pricing: { model: "custom" },
      highlights: ["Dedicated server/cluster", "Disaster recovery", "Dedicated account engineer"],
      sortOrder: 10,
    },
    {
      id: "ent-db-large",
      name: "Large Database Hosting (Dedicated)",
      description: "High-throughput managed DB for enterprise systems.",
      category: "Database Hosting",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "32GB+", storage: "1TB+ NVMe", cpu: "16 vCPU+", bandwidth: "Very High", backups: "Daily + PITR", sla: "99.95%" },
      pricing: { model: "custom" },
      sortOrder: 20,
    },
    {
      id: "ent-ecom-large",
      name: "Large E-commerce Platform (Dedicated)",
      description: "High-load e-commerce hosting with autoscaling.",
      category: "Website Hosting",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "16GB+", storage: "500GB+", cpu: "8 vCPU+", bandwidth: "Very High", backups: "Daily + CDN", sla: "99.95%" },
      pricing: { model: "custom" },
      requiresDomainChoice: true,
      sortOrder: 30,
    },
    {
      id: "ent-pos-multibranch",
      name: "Multi-branch POS (Dedicated)",
      description: "POS for multiple locations and high concurrency.",
      category: "POS & Inventory",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "16GB+", storage: "500GB+", cpu: "8 vCPU+", bandwidth: "Very High", backups: "Daily", sla: "99.95%" },
      pricing: { model: "custom" },
      sortOrder: 40,
    },
    {
      id: "ent-bi",
      name: "Business Intelligence (Dedicated)",
      description: "BI tools hosting — dashboards, ETL, analytics.",
      category: "Analytics",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "16GB+", storage: "500GB+", cpu: "8 vCPU+", bandwidth: "High", backups: "Daily", sla: "99.95%" },
      pricing: { model: "custom" },
      sortOrder: 50,
    },
    {
      id: "ent-mail",
      name: "Enterprise Mail (Dedicated)",
      description: "Enterprise email with policy, retention and admin controls.",
      category: "Email Hosting",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "Dedicated", storage: "Large / retention", cpu: "Dedicated", bandwidth: "High", backups: "Standard + retention", sla: "99.95%" },
      pricing: { model: "custom" },
      sortOrder: 60,
    },
    {
      id: "ent-cctv",
      name: "CCTV Storage (Dedicated)",
      description: "Video storage hosting with retention settings (separate storage server).",
      category: "CCTV",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "N/A", storage: "2TB+", cpu: "N/A", bandwidth: "High", backups: "Optional", sla: "99.95%" },
      pricing: { model: "custom" },
      sortOrder: 70,
    },
    {
      id: "ent-backup-server",
      name: "Backup / DR Server (Dedicated)",
      description: "Dedicated backup server / disaster-recovery node.",
      category: "Security & Backup",
      tier: "Enterprise",
      capacityClass: "dedicated",
      specs: { ram: "Dedicated", storage: "2TB+", cpu: "Dedicated", bandwidth: "High", backups: "Managed DR", sla: "99.95%" },
      pricing: { model: "custom" },
      sortOrder: 80,
    },
  ],
};

// =====================================================================
//  UNIVERSAL ADD-ONS — light, high-margin extras available on ANY paid
//  plan (Starter/Business). They sit on the shared KVM 4 (volume class)
//  and enrich the configurator with cross-cutting upsells. Prices are
//  margin-driven proposals — tune freely.
// =====================================================================
export const UNIVERSAL_ADDONS: ServiceItem[] = [
  // ---- Domains & SSL ----
  {
    id: "addon-ssl-premium",
    name: "Premium SSL (Wildcard / EV)",
    description: "Upgrade from free SSL to a wildcard or extended-validation certificate for stronger trust signals.",
    category: "Domains & SSL",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "—", cpu: "Shared", bandwidth: "—", backups: "—", sla: "99.9%" },
    resources: { ramMb: 16, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 700, setupKes: 0 },
    highlights: ["Covers all subdomains", "Green-bar trust", "Auto-renew & install"],
    sortOrder: 10,
  },
  {
    id: "addon-dedicated-ip",
    name: "Dedicated IP Address",
    description: "Your own IP for reputation, direct access and some compliance needs.",
    category: "Domains & SSL",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "—", cpu: "Shared", bandwidth: "—", backups: "—", sla: "99.9%" },
    resources: { ramMb: 8, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 700, setupKes: 0 },
    highlights: ["Own IP", "Better mail reputation", "Direct access"],
    sortOrder: 20,
  },

  // ---- Email ----
  {
    id: "addon-mailboxes-5",
    name: "+5 Business Mailboxes",
    description: "Add five more professional mailboxes on your domain.",
    category: "Email Hosting",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "5GB / mailbox", cpu: "Shared", bandwidth: "Fair-use", backups: "Standard", sla: "99.9%" },
    resources: { ramMb: 64, diskGb: 25 },
    pricing: { model: "addon", monthlyKes: 1200, setupKes: 0 },
    highlights: ["5 extra mailboxes", "Spam filtering", "Webmail + IMAP"],
    sortOrder: 30,
  },
  {
    id: "addon-bulk-email",
    name: "Bulk Email / Newsletters",
    description: "Send campaigns and transactional email from your domain, deliverability managed.",
    category: "Email Hosting",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "Shared", cpu: "Shared", bandwidth: "Generous", backups: "Standard", sla: "99.9%" },
    resources: { ramMb: 256, diskGb: 5 },
    pricing: { model: "addon", monthlyKes: 1500, setupKes: 1000 },
    highlights: ["Campaigns + templates", "SPF/DKIM set up", "Deliverability managed"],
    sortOrder: 40,
  },

  // ---- Storage & Backup ----
  {
    id: "addon-storage-50",
    name: "+50GB Storage",
    description: "Extra disk for files, media or growing databases.",
    category: "Storage",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "50GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Weekly", sla: "99.9%" },
    resources: { ramMb: 16, diskGb: 50 },
    pricing: { model: "addon", monthlyKes: 1500, setupKes: 0 },
    highlights: ["50GB NVMe", "Expandable anytime"],
    sortOrder: 50,
  },
  {
    id: "addon-backup-plus",
    name: "Hourly Backups + 30-day Retention",
    description: "Upgrade from daily to hourly backups with a 30-day restore window.",
    category: "Security & Backup",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "Included", cpu: "Shared", bandwidth: "—", backups: "Hourly · 30 days", sla: "99.9%" },
    resources: { ramMb: 32, diskGb: 20 },
    pricing: { model: "addon", monthlyKes: 1200, setupKes: 0 },
    highlights: ["Hourly snapshots", "30-day history", "One-click restore"],
    sortOrder: 60,
  },

  // ---- Security ----
  {
    id: "addon-waf",
    name: "Web Application Firewall",
    description: "Block common attacks (SQLi, XSS, bots) before they reach your site.",
    category: "Security & Backup",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "—", cpu: "Shared", bandwidth: "Generous", backups: "—", sla: "99.9%" },
    resources: { ramMb: 64, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1200, setupKes: 0 },
    highlights: ["OWASP rules", "Bot mitigation", "DDoS dampening"],
    sortOrder: 70,
  },
  {
    id: "addon-malware",
    name: "Malware Scanning & Removal",
    description: "Scheduled scans with cleanup if anything gets in.",
    category: "Security & Backup",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "—", cpu: "Shared", bandwidth: "—", backups: "—", sla: "99.9%" },
    resources: { ramMb: 64, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 900, setupKes: 0 },
    highlights: ["Daily scans", "Auto-clean", "Alerts"],
    sortOrder: 80,
  },

  // ---- Performance ----
  {
    id: "addon-cdn",
    name: "Global CDN",
    description: "Cache your site at edge locations for faster loads abroad.",
    category: "Performance",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "Shared", storage: "Edge cache", cpu: "Shared", bandwidth: "Offloaded", backups: "—", sla: "99.9%" },
    resources: { ramMb: 16, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 900, setupKes: 0 },
    highlights: ["Edge caching", "Faster global loads", "Bandwidth offload"],
    sortOrder: 90,
  },
  {
    id: "addon-staging",
    name: "Staging Environment",
    description: "A safe copy of your site to test changes before they go live.",
    category: "Performance",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "0.5GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Fair-use", backups: "Daily", sla: "99.9%" },
    resources: { ramMb: 512, diskGb: 10 },
    pricing: { model: "addon", monthlyKes: 1200, setupKes: 0 },
    highlights: ["One-click clone", "Push to live", "No risk"],
    sortOrder: 100,
  },

  // ---- Support & SLA ----
  {
    id: "addon-priority-support",
    name: "Priority Support (4h response)",
    description: "Jump the queue with a guaranteed 4-hour first response, business hours.",
    category: "Support & SLA",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "—", storage: "—", cpu: "—", bandwidth: "—", backups: "—", sla: "4h response" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 2500, setupKes: 0 },
    highlights: ["4h first response", "Named contact", "Phone + WhatsApp"],
    sortOrder: 110,
  },
  {
    id: "addon-managed-updates",
    name: "Managed Updates & Monitoring",
    description: "We watch uptime 24/7 and keep your apps, plugins and OS patched.",
    category: "Support & SLA",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "—", storage: "—", cpu: "—", bandwidth: "—", backups: "—", sla: "99.9%" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 2500, setupKes: 0 },
    highlights: ["24/7 monitoring", "Patch management", "Monthly report"],
    sortOrder: 120,
  },
  {
    id: "addon-migration",
    name: "Migration from Another Host",
    description: "One-time move of your existing site, email or data onto Murzak — done for you.",
    category: "Support & SLA",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "—", storage: "—", cpu: "—", bandwidth: "—", backups: "—", sla: "—" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 0, setupKes: 3000 },
    highlights: ["Zero-downtime move", "We handle DNS", "Verified before cutover"],
    sortOrder: 130,
  },
];

// =====================================================================
//  DOMAIN REGISTRATION — priced per TLD, not per plan. Billed yearly
//  (displayed "/yr" via isYearlyBilled), zero server footprint (a domain
//  purchase reserves no RAM/disk — fulfillment is the existing manual
//  domain-purchase-requests flow, unchanged by this catalog entry).
//  Prices MUST match backend/server.js's DOMAIN_TLD_PRICES exactly — that
//  object remains the server-side source of truth for /api/domains/check;
//  this catalog is what actually gets billed via /api/orders.
// =====================================================================
export const DOMAIN_CATALOG: ServiceItem[] = [
  {
    id: "domain-coke",
    name: "Domain — .co.ke",
    description: "Register a .co.ke domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1200 },
    sortOrder: 10,
  },
  {
    id: "domain-com",
    name: "Domain — .com",
    description: "Register a .com domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1500 },
    sortOrder: 20,
  },
  {
    id: "domain-ke",
    name: "Domain — .ke",
    description: "Register a .ke domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1800 },
    sortOrder: 30,
  },
  {
    id: "domain-org",
    name: "Domain — .org",
    description: "Register a .org domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1800 },
    sortOrder: 40,
  },
  {
    id: "domain-net",
    name: "Domain — .net",
    description: "Register a .net domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1800 },
    sortOrder: 50,
  },
  {
    id: "domain-africa",
    name: "Domain — .africa",
    description: "Register a .africa domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 2500 },
    sortOrder: 60,
  },
  {
    id: "domain-io",
    name: "Domain — .io",
    description: "Register a .io domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 4500 },
    sortOrder: 70,
  },
];

/** True for products billed yearly (domains) rather than monthly (everything else). */
export function isYearlyBilled(svc: ServiceItem): boolean {
  return svc.category === "Domain Registration";
}

/** Map a full TLD string (e.g. ".co.ke") to its DOMAIN_CATALOG product id. */
export function domainCatalogIdForTld(tld: string): string | null {
  const byTld: Record<string, string> = {
    ".co.ke": "domain-coke",
    ".com": "domain-com",
    ".ke": "domain-ke",
    ".org": "domain-org",
    ".net": "domain-net",
    ".africa": "domain-africa",
    ".io": "domain-io",
  };
  return byTld[tld] ?? null;
}

/**
 * Services shown in the configurator for a plan: the plan's own catalog plus
 * the universal add-ons (for self-serve paid plans). Test and Enterprise stay
 * scoped to their own lists (trial / dedicated quote).
 *
 * Deprecated ids (e.g. starter-db-light / starter-db-mongo, superseded by the
 * db-mysql/db-postgres/db-mongo/db-redis engine products) are hidden from
 * this NEW-purchase surface, same as cloudLaunchCatalog() — a new customer
 * must never be able to buy a deprecated id. They still resolve via
 * getService/getServiceMeta (SERVICE_INDEX below is never filtered) so
 * existing customers who already own one keep correct pricing/renewals.
 */
export function configuratorServices(planCode: PlanCode): ServiceItem[] {
  const base = SERVICE_CATALOG[planCode] ?? [];
  const pool = planCode === "Test" || planCode === "Enterprise" ? base : [...base, ...UNIVERSAL_ADDONS];
  return pool.filter((s) => !s.deprecated);
}

// ---- Helpers ----

/** Format a KES amount for display. */
export function formatKes(n?: number): string {
  if (n == null) return "Custom";
  return `KES ${n.toLocaleString()}`;
}

/** A service is quote-only when it's dedicated capacity / custom pricing. */
export function isQuoteOnly(svc: ServiceItem): boolean {
  return svc.capacityClass === "dedicated" || svc.pricing.model === "custom";
}

/**
 * Managed SaaS (premium: Murzak ERP/POS/CRM…) — configured & operated by the team,
 * so it's set up (not instant) after checkout. Drives the "Managed setup" badge
 * and the "Setting up" post-payment status. Volume hosting slices are not managed.
 */
export function isManagedSetup(svc: ServiceItem): boolean {
  return svc.capacityClass === "premium";
}

/**
 * Which /checkout order-summary "line" a service belongs to — drives which
 * post-purchase copy and framing the checkout page shows. Order matters:
 * premium (managed) beats category, and "App Hosting" is checked before the
 * broader CLOUD_LAUNCH_CATEGORIES membership so BYOA app hosting reads as
 * "app-hosting" rather than the generic "cloud" line.
 */
export type CheckoutLine = "cloud" | "app-hosting" | "business-system" | "hosting-service";

export function checkoutLineFor(svc: ServiceItem): CheckoutLine {
  if (svc.capacityClass === "premium") return "business-system";
  if (svc.category === "App Hosting") return "app-hosting";
  if ((CLOUD_LAUNCH_CATEGORIES as ServiceCategory[]).includes(svc.category)) return "cloud";
  return "hosting-service";
}

/**
 * Fallback "what happens after payment" copy for the checkout page, used both
 * as postPurchaseCopy()'s default branch and by the checkout page itself when
 * the order's service can't be resolved from the catalog — kept as one
 * exported constant so the two call sites can't drift apart.
 */
export const GENERIC_POST_PURCHASE_COPY =
  "Your resource is provisioned automatically and is typically live in about 10 minutes.";

/**
 * "What happens after payment" copy for the checkout page — no plan-tier or
 * hosting-provider names, just what the buyer should expect next.
 */
export function postPurchaseCopy(svc: ServiceItem): string {
  if (isManagedSetup(svc)) {
    return "Our team configures your system and hands it over within 24 hours — watch progress in your portal.";
  }
  if (svc.requiresRepo) {
    return "We deploy straight from your repository — your app is typically live in about 10 minutes.";
  }
  return GENERIC_POST_PURCHASE_COPY;
}

/** How long a checkout order's capacity reservation holds before it lapses. */
export const CHECKOUT_RESERVATION_MINUTES = 30;

// =====================================================================
//  SINGLE SOURCE OF TRUTH — price + lookup helpers.
//  Every customer-facing price MUST be derived from these, never hardcoded
//  in a page, so marketing copy can never drift from the configurator.
// =====================================================================

const SERVICE_INDEX: Record<string, ServiceItem> = (() => {
  const idx: Record<string, ServiceItem> = {};
  (Object.keys(SERVICE_CATALOG) as PlanCode[]).forEach((code) => {
    for (const s of SERVICE_CATALOG[code]) idx[s.id] = s;
  });
  for (const s of UNIVERSAL_ADDONS) idx[s.id] = s;
  for (const s of DOMAIN_CATALOG) idx[s.id] = s;
  return idx;
})();

/** Look up any catalog service (plan service or universal add-on) by id. */
export function getService(id: string): ServiceItem | undefined {
  return SERVICE_INDEX[id];
}

/** Monthly price (KES) of a service by id, or undefined if unknown. */
export function serviceMonthlyKes(id: string): number | undefined {
  return getService(id)?.pricing.monthlyKes;
}

/**
 * Which plan tab a service belongs to — used to open the configurator on the
 * right plan when a visitor picks a specific product elsewhere (e.g. the
 * Products page). Universal add-ons aren't tied to one plan; default to Business.
 */
export function planForService(id: string): PlanCode | null {
  for (const code of Object.keys(SERVICE_CATALOG) as PlanCode[]) {
    if ((SERVICE_CATALOG[code] || []).some((s) => s.id === id)) return code;
  }
  if (UNIVERSAL_ADDONS.some((s) => s.id === id)) return "Business";
  return null;
}

/** One-time setup fee (KES) of a service by id, or undefined if unknown. */
export function serviceSetupKes(id: string): number | undefined {
  return getService(id)?.pricing.setupKes;
}

/**
 * The honest "from" anchor for a plan card: the cheapest configurable monthly
 * price actually present in that plan's catalog. Derived (never hand-typed) so
 * "from KES X" on a card can never contradict the configurator.
 *  - Test => 0 (free), Enterprise => null (quote-only).
 */
export function planStartingKes(code: PlanCode): number | null {
  if (code === "Enterprise") return null;
  if (code === "Test") return 0;
  const prices = (SERVICE_CATALOG[code] ?? [])
    .filter((s) => s.pricing.model === "addon" && (s.pricing.monthlyKes ?? 0) > 0)
    .map((s) => s.pricing.monthlyKes as number);
  return prices.length ? Math.min(...prices) : null;
}

// =====================================================================
//  MURZAK CLOUD — instant single-resource checkout. Scoped to exactly the
//  volume-class categories that provision without a human (Coolify lane).
//  Deliberately excludes UNIVERSAL_ADDONS (those augment an existing
//  resource, e.g. "+50GB Storage" — they are not standalone launchable
//  resources) and anything capacityClass "premium"/"dedicated".
// =====================================================================

export type CloudLaunchCategory =
  | "Website Hosting"
  | "App Hosting"
  | "Database Hosting"
  | "Storage"
  | "E-Signature"
  | "Invoicing";

export const CLOUD_LAUNCH_CATEGORIES: CloudLaunchCategory[] = [
  "Website Hosting",
  "App Hosting",
  "Database Hosting",
  "Storage",
  "E-Signature",
  "Invoicing",
];

/** Every self-serve, instantly-provisioned resource, grouped by category. */
export function cloudLaunchCatalog(): Record<CloudLaunchCategory, ServiceItem[]> {
  const allVolumeServices = (Object.keys(SERVICE_CATALOG) as PlanCode[])
    .flatMap((code) => SERVICE_CATALOG[code])
    .filter((s) => s.capacityClass === "volume" && s.pricing.model === "addon" && !s.deprecated);

  const result = {} as Record<CloudLaunchCategory, ServiceItem[]>;
  for (const cat of CLOUD_LAUNCH_CATEGORIES) {
    result[cat] = allVolumeServices
      .filter((s) => s.category === cat)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  return result;
}

// =====================================================================
//  CAPACITY ENFORCEMENT — the box is ONE shared node (see SERVER_CAPACITY).
//  A single self-serve order must not consume capacity that only a dedicated
//  box can serve; beyond these caps the build becomes an Enterprise/quote.
//  (Fleet-level oversell is gated server-side at provisioning time.)
// =====================================================================

// A single self-serve tenant shouldn't eat more than ~half the sellable box.
// NOTE: on the real KVM 2 (see SERVER_CAPACITY), this halves what it was
// calibrated for on the previously-assumed KVM 4. biz-erp-configured and
// biz-db-medium (4096MB each) now individually exceed this cap alone —
// they can no longer be self-served as a single line item on this box.
// That's a pricing/product call (shrink their footprint, make them
// quote-only like the ent-* dedicated tier, or upgrade the box), not
// something this file should decide silently.
export const SELF_SERVE_ORDER_RAM_CAP_MB = 3200; // 3.2 GB
export const SELF_SERVE_ORDER_DISK_CAP_GB = 40; // 40 GB

export function serviceFootprint(svc: ServiceItem): { ramMb: number; diskGb: number } {
  return { ramMb: svc.resources?.ramMb ?? 0, diskGb: svc.resources?.diskGb ?? 0 };
}

/** Sum the real resource footprint of a set of services (for capacity math). */
export function sumFootprint(svcs: ServiceItem[]): { ramMb: number; diskGb: number } {
  return svcs.reduce(
    (acc, s) => {
      const f = serviceFootprint(s);
      return { ramMb: acc.ramMb + f.ramMb, diskGb: acc.diskGb + f.diskGb };
    },
    { ramMb: 0, diskGb: 0 }
  );
}

/** True when a selection exceeds what a single shared self-serve order may use. */
export function exceedsSelfServeCap(svcs: ServiceItem[]): {
  over: boolean;
  ramMb: number;
  diskGb: number;
  ramOver: boolean;
  diskOver: boolean;
} {
  const f = sumFootprint(svcs);
  const ramOver = f.ramMb > SELF_SERVE_ORDER_RAM_CAP_MB;
  const diskOver = f.diskGb > SELF_SERVE_ORDER_DISK_CAP_GB;
  return { over: ramOver || diskOver, ramMb: f.ramMb, diskGb: f.diskGb, ramOver, diskOver };
}

// Derive each plan's "from" anchor from the catalog at load time so the literal
// startingKes values in PLAN_META can never drift from real prices. This is the
// single source of truth every card/advisor reads via PLAN_META[code].startingKes.
(Object.keys(PLAN_META) as PlanCode[]).forEach((code) => {
  PLAN_META[code].startingKes = planStartingKes(code);
});
