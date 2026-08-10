import React from 'react';

export type Page = 'home' | 'services' | 'cloud' | 'pricing' | 'solutions' | 'products' | 'pos' | 'erp' | 'crm' | 'custom-software' | 'about' | 'contact' | 'test-request' | 'privacy' | 'terms' | 'sla' | 'login' | 'portal' | 'payment' | 'for-retail' | 'for-clinics' | 'for-logistics' | 'for-services' | 'deploy';

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
  pos: "/products/pos",
  erp: "/products/erp",
  crm: "/products/crm",
  "custom-software": "/products/custom",
  "for-retail": "/for/retail",
  "for-clinics": "/for/clinics",
  "for-logistics": "/for/logistics",
  "for-services": "/for/services",
  deploy: "/deploy",
};

export type AccountStatus = 'Pending' | 'Provisioning' | 'Active' | 'Suspended' | 'Evaluating';

export interface NavItem {
  label: string;
  page: Page;
}

export interface NavProps {
  onNavigate: (page: Page) => void;
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