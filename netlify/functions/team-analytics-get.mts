/**
 * Team Analytics Get
 *
 * Consolidated endpoint that returns:
 * - Organization revenue targets (annual as source of truth)
 * - Team member targets
 * - Performance analytics with attainment, projection, and status per member
 *
 * Query params:
 * - organization_id: required
 * - period: 'month' | 'quarter' | 'year' (default: 'month')
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Types
interface OrgTarget {
  annual: number;
  quarterly: number;
  monthly: number;
}

interface MemberTarget {
  userId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: string;
  monthlyTarget: number;
  quarterlyTarget: number;
  annualTarget: number;
}

interface MemberPerformanceSnapshot {
  userId: string;
  closedThisPeriod: number;
  targetThisPeriod: number;
  attainmentPct: number;
  projectedAttainmentPct: number | null;
  status: 'green' | 'yellow' | 'red' | 'no-target';
}

// TASK 4: Enhanced metrics for RevOps dashboard
interface RevOpsMetrics {
  newDeals: number;           // Deals created this period
  newDealsValue: number;      // Value of new deals
  closedWon: number;          // Won deals this period
  closedWonValue: number;     // Won revenue
  closedLost: number;         // Lost/disqualified this period
  closedLostValue: number;    // Lost value
  activePipeline: number;     // Active pipeline value
  staleDeals: number;         // Deals with no activity > 14 days
}

interface MemberHealth {
  userId: string;
  healthStatus: 'healthy' | 'at-risk' | 'critical';
  staleDealsCount: number;
  avgDaysToClose: number | null;
}

interface TeamAnalytics {
  period: 'month' | 'quarter' | 'year';
  startDate: string;
  endDate: string;
  members: MemberPerformanceSnapshot[];
  summary: {
    totalTarget: number;
    totalClosed: number;
    avgAttainmentPct: number | null;
    greenCount: number;
    yellowCount: number;
    redCount: number;
    noTargetCount: number;
  };
  // TASK 4: RevOps metrics
  revOps?: RevOpsMetrics;
  memberHealth?: MemberHealth[];
}

interface TeamAnalyticsResponse {
  success: boolean;
  orgTarget: OrgTarget;
  members: MemberTarget[];
  analytics: TeamAnalytics;
  isAdmin: boolean;
}

// Helper: Get period boundaries
function getPeriodBoundaries(period: 'month' | 'quarter' | 'year'): { startDate: Date; endDate: Date } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  if (period === 'month') {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0); // Last day of month
    return { startDate, endDate };
  }

  if (period === 'quarter') {
    const quarter = Math.floor(month / 3);
    const startMonth = quarter * 3;
    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, startMonth + 3, 0);
    return { startDate, endDate };
  }

  // Year
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  return { startDate, endDate };
}

// Helper: Calculate days between dates
function daysBetween(start: Date, end: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((end.getTime() - start.getTime()) / oneDay));
}

// Helper: Clamp value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Helper: Format date as ISO string (date only)
function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  const corsHeaders = getCorsHeaders(event.headers);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Allow GET or POST
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    console.log('[team-analytics-get] Request received');

    // Validate environment
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Server configuration error' })
      };
    }

    // Get access token from cookie or Authorization header
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    let accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];

    // Also check Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!accessToken && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    }

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not authenticated' })
      };
    }

    // Parse parameters
    let organizationId: string | null = null;
    let period: 'month' | 'quarter' | 'year' = 'month';

    if (event.httpMethod === 'GET') {
      organizationId = event.queryStringParameters?.organization_id || null;
      const periodParam = event.queryStringParameters?.period;
      if (periodParam === 'month' || periodParam === 'quarter' || periodParam === 'year') {
        period = periodParam;
      }
    } else {
      const body = JSON.parse(event.body || '{}');
      organizationId = body.organization_id || null;
      if (body.period === 'month' || body.period === 'quarter' || body.period === 'year') {
        period = body.period;
      }
    }

    if (!organizationId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Missing organization_id' })
      };
    }

    // Authenticate user
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    // Use service role for data access
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify membership and get role
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (memberError || !membership) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not a member of this organization' })
      };
    }

    const isAdmin = ['owner', 'admin'].includes(membership.role);

    // 1. Fetch organization targets
    const { data: orgTargetData } = await supabase
      .from('organization_targets')
      .select('annual_target, quarterly_target, monthly_target')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const orgTarget: OrgTarget = {
      annual: orgTargetData?.annual_target || 0,
      quarterly: orgTargetData?.quarterly_target || Math.round((orgTargetData?.annual_target || 0) / 4),
      monthly: orgTargetData?.monthly_target || Math.round((orgTargetData?.annual_target || 0) / 12)
    };

    // 2. Fetch team members with profiles
    const { data: teamMembers } = await supabase
      .from('team_members')
      .select('user_id, role')
      .eq('organization_id', organizationId);

    if (!teamMembers || teamMembers.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          orgTarget,
          members: [],
          analytics: {
            period,
            startDate: '',
            endDate: '',
            members: [],
            summary: {
              totalTarget: 0,
              totalClosed: 0,
              avgAttainmentPct: null,
              greenCount: 0,
              yellowCount: 0,
              redCount: 0,
              noTargetCount: 0
            }
          },
          isAdmin
        })
      };
    }

    const userIds = teamMembers.map(m => m.user_id);

    // Fetch user profiles and targets in parallel
    const [profilesResult, userTargetsResult] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds),
      supabase
        .from('user_targets')
        .select('user_id, monthly_target, quarterly_target, annual_target')
        .eq('organization_id', organizationId)
        .in('user_id', userIds)
    ]);

    // Also fetch profiles table for first_name, last_name, avatar_url
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, avatar_url')
      .in('id', userIds);

    // Create lookup maps
    const profileMap = new Map<string, { email: string; full_name: string | null }>();
    (profilesResult.data || []).forEach(p => profileMap.set(p.id, p));

    const profilesDataMap = new Map<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }>();
    (profilesData || []).forEach(p => profilesDataMap.set(p.id, p));

    const targetMap = new Map<string, { monthly: number; quarterly: number; annual: number }>();
    (userTargetsResult.data || []).forEach(t => {
      targetMap.set(t.user_id, {
        monthly: t.monthly_target || 0,
        quarterly: t.quarterly_target || 0,
        annual: t.annual_target || 0
      });
    });

    // Build member targets array
    const members: MemberTarget[] = teamMembers.map(tm => {
      const profile = profileMap.get(tm.user_id);
      const profileData = profilesDataMap.get(tm.user_id);
      const targets = targetMap.get(tm.user_id);

      // Determine display name
      let displayName = profile?.full_name || null;
      if (!displayName && profileData?.first_name) {
        displayName = profileData.first_name;
        if (profileData.last_name) {
          displayName += ` ${profileData.last_name.charAt(0).toUpperCase()}.`;
        }
      }
      if (!displayName && profile?.email) {
        displayName = profile.email.split('@')[0];
      }

      return {
        userId: tm.user_id,
        email: profile?.email || '',
        displayName,
        firstName: profileData?.first_name || null,
        lastName: profileData?.last_name || null,
        avatarUrl: profileData?.avatar_url || null,
        role: tm.role,
        monthlyTarget: targets?.monthly || 0,
        quarterlyTarget: targets?.quarterly || 0,
        annualTarget: targets?.annual || 0
      };
    });

    // 3. Calculate analytics
    const { startDate, endDate } = getPeriodBoundaries(period);
    const now = new Date();
    const totalDays = daysBetween(startDate, endDate) + 1;
    const daysElapsed = clamp(daysBetween(startDate, now) + 1, 1, totalDays);
    const timeProgress = totalDays > 0 ? daysElapsed / totalDays : 1;

    // TASK 4: Fetch all deals for comprehensive RevOps metrics
    const [closedWonResult, newDealsResult, lostDealsResult, activeDealsResult] = await Promise.all([
      // Closed-won deals for the period
      supabase
        .from('deals')
        .select('assigned_to, value, closed_at, created')
        .eq('organization_id', organizationId)
        .eq('status', 'won')
        .gte('closed_at', formatDateISO(startDate))
        .lte('closed_at', formatDateISO(endDate)),
      // New deals created this period
      supabase
        .from('deals')
        .select('assigned_to, value')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .gte('created', formatDateISO(startDate))
        .lte('created', formatDateISO(endDate)),
      // Lost/disqualified deals this period
      supabase
        .from('deals')
        .select('assigned_to, value')
        .eq('organization_id', organizationId)
        .in('status', ['lost', 'disqualified'])
        .gte('last_activity', formatDateISO(startDate))
        .lte('last_activity', formatDateISO(endDate)),
      // Active pipeline (not won/lost)
      supabase
        .from('deals')
        .select('assigned_to, value, last_activity')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .is('deleted_at', null)
    ]);

    const closedDeals = closedWonResult.data || [];
    const newDeals = newDealsResult.data || [];
    const lostDeals = lostDealsResult.data || [];
    const activeDeals = activeDealsResult.data || [];

    // Calculate RevOps metrics
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const revOps: RevOpsMetrics = {
      newDeals: newDeals.length,
      newDealsValue: newDeals.reduce((sum, d) => sum + (d.value || 0), 0),
      closedWon: closedDeals.length,
      closedWonValue: closedDeals.reduce((sum, d) => sum + (d.value || 0), 0),
      closedLost: lostDeals.length,
      closedLostValue: lostDeals.reduce((sum, d) => sum + (d.value || 0), 0),
      activePipeline: activeDeals.reduce((sum, d) => sum + (d.value || 0), 0),
      staleDeals: activeDeals.filter(d => {
        if (!d.last_activity) return true;
        return new Date(d.last_activity) < fourteenDaysAgo;
      }).length
    };

    // Calculate member health based on stale deals
    const staleByUser = new Map<string, number>();
    const activeByUser = new Map<string, number>();
    activeDeals.forEach(deal => {
      const userId = deal.assigned_to;
      if (!userId) return;

      activeByUser.set(userId, (activeByUser.get(userId) || 0) + 1);

      if (!deal.last_activity || new Date(deal.last_activity) < fourteenDaysAgo) {
        staleByUser.set(userId, (staleByUser.get(userId) || 0) + 1);
      }
    });

    const memberHealth: MemberHealth[] = members.map(member => {
      const staleCount = staleByUser.get(member.userId) || 0;
      const activeCount = activeByUser.get(member.userId) || 0;
      const staleRatio = activeCount > 0 ? staleCount / activeCount : 0;

      // Health status logic
      let healthStatus: 'healthy' | 'at-risk' | 'critical' = 'healthy';
      if (staleRatio > 0.5 || staleCount >= 5) {
        healthStatus = 'critical';
      } else if (staleRatio > 0.25 || staleCount >= 2) {
        healthStatus = 'at-risk';
      }

      // Calculate avg days to close from closed deals
      const userClosedDeals = closedDeals.filter(d => d.assigned_to === member.userId);
      let avgDaysToClose: number | null = null;
      if (userClosedDeals.length > 0) {
        const totalDays = userClosedDeals.reduce((sum, d) => {
          if (d.created && d.closed_at) {
            return sum + daysBetween(new Date(d.created), new Date(d.closed_at));
          }
          return sum;
        }, 0);
        avgDaysToClose = Math.round(totalDays / userClosedDeals.length);
      }

      return {
        userId: member.userId,
        healthStatus,
        staleDealsCount: staleCount,
        avgDaysToClose
      };
    });

    // Aggregate closed revenue by user
    const closedByUser = new Map<string, number>();
    closedDeals.forEach(deal => {
      if (deal.assigned_to) {
        const current = closedByUser.get(deal.assigned_to) || 0;
        closedByUser.set(deal.assigned_to, current + (deal.value || 0));
      }
    });

    // Calculate per-member performance
    const memberAnalytics: MemberPerformanceSnapshot[] = members.map(member => {
      const closedThisPeriod = closedByUser.get(member.userId) || 0;

      // Get target for this period
      let targetThisPeriod = 0;
      if (period === 'month') targetThisPeriod = member.monthlyTarget;
      else if (period === 'quarter') targetThisPeriod = member.quarterlyTarget;
      else targetThisPeriod = member.annualTarget;

      // Handle no target case
      if (targetThisPeriod <= 0) {
        return {
          userId: member.userId,
          closedThisPeriod,
          targetThisPeriod: 0,
          attainmentPct: 0,
          projectedAttainmentPct: null,
          status: 'no-target' as const
        };
      }

      const attainmentPct = closedThisPeriod / targetThisPeriod;

      // Projection (linear)
      let projectedAttainmentPct: number | null = null;
      if (timeProgress > 0) {
        const projectedClosed = closedThisPeriod / timeProgress;
        projectedAttainmentPct = projectedClosed / targetThisPeriod;
      }

      // Determine status
      let status: 'green' | 'yellow' | 'red' = 'red';
      if (attainmentPct >= 1.0) {
        status = 'green'; // Already met target
      } else if (projectedAttainmentPct !== null) {
        if (projectedAttainmentPct >= 1.0) {
          status = 'green';
        } else if (projectedAttainmentPct >= 0.75) {
          status = 'yellow';
        } else {
          status = 'red';
        }
      } else {
        // Fallback: compare attainment vs time progress
        if (attainmentPct >= timeProgress) {
          status = 'green';
        } else if (attainmentPct >= timeProgress * 0.75) {
          status = 'yellow';
        } else {
          status = 'red';
        }
      }

      return {
        userId: member.userId,
        closedThisPeriod,
        targetThisPeriod,
        attainmentPct,
        projectedAttainmentPct,
        status
      };
    });

    // Calculate summary
    const membersWithTargets = memberAnalytics.filter(m => m.status !== 'no-target');
    const totalTarget = membersWithTargets.reduce((sum, m) => sum + m.targetThisPeriod, 0);
    const totalClosed = memberAnalytics.reduce((sum, m) => sum + m.closedThisPeriod, 0);
    const avgAttainmentPct = membersWithTargets.length > 0
      ? membersWithTargets.reduce((sum, m) => sum + m.attainmentPct, 0) / membersWithTargets.length
      : null;

    const greenCount = memberAnalytics.filter(m => m.status === 'green').length;
    const yellowCount = memberAnalytics.filter(m => m.status === 'yellow').length;
    const redCount = memberAnalytics.filter(m => m.status === 'red').length;
    const noTargetCount = memberAnalytics.filter(m => m.status === 'no-target').length;

    const analytics: TeamAnalytics = {
      period,
      startDate: formatDateISO(startDate),
      endDate: formatDateISO(endDate),
      members: memberAnalytics,
      summary: {
        totalTarget,
        totalClosed,
        avgAttainmentPct,
        greenCount,
        yellowCount,
        redCount,
        noTargetCount
      },
      // TASK 4: RevOps metrics
      revOps,
      memberHealth
    };

    const response: TeamAnalyticsResponse = {
      success: true,
      orgTarget,
      members,
      analytics,
      isAdmin
    };

    console.log('[team-analytics-get] Success:', {
      memberCount: members.length,
      period,
      greenCount,
      yellowCount,
      redCount
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error: any) {
    console.error('[team-analytics-get] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
