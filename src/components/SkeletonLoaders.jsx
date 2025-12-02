import React from 'react';

// Enhanced Skeleton with shimmer effect
const SkeletonBase = ({ className = '' }) => (
  <div className={`animate-shimmer rounded ${className}`} />
);

export const DealCardSkeleton = () => (
  <div className="rounded-2xl p-5 bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 animate-fadeIn">
    {/* Top row: Icon + Name/Email + Amount */}
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <SkeletonBase className="w-12 h-12 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <SkeletonBase className="h-5 w-32 mb-2" />
          <SkeletonBase className="h-4 w-40" />
        </div>
      </div>
      <SkeletonBase className="h-6 w-20 flex-shrink-0" />
    </div>
    {/* Confidence label + percentage */}
    <div className="flex items-center justify-between mb-2">
      <SkeletonBase className="h-4 w-28" />
      <SkeletonBase className="h-4 w-8" />
    </div>
    {/* Progress bar */}
    <SkeletonBase className="h-1.5 w-full rounded-full mb-4" />
    {/* Assignee chip */}
    <SkeletonBase className="h-8 w-32 rounded-lg" />
  </div>
);

export const KanbanColumnSkeleton = () => (
  <div className="flex flex-col min-w-[300px] max-w-[340px] h-full animate-fadeIn">
    {/* Header skeleton */}
    <div className="rounded-t-2xl p-4 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SkeletonBase className="h-8 w-8 rounded-lg" />
          <SkeletonBase className="h-6 w-24" />
        </div>
        <SkeletonBase className="h-6 w-8 rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <SkeletonBase className="h-5 w-20" />
        <SkeletonBase className="h-8 w-8 rounded-lg" />
      </div>
    </div>
    
    {/* Body skeleton */}
    <div className="flex-1 glass-surface rounded-b-2xl p-4 space-y-3">
      <DealCardSkeleton />
      <DealCardSkeleton />
      <DealCardSkeleton />
    </div>
  </div>
);

export const StatsCardSkeleton = () => (
  <div className="bg-white dark:bg-[#0D1F2D] rounded-[24px] shadow-[0_2px_8px_rgba(26,188,156,0.08)] p-5 animate-fadeIn">
    <div className="flex items-center justify-between mb-4">
      <SkeletonBase className="h-12 w-12 rounded-full" />
      <SkeletonBase className="h-8 w-16 rounded-full" />
    </div>
    <div className="space-y-2">
      <SkeletonBase className="h-4 w-24" />
      <SkeletonBase className="h-9 w-32" />
      <SkeletonBase className="h-4 w-40" />
    </div>
  </div>
);

export const AIInsightsWidgetSkeleton = () => (
  <div className="glass-surface rounded-[24px] p-6 animate-fadeIn">
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <SkeletonBase className="h-10 w-10 rounded-full" />
        <div>
          <SkeletonBase className="h-6 w-32 mb-2" />
          <SkeletonBase className="h-4 w-48" />
        </div>
      </div>
    </div>
    
    {/* Tabs skeleton */}
    <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
      {[...Array(4)].map((_, idx) => (
        <SkeletonBase key={idx} className="h-10 w-32 rounded-lg flex-shrink-0" />
      ))}
    </div>
    
    {/* Content skeleton */}
    <div className="space-y-4">
      <SkeletonBase className="h-24 w-full rounded-lg" />
      <SkeletonBase className="h-24 w-full rounded-lg" />
      <SkeletonBase className="h-24 w-full rounded-lg" />
    </div>
  </div>
);

export const DashboardSkeleton = () => (
  <div className="space-y-6">
    {/* Header skeleton */}
    <div className="flex items-center justify-between">
      <div>
        <SkeletonBase className="h-9 w-32 mb-2" />
        <SkeletonBase className="h-4 w-56" />
      </div>
      <SkeletonBase className="h-11 w-40 rounded-lg" />
    </div>
    
    {/* Stats cards skeleton */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[...Array(4)].map((_, idx) => (
        <StatsCardSkeleton key={idx} />
      ))}
    </div>
    
    {/* AI Insights skeleton */}
    <AIInsightsWidgetSkeleton />
    
    {/* Search and filters skeleton */}
    <div className="flex gap-4">
      <SkeletonBase className="flex-1 h-10 rounded-lg" />
      <SkeletonBase className="h-10 w-64 rounded-lg" />
    </div>
    
    {/* Kanban columns skeleton */}
    <div className="flex gap-5 overflow-x-auto pb-6 px-2">
      {[...Array(5)].map((_, idx) => (
        <KanbanColumnSkeleton key={idx} />
      ))}
    </div>
  </div>
);

export default { 
  DealCardSkeleton, 
  KanbanColumnSkeleton, 
  StatsCardSkeleton, 
  AIInsightsWidgetSkeleton,
  DashboardSkeleton 
};
