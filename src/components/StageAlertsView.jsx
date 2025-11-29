import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle, Zap, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';

export const StageAlertsView = () => {
  const { organization } = useApp();
  const [stagnantDeals, setStagnantDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  const stageThresholds = {
    lead: 14,
    quote: 7,
    approval: 5,
    invoice: 3,
    onboarding: 10,
    delivery: 14,
    retention: 30
  };

  useEffect(() => {
    const fetchStagnantDeals = async () => {
      if (!organization) return;

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('deals')
          .select('*')
          .eq('organization_id', organization.id)
          .eq('status', 'active');

        if (error) throw error;

        // Calculate days in stage and check against thresholds
        const now = new Date();
        const stagnant = (data || [])
          .map(deal => {
            const daysInStage = Math.floor(
              (now - new Date(deal.updated_at)) / (1000 * 60 * 60 * 24)
            );
            const threshold = stageThresholds[deal.stage] || 7;
            const daysOver = daysInStage - threshold;
            
            return {
              ...deal,
              daysInStage,
              threshold,
              daysOver,
              isStagnant: daysOver > 0
            };
          })
          .filter(d => d.isStagnant)
          .sort((a, b) => b.daysOver - a.daysOver);

        setStagnantDeals(stagnant);
      } catch (error) {
        console.error('Error fetching stagnant deals:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStagnantDeals();
  }, [organization]);

  const getUrgencyColor = (daysOver) => {
    if (daysOver > 14) return 'text-[#E74C3C]';
    if (daysOver > 7) return 'text-[#F39C12]';
    return 'text-[#F59E0B]';
  };

  const getUrgencyBg = (daysOver) => {
    if (daysOver > 14) return 'bg-[#E74C3C]/10';
    if (daysOver > 7) return 'bg-[#F39C12]/10';
    return 'bg-[#F59E0B]/10';
  };

  const getUrgencyLabel = (daysOver) => {
    if (daysOver > 14) return 'URGENT';
    if (daysOver > 7) return 'HIGH';
    return 'MEDIUM';
  };

  const getSuggestedAction = (deal) => {
    const actions = {
      lead: 'Send follow-up email or schedule discovery call',
      quote: 'Follow up on quote and address questions',
      approval: 'Check in with decision maker',
      invoice: 'Send payment reminder',
      onboarding: 'Schedule onboarding session',
      delivery: 'Provide delivery update',
      retention: 'Check in and gather feedback'
    };
    return actions[deal.stage] || 'Follow up with client';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (stagnantDeals.length === 0) {
    return (
      <div className="text-center py-12">
        <Zap className="w-12 h-12 text-[#27AE60] mx-auto mb-3" />
        <p className="text-[#27AE60] font-semibold">
          All deals are progressing well!
        </p>
        <p className="text-sm text-[#9CA3AF] mt-1">
          No deals are stuck in their current stages
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="p-4 bg-[#F39C12]/10 border border-[#F39C12]/20 rounded-lg mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#F39C12] mt-0.5" />
          <div>
            <p className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
              {stagnantDeals.length} deal{stagnantDeals.length !== 1 ? 's' : ''} need{stagnantDeals.length === 1 ? 's' : ''} attention
            </p>
            <p className="text-sm text-[#61788A] dark:text-[#ABCAE2] mt-1">
              These deals have exceeded their expected time in the current stage
            </p>
          </div>
        </div>
      </div>

      {/* Stagnant Deals List */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
        {stagnantDeals.map(deal => (
          <div
            key={deal.id}
            className="p-4 bg-[#F9FAFB] dark:bg-[#121212] rounded-lg hover:shadow-md transition-shadow border-l-4"
            style={{
              borderLeftColor: deal.daysOver > 14 ? '#E74C3C' : deal.daysOver > 7 ? '#F39C12' : '#F59E0B'
            }}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h4 className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                  {deal.client}
                </h4>
                <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mt-0.5">
                  {deal.stage.charAt(0).toUpperCase() + deal.stage.slice(1)} stage • ${(Number(deal.value) || 0).toLocaleString()}
                </p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-bold ${getUrgencyBg(deal.daysOver)} ${getUrgencyColor(deal.daysOver)}`}>
                {getUrgencyLabel(deal.daysOver)}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm mb-3">
              <Clock className="w-4 h-4 text-[#9CA3AF]" />
              <span className="text-[#61788A] dark:text-[#ABCAE2]">
                <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">{deal.daysInStage} days</span> in stage
                <span className="text-[#9CA3AF] mx-1">•</span>
                <span className={getUrgencyColor(deal.daysOver)}>
                  {deal.daysOver} days over threshold
                </span>
              </span>
            </div>

            <div className="p-3 bg-white dark:bg-[#0D1F2D] rounded-lg">
              <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mb-1">
                💡 Suggested action:
              </p>
              <p className="text-sm text-[#1A1A1A] dark:text-[#E0E0E0]">
                {getSuggestedAction(deal)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
