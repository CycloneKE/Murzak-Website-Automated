
import React from 'react';

export type Page = 'home' | 'services' | 'cloud' | 'pricing' | 'solutions' | 'products' | 'about' | 'contact' | 'test-request' | 'privacy' | 'terms' | 'sla' | 'login' | 'portal' | 'payment';

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