import React from 'react';
import { Sparkles } from 'lucide-react';
import { CustomQueryView } from './CustomQueryView';

export const AIInsightsWidget = ({ healthAlert = null, orphanedDealIds = new Set(), onDismissAlert = () => {}, deals = [] }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-teal-500/20 ring-2 ring-teal-500/10 flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-teal-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-white">
              AI Analytics
            </h3>
            <span className="px-3 py-1 bg-teal-500/20 text-teal-400 text-xs font-semibold rounded-full">
              AI POWERED
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Ask questions and visualize your pipeline data with AI-powered charts
          </p>
        </div>
      </div>

      {/* AI Chat with Analytics */}
      <CustomQueryView
        healthAlert={healthAlert}
        orphanedDealIds={orphanedDealIds}
        onDismissAlert={onDismissAlert}
        deals={deals}
      />
    </div>
  );
};
