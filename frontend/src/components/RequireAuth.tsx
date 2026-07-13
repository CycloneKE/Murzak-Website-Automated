import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "../types";

export default function RequireAuth({
  user,
  children,
}: {
  user: User | null;
  children: React.ReactNode;
}) {
  const location = useLocation();

  if (!user) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
}
