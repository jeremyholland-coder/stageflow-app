import React, { useState, useEffect } from 'react';
import { Check, Loader2, TrendingUp, Building, Stethoscope, Briefcase, Home, Rocket } from 'lucide-react';
// FIX 2025-12-03: Import auth utilities for proper Authorization header injection
import { supabase, ensureValidSession } from '../lib/supabase';
import { useApp } from './AppShell';
import { PIPELINE_TEMPLATES, mapStage } from '../config/pipelineTemplates';

/**
 * Pipeline Template Selector Component
 *
 * Allows users to switch between industry-specific pipeline templates
 * Handles deal migration to preserve data when switching templates
 */
export const PipelineTemplateSelector = ({ onTemplateChange }) => {
  const { organization, addNotification } = useApp();
  const [selectedTemplate, setSelectedTemplate] = useState('default');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // FIX HIGH #3: Add pipeline switching progress indicator
  const [migrationProgress, setMigrationProgress] = useState({ current: 0, total: 0, step: '' });

  // Template icons mapping
  const templateIcons = {
    healthcare: Stethoscope,
    vc_pe: Building,
    real_estate: Home,
    professional_services: Briefcase,
    saas: Rocket,
    default: TrendingUp
  };

  // Load current pipeline template
  useEffect(() => {
    let isMounted = true;

    const loadCurrentTemplate = async () => {
      if (!supabase || !organization) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        // CRITICAL FIX: Add timeout to prevent infinite spinner
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Pipeline template lookup timed out')), 5000)
        );

        const { data, error } = await Promise.race([
          supabase
            .from('organizations')
            .select('pipeline_template')
            .eq('id', organization.id)
            .maybeSingle(),
          timeoutPromise
        ]);

        if (error && error.code !== 'PGRST116') throw error;

        if (isMounted && data?.pipeline_template) {
          setSelectedTemplate(data.pipeline_template);
        }
      } catch (error) {
        console.error('Failed to load pipeline template:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadCurrentTemplate();

    return () => {
      isMounted = false;
    };
  }, [organization]);

  const handleTemplateChange = async (templateId) => {
    if (!supabase || !organization) {
      console.error('Missing supabase or organization');
      addNotification('Unable to switch pipeline template', 'error');
      return;
    }

    // Validate template exists
    if (!PIPELINE_TEMPLATES[templateId]) {
      console.error('Invalid template ID:', templateId);
      addNotification('Invalid pipeline template selected', 'error');
      return;
    }

    if (templateId === selectedTemplate) return;

    setSaving(true);
    setMigrationProgress({ current: 0, total: 4, step: 'Preparing migration...' });

    // Safety timeout to prevent infinite saving state
    const timeoutId = setTimeout(() => {
      setSaving(false);
      setMigrationProgress({ current: 0, total: 0, step: '' });
      addNotification('Pipeline switch timed out. Please try again.', 'error');
    }, 10000);

    try {
      // PHASE 14 FIX: Use backend endpoint instead of direct Supabase
      // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
      // RLS policies deny all client-side mutations. Use backend with service role.
      setMigrationProgress({ current: 1, total: 2, step: 'Preparing migration...' });

      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/.netlify/functions/migrate-pipeline', {
        method: 'POST',
        headers,
        credentials: 'include', // Include HttpOnly cookies
        body: JSON.stringify({
          organization_id: organization.id,
          template_id: templateId
        })
      });

      setMigrationProgress({ current: 2, total: 2, step: 'Finalizing migration...' });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Migration failed: ${response.status}`);
      }

      clearTimeout(timeoutId);
      setSelectedTemplate(templateId);

      const dealsCount = result.deals_migrated || 0;
      addNotification(
        `Pipeline switched to ${PIPELINE_TEMPLATES[templateId].name}. ${dealsCount} deal${dealsCount !== 1 ? 's' : ''} migrated.`,
        'success'
      );

      // Notify parent component to refresh
      if (onTemplateChange) {
        onTemplateChange(templateId);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Failed to change pipeline template:', error);
      addNotification(
        error.message || 'Failed to change pipeline template. Please try again.',
        'error'
      );
    } finally {
      setSaving(false);
      setMigrationProgress({ current: 0, total: 0, step: '' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[#1ABC9C]" />
      </div>
    );
  }

  // Sort templates: default first, then alphabetically
  const sortedTemplates = Object.entries(PIPELINE_TEMPLATES).sort(([idA], [idB]) => {
    if (idA === 'default') return -1;
    if (idB === 'default') return 1;
    return idA.localeCompare(idB);
  });

  return (
    <div className="space-y-4">
      {/* Grid layout: 3 columns on desktop, 2 on tablet, 1 on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedTemplates.map(([id, template]) => {
          const Icon = templateIcons[id] || TrendingUp;
          const isSelected = selectedTemplate === id;

          return (
            <button
              key={id}
              onClick={() => handleTemplateChange(id)}
              disabled={saving || isSelected}
              className={`
                p-4 rounded-xl border-2 text-left transition-all h-full
                ${isSelected
                  ? 'border-[#1ABC9C] bg-[#1ABC9C]/5 shadow-lg'
                  : 'border-gray-200 dark:border-gray-700 hover:border-[#1ABC9C]/50 hover:shadow-md'
                }
                ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <div className="flex flex-col h-full">
                {/* Icon and title */}
                <div className="flex items-start gap-3 mb-3">
                  <div className={`
                    w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                    ${isSelected
                      ? 'bg-[#1ABC9C] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-[#6B7280] dark:text-[#9CA3AF]'
                    }
                  `}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className={`font-semibold text-sm ${isSelected ? 'text-[#1ABC9C]' : 'text-[#1A1A1A] dark:text-[#E0E0E0]'}`}>
                        {template.name}
                      </h4>
                      {isSelected && (
                        <Check className="w-4 h-4 text-[#1ABC9C] flex-shrink-0" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-3 line-clamp-2">
                  {template.description}
                </p>

                {/* Stage tags */}
                <div className="flex flex-wrap gap-1 mt-auto">
                  {template.stages.slice(0, 3).map((stage, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-[#6B7280] dark:text-[#9CA3AF] rounded"
                    >
                      {stage.name}
                    </span>
                  ))}
                  {template.stages.length > 3 && (
                    <span className="text-xs px-2 py-0.5 text-[#6B7280] dark:text-[#9CA3AF]">
                      +{template.stages.length - 3}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* FIX HIGH #3: Enhanced progress indicator with step details */}
      {saving && (
        <div className="bg-gradient-to-r from-[#1ABC9C]/10 to-[#16A085]/10 border-2 border-[#1ABC9C]/30 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-5 h-5 animate-spin text-[#1ABC9C]" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                {migrationProgress.step}
              </p>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                Step {migrationProgress.current} of {migrationProgress.total}
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#1ABC9C] to-[#16A085] transition-all duration-300 ease-out"
              style={{ width: `${(migrationProgress.current / migrationProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <strong className="font-semibold">Safe Migration:</strong> When you switch templates, your deals are automatically mapped to matching stages. No data is lost.
        </p>
      </div>
    </div>
  );
};

export default PipelineTemplateSelector;
