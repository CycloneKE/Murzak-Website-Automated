import { useCallback, useEffect, useState } from "react";

/** Seconds left on a "wait before asking again" timer; start(n) begins it. */
export function useCooldown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);
  const start = useCallback((seconds: number) => setLeft(seconds), []);
  return [left, start];
}

/** What to tell the customer when asking for a code fails. */
export function codeRequestMessage(status: number, fallback: string): string {
  if (status === 429) return "You have asked for several codes already. Please wait a few minutes, then try again.";
  if (status === 502) return "We couldn't send the code just now. Please try again in a minute.";
  return fallback;
}
