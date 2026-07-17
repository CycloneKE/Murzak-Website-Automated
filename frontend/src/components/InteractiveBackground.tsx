import React from 'react';

interface InteractiveBackgroundProps {
  isDarkMode?: boolean;
}

/**
 * Decorative motion layer. Provides the soft, airy glassmorphism gradients
 * using the new Glass UI tokens (Brand Gradient and Accent).
 */
const InteractiveBackground: React.FC<InteractiveBackgroundProps> = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none">
      {/* Top left purple/brand blob */}
      <div className="absolute top-[-20%] left-[-10%] w-[80vw] h-[80vh] rounded-full blur-[180px] bg-murzak-brand1/15 animate-drift" />
      
      {/* Bottom right blue/accent blob */}
      <div
        className="absolute bottom-[-25%] right-[-10%] w-[85vw] h-[85vh] rounded-full blur-[200px] bg-murzak-accent/15 animate-drift-slow"
        style={{ animationDelay: '8s' }}
      />

      {/* Additional subtle mid blob for texture */}
      <div 
        className="absolute top-[30%] left-[40%] w-[50vw] h-[50vh] rounded-full blur-[160px] bg-murzak-brand2/10 animate-float"
        style={{ animationDelay: '4s' }}
      />
    </div>
  );
};

export default InteractiveBackground;
