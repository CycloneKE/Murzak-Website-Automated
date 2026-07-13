import React from "react";

// Canonical page section: one set of container widths and vertical rhythm so
// pages stop drifting between max-w-[1000/1100/1320px] and py-16/20/24/28/36.
// Adopt incrementally — new/rewritten pages should use this instead of bespoke
// section + container markup.

type Spacing = "tight" | "default" | "hero";
type Width = "narrow" | "default" | "wide";

const SPACING: Record<Spacing, string> = {
  tight: "py-12 sm:py-16",
  default: "py-16 sm:py-24",
  hero: "py-20 sm:py-28 lg:py-32",
};

const WIDTH: Record<Width, string> = {
  narrow: "max-w-2xl",
  default: "max-w-[1100px]",
  wide: "max-w-[1320px]",
};

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  spacing?: Spacing;
  width?: Width;
  id?: string;
}

export function Section({
  children,
  className = "",
  innerClassName = "",
  spacing = "default",
  width = "default",
  id,
}: SectionProps) {
  return (
    <section id={id} className={`${SPACING[spacing]} ${className}`}>
      <div className={`${WIDTH[width]} mx-auto px-6 sm:px-10 lg:px-16 ${innerClassName}`}>
        {children}
      </div>
    </section>
  );
}

export default Section;
