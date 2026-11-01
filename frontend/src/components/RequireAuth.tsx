import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "../types";
import { redactStatusPath } from "../utils/safeUrl";

export default function RequireAuth({
  user,
  children,
}: {
  user: User | null;
  children: React.ReactNode;
}) {
  const location = useLocation();

  if (!user) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(redactStatusPath(location.pathname + location.search))}`} replace />;
  }

  return <>{children}</>;
}
