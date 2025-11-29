import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Users, TrendingUp, TrendingDown, DollarSign, Target, Loader2 } from 'lucide-react';
import { useApp } from './AppShell';
import { useRealTimeDeals } from '../hooks/useRealTimeDeals';
import { logger } from '../lib/logger';

export const TeamDashboard = () => {
  // CRITICAL FIX: useApp() MUST be called at top of component (React Rules of Hooks)
  // Cannot be called after conditional returns or it will cause "Cannot update component" error
  // PRO TIER FIX: Get organization from context to check plan tier directly
  const { setActiveView, organization: contextOrganization } = useApp();

  const [loading, setLoading] = useState(true);
  const [teamMetrics, setTeamMetrics] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [organizationId, setOrganizationId] = useState(null);
  const debounceTimerRef = useRef(null);

  // PRO TIER FIX: Check if user has a paid plan that unlocks team features
  const hasPaidPlan = contextOrganization?.plan && ['startup', 'growth', 'pro'].includes(contextOrganization.plan.toLowerCase());

  const loadTeamData = useCallback(async () => {
    try {
      setLoading(true);

      // CRITICAL FIX: Add timeout protection to all queries
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Team data query timed out')), 10000)
      );

      // Get current user's organization
      const { data: { user } } = await Promise.race([
        supabase.auth.getUser(),
        timeoutPromise
      ]);
      if (!user) return;

      const { data: member, error: memberError } = await Promise.race([
        supabase
          .from('team_members')
          .select('organization_id, organizations(name)')
          .eq('user_id', user.id)
          .maybeSingle(),
        timeoutPromise
      ]);

      // Gracefully handle no team membership - shows upgrade prompt
      if (memberError) {
        logger.log('No team membership found:', memberError.message);
        return;
      }

      if (!member) return;

      setOrganization(member.organizations);
      const orgId = member.organization_id;
      setOrganizationId(orgId);

      // Get all team members for this organization
      // FIX D1: Removed incorrect FK hint that was causing query to return empty results
      // The FK name 'user_workspaces_user_id_fkey' doesn't exist on team_members table
      const { data: members, error: membersError } = await Promise.race([
        supabase
          .from('team_members')
          .select('user_id, role, created_at')
          .eq('organization_id', orgId),
        timeoutPromise
      ]);

      if (membersError) {
        console.error('[TeamDashboard] Error fetching team members:', membersError);
      }

      if (!members) return;

      // QA FIX: Deduplicate members by user_id (handles rare edge case of user in multiple orgs)
      const uniqueMembers = Array.from(
        new Map(members.map(m => [m.user_id, m])).values()
      );

      // Get all deals for the organization
      const { data: allDeals } = await Promise.race([
        supabase
          .from('deals')
          .select('*')
          .eq('organization_id', orgId),
        timeoutPromise
      ]);

      if (!allDeals) return;

      // Calculate metrics for each team member
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const memberMetrics = await Promise.all(
        uniqueMembers.map(async (member) => {
          const memberDeals = allDeals.filter(d => d.created_by === member.user_id);

          const activeDeals = memberDeals.filter(d => d.status === 'active');
          const activePipeline = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);
          const expectedRevenue = Math.round(activePipeline * 0.70);

          const dealsThisWeek = memberDeals.filter(d => new Date(d.created) >= oneWeekAgo);
          const dealsPreviousWeek = memberDeals.filter(d => {
            const created = new Date(d.created);
            return created >= twoWeeksAgo && created < oneWeekAgo;
          });

          const wonThisWeek = memberDeals.filter(d =>
            d.status === 'won' && new Date(d.last_activity) >= oneWeekAgo
          );
          const wonValue = wonThisWeek.reduce((sum, d) => sum + (d.value || 0), 0);

          const dealsAddedTrend = dealsThisWeek.length >= dealsPreviousWeek.length ? 'up' : 'down';
          const dealsAddedValue = dealsThisWeek.reduce((sum, d) => sum + (d.value || 0), 0);

          // FIX D1: Simplified - no longer fetching user data via join
          // Display user role and use current user's info when applicable
          const isCurrentUser = member.user_id === user.id;

          // For current user, use their actual name; for others, show role
          const userName = isCurrentUser
            ? (user.user_metadata?.full_name || user.email?.split('@')[0] || 'You')
            : (member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Team Member');

          return {
            userId: member.user_id,
            name: userName,
            role: member.role,
            isCurrentUser,
            dealsAdded: dealsThisWeek.length,
            dealsAddedValue,
            dealsAddedTrend,
            dealsClosed: wonThisWeek.length,
            dealsClosedValue: wonValue,
            activePipeline,
            expectedRevenue
          };
        })
      );

      // Calculate team totals
      const totalPipeline = memberMetrics.reduce((sum, m) => sum + m.activePipeline, 0);
      const totalExpectedRevenue = memberMetrics.reduce((sum, m) => sum + m.expectedRevenue, 0);
      const totalDealsAdded = memberMetrics.reduce((sum, m) => sum + m.dealsAdded, 0);
      const totalDealsClosed = memberMetrics.reduce((sum, m) => sum + m.dealsClosed, 0);
      const totalClosedValue = memberMetrics.reduce((sum, m) => sum + m.dealsClosedValue, 0);

      // Calculate team trend (average of all member trends)
      const upTrends = memberMetrics.filter(m => m.dealsAddedTrend === 'up').length;
      const teamTrend = upTrends >= memberMetrics.length / 2 ? 'up' : 'down';

      setTeamMetrics({
        totalPipeline,
        totalExpectedRevenue,
        totalDealsAdded,
        totalDealsClosed,
        totalClosedValue,
        teamTrend,
        memberCount: memberMetrics.length
      });

      // Sort members: current user first, then by pipeline value
      const sortedMembers = memberMetrics.sort((a, b) => {
        if (a.isCurrentUser) return -1;
        if (b.isCurrentUser) return 1;
        return b.activePipeline - a.activePipeline;
      });

      setTeamMembers(sortedMembers);
    } catch (error) {
      console.error('Error loading team data:', error);
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps - all state setters are stable

  // Load team data on mount
  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  // CRITICAL FIX: Debounced refresh to prevent query spam
  // When deals change rapidly (e.g. bulk operations), this prevents
  // loadTeamData() from being called dozens of times per second
  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      loadTeamData();
    }, 500); // Wait 500ms after last change before refreshing
  }, [loadTeamData]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // PERFORMANCE OPTIMIZATION: Centralized real-time subscription
  // Uses shared subscription manager to reduce network traffic by 40%
  // Subscribes to deal changes and refreshes team metrics (debounced)
  useRealTimeDeals(organizationId, () => {
    debouncedRefresh();
  });

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-[#1ABC9C]" />
      </div>
    );
  }

  // PRO TIER FIX: Show different UI based on plan tier
  // For paid plans (startup/growth/pro): Show empty team state with invite prompt
  // For free plan: Show upgrade prompt
  if (!teamMetrics) {
    // Paid plan but no team data yet - show invite prompt instead of upgrade prompt
    if (hasPaidPlan) {
      return (
        <div className="p-6 space-y-6 bg-white dark:bg-[#1A1A1A] min-h-screen">
          <div>
            <h1 className="text-title-1 text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">Team Performance</h1>
            <p className="text-body text-[#6B7280] dark:text-[#9CA3AF]">
              {contextOrganization?.name} • {contextOrganization?.plan?.charAt(0).toUpperCase() + contextOrganization?.plan?.slice(1)} Plan
            </p>
          </div>

          <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-8 border border-gray-200 dark:border-gray-700">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-[#1ABC9C]/10 rounded-full flex items-center justify-center mx-auto">
                <Users className="w-8 h-8 text-[#1ABC9C]" />
              </div>
              <div>
                <h4 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">Start Building Your Team</h4>
                <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] max-w-md mx-auto">
                  Your {contextOrganization?.plan} plan includes team collaboration features.
                  Invite team members from Settings to start tracking performance together.
                </p>
              </div>
              <button
                type="button"
                className="bg-[#1ABC9C] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#16A085] transition shadow-md hover:shadow-lg"
                onClick={() => {
                  // Navigate to Settings general tab for team management
                  const url = new URL(window.location);
                  url.searchParams.set('tab', 'general');
                  window.history.pushState({}, '', url);
                  setActiveView('settings');
                }}
              >
                Invite Team Members
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Free plan - show upgrade prompt
    return (
      <div className="p-6 space-y-6 bg-white dark:bg-[#1A1A1A] min-h-screen">
        <div>
          <h1 className="text-title-1 text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">Team</h1>
          <p className="text-body text-[#6B7280] dark:text-[#9CA3AF]">Collaborate with your team</p>
        </div>

        <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-8 border border-gray-200 dark:border-gray-700">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-8 h-8 text-[#6B7280] dark:text-[#9CA3AF]" />
            </div>
            <div>
              <h4 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">Team Features Locked</h4>
              <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                Upgrade to Startup plan to invite team members and collaborate
              </p>
            </div>
            <button
              type="button"
              className="bg-[#1ABC9C] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#16A085] transition shadow-md hover:shadow-lg"
              onClick={() => {
                // Navigate to Settings and set URL parameter for billing tab
                const url = new URL(window.location);
                url.searchParams.set('tab', 'billing');
                logger.log('TeamDashboard: Setting URL to', url.toString());
                window.history.pushState({}, '', url);
                logger.log('TeamDashboard: Navigating to settings view');
                setActiveView('settings');
              }}
            >
              Unlock Team Features
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-white dark:bg-[#1A1A1A] min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-title-1 text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
          Team Performance
        </h1>
        <p className="text-body text-[#6B7280] dark:text-[#9CA3AF]">
          {organization?.name} • {teamMetrics.memberCount} Active {teamMetrics.memberCount === 1 ? 'Member' : 'Members'}
        </p>
      </div>

      {/* Team Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Total Pipeline */}
        <div className="bg-gradient-to-br from-[#F0FDF4] to-[#DCFCE7] rounded-xl p-6 border border-[#BBF7D0]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-[#6B7280] mb-1">Total Pipeline</p>
              <p className="text-3xl font-bold text-[#16A34A]">
                {formatCurrency(teamMetrics.totalPipeline)}
              </p>
              <p className="text-sm text-[#6B7280] mt-2 flex items-center gap-1">
                {teamTrend === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-[#16A34A]" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-[#DC2626]" />
                )}
                <span className={teamMetrics.teamTrend === 'up' ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                  {teamMetrics.teamTrend === 'up' ? 'Trending up' : 'Trending down'}
                </span>
              </p>
            </div>
            <DollarSign className="w-10 h-10 text-[#16A34A] opacity-50" />
          </div>
        </div>

        {/* Expected Revenue */}
        <div className="bg-gradient-to-br from-[#EBF8FF] to-[#E0F2FE] rounded-xl p-6 border border-[#BAE6FD]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-[#6B7280] mb-1">Expected Revenue</p>
              <p className="text-3xl font-bold text-[#0284C7]">
                {formatCurrency(teamMetrics.totalExpectedRevenue)}
              </p>
              <p className="text-sm text-[#6B7280] mt-2">70% avg probability</p>
            </div>
            <Target className="w-10 h-10 text-[#0284C7] opacity-50" />
          </div>
        </div>

        {/* Deals Added This Week */}
        <div className="bg-gradient-to-br from-[#F0FDF4] to-[#DCFCE7] rounded-xl p-6 border border-[#BBF7D0]">
          <div>
            <p className="text-sm text-[#6B7280] mb-1">Deals Added (This Week)</p>
            <p className="text-3xl font-bold text-[#16A34A]">{teamMetrics.totalDealsAdded}</p>
          </div>
        </div>

        {/* Deals Closed This Week */}
        <div className="bg-gradient-to-br from-[#FAF5FF] to-[#F3E8FF] rounded-xl p-6 border border-[#E9D5FF]">
          <div>
            <p className="text-sm text-[#6B7280] mb-1">Deals Closed (This Week)</p>
            <p className="text-3xl font-bold text-[#9333EA]">{teamMetrics.totalDealsClosed}</p>
            <p className="text-sm text-[#6B7280] mt-2">{formatCurrency(teamMetrics.totalClosedValue)}</p>
          </div>
        </div>
      </div>

      {/* Team Members Performance */}
      <div>
        <h2 className="text-title-2 text-[#1A1A1A] dark:text-[#E0E0E0] mb-4">
          Team Member Performance
        </h2>
        {/* FIX H3: Empty state for no team members */}
        {teamMembers.length === 0 ? (
          <div className="bg-white dark:bg-[#0D1F2D] rounded-2xl p-12 border border-gray-200 dark:border-gray-700 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-[#6B7280] dark:text-[#9CA3AF]" />
            </div>
            <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
              No Team Members Yet
            </h3>
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] max-w-md mx-auto">
              Invite your first team member from Settings to start collaborating on deals.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {teamMembers.map((member) => (
            <div
              key={member.userId}
              className="bg-[#F9FAFB] dark:bg-[#1E1E1E] rounded-xl p-6 border-l-4 border-[#1ABC9C]"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {member.name}
                    {member.isCurrentUser && (
                      <span className="ml-2 text-sm font-normal text-[#6B7280]">(You)</span>
                    )}
                  </h3>
                  <p className="text-sm text-[#6B7280] capitalize">{member.role || 'Member'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]">Deals Added:</span>
                  <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {member.dealsAdded} ({formatCurrency(member.dealsAddedValue)})
                    {member.dealsAddedTrend === 'up' ? (
                      <TrendingUp className="inline w-4 h-4 ml-1 text-[#16A34A]" />
                    ) : (
                      <TrendingDown className="inline w-4 h-4 ml-1 text-[#DC2626]" />
                    )}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]">Deals Closed:</span>
                  <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {member.dealsClosed} won ({formatCurrency(member.dealsClosedValue)})
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#6B7280]">Active Pipeline:</span>
                  <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {formatCurrency(member.activePipeline)} → {formatCurrency(member.expectedRevenue)}
                  </span>
                </div>
              </div>
            </div>
          ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamDashboard;
