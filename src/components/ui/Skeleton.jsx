import React from 'react';

/**
 * Base Skeleton Component
 * Shows animated loading placeholder
 */
export const Skeleton = ({ className = '', variant = 'default', width, height }) => {
  const baseClass = 'animate-pulse bg-gray-200 dark:bg-gray-700 rounded';

  const variants = {
    default: 'h-4 w-full',
    circle: 'rounded-full',
    card: 'h-32 w-full rounded-lg',
    text: 'h-4 w-3/4',
    title: 'h-8 w-1/2',
    button: 'h-10 w-24 rounded-lg',
    stat: 'h-24 w-full rounded-xl',
  };

  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <div
      className={`${baseClass} ${variants[variant]} ${className}`}
      style={style}
      aria-label="Loading..."
      role="status"
    />
  );
};

/**
 * Stat Card Skeleton
 * Matches DashboardStats cards
 */
export const StatCardSkeleton = () => (
  <div className="bg-[#F5F5F7] dark:bg-[#0D1F2D] rounded-[24px] shadow-[0_1px_3px_rgba(0,0,0,0.12)] p-5 animate-pulse">
    <div className="flex items-center justify-between mb-4">
      <Skeleton variant="circle" className="w-12 h-12" />
    </div>
    <Skeleton variant="text" className="mb-2 w-2/3" />
    <Skeleton variant="title" className="mb-3" />
    <Skeleton variant="text" className="w-1/2" />
  </div>
);

/**
 * Deal Card Skeleton
 * Matches Kanban deal cards
 */
export const DealCardSkeleton = () => (
  <div className="rounded-2xl p-5 bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 animate-pulse">
    {/* Top row: Icon + Name/Email + Amount */}
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 flex-shrink-0" />
    </div>
    {/* Confidence label + percentage */}
    <div className="flex items-center justify-between mb-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-4 w-8" />
    </div>
    {/* Progress bar */}
    <Skeleton className="h-1.5 w-full rounded-full mb-4" />
    {/* Assignee chip */}
    <Skeleton className="h-8 w-32 rounded-lg" />
  </div>
);

/**
 * Kanban Column Skeleton
 * Shows loading state for pipeline columns
 */
export const KanbanColumnSkeleton = () => (
  <div className="flex-shrink-0 w-80 space-y-3">
    <div className="flex items-center justify-between mb-3">
      <Skeleton className="h-6 w-32" />
      <Skeleton variant="circle" className="w-6 h-6" />
    </div>
    <DealCardSkeleton />
    <DealCardSkeleton />
    <DealCardSkeleton />
  </div>
);

/**
 * Dashboard Skeleton
 * Full dashboard loading state
 */
export const DashboardSkeleton = () => (
  <div className="space-y-6 animate-fadeIn">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div>
        <Skeleton className="h-10 w-48 mb-2" />
        <Skeleton className="h-5 w-64" />
      </div>
      <Skeleton variant="button" className="h-11 w-32" />
    </div>

    {/* Stats Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
      {[1, 2, 3, 4, 5].map(i => (
        <StatCardSkeleton key={i} />
      ))}
    </div>

    {/* Search and Filters */}
    <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
      <Skeleton className="flex-1 h-[46px] rounded-lg" />
      <Skeleton className="h-[46px] w-full md:w-auto rounded-lg" />
    </div>

    {/* Kanban Board */}
    <div className="flex gap-4 overflow-x-auto pb-4">
      {[1, 2, 3, 4].map(i => (
        <KanbanColumnSkeleton key={i} />
      ))}
    </div>
  </div>
);

/**
 * Settings Skeleton
 * Settings page loading state
 */
export const SettingsSkeleton = () => (
  <div className="space-y-6 animate-fadeIn">
    <div>
      <Skeleton className="h-10 w-40 mb-2" />
      <Skeleton className="h-5 w-64" />
    </div>

    {/* Tabs */}
    <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
      {[1, 2, 3, 4].map(i => (
        <Skeleton key={i} className="h-10 w-24 rounded-t-lg" />
      ))}
    </div>

    {/* Content */}
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="bg-white dark:bg-[#0D1F2D] rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * Table Skeleton
 * Generic table loading state
 */
export const TableSkeleton = ({ rows = 5, columns = 4 }) => (
  <div className="bg-white dark:bg-[#0D1F2D] rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
    {/* Table Header */}
    <div className="bg-gray-50 dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-5 flex-1" />
        ))}
      </div>
    </div>

    {/* Table Rows */}
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="p-4">
          <div className="flex gap-4">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton key={colIdx} className="h-4 flex-1" />
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * List Skeleton
 * Generic list loading state
 */
export const ListSkeleton = ({ items = 5 }) => (
  <div className="space-y-3">
    {Array.from({ length: items }).map((_, i) => (
      <div key={i} className="bg-white dark:bg-[#0D1F2D] rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex items-center gap-4">
        <Skeleton variant="circle" className="w-12 h-12 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    ))}
  </div>
);

/**
 * Widget Skeleton
 * Generic widget/card loading state
 */
export const WidgetSkeleton = ({ height = 'auto' }) => (
  <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-6 border border-[#E0E0E0] dark:border-gray-700 animate-pulse" style={{ height }}>
    <Skeleton className="h-6 w-1/3 mb-4" />
    <Skeleton className="h-4 w-2/3 mb-6" />
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  </div>
);

/**
 * Avatar Skeleton
 * User avatar loading state
 */
export const AvatarSkeleton = ({ size = 'md' }) => {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24'
  };

  return (
    <Skeleton variant="circle" className={sizes[size]} />
  );
};

/**
 * Form Skeleton
 * Form fields loading state
 */
export const FormSkeleton = ({ fields = 4 }) => (
  <div className="space-y-6">
    {Array.from({ length: fields }).map((_, i) => (
      <div key={i} className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    ))}
    <div className="flex gap-3">
      <Skeleton variant="button" className="h-11 w-32" />
      <Skeleton variant="button" className="h-11 w-24" />
    </div>
  </div>
);

/**
 * Chart Skeleton
 * Chart/graph loading state
 */
export const ChartSkeleton = ({ height = '300px' }) => (
  <div className="bg-white dark:bg-[#0D1F2D] rounded-xl p-6 border border-gray-200 dark:border-gray-700">
    <Skeleton className="h-6 w-40 mb-6" />
    <div className="flex items-end justify-between gap-2" style={{ height }}>
      {[60, 80, 45, 90, 70, 85, 55, 75].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
      ))}
    </div>
  </div>
);

/**
 * Modal Skeleton
 * Modal dialog loading state
 */
export const ModalSkeleton = () => (
  <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-6 w-full max-w-2xl">
    <div className="flex items-center justify-between mb-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton variant="circle" className="w-8 h-8" />
    </div>
    <div className="space-y-4 mb-6">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
    </div>
    <FormSkeleton fields={3} />
  </div>
);
