import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase, ensureValidSession } from '../lib/supabase';
import {
  Users, TrendingUp, TrendingDown, DollarSign, Target, Loader2,
  Check, X, Search, ChevronDown, Building2, Pencil
} from 'lucide-react';
import { useApp } from './AppShell';
import { useRealTimeDeals } from '../hooks/useRealTimeDeals';
import { logger } from '../lib/logger';

// PAGINATION FIX: Page size for team members list
const TEAM_PAGE_SIZE = 25;

// ============================================================
// TEAM PAGE DISPLAY HELPERS (Name & Avatar logic)
// ============================================================

/**
 * Get display name for a team member with priority:
 * 1) First Name + Last Initial (e.g., "Jeremy H.")
 * 2) First Name only (e.g., "Jeremy")
 * 3) full_name fallback
 * 4) Full email address
 * 5) "Team Member" as last resort
 */
function getTeamDisplayName(member) {
  const profile = member.profiles || member.user_profiles || member.profile || {};
  const profilesData = member.profilesData || {};

  const first = profilesData.first_name?.trim() || profile.first_name?.trim();
  const last = profilesData.last_name?.trim() || profile.last_name?.trim();
  const fullName = profile.full_name?.trim();
  const email = profile.email || member.email;

  if (first && last) {
    return `${first} ${last.charAt(0).toUpperCase()}.`;
  }
  if (first) {
    return first;
  }
  if (fullName) {
    return fullName;
  }
  if (email) {
    return email;
  }
  return 'Team Member';
}

/**
 * Get avatar initials for a team member
 */
function getTeamAvatarInitials(member) {
  const profile = member.profiles || member.user_profiles || member.profile || {};
  const profilesData = member.profilesData || {};

  const first = profilesData.first_name?.trim() || profile.first_name?.trim();
  const last = profilesData.last_name?.trim() || profile.last_name?.trim();
  const fullName = profile.full_name?.trim();
  const email = profile.email || member.email;

  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase();
  }
  if (first) {
    return first[0].toUpperCase();
  }
  if (fullName) {
    const parts = fullName.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return 'U';
}

/**
 * Get avatar URL from member profile data
 */
function getTeamAvatarUrl(member) {
  const profilesData = member.profilesData || {};
  const profile = member.profiles || member.user_profiles || member.profile || {};
  return profilesData.avatar_url || profile.avatar_url || null;
}

// ============================================================
// STATUS BADGE COMPONENT
// ============================================================

