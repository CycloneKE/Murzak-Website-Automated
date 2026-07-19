
import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'cloud-only';
  theme?: 'dark' | 'light';
  /** Hide the wordmark and show only the monogram (e.g. tight mobile headers). */
  markOnly?: boolean;
}

const Logo: React.FC<LogoProps> = ({ className = "", variant = 'full', theme, markOnly = false }) => {
  // Wordmark ("MURZAK") follows the surface: dark on light, white on dark.
  const wordmarkColor =
    theme === 'dark' ? 'text-white'
    : theme === 'light' ? 'text-murzak-ink'
    : 'text-murzak-ink';

  const secondary = variant === 'cloud-only' ? 'Cloud' : 'Technologies';

  return (
    <div
      className={`flex items-center gap-2 sm:gap-2.5 select-none transition-colors duration-300 ${className}`}
      aria-label="Murzak Technologies"
    >
      <picture>
        <source srcSet="/murzak-monogram.webp" type="image/webp" />
        <img
          src="/murzak-monogram.png"
          alt=""
          aria-hidden="true"
          width={257}
          height={128}
          className="h-7 sm:h-9 lg:h-10 w-auto shrink-0 drop-shadow-sm"
          draggable={false}
        />
      </picture>

      {!markOnly && (
        <div className="flex flex-col leading-none">
          <span
            className={`font-[900] text-[clamp(1rem,3.5vw,1.45rem)] tracking-[-0.04em] uppercase ${wordmarkColor}`}
            style={{ lineHeight: '0.9' }}
          >
            Murzak
          </span>
          <span
            className="font-[800] text-[clamp(0.6875rem,1.4vw,0.8125rem)] tracking-[0.15em] lg:tracking-[0.2em] uppercase mt-1 text-murzak-gradient"
          >
            {secondary}
          </span>
        </div>
      )}
    </div>
  );
};

export default Logo;
