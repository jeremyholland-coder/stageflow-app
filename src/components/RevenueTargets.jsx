import { useState, useEffect, useCallback, useRef } from 'react';
import { Target, TrendingUp, Loader2, DollarSign, Calendar, Check } from 'lucide-react';
// FIX 2025-12-03: Import auth utilities for proper Authorization header injection
import { supabase, ensureValidSession } from '../lib/supabase';
import { sanitizeNumberInput, toNumberOrNull } from '../utils/numberSanitizer';

export const RevenueTargets = ({ organization, userRole, addNotification }) => {
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  // Store as strings for controlled input, convert to numbers on submit
  const [orgTargets, setOrgTargets] = useState({
    annual_target: '',
    quarterly_target: '',
    monthly_target: ''
  });
  // Validation errors for inline feedback
  const [orgTargetErrors, setOrgTargetErrors] = useState({
    annual_target: null,
    quarterly_target: null,
    monthly_target: null
  });
  const [userTargets, setUserTargets] = useState([]);

  // UX FRICTION FIX: Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const autoSaveTimerRef = useRef(null);
  const lastSavedDataRef = useRef(null);

  const isAdmin = ['owner', 'admin'].includes(userRole);

  // Load current user ID
  useEffect(() => {
    const loadCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id);
    };
    loadCurrentUser();
  }, []);

  // CRITICAL FIX: Move loadTargets outside useEffect so it can be called from other functions
  // Use useCallback to properly memoize and prevent infinite loops
  const loadTargets = useCallback(async () => {
    if (!organization?.id || !currentUserId) { setLoading(false); return; }
      setLoading(true);
      try {
        // Load organization-wide targets via backend endpoint (bypasses RLS)
        // CRITICAL FIX: Direct Supabase queries fail RLS with HttpOnly cookie auth
        // because auth.uid() returns NULL. Use backend endpoint with service role.
        // FIX 2025-12-03: Inject Authorization header for reliable auth
        await ensureValidSession();
        const { data: { session } } = await supabase.auth.getSession();

        const headers = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const orgResponse = await fetch(`/.netlify/functions/organization-targets-get?organization_id=${organization.id}`, {
          method: 'GET',
          credentials: 'include', // Include HttpOnly cookies
          headers
        });

        const orgResult = await orgResponse.json();

        if (!orgResponse.ok || !orgResult.success) {
          console.warn('Failed to load org targets:', orgResult.error || 'Unknown error');
          // Don't throw - continue with null targets
        } else if (orgResult.targets) {
          // Map response shape to local state shape (convert to strings for controlled inputs)
          const initialData = {
            annual_target: orgResult.targets.yearly != null ? String(orgResult.targets.yearly) : '',
            quarterly_target: orgResult.targets.quarterly != null ? String(orgResult.targets.quarterly) : '',
            monthly_target: orgResult.targets.monthly != null ? String(orgResult.targets.monthly) : ''
          };
          setOrgTargets(initialData);
          // UX FRICTION FIX: Store initial data for auto-save comparison
          lastSavedDataRef.current = JSON.stringify(initialData);
        }
        // If orgResult.targets is null, keep default empty state

        // Load team members with their user data
        const { data: members, error: membersError} = await supabase
          .from('team_members')
          .select('user_id, role, users:user_id(email)')
          .eq('organization_id', organization.id);

        if (membersError) throw membersError;

        // Load user targets
        const { data: targets, error: targetsError } = await supabase
          .from('user_targets')
          .select('*')
          .eq('organization_id', organization.id);

        if (targetsError && targetsError.code !== 'PGRST116') {
          throw targetsError;
        }

        // Combine team members with their targets
        const enrichedMembers = (members || []).map(member => {
          const target = (targets || []).find(t => t.user_id === member.user_id);
          return {
            user_id: member.user_id,
            full_name: member.users?.raw_user_meta_data?.full_name || member.users?.email?.split('@')[0] || 'Unknown User',
            avatar_url: member.users?.raw_user_meta_data?.avatar_url,
            role: member.role,
            annual_target: target?.annual_target || null,
            quarterly_target: target?.quarterly_target || null,
            monthly_target: target?.monthly_target || null,
            show_on_dashboard: target?.show_on_dashboard ?? true,
            visible_to_team: target?.visible_to_team ?? false,
            is_active: target?.is_active ?? true,
            notes: target?.notes || ''
          };
        });

        setUserTargets(enrichedMembers);
      } catch (error) {
        console.error('Error loading targets:', error);
        // CRITICAL FIX: Don't trigger parent re-renders by calling addNotification
        // Just log the error - user will see empty state
      } finally {
        setLoading(false);
      }
  }, [organization?.id, currentUserId]); // CRITICAL FIX: Include currentUserId to ensure loadTargets re-runs when user ID loads

  // Call loadTargets when organization changes
  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  // UX FRICTION FIX: Auto-save function with 800ms debounce
  const performAutoSave = useCallback(async (dataToSave) => {
    if (!isAdmin || !organization?.id) return;

    // Don't auto-save if data hasn't actually changed
    const currentDataStr = JSON.stringify(dataToSave);
    if (currentDataStr === lastSavedDataRef.current) return;

    // Validate targets
    const annualValue = toNumberOrNull(dataToSave.annual_target);
    const quarterlyValue = toNumberOrNull(dataToSave.quarterly_target);
    const monthlyValue = toNumberOrNull(dataToSave.monthly_target);

    // Check for validation errors
    let hasErrors = false;
    const newErrors = { annual_target: null, quarterly_target: null, monthly_target: null };

    if (dataToSave.annual_target && annualValue === null) {
      newErrors.annual_target = 'Enter a valid number';
      hasErrors = true;
    }
    if (dataToSave.quarterly_target && quarterlyValue === null) {
      newErrors.quarterly_target = 'Enter a valid number';
      hasErrors = true;
    }
    if (dataToSave.monthly_target && monthlyValue === null) {
      newErrors.monthly_target = 'Enter a valid number';
      hasErrors = true;
    }

    if (hasErrors) {
      setOrgTargetErrors(newErrors);
      return;
    }

    setOrgTargetErrors({ annual_target: null, quarterly_target: null, monthly_target: null });
    setAutoSaveStatus('saving');

    try {
      await ensureValidSession();
      const { data: { session: saveSession } } = await supabase.auth.getSession();

      const saveHeaders = { 'Content-Type': 'application/json' };
      if (saveSession?.access_token) {
        saveHeaders['Authorization'] = `Bearer ${saveSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/organization-targets-save', {
        method: 'POST',
        credentials: 'include',
        headers: saveHeaders,
        body: JSON.stringify({
          organization_id: organization.id,
          annual_target: annualValue,
          quarterly_target: quarterlyValue,
          monthly_target: monthlyValue
        })
      });

      const responseData = await response.json();

      if (!response.ok || !responseData.success) {
        throw new Error(responseData.error || 'Failed to save targets');
      }

      // Update last saved data
      lastSavedDataRef.current = currentDataStr;
      setAutoSaveStatus('saved');

      // Reset status after 2 seconds
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('[RevenueTargets] Auto-save error:', error);
      setAutoSaveStatus('idle');
    }
  }, [isAdmin, organization?.id]);

  // UX FRICTION FIX: Trigger auto-save with 800ms debounce
  useEffect(() => {
    if (!isAdmin) return;

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer for 800ms debounce
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave(orgTargets);
    }, 800);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [orgTargets, isAdmin, performAutoSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const formatCurrency = (value) => {
    if (!value || isNaN(value)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[#1ABC9C]" />
        <span className="ml-3 text-[#6B7280] dark:text-[#9CA3AF]">Loading revenue targets...</span>
      </div>
    );
  }

  // Non-admin view: Show read-only view of their own targets
  if (!isAdmin) {
    if (!currentUserId) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[#1ABC9C]" />
        </div>
      );
    }

    const myTarget = userTargets.find(t => t.user_id === currentUserId);

    if (!myTarget || !myTarget.show_on_dashboard) {
      return (
        <div className="p-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 text-center">
          <Target className="w-12 h-12 text-[#6B7280] dark:text-[#9CA3AF] mx-auto mb-3" />
          <p className="text-[#6B7280] dark:text-[#9CA3AF]">
            No revenue targets configured for your account
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="p-6 bg-gradient-to-br from-[#1ABC9C]/10 to-[#16A085]/10 rounded-xl border border-[#1ABC9C]/20">
          <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-4">Your Revenue Targets</h3>
          <div className="grid grid-cols-3 gap-4">
            {myTarget.annual_target && (
              <div>
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Annual</p>
                <p className="text-2xl font-bold text-[#1ABC9C]">{formatCurrency(myTarget.annual_target)}</p>
              </div>
            )}
            {myTarget.quarterly_target && (
              <div>
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Quarterly</p>
                <p className="text-2xl font-bold text-[#1ABC9C]">{formatCurrency(myTarget.quarterly_target)}</p>
              </div>
            )}
            {myTarget.monthly_target && (
              <div>
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Monthly</p>
                <p className="text-2xl font-bold text-[#1ABC9C]">{formatCurrency(myTarget.monthly_target)}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Admin view: Full target management
  return (
    <div className="space-y-6">
      {/* Organization-Wide Targets */}
      <div className="p-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {/* UX FRICTION FIX: Header with auto-save status indicator */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1ABC9C]/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-[#1ABC9C]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">Organization Targets</h3>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Company-wide revenue goals</p>
            </div>
          </div>
          {/* Auto-save status indicator */}
          <div className="flex items-center gap-2">
            {autoSaveStatus === 'saving' && (
              <span className="flex items-center gap-2 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="flex items-center gap-2 text-sm text-[#1ABC9C]">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
            {autoSaveStatus === 'idle' && (
              <span className="text-xs text-[#9CA3AF]">Auto-saves</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Annual Target
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#6B7280] dark:text-[#9CA3AF]" />
              <input
                type="text"
                inputMode="decimal"
                value={orgTargets.annual_target}
                onChange={(e) => {
                  const sanitized = sanitizeNumberInput(e.target.value);
                  setOrgTargets(prev => ({ ...prev, annual_target: sanitized }));
                  // Clear error on change
                  if (orgTargetErrors.annual_target) {
                    setOrgTargetErrors(prev => ({ ...prev, annual_target: null }));
                  }
                }}
                placeholder="e.g., 1000000"
                aria-invalid={!!orgTargetErrors.annual_target}
                className={`w-full pl-10 pr-3 py-2 border rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent ${
                  orgTargetErrors.annual_target ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            </div>
            {orgTargetErrors.annual_target && (
              <p className="mt-1 text-xs text-red-500">{orgTargetErrors.annual_target}</p>
            )}
            <p className="mt-1 text-xs text-[#9CA3AF]">Digits only. We'll handle the math.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Quarterly Target
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#6B7280] dark:text-[#9CA3AF]" />
              <input
                type="text"
                inputMode="decimal"
                value={orgTargets.quarterly_target}
                onChange={(e) => {
                  const sanitized = sanitizeNumberInput(e.target.value);
                  setOrgTargets(prev => ({ ...prev, quarterly_target: sanitized }));
                  if (orgTargetErrors.quarterly_target) {
                    setOrgTargetErrors(prev => ({ ...prev, quarterly_target: null }));
                  }
                }}
                placeholder="e.g., 250000"
                aria-invalid={!!orgTargetErrors.quarterly_target}
                className={`w-full pl-10 pr-3 py-2 border rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent ${
                  orgTargetErrors.quarterly_target ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            </div>
            {orgTargetErrors.quarterly_target && (
              <p className="mt-1 text-xs text-red-500">{orgTargetErrors.quarterly_target}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Monthly Target
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#6B7280] dark:text-[#9CA3AF]" />
              <input
                type="text"
                inputMode="decimal"
                value={orgTargets.monthly_target}
                onChange={(e) => {
                  const sanitized = sanitizeNumberInput(e.target.value);
                  setOrgTargets(prev => ({ ...prev, monthly_target: sanitized }));
                  if (orgTargetErrors.monthly_target) {
                    setOrgTargetErrors(prev => ({ ...prev, monthly_target: null }));
                  }
                }}
                placeholder="e.g., 83333"
                aria-invalid={!!orgTargetErrors.monthly_target}
                className={`w-full pl-10 pr-3 py-2 border rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent ${
                  orgTargetErrors.monthly_target ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            </div>
            {orgTargetErrors.monthly_target && (
              <p className="mt-1 text-xs text-red-500">{orgTargetErrors.monthly_target}</p>
            )}
          </div>
        </div>
      </div>

      {/* TODO: Team member revenue targets have been moved to the Team tab.
          Once backend fields (user_targets table) and RPC are fully integrated with TeamDashboard,
          per-user annual, quarterly, and monthly targets will be managed from the Team tab
          instead of this Revenue Targets settings page. See TeamDashboard.jsx for implementation. */}
    </div>
  );
};
