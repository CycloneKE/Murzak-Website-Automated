import React from "react";

// Canonical button. Collapses the three competing "primary" looks across the
// app (bg-murzak-cyan / bg-white / bg-murzak-navy) into ONE primary plus a
// secondary and a ghost variant. Adopt incrementally for CTAs.

type Variant = "primary" | "secondary" | "ghost" | "onDark" | "outlineOnDark";
type Size = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-2xl font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed";

const SIZES: Record<Size, string> = {
  md: "px-6 py-3.5 text-[10px] sm:text-[11px]",
  lg: "px-8 py-4 text-[11px] sm:text-sm",
};

const VARIANTS: Record<Variant, string> = {
  // The one true primary: brand cyan on navy.
  primary: "bg-murzak-cyan text-murzak-navy hover:scale-[1.03] shadow-lg shadow-murzak-cyan/20",
  secondary:
    "bg-murzak-navy text-white dark:bg-white/10 dark:text-white hover:bg-murzak-navy/90 dark:hover:bg-white/15",
  ghost:
    "border border-slate-200 dark:border-white/20 text-murzak-navy dark:text-white hover:border-murzak-cyan",
  // For use on dark gradient/CTA bands where a white button reads best.
  onDark: "bg-white text-murzak-navy hover:scale-[1.03] shadow-xl",
  // Outline on a dark surface (theme-independent — always white on dark).
  outlineOnDark: "border-2 border-white/40 text-white hover:bg-white/10",
};

type ButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = "primary",
  size = "lg",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export default Button;
