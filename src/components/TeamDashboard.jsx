import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase, ensureValidSession } from '../lib/supabase';
import {
  Users, TrendingUp, TrendingDown, DollarSign, Target, Loader2,
  Check, X, Search, ChevronDown, Building2, Pencil, AlertCircle, RefreshCw
} from 'lucide-react';
import { useApp } from './AppShell';
import { useRealTimeDeals } from '../hooks/useRealTimeDeals';
import { logger } from '../lib/logger';
// TASK 3: Demo user display utilities
import { isDemoEmail, getDemoUserData, getDemoAvatarUrl, getInitials as getDemoInitials } from '../lib/demo-users';

// PAGINATION FIX: Page size for team members list
const TEAM_PAGE_SIZE = 25;

// ============================================================
// TEAM PAGE DISPLAY HELPERS (Name & Avatar logic)
// ============================================================

/**
 * Get display name for a team member with priority:
 * 1) Demo user name (if @startupstage.com email)
 * 2) First Name + Last Initial (e.g., "Jeremy H.")
 * 3) First Name only (e.g., "Jeremy")
 * 4) full_name fallback
 * 5) Full email address
 * 6) "Team Member" as last resort
 */
function getTeamDisplayName(member) {
  const profile = member.profiles || member.user_profiles || member.profile || {};
  const profilesData = member.profilesData || {};
  const email = profile.email || member.email;

  // TASK 3: Check for demo user first
  if (isDemoEmail(email)) {
    const demoData = getDemoUserData(email);
    if (demoData) return demoData.name;
  }

  const first = profilesData.first_name?.trim() || profile.first_name?.trim();
  const last = profilesData.last_name?.trim() || profile.last_name?.trim();
  const fullName = profile.full_name?.trim();

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
  const email = profile.email || member.email;

  // TASK 3: Check for demo user first
  if (isDemoEmail(email)) {
    const demoData = getDemoUserData(email);
    if (demoData && demoData.firstName && demoData.lastName) {
      return `${demoData.firstName[0]}${demoData.lastName[0]}`.toUpperCase();
    }
  }

  const first = profilesData.first_name?.trim() || profile.first_name?.trim();
  const last = profilesData.last_name?.trim() || profile.last_name?.trim();
  const fullName = profile.full_name?.trim();

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
 * TASK 3: For demo users, generates DiceBear avatar
 */
function getTeamAvatarUrl(member) {
  const profilesData = member.profilesData || {};
  const profile = member.profiles || member.user_profiles || member.profile || {};
  const email = profile.email || member.email;

  // TASK 3: Generate DiceBear avatar for demo users
  if (isDemoEmail(email)) {
    const demoData = getDemoUserData(email);
    if (demoData) return getDemoAvatarUrl(demoData.name);
  }

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
  // APPLE-GRADE UX: Track load errors for retry UI
  const [loadError, setLoadError] = useState(null);

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
      setLoadError(null); // APPLE-GRADE UX: Clear previous errors

      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid) {
        logger.warn('[TeamDashboard] Session invalid:', sessionCheck.error);
        setLoading(false);
        setLoadError('Session expired. Please refresh the page.');
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
      // APPLE-GRADE UX: Show user-friendly error with context
      const isTimeout = error.message?.includes('timed out');
      setLoadError(
        isTimeout
          ? 'Team data is taking longer than expected. Please try again.'
          : 'Unable to load team data. Please check your connection and try again.'
      );
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
  // TARGET EDITING - TASK 2A/2B: Auto-save with debounce
  // ============================================================

  // Ref to track pending auto-save
  const autoSaveTimerRef = useRef(null);
  const pendingSaveRef = useRef(null);

  // Initialize editable state when analytics loads
  useEffect(() => {
    if (analyticsData?.members && !isEditingTeamTargets) {
      const targets = {};
      analyticsData.members.forEach(m => {
        targets[m.userId] = {
          monthly: m.monthlyTarget || 0,
          quarterly: m.quarterlyTarget || 0,
          annual: m.annualTarget || 0
        };
      });
      setEditedTargets(targets);
      setEditedOrgAnnual(String(orgTargetAnnual || 0));
    }
  }, [analyticsData, orgTargetAnnual, isEditingTeamTargets]);

  // TASK 2A: Auto-save function with debounce
  const autoSaveTargets = useCallback(async (newOrgAnnual, newMemberTargets) => {
    if (!organizationId || !isAdmin) return;

    // Clear any pending save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Store the latest values to save
    pendingSaveRef.current = { newOrgAnnual, newMemberTargets };

    // Debounce the save
    autoSaveTimerRef.current = setTimeout(async () => {
      const { newOrgAnnual: orgVal, newMemberTargets: memberVals } = pendingSaveRef.current || {};
      if (!orgVal && !memberVals) return;

      setSavingTargets(true);
      try {
        await ensureValidSession();
        const { data: { session } } = await supabase.auth.getSession();

        const headers = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        // Use current state values if not provided
        const orgAnnualToSave = orgVal !== undefined ? parseFloat(orgVal) || 0 : parseFloat(editedOrgAnnual) || 0;
        const targetsToSave = memberVals || editedTargets;

        const membersPayload = Object.entries(targetsToSave).map(([userId, targets]) => ({
          userId,
          monthlyTarget: parseFloat(targets.monthly) || 0,
          quarterlyTarget: parseFloat(targets.quarterly) || 0,
          annualTarget: parseFloat(targets.annual) || 0
        }));

        const payload = {
          organization_id: organizationId,
          orgTargetAnnual: orgAnnualToSave,
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
          // Update local state silently
          setOrgTargetAnnual(orgAnnualToSave);
          // Reload analytics in background
          const analytics = await fetchAnalytics(organizationId, selectedPeriod);
          if (analytics) {
            setAnalyticsData(analytics);
          }
          // Subtle success feedback (no intrusive notification for auto-save)
          logger.log('[TeamDashboard] Targets auto-saved successfully');
        } else {
          console.error('[TeamDashboard] Failed to auto-save targets:', result.errors);
          addNotification('Failed to save targets. Please try again.', 'error');
        }
      } catch (error) {
        console.error('[TeamDashboard] Error auto-saving targets:', error);
        addNotification('Connection error. Changes may not be saved.', 'error');
      } finally {
        setSavingTargets(false);
        pendingSaveRef.current = null;
      }
    }, 800); // 800ms debounce for auto-save
  }, [organizationId, isAdmin, editedOrgAnnual, editedTargets, selectedPeriod, fetchAnalytics, addNotification]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // TASK 2A: Handle org target change with auto-save
  const handleOrgTargetChange = useCallback((value) => {
    setEditedOrgAnnual(value);
    setIsEditingTeamTargets(true);
    autoSaveTargets(value, editedTargets);
  }, [autoSaveTargets, editedTargets]);

  // TASK 2A: Handle member target change with auto-save
  const handleMemberTargetChange = useCallback((userId, field, value) => {
    const newTargets = {
      ...editedTargets,
      [userId]: {
        ...editedTargets[userId],
        [field]: value
      }
    };
    setEditedTargets(newTargets);
    setIsEditingTeamTargets(true);
    autoSaveTargets(editedOrgAnnual, newTargets);
  }, [autoSaveTargets, editedOrgAnnual, editedTargets]);

  // Legacy: Start editing (now just sets mode)
  const startEditingTeamTargets = useCallback(() => {
    setIsEditingTeamTargets(true);
  }, []);

  // TASK 2B FIX: Distribute to team - reads from current editedOrgAnnual and auto-saves
  const distributeToTeam = useCallback(() => {
    // TASK 2B: Read from current editedOrgAnnual state (not stale closure)
    const annual = parseFloat(editedOrgAnnual) || 0;
    if (annual <= 0 || !analyticsData?.members?.length) {
      addNotification('Please set an organization target first', 'warning');
      return;
    }

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
    setIsEditingTeamTargets(true);

    // TASK 2B: Auto-save the distributed targets immediately
    autoSaveTargets(editedOrgAnnual, newTargets);
    addNotification(`Distributed ${formatCurrency(annual)} across ${analyticsData.members.length} team members`, 'success');
  }, [editedOrgAnnual, analyticsData, autoSaveTargets, addNotification]);

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

  // APPLE-GRADE UX: Error state with retry button
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 px-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-rose-500/5 flex items-center justify-center shadow-[0_4px_20px_rgba(244,63,94,0.15)]">
          <AlertCircle className="w-7 h-7 text-rose-400" />
        </div>
        <div className="text-center space-y-2">
          <h4 className="text-lg font-semibold text-white">Unable to Load Team Data</h4>
          <p className="text-sm text-white/50 max-w-md">{loadError}</p>
        </div>
        <button
          onClick={loadTeamData}
          className="bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 text-white py-3 px-6 rounded-xl font-semibold hover:from-[#0CE3B1] hover:to-[#16A085] transition-all duration-300 shadow-[0_4px_20px_rgba(12,227,177,0.3)] hover:shadow-[0_6px_28px_rgba(12,227,177,0.4)] hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
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
    <div className="p-4 sm:p-6 space-y-6 min-h-screen">
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
          {/* TASK 2A: Removed explicit Edit button - targets are always editable for admins with auto-save */}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="p-4 bg-white/[0.02] rounded-xl text-center">
            <p className="text-xs text-white/50 mb-1">Monthly</p>
            <p className="text-xl font-bold text-white">
              {formatCurrency(editedMonthly || orgMonthly)}
            </p>
            <p className="text-xs text-white/40 mt-1">auto-derived</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl text-center">
            <p className="text-xs text-white/50 mb-1">Quarterly</p>
            <p className="text-xl font-bold text-white">
              {formatCurrency(editedQuarterly || orgQuarterly)}
            </p>
            <p className="text-xs text-white/40 mt-1">auto-derived</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl text-center border border-[#0CE3B1]/20">
            <p className="text-xs text-[#0CE3B1] mb-1 font-medium">Annual (source)</p>
            {/* TASK 2A: Always show editable input for admins with auto-save */}
            {isAdmin ? (
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="number"
                  value={editedOrgAnnual}
                  onChange={(e) => handleOrgTargetChange(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-white/[0.05] border border-[#0CE3B1]/30 rounded-lg text-white text-center text-xl font-bold focus:outline-none focus:border-[#0CE3B1]/60"
                  placeholder="0"
                />
                {savingTargets && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#0CE3B1]" />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xl font-bold text-[#0CE3B1]">{formatCurrency(orgTargetAnnual)}</p>
            )}
            <p className="text-xs text-white/40 mt-1">{isAdmin ? 'auto-saves' : 'view only'}</p>
          </div>
        </div>

        {/* TASK 2A: Distribute to Team button - always visible for admins */}
        {isAdmin && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={distributeToTeam}
              disabled={!canDistribute || savingTargets}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                canDistribute && !savingTargets
                  ? 'bg-[#0CE3B1]/20 text-[#0CE3B1] border border-[#0CE3B1]/30 hover:bg-[#0CE3B1]/30'
                  : 'bg-white/[0.03] text-white/30 border border-white/[0.05] cursor-not-allowed'
              }`}
            >
              Auto Distribute
            </button>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* TASK 4: REVOPS DASHBOARD - Enhanced metrics with traffic lights */}
      {/* ============================================================ */}
      <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-6 border border-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white tracking-tight">RevOps Dashboard</h2>
            <p className="text-xs text-white/50">Revenue operations health at a glance.</p>
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

        {/* TASK 4A: Top-level RevOps metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {/* New Deals */}
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-xs text-white/50 mb-1">New Deals</p>
            <p className="text-xl font-bold text-white">{analyticsData?.analytics?.revOps?.newDeals || 0}</p>
            <p className="text-xs text-[#0CE3B1] mt-1">
              {formatCurrency(analyticsData?.analytics?.revOps?.newDealsValue || 0)}
            </p>
          </div>

          {/* Closed Won */}
          <div className="p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <p className="text-xs text-emerald-400/70 mb-1">Closed Won</p>
            <p className="text-xl font-bold text-emerald-400">{analyticsData?.analytics?.revOps?.closedWon || 0}</p>
            <p className="text-xs text-emerald-400/70 mt-1">
              {formatCurrency(analyticsData?.analytics?.revOps?.closedWonValue || 0)}
            </p>
          </div>

          {/* Closed Lost */}
          <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/20">
            <p className="text-xs text-red-400/70 mb-1">Lost / Disqualified</p>
            <p className="text-xl font-bold text-red-400">{analyticsData?.analytics?.revOps?.closedLost || 0}</p>
            <p className="text-xs text-red-400/70 mt-1">
              {formatCurrency(analyticsData?.analytics?.revOps?.closedLostValue || 0)}
            </p>
          </div>

          {/* Active Pipeline */}
          <div className="p-4 bg-sky-500/10 rounded-xl border border-sky-500/20">
            <p className="text-xs text-sky-400/70 mb-1">Active Pipeline</p>
            <p className="text-xl font-bold text-sky-400">
              {formatCurrency(analyticsData?.analytics?.revOps?.activePipeline || 0)}
            </p>
            <p className="text-xs text-sky-400/70 mt-1">
              {analyticsData?.analytics?.revOps?.staleDeals || 0} stale
            </p>
          </div>

          {/* Team Attainment */}
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-xs text-white/50 mb-1">Attainment</p>
            <p className="text-xl font-bold text-white">
              {summary.totalTarget > 0
                ? `${Math.round((summary.totalClosed / summary.totalTarget) * 100)}%`
                : '—'}
            </p>
            {summary.totalTarget > 0 && (
              <div className="mt-2 h-1 bg-white/[0.1] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    (summary.totalClosed / summary.totalTarget) >= 0.9
                      ? 'bg-emerald-400'
                      : (summary.totalClosed / summary.totalTarget) >= 0.6
                        ? 'bg-yellow-400'
                        : 'bg-red-400'
                  }`}
                  style={{ width: `${Math.min((summary.totalClosed / summary.totalTarget) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* TASK 4B: Team Status Traffic Light */}
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-xs text-white/50 mb-2">Team Health</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-2 py-1 bg-emerald-500/20 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">{summary.greenCount || 0}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-xs font-medium text-yellow-400">{summary.yellowCount || 0}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-red-500/20 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-xs font-medium text-red-400">{summary.redCount || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* TASK 4C: Pipeline Health Summary */}
        {analyticsData?.analytics?.revOps && (
          <div className="flex items-center gap-4 p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <div className="flex-1">
              <p className="text-sm text-white/70 mb-2">Pipeline Health</p>
              <div className="flex items-center gap-4">
                {/* Win Rate bar */}
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs text-white/50 mb-1">
                    <span>Win Rate</span>
                    <span>
                      {analyticsData.analytics.revOps.closedWon + analyticsData.analytics.revOps.closedLost > 0
                        ? Math.round((analyticsData.analytics.revOps.closedWon / (analyticsData.analytics.revOps.closedWon + analyticsData.analytics.revOps.closedLost)) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-white/[0.1] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (() => {
                          const total = analyticsData.analytics.revOps.closedWon + analyticsData.analytics.revOps.closedLost;
                          if (total === 0) return 'bg-white/20';
                          const rate = analyticsData.analytics.revOps.closedWon / total;
                          return rate >= 0.4 ? 'bg-emerald-400' : rate >= 0.25 ? 'bg-yellow-400' : 'bg-red-400';
                        })()
                      }`}
                      style={{
                        width: `${
                          analyticsData.analytics.revOps.closedWon + analyticsData.analytics.revOps.closedLost > 0
                            ? (analyticsData.analytics.revOps.closedWon / (analyticsData.analytics.revOps.closedWon + analyticsData.analytics.revOps.closedLost)) * 100
                            : 0
                        }%`
                      }}
                    />
                  </div>
                </div>

                {/* Stale deals indicator */}
                <div className="text-center px-4 border-l border-white/[0.08]">
                  <p className={`text-lg font-bold ${
                    (analyticsData.analytics.revOps.staleDeals || 0) === 0
                      ? 'text-emerald-400'
                      : (analyticsData.analytics.revOps.staleDeals || 0) <= 3
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }`}>
                    {analyticsData.analytics.revOps.staleDeals || 0}
                  </p>
                  <p className="text-xs text-white/50">Stale Deals</p>
                </div>
              </div>
            </div>
          </div>
        )}
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
            {/* TASK 2A: Removed Save/Cancel buttons - targets auto-save on change */}
            {savingTargets && (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="w-4 h-4 animate-spin text-[#0CE3B1]" />
                <span>Saving...</span>
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
                        {/* TASK 4C: Health Chip + Status Badge */}
                        <div className="flex items-center gap-2">
                          {/* Health Status Chip */}
                          {(() => {
                            const health = analyticsData?.analytics?.memberHealth?.find(h => h.userId === member.userId);
                            if (!health) return null;
                            const statusConfig = {
                              healthy: { label: 'Healthy', bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
                              'at-risk': { label: 'At Risk', bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
                              critical: { label: 'Critical', bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' }
                            };
                            const config = statusConfig[health.healthStatus] || statusConfig.healthy;
                            return (
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${config.bg} ${config.text} border ${config.border}`}>
                                {config.label}
                              </span>
                            );
                          })()}
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

                    {/* TASK 2A: Always show editable inputs for admins with auto-save */}
                    {isAdmin ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">Monthly</label>
                          <input
                            type="number"
                            value={editedMemberTargets.monthly ?? memberTarget?.monthlyTarget ?? ''}
                            onChange={(e) => handleMemberTargetChange(member.userId, 'monthly', e.target.value)}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm text-right focus:outline-none focus:border-[#0CE3B1]/40"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">Quarterly</label>
                          <input
                            type="number"
                            value={editedMemberTargets.quarterly ?? memberTarget?.quarterlyTarget ?? ''}
                            onChange={(e) => handleMemberTargetChange(member.userId, 'quarterly', e.target.value)}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm text-right focus:outline-none focus:border-[#0CE3B1]/40"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">Annual</label>
                          <input
                            type="number"
                            value={editedMemberTargets.annual ?? memberTarget?.annualTarget ?? ''}
                            onChange={(e) => handleMemberTargetChange(member.userId, 'annual', e.target.value)}
                            placeholder="0"
                            className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-sm text-right focus:outline-none focus:border-[#0CE3B1]/40"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
