import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemePreference = "light" | "dark" | "system";
type EffectiveTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  effective: EffectiveTheme;
  setTheme: (theme: ThemePreference) => void;
  toggle: () => void;
  setForceLight: (force: boolean) => void;
}

const STORAGE_KEY = "murzak-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to system.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  // Set by routes (the client portal) that must never render in dark mode,
  // regardless of the site-wide preference — overrides `effective` for the
  // <html> class without touching the stored preference, so leaving the
  // route restores whatever theme the user had picked.
  const [forceLight, setForceLight] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const effective: EffectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const applied: EffectiveTheme = forceLight ? "light" : effective;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", applied === "dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", applied === "dark" ? "#090C10" : "#0B3C5D");
  }, [applied]);

  const setTheme = (next: ThemePreference) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
  };

  const toggle = () => setTheme(effective === "dark" ? "light" : "dark");

  const value = useMemo(
    () => ({ theme, effective: applied, setTheme, toggle, setForceLight }),
    [theme, applied]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
