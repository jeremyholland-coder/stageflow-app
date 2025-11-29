import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';

// Lazy load the heavy Recharts component
const DealAnalyticsChart = lazy(() => import('./DealAnalyticsChart'));

/**
 * Lazy Loading Wrapper for DealAnalyticsChart
 *
 * This prevents Recharts (~60-80 KB) from loading until charts are actually needed.
 * Reduces initial AI bundle from 428 KB to ~370 KB (60 KB savings).
 */
export const DealAnalyticsChartLazy = ({ data, type, title }) => {
  return (
    <Suspense
      fallback={
        <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0D1F2D] rounded-2xl p-6 border border-[#1ABC9C]/30 my-4 shadow-xl">
          <div className="flex items-center justify-center gap-3 py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[#1ABC9C]" />
            <span className="text-sm text-gray-400">Loading chart...</span>
          </div>
        </div>
      }
    >
      <DealAnalyticsChart data={data} type={type} title={title} />
    </Suspense>
  );
};

export default DealAnalyticsChartLazy;
