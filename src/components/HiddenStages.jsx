import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useStageVisibility } from '../hooks/useStageVisibility';
import { useApp } from './AppShell';

/**
 * Hidden Stages Management Component
 * Shows list of hidden stages with ability to unhide them
 */
export const HiddenStages = ({ pipelineStages = [] }) => {
  const { user, organization } = useApp();
  const { hiddenStageIds, unhideStage, loading } = useStageVisibility(user?.id, organization?.id);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1ABC9C]"></div>
      </div>
    );
  }

  // Filter to show only hidden stages
  const hiddenStages = pipelineStages.filter(stage =>
    hiddenStageIds.includes(stage.id || stage.stage_key)
  );

  if (hiddenStages.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <Eye className="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <p className="text-[#6B7280] dark:text-[#9CA3AF] text-sm">
          No hidden stages. All your pipeline stages are currently visible.
        </p>
        <p className="text-[#9CA3AF] dark:text-gray-500 text-xs mt-2">
          You can hide stages from the Kanban view by clicking the menu (⋮) on any stage column header.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mb-4">
        These stages are currently hidden from your Kanban view. Click "Unhide" to make them visible again.
      </p>

      <div className="grid gap-3">
        {hiddenStages.map(stage => {
          const stageId = stage.id || stage.stage_key;
          const stageName = stage.name || stage.stage_name || stageId;
          const stageColor = stage.color || '#64748b';

          return (
            <div
              key={stageId}
              className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${stageColor}20` }}
                >
                  <EyeOff
                    className="w-5 h-5"
                    style={{ color: stageColor }}
                  />
                </div>
                <div>
                  <h4 className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {stageName}
                  </h4>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    Hidden from Kanban view
                  </p>
                </div>
              </div>

              <button
                onClick={() => unhideStage(stageId)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#1ABC9C] text-[#1ABC9C] hover:bg-[#1ABC9C] hover:text-white transition font-medium text-sm"
              >
                <Eye className="w-4 h-4" />
                Unhide
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          <strong>Tip:</strong> You can also drag and drop stage columns in the Kanban view to reorder them. Your custom order is saved automatically.
        </p>
      </div>
    </div>
  );
};
