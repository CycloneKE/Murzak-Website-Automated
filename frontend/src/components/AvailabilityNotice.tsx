import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock } from "lucide-react";
import { fetchAvailability, type Availability } from "../services/bundles";

/** Availability for the storefront; null while loading, when bundles are off, or if the fetch fails. */
export function useAvailability(): Availability | null {
  const [data, setData] = useState<Availability | null>(null);
  useEffect(() => {
    let live = true;
    fetchAvailability()
      .then((a) => live && setData(a.enabled ? a : null))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, []);
  return data;
}

/**
 * Capacity notice for business apps: "Limited availability" when only a few
 * slots remain, a "currently full" message (with a contact link) at zero.
 * Renders nothing when capacity is fine, bundles are off, or the fetch fails.
 */
const AvailabilityNotice: React.FC<{ className?: string }> = ({ className = "" }) => {
  const availability = useAvailability();
  const level = availability?.headroom.level;
  if (level !== "limited" && level !== "full") return null;

  if (level === "full") {
    return (
      <div
        data-testid="availability-notice"
        role="status"
        className={`flex gap-3 rounded-2xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 ${className}`}
      >
        <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
        <p className="text-sm font-semibold text-red-800 dark:text-red-200">
          <span className="font-black">Business apps are currently full.</span> New business-app slots open as capacity frees up.{" "}
          <Link to="/contact" className="font-black underline underline-offset-2 text-red-700 dark:text-red-300">
            Contact us to join the waitlist
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="availability-notice"
      role="status"
      className={`flex gap-3 rounded-2xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 ${className}`}
    >
      <Clock size={18} className="shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        <span className="font-black">Limited availability.</span> Only a few business-app slots are left, so reserve yours soon.
      </p>
    </div>
  );
};

export default AvailabilityNotice;
