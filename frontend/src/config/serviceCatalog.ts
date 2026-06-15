
export type PlanCode = "Test" | "Starter" | "Business" | "Enterprise";

export type ServiceCategory =
  | "Website Hosting"
  | "ERP Hosting"
  | "CRM & Helpdesk"
  | "Email Hosting"
  | "Database Hosting"
  | "Storage"
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
 *  - "volume":   light, shared slices of the KVM 4. High density, high aggregate margin.
 *  - "premium":  managed Frappe-class apps (ERPNext/POS/CRM). Low density (~2–4GB RAM each),
 *                so only a handful fit. Priced high.
 *  - "dedicated":too large for the shared KVM 4 — provisioning a separate/bigger server.
 *                Always quote-based ("custom"), never self-serve.
 */
export type CapacityClass = "volume" | "premium" | "dedicated";

/**
 * Real budget of the production box: ONE upstream KVM node sourced wholesale
 * (4 vCPU / 16 GB RAM / 200 GB NVMe / 16 TB bandwidth).
 * `sellable*` = what's left after OS + control plane + backups overhead.
 * Used for internal capacity tracking so we don't oversell beyond the hardware.
 * NOTE: white-label — never surface the upstream provider name to customers.
 */
export const SERVER_CAPACITY = {
  plan: "Murzak Cloud — Standard Node",
  totalRamMb: 16384,
  totalDiskGb: 200,
  vcpu: 4,
  bandwidthTb: 16,
  // ~3.5GB RAM and ~40GB disk reserved for OS/panel/proxy/backups
  sellableRamMb: 12800,
  sellableDiskGb: 160,
  // Approx wholesale cost to cover (KES/mo) — used to sanity-check margin.
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

  /** Short benefit bullets shown in the configurator. */
  highlights?: string[];

  tags?: string[];
  sortOrder?: number;
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
    label: "Starter",
    startingKes: 1200,
    period: "/mo",
    blurb: "Fast, managed hosting for a website, business email and small databases — billed in KES.",
    bestFor: "Websites, email & small business apps",
    cta: "Configure plan",
    features: ["Managed website hosting", "Business email", "Daily backups + SSL", "M-Pesa billing in KES"],
  },
  Business: {
    code: "Business",
    label: "Business",
    startingKes: 4500,
    period: "/mo",
    blurb: "Fully managed ERPNext, POS, CRM and apps — configured, hosted and supported from Nairobi.",
    bestFor: "Growing teams running business apps",
    cta: "Configure plan",
    featured: true,
    features: ["Managed ERPNext / POS / CRM", "Pre-configured & migrated", "Daily backups + hardening", "Priority Nairobi support"],
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

export const PLAN_LIMITS: Record<PlanCode, number> = {
  Test: 1,
  Starter: 3,
  Business: 5,
  Enterprise: 999,
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
      name: "ERPNext Demo Sandbox",
      description: "Pre-seeded ERPNext sandbox to explore modules and workflows.",
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
      resources: { ramMb: 256, diskGb: 25 },
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
      name: "Managed ERPNext (1–3 users)",
      description: "Fully managed ERPNext for a small operation — we host, configure and back it up.",
      category: "ERP Hosting",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "20GB NVMe", cpu: "1–2 vCPU", bandwidth: "Generous", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 20 },
      pricing: { model: "addon", monthlyKes: 6000, setupKes: 5000 },
      highlights: ["Managed ERPNext", "Daily backups", "SSL + custom domain", "Email support"],
      sortOrder: 10,
    },
    {
      id: "biz-erp-configured",
      name: "Managed ERPNext (5–20 users, configured)",
      description: "ERPNext tailored to your departments (KE tax, inventory, accounting) and migrated for you.",
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
      description: "Enterprise ERPNext on dedicated capacity with hardening and scale.",
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

/**
 * Services shown in the configurator for a plan: the plan's own catalog plus
 * the universal add-ons (for self-serve paid plans). Test and Enterprise stay
 * scoped to their own lists (trial / dedicated quote).
 */
export function configuratorServices(planCode: PlanCode): ServiceItem[] {
  const base = SERVICE_CATALOG[planCode] ?? [];
  if (planCode === "Test" || planCode === "Enterprise") return base;
  return [...base, ...UNIVERSAL_ADDONS];
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
//  CAPACITY ENFORCEMENT — the box is ONE shared node (see SERVER_CAPACITY).
//  A single self-serve order must not consume capacity that only a dedicated
//  box can serve; beyond these caps the build becomes an Enterprise/quote.
//  (Fleet-level oversell is gated server-side at provisioning time.)
// =====================================================================

// A single self-serve tenant shouldn't eat more than ~half the sellable box.
export const SELF_SERVE_ORDER_RAM_CAP_MB = 6144; // 6 GB
export const SELF_SERVE_ORDER_DISK_CAP_GB = 80; // 80 GB

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
