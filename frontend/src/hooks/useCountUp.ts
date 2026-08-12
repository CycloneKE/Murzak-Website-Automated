import { useEffect, useState } from "react";

/**
 * Counts up from 0 to `target` once `start` flips true, easing out over
 * `durationMs`. Renders the target value immediately (no animation) for
 * users with prefers-reduced-motion, matching the site's global reduced-
 * motion handling in index.css rather than duplicating that check here.
 */
export function useCountUp(target: number, start: boolean, durationMs = 1200): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }

    let raf: number;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, target, durationMs]);

  return value;
}
