
import React, { useState } from 'react';

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  aspectRatio?: string;
  objectFit?: 'cover' | 'contain';
  width?: number;
}

/**
 * OptimizedImage Component v3 (Hard Transition Focus)
 * Removes slow animations to prevent content "disappearing" during state changes.
 */
const OptimizedImage: React.FC<OptimizedImageProps> = ({ 
  src, 
  alt, 
  className = "", 
  priority = false,
  aspectRatio = "auto",
  objectFit = "cover",
  width = 1200
}) => {
  const [isLoaded, setIsLoaded] = useState(false);

  // Target optimized URL with exact width hint
  const highResUrl = src.includes('unsplash.com')
    ? `${src}${src.includes('?') ? '&' : '?'}auto=format&q=75&w=${width}`
    : src;

  return (
    <div 
      className={`relative overflow-hidden bg-slate-200 dark:bg-black/5 ${className}`}
      style={{ aspectRatio }}
    >
      <img
        src={highResUrl}
        alt={alt}
        className={`w-full h-full ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        style={{ objectFit }}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setIsLoaded(true)}
      />
      
      {!isLoaded && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-black/5 animate-shimmer" 
             style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)', backgroundSize: '200% 100%' }} />
      )}
    </div>
  );
};

export default OptimizedImage;
