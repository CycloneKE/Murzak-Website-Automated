import React from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

interface PButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-p-accent text-p-accent-fg border border-transparent hover:bg-p-accent-hover",
  secondary: "bg-p-panel text-p-text border border-p-border hover:border-p-border-strong hover:bg-p-panel-2",
  danger: "bg-p-panel text-p-danger border border-p-danger/40 hover:bg-p-danger-soft",
  ghost: "bg-transparent text-p-muted border border-transparent hover:text-p-text hover:bg-p-panel-2",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "p-tap px-3.5 text-sm",
};

/** The portal's button. One primary per screen; everything else is secondary. */
const PButton = React.forwardRef<HTMLButtonElement, PButtonProps>(function PButton(
  { variant = "secondary", size = "md", icon, loading, disabled, className = "", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export default PButton;
