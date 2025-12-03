import React, { useState, useEffect } from 'react';
import {
  Laptop, Briefcase, Home, Activity, Target, Zap,
  CheckCircle, ArrowRight, Sparkles, AlertCircle
} from 'lucide-react';
// FIX 2025-12-03: Import auth utilities for proper Authorization header injection
import { supabase, ensureValidSession } from '../lib/supabase';

/**
 * IndustrySelector Component
 * 
 * Shown during onboarding to help users select their industry
 * and configure their pipeline automatically
 */

const INDUSTRIES = [
  {
    id: 'saas',
    name: 'SaaS',
    fullName: 'Software as a Service',
    icon: Laptop,
    color: '#3B82F6',
    gradient: 'from-blue-500 to-blue-600',
    description: 'Subscription software, recurring revenue, PLG models',
    stages: 7,
    avgCycle: '30-60 days',
    keyFeatures: ['BANT Qualification', 'Demo Tracking', 'MRR Analytics']
  },
  {
    id: 'services',
    name: 'Services',
    fullName: 'Professional Services',
    icon: Briefcase,
    color: '#8B5CF6',
    gradient: 'from-purple-500 to-purple-600',
    description: 'Agencies, consulting, design firms, freelancers',
    stages: 7,
    avgCycle: '14-30 days',
    keyFeatures: ['Proposal Templates', 'Contract Tracking', 'Referral Metrics']
  },
  {
    id: 'real_estate',
    name: 'Real Estate',
    fullName: 'Real Estate',
    icon: Home,
    color: '#F59E0B',
    gradient: 'from-amber-500 to-amber-600',
    description: 'Residential, commercial, property management',
    stages: 7,
    avgCycle: '45-90 days',
    keyFeatures: ['Property Matching', 'Escrow Tracking', 'Inspection Alerts']
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    fullName: 'Healthcare Sales',
    icon: Activity,
    color: '#EF4444',
    gradient: 'from-red-500 to-red-600',
    description: 'Medical devices, pharma, healthcare services',
    stages: 6,
    avgCycle: '60-120 days',
    keyFeatures: ['Compliance Checks', 'Stakeholder Mapping', 'Regulatory Tracking']
  },
  {
    id: 'investment',
    name: 'Investment',
    fullName: 'VC/Private Equity',
    icon: Target,
    color: '#10B981',
    gradient: 'from-emerald-500 to-emerald-600',
    description: 'Venture capital, private equity, angel investing',
    stages: 7,
    avgCycle: '90-180 days',
    keyFeatures: ['Due Diligence', 'Investment Committee', 'Portfolio Tracking']
  },
  {
    id: 'generic',
    name: 'Generic',
    fullName: 'StageFlow Classic',
    icon: Zap,
    color: '#1ABC9C',
    gradient: 'from-[#1ABC9C] to-[#16A085]',
    description: 'Universal pipeline for any business type',
    stages: 8,
    avgCycle: '30-90 days',
    keyFeatures: ['Flexible Stages', 'Universal Tracking', 'Post-Sale Management']
  }
];

export const IndustrySelector = ({ organizationId, onComplete, onSkip, darkMode = true }) => {
  const [selectedIndustry, setSelectedIndustry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [templates, setTemplates] = useState({});

  useEffect(() => {
    loadPipelineTemplates();
  }, []);

  const loadPipelineTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('pipeline_templates')
        .select('*');
      
      if (error) throw error;
      
      const templatesMap = {};
      data.forEach(template => {
        templatesMap[template.industry] = template;
      });
      setTemplates(templatesMap);
    } catch (err) {
      console.error('Error loading templates:', err);
    }
  };

  // PHASE 14 FIX: Use backend endpoint instead of direct Supabase
  // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
  // RLS policies deny all client-side mutations. Use backend with service role.
  const handleSelectIndustry = async () => {
    if (!selectedIndustry || !organizationId) return;

    setLoading(true);
    setError(null);

    try {
      // Update organization with selected industry via backend
      // FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/.netlify/functions/update-organization', {
        method: 'POST',
        headers,
        credentials: 'include', // Include HttpOnly cookies
        body: JSON.stringify({
          organization_id: organizationId,
          updates: {
            selected_industry: selectedIndustry,
            pipeline_template_id: templates[selectedIndustry]?.id
          }
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Update failed: ${response.status}`);
      }

      // Store in localStorage for client-side access
      localStorage.setItem('stageflow_industry', selectedIndustry);

      onComplete(selectedIndustry);
    } catch (err) {
      console.error('Error saving industry:', err);
      setError(err.message || 'Failed to save industry selection. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    // Default to generic pipeline
    localStorage.setItem('stageflow_industry', 'generic');
    onSkip();
  };

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="fixed inset-0 modal-backdrop-apple z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0D1F2D] rounded-xl sm:rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 p-4 sm:p-6 lg:p-8 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-gradient-to-br from-[#1ABC9C] to-[#16A085] rounded-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
              Welcome to StageFlow!
            </h2>
          </div>
          <p className="text-[#6B7280] dark:text-[#9CA3AF] text-sm sm:text-base lg:text-lg">
            Select your industry to get a pipeline optimized for your business
          </p>
        </div>

        {/* Industry Grid - Scrollable with Apple-like scrollbar */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 apple-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {INDUSTRIES.map(industry => {
              const Icon = industry.icon;
              const isSelected = selectedIndustry === industry.id;
              
              return (
                <button
                  key={industry.id}
                  onClick={() => setSelectedIndustry(industry.id)}
                  className={`
                    text-left p-4 sm:p-5 lg:p-6 rounded-lg sm:rounded-xl border-2 transition-all duration-300
                    ${isSelected 
                      ? 'border-[#1ABC9C] bg-[#1ABC9C]/5 shadow-lg' 
                      : 'border-gray-200 dark:border-gray-700 hover:border-[#1ABC9C]/50 hover:shadow-md'
                    }
                  `}
                >
                  <div className="flex items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
                    <div className={`p-2 sm:p-3 rounded-lg bg-gradient-to-br ${industry.gradient}`}>
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-base sm:text-lg text-[#1A1A1A] dark:text-[#E0E0E0] mb-1">
                        {industry.fullName}
                      </h3>
                      <p className="text-xs sm:text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                        {industry.description}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 mb-3 sm:mb-4">
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-[#6B7280] dark:text-[#9CA3AF]">Pipeline Stages</span>
                      <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        {industry.stages}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#6B7280] dark:text-[#9CA3AF]">Avg. Sales Cycle</span>
                      <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                        {industry.avgCycle}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 hidden sm:block">
                    <p className="text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF] mb-2">
                      Key Features:
                    </p>
                    {industry.keyFeatures.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <CheckCircle className="w-3 h-3 text-[#1ABC9C]" />
                        <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                          {feature}
                        </span>
                      </div>
                    ))}
                  </div>

                  {isSelected && (
                    <div className="mt-4 pt-4 border-t border-[#1ABC9C]/20">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#1ABC9C]">
                        <CheckCircle className="w-4 h-4" />
                        Selected
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions - Fixed Footer */}
        <div className="flex-shrink-0 p-4 sm:p-6 lg:p-8 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0D1F2D]">
          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2" role="alert">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end gap-3 sm:gap-4">
            <button
              onClick={handleSelectIndustry}
              disabled={!selectedIndustry || loading}
              className={`
                w-full sm:w-auto px-6 sm:px-8 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition
                ${selectedIndustry && !loading
                  ? 'bg-gradient-to-r from-[#1ABC9C] to-[#16A085] hover:shadow-lg text-white' 
                  : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              {loading ? (
                'Setting up...'
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};
