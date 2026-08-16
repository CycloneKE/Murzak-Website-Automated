
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

/** A domain the account owns, independent of any service it may point at. */
export interface CustomerDomain {
  id: string;
  domainName: string;
  kind: "registered" | "external" | "murzak_subdomain";
  status: "pending" | "active" | "failed" | "expired" | "cancelled";
  registrar: string;
  sslStatus: "none" | "pending" | "active";
  expiresOn: string | null;
  autoRenew: boolean;
  /** serviceId this domain currently points at, or null when unattached. */
  attachedToService: string | null;
  sourceDoctype: string;
  sourceName: string;
  notes: string;
  createdAt?: string;
}

export interface HostingSite {
  id: string;
  siteType: "domain" | "murzak_subdomain" | "external_domain";
  primaryHost: string;
  /** The Customer Domain this site serves. Null on sites created before
   *  domains became account-owned and never re-requested since. */
  customerDomainId: string | null;
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
