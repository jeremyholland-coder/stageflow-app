import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Users, TrendingUp, TrendingDown, DollarSign, Target, Loader2 } from 'lucide-react';
import { useApp } from './AppShell';
import { useRealTimeDeals } from '../hooks/useRealTimeDeals';
import { logger } from '../lib/logger';

// PAGINATION FIX: Page size for team members list
const TEAM_PAGE_SIZE = 25;

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

  // PAGINATION FIX: Track displayed member count and total
  const [displayedCount, setDisplayedCount] = useState(TEAM_PAGE_SIZE);
  const [totalMemberCount, setTotalMemberCount] = useState(0);

  // PHASE 20: Incremental rendering - render first batch immediately, rest via idle callbacks
  const INITIAL_RENDER_COUNT = 10;
  const BATCH_SIZE = 10;

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

      // Get all team members for this organization with user profile data for display
      // FIX: Join with users table to fetch email AND raw_user_meta_data for full_name
      // Uses same pattern as RevenueTargets.jsx (users:user_id syntax)
      const { data: members, error: membersError } = await Promise.race([
        supabase
          .from('team_members')
          .select('user_id, role, created_at, users:user_id(email, raw_user_meta_data)')
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
      // PHASE C FIX (B-DATA-01): Added soft delete filter - was counting deleted deals in metrics
      const { data: allDeals } = await Promise.race([
        supabase
          .from('deals')
          .select('*')
          .eq('organization_id', orgId)
          .is('deleted_at', null),
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

          // FIX: Use full_name from raw_user_meta_data, then email for meaningful identity display
          const isCurrentUser = member.user_id === user.id;
          const memberEmail = member.users?.email;
          const memberFullName = member.users?.raw_user_meta_data?.full_name;

          // Determine display name with fallback order:
          // 1. Full name from user metadata (raw_user_meta_data)
          // 2. Email username (before @)
          // 3. Full email address
          // 4. Last resort: email or 'Unknown Member' (never 'Team Member 1')
          const userName = isCurrentUser
            ? (user.user_metadata?.full_name || memberFullName || user.email?.split('@')[0] || 'You')
            : (memberFullName || memberEmail?.split('@')[0] || memberEmail || 'Unknown Member');

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
            expectedRevenue,
            // Track if we have no activity for this user
            hasNoActivity: memberDeals.length === 0
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

      // PAGINATION FIX: Store all members and track total count
      setTeamMembers(sortedMembers);
      setTotalMemberCount(sortedMembers.length);

      // PHASE 20: Incremental rendering - show first 10 immediately
      // Then progressively load remaining members via idle callbacks
      if (sortedMembers.length > INITIAL_RENDER_COUNT) {
        setDisplayedCount(INITIAL_RENDER_COUNT);

        // Schedule incremental rendering of remaining members
        const scheduleNextBatch = (currentCount) => {
          if (currentCount >= sortedMembers.length) return;

          const loadNextBatch = () => {
            setDisplayedCount(prev => Math.min(prev + BATCH_SIZE, sortedMembers.length));
            scheduleNextBatch(currentCount + BATCH_SIZE);
          };

          if ('requestIdleCallback' in window) {
            requestIdleCallback(loadNextBatch, { timeout: 1000 });
          } else {
            setTimeout(loadNextBatch, 50);
          }
        };

        // Start incremental loading after initial render
        setTimeout(() => scheduleNextBatch(INITIAL_RENDER_COUNT), 100);
      } else {
        setDisplayedCount(sortedMembers.length);
      }
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
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/5 flex items-center justify-center shadow-[0_4px_20px_rgba(12,227,177,0.15)]">
          <Loader2 className="w-7 h-7 animate-spin text-[#0CE3B1]" />
        </div>
        <p className="text-sm text-white/50 font-medium">Loading team data...</p>
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
        <div className="p-6 space-y-8 min-h-screen">
          <div>
            <h1 className="text-title-1 text-white tracking-tight mb-2">Team Performance</h1>
            <p className="text-body text-white/50">
              {contextOrganization?.name} • {contextOrganization?.plan?.charAt(0).toUpperCase() + contextOrganization?.plan?.slice(1)} Plan
            </p>
          </div>

          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-10 border border-white/[0.08] shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
            <div className="text-center space-y-5">
              <div className="w-18 h-18 bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/5 rounded-2xl flex items-center justify-center mx-auto w-[72px] h-[72px] border border-[#0CE3B1]/20 shadow-[0_4px_20px_rgba(12,227,177,0.15)]">
                <Users className="w-9 h-9 text-[#0CE3B1]" />
              </div>
              <div>
                <h4 className="text-xl font-semibold text-white mb-2 tracking-tight">Start Building Your Team</h4>
                <p className="text-sm text-white/50 max-w-md mx-auto leading-relaxed">
                  Your {contextOrganization?.plan} plan includes team collaboration features.
                  Invite team members from Settings to start tracking performance together.
                </p>
              </div>
              <button
                type="button"
                className="bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 text-white py-3.5 px-7 rounded-2xl font-semibold hover:from-[#0CE3B1] hover:to-[#16A085] transition-all duration-300 shadow-[0_4px_20px_rgba(12,227,177,0.3)] hover:shadow-[0_6px_28px_rgba(12,227,177,0.4)] hover:scale-[1.02] active:scale-[0.98]"
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
      <div className="p-6 space-y-8 min-h-screen">
        <div>
          <h1 className="text-title-1 text-white tracking-tight mb-2">Team</h1>
          <p className="text-body text-white/50">Collaborate with your team</p>
        </div>

        <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-10 border border-white/[0.08] shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
          <div className="text-center space-y-5">
            <div className="w-[72px] h-[72px] bg-white/[0.05] rounded-2xl flex items-center justify-center mx-auto border border-white/[0.08]">
              <Users className="w-9 h-9 text-white/40" />
            </div>
            <div>
              <h4 className="text-xl font-semibold text-white mb-2 tracking-tight">Team Features Locked</h4>
              <p className="text-sm text-white/50 leading-relaxed">
                Upgrade to Startup plan to invite team members and collaborate
              </p>
            </div>
            <button
              type="button"
              className="bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 text-white py-3.5 px-7 rounded-2xl font-semibold hover:from-[#0CE3B1] hover:to-[#16A085] transition-all duration-300 shadow-[0_4px_20px_rgba(12,227,177,0.3)] hover:shadow-[0_6px_28px_rgba(12,227,177,0.4)] hover:scale-[1.02] active:scale-[0.98]"
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
    <div className="p-6 space-y-8 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-title-1 text-white tracking-tight mb-2">
          Team Performance
        </h1>
        <p className="text-body text-white/50">
          {organization?.name} • {teamMetrics.memberCount} Active {teamMetrics.memberCount === 1 ? 'Member' : 'Members'}
        </p>
      </div>

      {/* Team Overview Metrics */}
      {/* CRITICAL FIX: Show honest empty state when no pipeline data */}
      {/* Don't show misleading "Trending up" or "70% probability" with $0 */}
      {(teamMetrics?.totalPipeline ?? 0) === 0 && (teamMetrics?.totalDealsAdded ?? 0) === 0 ? (
        <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-12 border border-white/[0.08] text-center shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
          <div className="w-[72px] h-[72px] bg-white/[0.05] rounded-2xl flex items-center justify-center mx-auto mb-5 border border-white/[0.08]">
            <TrendingUp className="w-9 h-9 text-white/40" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2 tracking-tight">
            No pipeline performance data yet.
          </h3>
          <p className="text-sm text-white/50 max-w-md mx-auto leading-relaxed">
            Once your team starts closing deals, you'll see trends and performance graphs here.
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Total Pipeline */}
        <div className="bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 backdrop-blur-md rounded-2xl p-6 border border-emerald-400/25 shadow-[0_4px_20px_rgba(16,185,129,0.1)] transition-all duration-300 hover:shadow-[0_6px_28px_rgba(16,185,129,0.15)] hover:border-emerald-400/35">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-white/60 mb-1.5 font-medium">Total Pipeline</p>
              <p className="text-3xl font-bold text-emerald-400 tracking-tight">
                {formatCurrency(teamMetrics?.totalPipeline ?? 0)}
              </p>
              {/* CRITICAL FIX: Only show trend if there's actual pipeline data */}
              {(teamMetrics?.totalPipeline ?? 0) > 0 && (
                <p className="text-sm text-white/50 mt-2.5 flex items-center gap-1.5">
                  {teamMetrics?.teamTrend === 'up' ? (
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-rose-400" />
                  )}
                  <span className={teamMetrics?.teamTrend === 'up' ? 'text-emerald-400' : 'text-rose-400'}>
                    {teamMetrics?.teamTrend === 'up' ? 'Trending up' : 'Trending down'}
                  </span>
                </p>
              )}
            </div>
            <DollarSign className="w-10 h-10 text-emerald-400/30" />
          </div>
        </div>

        {/* Expected Revenue */}
        <div className="bg-gradient-to-br from-sky-500/15 to-sky-600/5 backdrop-blur-md rounded-2xl p-6 border border-sky-400/25 shadow-[0_4px_20px_rgba(14,165,233,0.1)] transition-all duration-300 hover:shadow-[0_6px_28px_rgba(14,165,233,0.15)] hover:border-sky-400/35">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-white/60 mb-1.5 font-medium">Expected Revenue</p>
              <p className="text-3xl font-bold text-sky-400 tracking-tight">
                {formatCurrency(teamMetrics?.totalExpectedRevenue ?? 0)}
              </p>
              {/* CRITICAL FIX: Only show probability if there's actual revenue data */}
              {(teamMetrics?.totalExpectedRevenue ?? 0) > 0 && (teamMetrics?.totalPipeline ?? 0) > 0 && (
                <p className="text-sm text-white/50 mt-2.5">
                  {Math.round((teamMetrics.totalExpectedRevenue / teamMetrics.totalPipeline) * 100)}% avg probability
                </p>
              )}
            </div>
            <Target className="w-10 h-10 text-sky-400/30" />
          </div>
        </div>

        {/* Deals Added This Week */}
        <div className="bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 backdrop-blur-md rounded-2xl p-6 border border-emerald-400/25 shadow-[0_4px_20px_rgba(16,185,129,0.1)] transition-all duration-300 hover:shadow-[0_6px_28px_rgba(16,185,129,0.15)] hover:border-emerald-400/35">
          <div>
            <p className="text-sm text-white/60 mb-1.5 font-medium">Deals Added (This Week)</p>
            <p className="text-3xl font-bold text-emerald-400 tracking-tight">{teamMetrics?.totalDealsAdded ?? 0}</p>
          </div>
        </div>

        {/* Deals Closed This Week */}
        <div className="bg-gradient-to-br from-purple-500/15 to-purple-600/5 backdrop-blur-md rounded-2xl p-6 border border-purple-400/25 shadow-[0_4px_20px_rgba(168,85,247,0.1)] transition-all duration-300 hover:shadow-[0_6px_28px_rgba(168,85,247,0.15)] hover:border-purple-400/35">
          <div>
            <p className="text-sm text-white/60 mb-1.5 font-medium">Deals Closed (This Week)</p>
            <p className="text-3xl font-bold text-purple-400 tracking-tight">{teamMetrics?.totalDealsClosed ?? 0}</p>
            <p className="text-sm text-white/50 mt-2.5">{formatCurrency(teamMetrics?.totalClosedValue ?? 0)}</p>
          </div>
        </div>
      </div>
      )}

      {/* Team Members Performance */}
      {/* TODO: Per-user revenue targets
          Once the user_targets table is integrated with TeamDashboard (via a new query or
          backend endpoint), this section will display and allow editing of annual, quarterly,
          and monthly targets for each team member. The backend already supports user_targets
          (see user-targets-save Netlify function), but TeamDashboard does not currently load
          this data. When ready, add a "Targets" row per member showing their goals. */}
      <div>
        <h2 className="text-title-2 text-white tracking-tight mb-5">
          Team Member Performance
        </h2>
        {/* FIX H3: Empty state for no team members */}
        {teamMembers.length === 0 ? (
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-12 border border-white/[0.08] text-center shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
            <div className="w-[72px] h-[72px] bg-white/[0.05] rounded-2xl flex items-center justify-center mx-auto mb-5 border border-white/[0.08]">
              <Users className="w-9 h-9 text-white/40" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2 tracking-tight">
              No Team Members Yet
            </h3>
            <p className="text-sm text-white/50 max-w-md mx-auto leading-relaxed">
              Invite your first team member from Settings to start collaborating on deals.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* PAGINATION FIX: Only show displayedCount members */}
            {/* FIX G2: Tightened spacing (space-y-3, p-5, mb-4) for Apple-tight layout */}
            {teamMembers.slice(0, displayedCount).map((member) => (
            <div
              key={member.userId}
              className="bg-white/[0.03] backdrop-blur-md rounded-2xl p-5 border-l-4 border-[#0CE3B1] border border-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 hover:shadow-[0_6px_28px_rgba(0,0,0,0.15)] hover:bg-white/[0.05]"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white tracking-tight">
                    {member.name}
                    {member.isCurrentUser && (
                      <span className="ml-2 text-sm font-normal text-[#0CE3B1]">(You)</span>
                    )}
                  </h3>
                  <p className="text-sm text-white/50 mt-0.5">
                    {member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'}
                  </p>
                </div>
              </div>

              {/* Show metrics or "no activity" message */}
              {member.hasNoActivity && !member.isCurrentUser ? (
                <div className="p-4 bg-white/[0.02] rounded-xl text-center">
                  <p className="text-sm text-white/40">No recent deal activity yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex justify-between items-center p-3 bg-white/[0.02] rounded-xl">
                    <span className="text-sm text-white/50">Deals Added:</span>
                    <span className="font-semibold text-white">
                      {member.dealsAdded} ({formatCurrency(member.dealsAddedValue)})
                      {member.dealsAdded > 0 && (
                        member.dealsAddedTrend === 'up' ? (
                          <TrendingUp className="inline w-4 h-4 ml-1.5 text-emerald-400" />
                        ) : (
                          <TrendingDown className="inline w-4 h-4 ml-1.5 text-rose-400" />
                        )
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-3 bg-white/[0.02] rounded-xl">
                    <span className="text-sm text-white/50">Deals Closed:</span>
                    <span className="font-semibold text-white">
                      {member.dealsClosed} won ({formatCurrency(member.dealsClosedValue)})
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-3 bg-white/[0.02] rounded-xl">
                    <span className="text-sm text-white/50">Active Pipeline:</span>
                    <span className="font-semibold text-white">
                      {formatCurrency(member.activePipeline)} → {formatCurrency(member.expectedRevenue)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}

            {/* PAGINATION FIX: Load More button when there are more members */}
            {displayedCount < totalMemberCount && (
              <div className="flex justify-center pt-6">
                <button
                  onClick={() => setDisplayedCount(prev => prev + TEAM_PAGE_SIZE)}
                  className="flex items-center gap-2.5 px-7 py-3.5 bg-white/[0.03] border border-white/[0.1] text-white rounded-2xl hover:bg-white/[0.06] hover:border-[#0CE3B1]/30 transition-all duration-300 font-medium shadow-[0_4px_16px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(12,227,177,0.1)]"
                >
                  <Users className="w-4 h-4 text-[#0CE3B1]" />
                  Load More ({totalMemberCount - displayedCount} remaining)
                </button>
              </div>
            )}

            {/* PAGINATION FIX: Show count indicator */}
            <div className="text-center pt-4">
              <p className="text-xs text-white/40">
                Showing {Math.min(displayedCount, totalMemberCount)} of {totalMemberCount} team members
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamDashboard;
