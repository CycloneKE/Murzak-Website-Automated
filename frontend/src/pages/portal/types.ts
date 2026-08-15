import { User, Page } from "../../types";

/** Top-level portal destinations. "admin" is staff-only (gated on user.is_admin). */
export type Tab = "overview" | "cloud" | "billing" | "profile" | "admin";

export const isTab = (v: string | undefined): v is Tab =>
  v === "overview" ||
  v === "cloud" ||
  v === "billing" ||
  v === "profile" ||
  v === "admin";

export interface PortalProps {
  user: User;
  onLogout: () => void;
  onNavigate: (page: Page) => void;
  onUserUpdate: (user: User) => void;
}
