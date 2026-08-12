import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Fires once when the attached element first crosses the viewport threshold,
 * then stops observing. Doesn't re-trigger on scroll back up — repeat
 * reveal-on-every-pass reads as gimmicky rather than intentional.
 */
export function useInView<T extends Element>(options?: IntersectionObserverInit): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.15, ...options });

    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, inView];
}
