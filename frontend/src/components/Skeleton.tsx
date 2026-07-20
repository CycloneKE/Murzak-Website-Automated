
import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = "" }) => (
  <div className={`animate-pulse bg-slate-200 dark:bg-black/5 rounded-lg ${className}`} />
);

export const SkeletonHero: React.FC = () => (
  <div className="relative min-h-[80vh] w-full flex items-center pt-24 pb-32 overflow-hidden bg-slate-100">
    <div className="max-w-7xl mx-auto px-6 lg:px-12 w-full space-y-10">
      <Skeleton className="h-10 w-64 rounded-full" />
      <div className="space-y-4">
        <Skeleton className="h-20 lg:h-32 w-full lg:w-3/4" />
        <Skeleton className="h-20 lg:h-32 w-1/2" />
      </div>
      <Skeleton className="h-10 w-2/3 max-w-xl" />
      <div className="flex flex-col sm:flex-row gap-6">
        <Skeleton className="h-16 w-full sm:w-64 rounded-2xl" />
        <Skeleton className="h-16 w-full sm:w-64 rounded-2xl" />
      </div>
    </div>
  </div>
);

export const SkeletonCard: React.FC = () => (
  <div className="bg-white dark:bg-murzak-ink rounded-[3rem] overflow-hidden border border-slate-100 dark:border-murzak-border/50 h-full">
    <Skeleton className="h-48 lg:h-64 rounded-none" />
    <div className="p-8 lg:p-12 space-y-6">
      <Skeleton className="h-10 w-10 rounded-xl" />
      <Skeleton className="h-8 w-3/4" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  </div>
);

export const SkeletonGrid: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-16">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export const SkeletonList: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <Skeleton key={i} className="h-20 w-full rounded-2xl" />
    ))}
  </div>
);
