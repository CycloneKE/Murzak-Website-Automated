import React from "react";
import {
  AlertTriangle, Archive, Database, FileText, FolderOpen, Globe, HeartPulse, KeyRound, Mail, RefreshCw, Settings,
  SlidersHorizontal, SquareTerminal,
} from "lucide-react";
import { type SelectedServiceView } from "../../../../types";

export type SectionId =
  | "general"
  | "address"
  | "environment"
  | "updates"
  | "logs"
  | "terminal"
  | "health"
  | "backups"
  | "files"
  | "mailboxes"
  | "connection"
  | "advanced"
  | "danger";

export interface ServiceSection {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  tone?: "danger";
}

interface SectionContext {
  service: SelectedServiceView;
  /** Git-sourced app with build history. */
  deployable: boolean;
}

/**
 * The sections a service's page shows. A section appears only when there is
 * something real behind it for this kind of service — an empty section is
 * worse than a missing one.
 */
export function sectionsFor({ service, deployable }: SectionContext): ServiceSection[] {
  const isActive = service.status === "Active";
  const isStorage = service.category === "Storage";
  const isEmail = service.category === "Email Hosting";
  const isDatabase = service.category === "Database Hosting";
  const isWebsiteHosting = service.serviceId === "biz-web-hosting";
  // Storage and email run without a container of ours: no domain to attach,
  // no settings to change, exactly as before this redesign.
  const hasContainer = !isStorage && !isEmail && !isWebsiteHosting;

  const out: ServiceSection[] = [{ id: "general", label: "General", icon: <Settings /> }];
  if (isStorage) out.push({ id: "files", label: "Files", icon: <FolderOpen /> });
  if (isEmail) out.push({ id: "mailboxes", label: "Mailboxes", icon: <Mail /> });
  if (isDatabase) out.push({ id: "connection", label: "Connection", icon: <Database /> });
  if (hasContainer && isActive) out.push({ id: "address", label: "Domains", icon: <Globe /> });
  if (deployable && isActive) out.push({ id: "environment", label: "Environment", icon: <KeyRound /> });
  if (deployable) out.push({ id: "updates", label: "Deployments", icon: <RefreshCw /> });
  if (deployable && isActive) out.push({ id: "logs", label: "Logs", icon: <FileText /> });
  if (deployable && isActive) out.push({ id: "health", label: "Healthcheck", icon: <HeartPulse /> });
  if (hasContainer && isActive) out.push({ id: "terminal", label: "Terminal", icon: <SquareTerminal /> });
  if (hasContainer && isActive) out.push({ id: "backups", label: "Backups", icon: <Archive /> });
  if (hasContainer) out.push({ id: "advanced", label: "Advanced", icon: <SlidersHorizontal /> });
  if (!isWebsiteHosting) out.push({ id: "danger", label: "Danger zone", icon: <AlertTriangle />, tone: "danger" });
  return out;
}