const StatusBadge = ({ status, attainmentPct, projectedAttainmentPct, period }) => {
  const statusConfig = {
    'green': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'On track' },
    'yellow': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Watch' },
    'red': { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Needs attention' },
    'no-target': { bg: 'bg-white/10', text: 'text-white/50', label: 'No target' }
  };

  const config = statusConfig[status] || statusConfig['no-target'];
  const periodLabel = period === 'month' ? 'monthly' : period === 'quarter' ? 'quarterly' : 'annual';

  // Build summary text
  let summaryText = '';
  if (status === 'no-target') {
    summaryText = 'No target set for this period';
  } else if (projectedAttainmentPct !== null) {
    const attained = Math.round((attainmentPct || 0) * 100);
    const projected = Math.round(Math.min(projectedAttainmentPct * 100, 200));
    summaryText = `${attained}% of ${periodLabel} goal so far • projected ${projected}%`;
  } else {
    const attained = Math.round((attainmentPct || 0) * 100);
    summaryText = `${attained}% of ${periodLabel} goal so far`;
  }

  return (
    <div className="flex items-center gap-2 mt-1">
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
      <span className="text-xs text-white/50">{summaryText}</span>
    </div>
  );
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export const TeamDashboard = () => {
  const { setActiveView, organization: contextOrganization, addNotification } = useApp();

  // Core state
  const [loading, setLoading] = useState(true);
  const [teamMetrics, setTeamMetrics] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [organizationId, setOrganizationId] = useState(null);
  const debounceTimerRef = useRef(null);

  // Pagination
  const [displayedCount, setDisplayedCount] = useState(TEAM_PAGE_SIZE);
  const [totalMemberCount, setTotalMemberCount] = useState(0);

  // Analytics state (from new endpoint)
  const [analyticsData, setAnalyticsData] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [searchQuery, setSearchQuery] = useState('');

  // Organization targets state
  const [orgTargetAnnual, setOrgTargetAnnual] = useState(0);
  const [isEditingOrgTarget, setIsEditingOrgTarget] = useState(false);
  const [editedOrgAnnual, setEditedOrgAnnual] = useState('');

  // Team targets editing state
  const [isAdmin, setIsAdmin] = useState(false);
  const [isEditingTeamTargets, setIsEditingTeamTargets] = useState(false);
  const [editedTargets, setEditedTargets] = useState({});
  const [savingTargets, setSavingTargets] = useState(false);

  const hasPaidPlan = contextOrganization?.plan && ['startup', 'growth', 'pro'].includes(contextOrganization.plan.toLowerCase());

  const INITIAL_RENDER_COUNT = 10;
  const BATCH_SIZE = 10;

  // ============================================================
  // DATA FETCHING
  // ============================================================

  const fetchAnalytics = useCallback(async (orgId, period = 'month') => {
    try {
      await ensureValidSession();
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`/.netlify/functions/team-analytics-get?organization_id=${orgId}&period=${period}`, {
        method: 'GET',
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.warn('[TeamDashboard] Session expired - cannot fetch analytics');
          return null;
        }
        console.warn('[TeamDashboard] Failed to fetch analytics:', response.status);
        return null;
      }

      const result = await response.json();
      if (result.success) {
        return result;
      }
      return null;
    } catch (error) {
      console.error('[TeamDashboard] Error fetching analytics:', error);
      return null;
    }
  }, []);

  const loadTeamData = useCallback(async () => {
    try {
      setLoading(true);

      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid) {
        logger.warn('[TeamDashboard] Session invalid:', sessionCheck.error);
        setLoading(false);
        return;
      }

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Team data query timed out')), 10000)
      );

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

      if (memberError) {
        logger.log('No team membership found:', memberError.message);
        return;
      }

      if (!member) return;

      setOrganization(member.organizations);
      const orgId = member.organization_id;
      setOrganizationId(orgId);

      // Fetch analytics data (includes org targets, member targets, and performance)
      const analytics = await fetchAnalytics(orgId, selectedPeriod);
      if (analytics) {
        setAnalyticsData(analytics);
        setIsAdmin(analytics.isAdmin);
        setOrgTargetAnnual(analytics.orgTarget?.annual || 0);
      }

      // Get all team members for this organization
      const { data: members, error: membersError } = await Promise.race([
        supabase
          .from('team_members')
          .select('user_id, role, created_at')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: true }),
        timeoutPromise
      ]);

      if (membersError) {
        console.error('[TeamDashboard] Error fetching team members:', membersError);
      }

      if (!members || members.length === 0) {
        console.log('[TeamDashboard] No team members found for org:', orgId);
        return;
      }

      const userIds = members.map(m => m.user_id);

      const [userProfilesResult, profilesTableResult] = await Promise.all([
        Promise.race([
          supabase
            .from('user_profiles')
            .select('id, email, full_name')
            .in('id', userIds),
          timeoutPromise
        ]),
        Promise.race([
          supabase
            .from('profiles')
            .select('id, first_name, last_name, avatar_url')
            .in('id', userIds),
          timeoutPromise
        ])
      ]);

      const { data: userProfiles, error: userProfilesError } = userProfilesResult;
      const { data: profilesData, error: profilesTableError } = profilesTableResult;

      if (userProfilesError) {
        console.error('[TeamDashboard] Error fetching user_profiles:', userProfilesError);
      }
      if (profilesTableError) {
        console.error('[TeamDashboard] Error fetching profiles table:', profilesTableError);
      }

      const userProfileMap = new Map();
      if (userProfiles) {
        userProfiles.forEach(p => userProfileMap.set(p.id, p));
      }

      const profilesDataMap = new Map();
      if (profilesData) {
        profilesData.forEach(p => profilesDataMap.set(p.id, p));
      }

      const membersWithProfiles = members.map(m => ({
        ...m,
        profiles: userProfileMap.get(m.user_id) || null,
        profilesData: profilesDataMap.get(m.user_id) || null
      }));

      const uniqueMembers = Array.from(
        new Map(membersWithProfiles.map(m => [m.user_id, m])).values()
      );

      const orgAdmin = uniqueMembers.find(m => m.role === 'owner') ||
                       uniqueMembers.find(m => m.role === 'admin') ||
                       uniqueMembers[0];
      const orgAdminId = orgAdmin?.user_id;

      const { data: allDeals } = await Promise.race([
        supabase
          .from('deals')
          .select('*')
          .eq('organization_id', orgId)
          .is('deleted_at', null),
        timeoutPromise
      ]);

      if (!allDeals) return;

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const memberMetrics = await Promise.all(
        uniqueMembers.map(async (memberItem) => {
          const memberDeals = allDeals.filter(d => {
            if (d.assigned_to === memberItem.user_id) return true;
            if (!d.assigned_to && memberItem.user_id === orgAdminId) return true;
            return false;
          });

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

          const isCurrentUser = memberItem.user_id === user.id;
          const memberEmail = memberItem.profiles?.email;
          const memberFullName = memberItem.profiles?.full_name;

          let userName;
          if (isCurrentUser) {
            userName = user.user_metadata?.full_name
              || memberFullName
              || user.email?.split('@')[0]
              || 'You';
          } else if (memberFullName) {
            userName = memberFullName;
          } else if (memberEmail) {
            userName = memberEmail.split('@')[0];
          } else {
            const roleLabel = memberItem.role === 'owner' ? 'Owner' : memberItem.role === 'admin' ? 'Admin' : 'Member';
            userName = `Team ${roleLabel}`;
            logger.warn('[TeamDashboard] Member without user_profile:', memberItem.user_id?.substring(0, 8));
          }

          return {
            userId: memberItem.user_id,
            name: userName,
            role: memberItem.role,
            isCurrentUser,
            dealsAdded: dealsThisWeek.length,
            dealsAddedValue,
            dealsAddedTrend,
            dealsClosed: wonThisWeek.length,
            dealsClosedValue: wonValue,
            activePipeline,
            expectedRevenue,
            hasNoActivity: memberDeals.length === 0,
            profiles: memberItem.profiles,
            profilesData: memberItem.profilesData,
            email: memberItem.profiles?.email
          };
        })
      );

      const totalPipeline = memberMetrics.reduce((sum, m) => sum + m.activePipeline, 0);
      const totalExpectedRevenue = memberMetrics.reduce((sum, m) => sum + m.expectedRevenue, 0);
      const totalDealsAdded = memberMetrics.reduce((sum, m) => sum + m.dealsAdded, 0);
      const totalDealsClosed = memberMetrics.reduce((sum, m) => sum + m.dealsClosed, 0);
      const totalClosedValue = memberMetrics.reduce((sum, m) => sum + m.dealsClosedValue, 0);

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

      const sortedMembers = memberMetrics.sort((a, b) => {
        if (a.isCurrentUser) return -1;
        if (b.isCurrentUser) return 1;
        return b.activePipeline - a.activePipeline;
      });

      setTeamMembers(sortedMembers);
      setTotalMemberCount(sortedMembers.length);

      if (sortedMembers.length > INITIAL_RENDER_COUNT) {
        setDisplayedCount(INITIAL_RENDER_COUNT);

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

        setTimeout(() => scheduleNextBatch(INITIAL_RENDER_COUNT), 100);
      } else {
        setDisplayedCount(sortedMembers.length);
      }
    } catch (error) {
      console.error('Error loading team data:', error);
    } finally {
      setLoading(false);
    }
  }, [fetchAnalytics, selectedPeriod]);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  // Refetch analytics when period changes
  useEffect(() => {
    if (organizationId) {
      fetchAnalytics(organizationId, selectedPeriod).then(result => {
        if (result) {
          setAnalyticsData(result);
        }
      });
    }
  }, [selectedPeriod, organizationId, fetchAnalytics]);

  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      loadTeamData();
    }, 500);
  }, [loadTeamData]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useRealTimeDeals(organizationId, () => {
    debouncedRefresh();
  });

  // ============================================================
  // TARGET EDITING
  // ============================================================

  const startEditingTeamTargets = useCallback(() => {
    // Initialize edited targets from analytics data
    const targets = {};
    if (analyticsData?.members) {
      analyticsData.members.forEach(m => {
        targets[m.userId] = {
          monthly: m.monthlyTarget || 0,
          quarterly: m.quarterlyTarget || 0,
          annual: m.annualTarget || 0
        };
      });
    }
    setEditedTargets(targets);
    setEditedOrgAnnual(String(orgTargetAnnual || 0));
    setIsEditingTeamTargets(true);
  }, [analyticsData, orgTargetAnnual]);

  const cancelEditingTeamTargets = useCallback(() => {
    setIsEditingTeamTargets(false);
    setEditedTargets({});
    setEditedOrgAnnual('');
    // Reload data to reset any unsaved changes
    if (organizationId) {
      fetchAnalytics(organizationId, selectedPeriod).then(result => {
        if (result) {
          setAnalyticsData(result);
          setOrgTargetAnnual(result.orgTarget?.annual || 0);
        }
      });
    }
  }, [organizationId, selectedPeriod, fetchAnalytics]);

  const saveTeamTargets = useCallback(async () => {
    if (!organizationId) return;

    setSavingTargets(true);
    try {
      await ensureValidSession();
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      // Prepare payload
      const membersPayload = Object.entries(editedTargets).map(([userId, targets]) => ({
        userId,
        monthlyTarget: parseFloat(targets.monthly) || 0,
        quarterlyTarget: parseFloat(targets.quarterly) || 0,
        annualTarget: parseFloat(targets.annual) || 0
      }));

      const payload = {
        organization_id: organizationId,
        orgTargetAnnual: parseFloat(editedOrgAnnual) || 0,
        members: membersPayload
      };

      const response = await fetch('/.netlify/functions/team-targets-save', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.success || result.partial) {
        // Update local state
        setOrgTargetAnnual(parseFloat(editedOrgAnnual) || 0);
        setIsEditingTeamTargets(false);
        setEditedTargets({});
        // Reload analytics
        const analytics = await fetchAnalytics(organizationId, selectedPeriod);
        if (analytics) {
          setAnalyticsData(analytics);
        }
        // APPLE UX POLISH: Show success notification
        addNotification(result.partial ? 'Targets saved (some may need review)' : 'Targets saved successfully', result.partial ? 'warning' : 'success');
      } else {
        console.error('[TeamDashboard] Failed to save targets:', result.errors);
        // APPLE UX POLISH: Show error notification
        addNotification('Failed to save targets. Please try again.', 'error');
      }
    } catch (error) {
      console.error('[TeamDashboard] Error saving targets:', error);
      // APPLE UX POLISH: Show error notification
      addNotification('Connection error. Please check your network and try again.', 'error');
    } finally {
      setSavingTargets(false);
    }
  }, [organizationId, editedTargets, editedOrgAnnual, selectedPeriod, fetchAnalytics, addNotification]);

  // Distribute to team
  const distributeToTeam = useCallback(() => {
    const annual = parseFloat(editedOrgAnnual) || 0;
    if (annual <= 0 || !analyticsData?.members?.length) return;

    const perMemberAnnual = Math.round(annual / analyticsData.members.length);
    const perMemberQuarterly = Math.round(perMemberAnnual / 4);
    const perMemberMonthly = Math.round(perMemberAnnual / 12);

    const newTargets = {};
    analyticsData.members.forEach(m => {
      newTargets[m.userId] = {
        annual: perMemberAnnual,
        quarterly: perMemberQuarterly,
        monthly: perMemberMonthly
      };
    });

    setEditedTargets(newTargets);
    // Ensure we're in edit mode
    if (!isEditingTeamTargets) {
      setIsEditingTeamTargets(true);
    }
  }, [editedOrgAnnual, analyticsData, isEditingTeamTargets]);

  // ============================================================
  // HELPERS
  // ============================================================

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Filter members by search
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return teamMembers;
    const query = searchQuery.toLowerCase();
    return teamMembers.filter(m =>
      m.name?.toLowerCase().includes(query) ||
      m.email?.toLowerCase().includes(query)
    );
  }, [teamMembers, searchQuery]);

  // Get analytics for a specific member
  const getMemberAnalytics = useCallback((userId) => {
    if (!analyticsData?.analytics?.members) return null;
    return analyticsData.analytics.members.find(m => m.userId === userId);
  }, [analyticsData]);

  // Get member target from analytics
  const getMemberTarget = useCallback((userId) => {
    if (!analyticsData?.members) return null;
    return analyticsData.members.find(m => m.userId === userId);
  }, [analyticsData]);

  // ============================================================
  // RENDER
  // ============================================================

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

  if (!teamMetrics) {
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
                const url = new URL(window.location);
                url.searchParams.set('tab', 'billing');
                window.history.pushState({}, '', url);
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

  // Derived values
  const orgQuarterly = Math.round((orgTargetAnnual || 0) / 4);
  const orgMonthly = Math.round((orgTargetAnnual || 0) / 12);
  const editedQuarterly = Math.round((parseFloat(editedOrgAnnual) || 0) / 4);
  const editedMonthly = Math.round((parseFloat(editedOrgAnnual) || 0) / 12);

  const summary = analyticsData?.analytics?.summary || {};
  const canDistribute = (parseFloat(editedOrgAnnual) || 0) > 0 && (analyticsData?.members?.length || 0) > 0;

  return (
    <div className="p-6 space-y-6 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-title-1 text-white tracking-tight mb-2">
          Team Performance
        </h1>
        <p className="text-body text-white/50">
          {organization?.name} • {teamMetrics.memberCount} Active {teamMetrics.memberCount === 1 ? 'Member' : 'Members'}
        </p>
      </div>

      {/* ============================================================ */}
      {/* ORGANIZATION REVENUE TARGETS CARD */}
      {/* ============================================================ */}
      <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-6 border border-[#0CE3B1]/20 shadow-[0_4px_20px_rgba(12,227,177,0.08)]">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/10 rounded-xl flex items-center justify-center border border-[#0CE3B1]/20">
              <Building2 className="w-5 h-5 text-[#0CE3B1]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white tracking-tight">Organization Revenue Targets</h2>
              <p className="text-xs text-white/50">Set your top-line revenue goals and cascade them down to your team.</p>
            </div>
          </div>
          {isAdmin && !isEditingTeamTargets && (
            <button
              onClick={startEditingTeamTargets}
              className="flex items-center gap-2 px-4 py-2 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white hover:bg-white/[0.08] transition-colors"
            >
              <Pencil className="w-4 h-4" />
              Edit targets
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-white/[0.02] rounded-xl text-center">
            <p className="text-xs text-white/50 mb-1">Monthly</p>
            <p className="text-xl font-bold text-white">
              {isEditingTeamTargets ? formatCurrency(editedMonthly) : formatCurrency(orgMonthly)}
            </p>
            <p className="text-xs text-white/40 mt-1">auto-derived</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl text-center">
            <p className="text-xs text-white/50 mb-1">Quarterly</p>
            <p className="text-xl font-bold text-white">
              {isEditingTeamTargets ? formatCurrency(editedQuarterly) : formatCurrency(orgQuarterly)}
            </p>
            <p className="text-xs text-white/40 mt-1">auto-derived</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl text-center border border-[#0CE3B1]/20">
            <p className="text-xs text-[#0CE3B1] mb-1 font-medium">Annual (source)</p>
            {isEditingTeamTargets ? (
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="number"
                  value={editedOrgAnnual}
                  onChange={(e) => setEditedOrgAnnual(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-white/[0.05] border border-[#0CE3B1]/30 rounded-lg text-white text-center text-xl font-bold focus:outline-none focus:border-[#0CE3B1]/60"
                  placeholder="0"
                />
              </div>
            ) : (
              <p className="text-xl font-bold text-[#0CE3B1]">{formatCurrency(orgTargetAnnual)}</p>
            )}
            <p className="text-xs text-white/40 mt-1">editable</p>
          </div>
        </div>

        {/* Distribute to Team button (only in edit mode) */}
        {isEditingTeamTargets && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={distributeToTeam}
              disabled={!canDistribute}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                canDistribute
                  ? 'bg-[#0CE3B1]/20 text-[#0CE3B1] border border-[#0CE3B1]/30 hover:bg-[#0CE3B1]/30'
                  : 'bg-white/[0.03] text-white/30 border border-white/[0.05] cursor-not-allowed'
              }`}
            >
              Distribute to team
            </button>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* TEAM PERFORMANCE SNAPSHOT DASHBOARD */}
      {/* ============================================================ */}
      <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-6 border border-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white tracking-tight">Team Performance Snapshot</h2>
            <p className="text-xs text-white/50">Quick view of how your team is tracking against their revenue targets.</p>
          </div>
          {/* Period Selector */}
          <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.08]">
            {['month', 'quarter', 'year'].map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPeriod(p)}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  selectedPeriod === p
                    ? 'bg-[#0CE3B1]/20 text-[#0CE3B1]'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                {p === 'month' ? 'Monthly' : p === 'quarter' ? 'Quarterly' : 'Annual'}
              </button>
            ))}
          </div>
        </div>

        {/* Key Gauges */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Team Attainment */}
          <div className="p-4 bg-white/[0.02] rounded-xl">
            <p className="text-xs text-white/50 mb-2">Team Attainment</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-white">
                {summary.totalTarget > 0
                  ? Math.round((summary.totalClosed / summary.totalTarget) * 100)
                  : 0}%
              </span>
              <span className="text-xs text-white/40 mb-1">of target</span>
            </div>
            {summary.totalTarget > 0 && (
              <div className="mt-2 h-1.5 bg-white/[0.1] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0CE3B1] rounded-full transition-all"
                  style={{ width: `${Math.min((summary.totalClosed / summary.totalTarget) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Status Counts */}
          <div className="p-4 bg-white/[0.02] rounded-xl">
            <p className="text-xs text-white/50 mb-2">Team Status</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-white">{summary.greenCount || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-sm text-white">{summary.yellowCount || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-sm text-white">{summary.redCount || 0}</span>
              </div>
            </div>
            <p className="text-xs text-white/40 mt-2">on track / watch / needs attention</p>
          </div>

          {/* Total Closed */}
          <div className="p-4 bg-white/[0.02] rounded-xl">
            <p className="text-xs text-white/50 mb-2">Total Closed</p>
            <p className="text-2xl font-bold text-[#0CE3B1]">{formatCurrency(summary.totalClosed || 0)}</p>
            <p className="text-xs text-white/40 mt-1">this {selectedPeriod}</p>
          </div>

          {/* Avg Attainment */}
          <div className="p-4 bg-white/[0.02] rounded-xl">
            <p className="text-xs text-white/50 mb-2">Avg Rep Attainment</p>
            <p className="text-2xl font-bold text-white">
              {summary.avgAttainmentPct !== null
                ? `${Math.round(summary.avgAttainmentPct * 100)}%`
                : '—'}
            </p>
            <p className="text-xs text-white/40 mt-1">
              {summary.noTargetCount > 0 && `${summary.noTargetCount} without targets`}
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* TEAM MEMBER PERFORMANCE */}
      {/* ============================================================ */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-title-2 text-white tracking-tight">
            Team Member Performance
          </h2>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search team members..."
                className="pl-9 pr-4 py-2 bg-white/[0.03] border border-white/[0.08] rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#0CE3B1]/40 w-64"
              />
            </div>
            {/* Edit mode controls */}
            {isEditingTeamTargets && (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelEditingTeamTargets}
                  className="px-4 py-2 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white hover:bg-white/[0.08] transition-colors"
                  disabled={savingTargets}
                >
                  Cancel
                </button>
                <button
                  onClick={saveTeamTargets}
                  disabled={savingTargets}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0CE3B1] text-white rounded-xl text-sm font-medium hover:bg-[#0CE3B1]/90 transition-colors disabled:opacity-50"
                >
                  {savingTargets ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save changes
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {filteredMembers.length === 0 ? (
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-12 border border-white/[0.08] text-center shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
            <div className="w-[72px] h-[72px] bg-white/[0.05] rounded-2xl flex items-center justify-center mx-auto mb-5 border border-white/[0.08]">
              <Users className="w-9 h-9 text-white/40" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2 tracking-tight">
              {searchQuery ? 'No matching team members' : 'No Team Members Yet'}
            </h3>
            <p className="text-sm text-white/50 max-w-md mx-auto leading-relaxed">
              {searchQuery
                ? 'Try a different search term'
                : 'Invite your first team member from Settings to start collaborating on deals.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMembers.slice(0, displayedCount).map((member) => {
              const memberAnalytics = getMemberAnalytics(member.userId);
              const memberTarget = getMemberTarget(member.userId);
              const editedMemberTargets = editedTargets[member.userId] || {};

              return (
                <div
                  key={member.userId}
                  className="bg-white/[0.03] backdrop-blur-md rounded-2xl p-5 border-l-4 border-[#0CE3B1] border border-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 hover:shadow-[0_6px_28px_rgba(0,0,0,0.15)] hover:bg-white/[0.05]"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {getTeamAvatarUrl(member) ? (
                          <img
                            src={getTeamAvatarUrl(member)}
                            alt={getTeamDisplayName(member)}
                            className="w-10 h-10 rounded-full object-cover border border-white/[0.1]"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0CE3B1]/30 to-[#0CE3B1]/10 border border-[#0CE3B1]/20 flex items-center justify-center">
                            <span className="text-sm font-semibold text-[#0CE3B1]">
                              {getTeamAvatarInitials(member)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-white tracking-tight">
                            {getTeamDisplayName(member)}
                            {member.isCurrentUser && (
                              <span className="ml-2 text-sm font-normal text-[#0CE3B1]">(You)</span>
                            )}
                          </h3>
                          <span className="px-2 py-0.5 text-xs rounded-full bg-white/[0.05] text-white/50">
                            {member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'}
                          </span>
                        </div>
                        {/* Status Badge */}
                        {memberAnalytics && (
                          <StatusBadge
                            status={memberAnalytics.status}
                            attainmentPct={memberAnalytics.attainmentPct}
                            projectedAttainmentPct={memberAnalytics.projectedAttainmentPct}
                            period={selectedPeriod}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  {member.hasNoActivity && !member.isCurrentUser ? (
                    <div className="p-4 bg-white/[0.02] rounded-xl text-center">
                      <p className="text-sm text-white/40">No recent deal activity yet</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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

                  {/* Revenue Targets Section */}
                  <div className="pt-4 border-t border-white/[0.05]">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-4 h-4 text-sky-400" />
                      <span className="text-sm font-medium text-white/70">Revenue Targets</span>
                    </div>

                    {isEditingTeamTargets ? (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">Monthly</label>
                          <input
                            type="number"
                            value={editedMemberTargets.monthly ?? ''}
                            onChange={(e) => setEditedTargets(prev => ({
                              ...prev,
                              [member.userId]: {
                                ...prev[member.userId],
                                monthly: e.target.value
                              }
                            }))}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm text-right focus:outline-none focus:border-[#0CE3B1]/40"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">Quarterly</label>
                          <input
                            type="number"
                            value={editedMemberTargets.quarterly ?? ''}
                            onChange={(e) => setEditedTargets(prev => ({
                              ...prev,
                              [member.userId]: {
                                ...prev[member.userId],
                                quarterly: e.target.value
                              }
                            }))}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm text-right focus:outline-none focus:border-[#0CE3B1]/40"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">Annual</label>
                          <input
                            type="number"
                            value={editedMemberTargets.annual ?? ''}
                            onChange={(e) => setEditedTargets(prev => ({
                              ...prev,
                              [member.userId]: {
                                ...prev[member.userId],
                                annual: e.target.value
                              }
                            }))}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm text-right focus:outline-none focus:border-[#0CE3B1]/40"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2 bg-white/[0.02] rounded-lg text-center">
                          <p className="text-xs text-white/40 mb-0.5">Monthly</p>
                          <p className="text-sm font-medium text-white">
                            {memberTarget?.monthlyTarget
                              ? formatCurrency(memberTarget.monthlyTarget)
                              : '—'}
                          </p>
                        </div>
                        <div className="p-2 bg-white/[0.02] rounded-lg text-center">
                          <p className="text-xs text-white/40 mb-0.5">Quarterly</p>
                          <p className="text-sm font-medium text-white">
                            {memberTarget?.quarterlyTarget
                              ? formatCurrency(memberTarget.quarterlyTarget)
                              : '—'}
                          </p>
                        </div>
                        <div className="p-2 bg-white/[0.02] rounded-lg text-center">
                          <p className="text-xs text-white/40 mb-0.5">Annual</p>
                          <p className="text-sm font-medium text-white">
                            {memberTarget?.annualTarget
                              ? formatCurrency(memberTarget.annualTarget)
                              : '—'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Load More button */}
            {displayedCount < filteredMembers.length && (
              <div className="flex justify-center pt-6">
                <button
                  onClick={() => setDisplayedCount(prev => prev + TEAM_PAGE_SIZE)}
                  className="flex items-center gap-2.5 px-7 py-3.5 bg-white/[0.03] border border-white/[0.1] text-white rounded-2xl hover:bg-white/[0.06] hover:border-[#0CE3B1]/30 transition-all duration-300 font-medium shadow-[0_4px_16px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(12,227,177,0.1)]"
                >
                  <Users className="w-4 h-4 text-[#0CE3B1]" />
                  Load More ({filteredMembers.length - displayedCount} remaining)
                </button>
              </div>
            )}

            {/* Count indicator */}
            <div className="text-center pt-4">
              <p className="text-xs text-white/40">
                Showing {Math.min(displayedCount, filteredMembers.length)} of {filteredMembers.length} team members
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamDashboard;
