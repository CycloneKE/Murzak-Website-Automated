import React from 'react';

export type Page = 'home' | 'services' | 'cloud' | 'pricing' | 'solutions' | 'products' | 'pos' | 'erp' | 'crm' | 'custom-software' | 'about' | 'contact' | 'test-request' | 'privacy' | 'terms' | 'sla' | 'login' | 'portal' | 'payment' | 'thank-you' | 'for-retail' | 'for-clinics' | 'for-logistics' | 'for-services' | 'deploy' | 'cloud-domains' | 'cloud-wordpress' | 'cloud-databases' | 'cloud-n8n' | 'cloud-email';

// Single source of truth for Page key -> URL path, shared by App.tsx's router
// wiring and anything (e.g. Breadcrumbs) that needs to turn a Page key into a
// real URL rather than naively assuming the key IS the path (it usually
// isn't — "home" -> "/", "custom-software" -> "/products/custom", etc).
export const pageToPath: Record<Page, string> = {
  home: "/",
  services: "/services",
  cloud: "/cloud",
  pricing: "/pricing",
  solutions: "/solutions",
  products: "/products",
  about: "/about",
  contact: "/contact",
  "test-request": "/test-request",
  privacy: "/privacy",
  terms: "/terms",
  sla: "/sla",
  login: "/login",
  portal: "/portal",
  payment: "/payment",
  "thank-you": "/thank-you",
  pos: "/products/pos",
  erp: "/products/erp",
  crm: "/products/crm",
  "custom-software": "/products/custom",
  "for-retail": "/for/retail",
  "for-clinics": "/for/clinics",
  "for-logistics": "/for/logistics",
  "for-services": "/for/services",
  deploy: "/deploy",
  "cloud-domains": "/cloud/domains",
  "cloud-wordpress": "/cloud/wordpress",
  "cloud-databases": "/cloud/databases",
  "cloud-n8n": "/cloud/n8n",
  "cloud-email": "/cloud/email",
};

export type AccountStatus = 'Pending' | 'Provisioning' | 'Active' | 'Suspended' | 'Evaluating';

export interface NavItem {
  label: string;
  page: Page;
}

export interface NavProps {
  /**
   * Accepts a Page key OR a raw path — App.tsx's handler is literally
   * `(pageOrPath: string)` and callers pass `c.path || c.page`. This was
   * declared as `(page: Page) => void`, which was simply not what the app
   * does; nothing caught it because @types/react was missing, so most of the
   * JSX type-checking was inert.
   */
  onNavigate: (pageOrPath: Page | string) => void;
  /**
   * Set while a route transition is in flight. App.tsx passes this to five
   * pages; only three declared it, so the other two silently ignored it and
   * never showed a loading state.
   */
  isLoading?: boolean;
}

export interface ProjectUpdate {
  id: string;
  timestamp: string;
  engineer: string;
  content: string;
  type: 'milestone' | 'technical' | 'alert';
  acknowledged?: boolean;
}

export interface Project {
  id: string;
  name: string;
  status: string;
  progress: number;
  sourceCode?: string;
}

export interface ServerStatus {
  id: string;
  name: string;
  ip: string;
  status: 'Online' | 'Offline' | 'Provisioning';
  cpu: number;
  ram: number;
}

export interface Invoice {
  id: string;
  amount: number;
  date: string;
  status: 'Paid' | 'Unpaid' | 'Overdue';
  type: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  company: string;
  plan: 'None' | 'Starter' | 'Business' | 'Enterprise' | 'Test';
  accountStatus: AccountStatus;
  projects: Project[];
  servers: ServerStatus[];
  invoices: Invoice[];
  updates: ProjectUpdate[];
  sourceCode?: string;
  evaluationGoal?: string;
  /** Services attached to the account (from the configurator/portal selection). */
  selectedServices?: Array<{
    serviceId: string;
    serviceName?: string;
    tier?: string;
    status?: string;
    [k: string]: unknown;
  }>;
  /** Convenience list of selected add-on service ids. */
  addonServiceIds?: string[];
}

export type ScrollTarget = "pricing-plans" | null;

export type ServiceStatus = 'Active' | 'Setting up' | 'Awaiting Payment';

export type SelectedServiceView = {
  serviceId: string;
  name: string;
  tier?: string;
  category?: string;
  domainChoice?: string;
  status: ServiceStatus;
  isAddon: boolean;
  /** Looked up from the service catalog by serviceId — matches ServiceHealth's looseness. */
  capacityClass?: string;
};
// ---- Business email (mail plans) ----

export type MailPlanId = 'mail-starter' | 'mail-business' | 'mail-pro';

/** What the order form sends with a mail plan order (POST /api/orders `mailSetup`). */
export interface MailSetup {
  planId: MailPlanId;
  businessName: string;
  domain: string;
  /** 'new' = we register it; 'own' = the customer already owns it. */
  domainMode: 'new' | 'own';
  contactEmail: string;
  mailboxes: string[];
  logoUrl?: string;
}

export type MailStageState = 'pending' | 'running' | 'done' | 'failed';

export interface MailStage {
  id: 'payment' | 'domain' | 'mail' | 'webmail';
  label: string;
  state: MailStageState;
}

export interface MailDnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
}

/** GET /api/mail/status/:token. Never carries ids, hashes or secrets. */
export interface MailStatus {
  state: string;
  stages: MailStage[];
  mailboxes: Array<{ address: string; passwordSet: boolean }>;
  webmailUrl: string;
  plan: { planId: MailPlanId | null; mailboxLimit: number; mailboxCount: number };
  /** Fixed support sentence; present only when state is needs_attention. */
  message?: string;
  /** Only while the customer still has to publish records at their own registrar. */
  dnsRecords?: MailDnsRecord[];
}
