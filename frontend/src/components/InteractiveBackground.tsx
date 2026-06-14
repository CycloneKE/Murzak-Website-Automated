
import React from 'react';

interface InteractiveBackgroundProps {
  isDarkMode?: boolean;
}

/**
 * Decorative motion layer only — the muted backdrop image + base now live on the
 * body background (see index.css). This adds drifting brand-gradient auras above
 * that backdrop but below page content (transparent, non-interactive).
 */
const InteractiveBackground: React.FC<InteractiveBackgroundProps> = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none">
      <div className="absolute top-[-20%] left-[-10%] w-[80vw] h-[80vh] rounded-full blur-[180px] bg-murzak-violet/10 animate-drift" />
      <div
        className="absolute bottom-[-25%] right-[-10%] w-[85vw] h-[85vh] rounded-full blur-[200px] bg-murzak-cyan/10 animate-drift-slow"
        style={{ animationDelay: '8s' }}
      />
    </div>
  );
};

export default InteractiveBackground;
