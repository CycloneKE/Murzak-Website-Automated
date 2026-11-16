import React from "react";
import PButton from "./PButton";

interface EmptyProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/** Empty state: says what belongs here and offers the one next step. */
export default function Empty({ icon, title, description, actionLabel, onAction, className = "" }: EmptyProps) {
  return (
    <div className={`text-center py-8 px-4 ${className}`}>
      {icon && (
        <div className="w-10 h-10 mx-auto mb-3 rounded-md border border-p-border bg-p-panel-2 text-p-muted flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-p-text">{title}</p>
      {description && <p className="mt-1 text-[13px] text-p-muted max-w-sm mx-auto">{description}</p>}
      {actionLabel && onAction && (
        <PButton variant="primary" onClick={onAction} className="mt-4">
          {actionLabel}
        </PButton>
      )}
    </div>
  );
}
