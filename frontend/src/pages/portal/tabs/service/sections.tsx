import React from "react";
import { AlertTriangle, Database, FolderOpen, Globe, Mail, RefreshCw, Settings, SlidersHorizontal } from "lucide-react";
import { type SelectedServiceView } from "../../../../types";

export type SectionId =
  | "general"
  | "address"
  | "updates"
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
  if (hasContainer && isActive) out.push({ id: "address", label: "Web address", icon: <Globe /> });
  if (deployable) out.push({ id: "updates", label: "Updates", icon: <RefreshCw /> });
  if (hasContainer) out.push({ id: "advanced", label: "Advanced", icon: <SlidersHorizontal /> });
  if (!isWebsiteHosting) out.push({ id: "danger", label: "Danger zone", icon: <AlertTriangle />, tone: "danger" });
  return out;
}
