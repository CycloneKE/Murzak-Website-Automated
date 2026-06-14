
export type HostingDomainChoice =
  | "Use Murzak Subdomain"
  | "Bring My Domain"
  | "Register New Domain";

export interface HostingDomainPurchaseRequest {
  id: string;
  requestedName: string;
  requestedTld: string;
  fullDomain: string;
  status: string;
  notes?: string;
  provider?: string;
  isPrimary?: boolean;
  createdAt?: string;
}

export interface HostingMurzakSubdomain {
  id: string;
  requestedLabel: string;
  fullSubdomain: string;
  status: string;
  targetType?: string;
  targetValue?: string;
  notes?: string;
  isPrimary?: boolean;
  createdAt?: string;
}

export interface HostingExternalDomain {
  id: string;
  domainName: string;
  status: string;
  registrar?: string;
  nameserver1?: string;
  nameserver2?: string;
  aRecord?: string;
  verificationNotes?: string;
  isPrimary?: boolean;
  createdAt?: string;
}

export interface HostingSupportRequest {
  id: string;
  category: string;
  title: string;
  description: string;
  status: string;
  createdAt?: string;
}

export interface HostingFile {
  id: string;
  fileName: string;
  filePath?: string;
  fileSizeMb: number;
  fileType?: string;
  uploadCategory: string;
  status: string;
  isActiveBuild?: boolean;
  notes?: string;
  createdAt?: string;
}

export interface HostingDeployment {
  id: string;
  sourceFile?: string;
  deploymentType?: string;
  status: string;
  targetPath?: string;
  notes?: string;
  createdAt?: string;
}

export interface HostingActivityLog {
  id: string;
  eventType: string;
  title: string;
  description?: string;
  createdAt?: string;
}

export interface HostingSite {
  id: string;
  siteType: "domain" | "murzak_subdomain" | "external_domain";
  primaryHost: string;
  status: "pending" | "active" | "suspended";
  planName?: string;
  tier?: string;
  storageLimitMb: number;
  storageUsedMb: number;
  sslStatus: "pending" | "active" | "none";
  documentRoot?: string;
  notes?: string;
  createdAt?: string;
}

export interface HostingDashboardPayload {
  service: {
    serviceId: string;
    serviceName: string;
    tier: string;
    status: "active" | "awaiting_payment";
    domainChoice: HostingDomainChoice | null;
  };
  hostingStatus: "pending" | "active" | "suspended";
  activeSite: HostingSite | null;
  registerNewDomainRequests: HostingDomainPurchaseRequest[];
  murzakSubdomains: HostingMurzakSubdomain[];
  externalDomains: HostingExternalDomain[];
  requests: HostingSupportRequest[];
  files: HostingFile[];
  deployments: HostingDeployment[];
  activity: HostingActivityLog[];
}
