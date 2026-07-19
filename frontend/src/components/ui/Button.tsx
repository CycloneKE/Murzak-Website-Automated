import React from "react";

// Glass UI Button Component
// Implements the primary gradient, secondary outline, and ghost variants.

type Variant = "primary" | "secondary" | "ghost" | "onDark";
type Size = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-murzak-muted disabled:border-none disabled:shadow-none";

const SIZES: Record<Size, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-2.5 text-base",
  lg: "px-8 py-3.5 text-lg",
};

const VARIANTS: Record<Variant, string> = {
  // Primary: Brand Gradient with subtle hover glow
  primary: "bg-brand-gradient text-murzak-ink hover:scale-[1.02] shadow-md hover:shadow-murzak-brand2/30",
  // Secondary: White with light border
  secondary:
    "bg-white dark:bg-white/5 border border-murzak-border text-murzak-ink dark:text-slate-100 hover:border-murzak-accent hover:text-murzak-accent shadow-sm",
  // Ghost: No background, subtle hover
  ghost:
    "bg-transparent text-murzak-ink dark:text-slate-100 hover:bg-slate-100/50 dark:hover:bg-white/5",
  // For use on dark glass/spatial panels
  onDark: "bg-black/5 border border-white/20 text-murzak-ink hover:bg-white/20",
};

type ButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = "primary",
  size = "md",
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

