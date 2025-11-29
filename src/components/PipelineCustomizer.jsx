import React from 'react';

/**
 * PipelineCustomizer Component
 *
 * Placeholder for future pipeline customization feature
 */

export const PipelineCustomizer = ({ organizationId }) => {
  // DISABLED FOR V1 - Pipeline customization coming in future release
  /* const { 
    stages, 
    loading, 
    industry, 
    template,
    updateCustomStages, 
    resetToTemplate 
  } = usePipelineStages(organizationId); */

  return (
    <div className="p-8 text-center">
      <p className="text-[#6B7280] dark:text-[#9CA3AF]">
        Pipeline customization coming soon!
      </p>
    </div>
  );
};
