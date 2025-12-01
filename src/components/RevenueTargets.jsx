import { useState, useEffect, useCallback } from 'react';
import { Target, TrendingUp, Loader2, DollarSign, Calendar, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sanitizeNumberInput, toNumberOrNull } from '../utils/numberSanitizer';

export const RevenueTargets = ({ organization, userRole, addNotification }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        const orgResponse = await fetch(`/.netlify/functions/organization-targets-get?organization_id=${organization.id}`, {
          method: 'GET',
          credentials: 'include', // Include HttpOnly cookies
          headers: {
            'Content-Type': 'application/json'
          }
        });

        const orgResult = await orgResponse.json();

        if (!orgResponse.ok || !orgResult.success) {
          console.warn('Failed to load org targets:', orgResult.error || 'Unknown error');
          // Don't throw - continue with null targets
        } else if (orgResult.targets) {
          // Map response shape to local state shape (convert to strings for controlled inputs)
          setOrgTargets({
            annual_target: orgResult.targets.yearly != null ? String(orgResult.targets.yearly) : '',
            quarterly_target: orgResult.targets.quarterly != null ? String(orgResult.targets.quarterly) : '',
            monthly_target: orgResult.targets.monthly != null ? String(orgResult.targets.monthly) : ''
          });
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

  const saveOrgTargets = async () => {
    if (!isAdmin) {
      addNotification('Only admins can save organization targets', 'error');
      return;
    }

    if (!organization) {
      console.error('Cannot save targets: organization is null/undefined');
      addNotification('Organization not loaded. Please refresh the page.', 'error');
      return;
    }

    if (!organization.id) {
      console.error('Cannot save targets: organization.id is missing', organization);
      addNotification('Organization ID missing. Please contact support.', 'error');
      return;
    }

    // Clear previous errors
    setOrgTargetErrors({ annual_target: null, quarterly_target: null, monthly_target: null });

    // Validate and convert targets using sanitization helper
    const annualValue = toNumberOrNull(orgTargets.annual_target);
    const quarterlyValue = toNumberOrNull(orgTargets.quarterly_target);
    const monthlyValue = toNumberOrNull(orgTargets.monthly_target);

    // Validate: if user entered something but it's not a valid number, show error
    let hasErrors = false;
    const newErrors = { annual_target: null, quarterly_target: null, monthly_target: null };

    if (orgTargets.annual_target && annualValue === null) {
      newErrors.annual_target = 'Enter a valid number (digits only, optional decimal)';
      hasErrors = true;
    }
    if (orgTargets.quarterly_target && quarterlyValue === null) {
      newErrors.quarterly_target = 'Enter a valid number (digits only, optional decimal)';
      hasErrors = true;
    }
    if (orgTargets.monthly_target && monthlyValue === null) {
      newErrors.monthly_target = 'Enter a valid number (digits only, optional decimal)';
      hasErrors = true;
    }

    if (hasErrors) {
      setOrgTargetErrors(newErrors);
      addNotification('Please fix the invalid target values', 'error');
      return;
    }

    setSaving(true);
    try {
      console.log('[RevenueTargets] Saving org targets:', {
        orgId: organization.id,
        annual: annualValue,
        quarterly: quarterlyValue,
        monthly: monthlyValue
      });

      // CRITICAL FIX v1.7.89: Use backend endpoint with HttpOnly cookie auth
      // PROBLEM: Direct Supabase queries fail RLS because auth.uid() unavailable with HttpOnly cookies
      // SOLUTION: Backend endpoint uses service role to bypass RLS (same pattern as notification-preferences-save)
      const response = await fetch('/.netlify/functions/organization-targets-save', {
        method: 'POST',
        credentials: 'include', // Include HttpOnly cookies
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          organization_id: organization.id,
          annual_target: annualValue,
          quarterly_target: quarterlyValue,
          monthly_target: monthlyValue
        })
      });

      const responseData = await response.json();

      if (!response.ok || !responseData.success) {
        console.error('[RevenueTargets] Save failed:', response.status, responseData);
        throw new Error(responseData.error || responseData.details || 'Failed to save targets');
      }

      console.log('[RevenueTargets] Save successful:', responseData);

      // Update local state from returned targets to ensure consistency (convert to strings)
      if (responseData.targets) {
        setOrgTargets({
          annual_target: responseData.targets.yearly != null ? String(responseData.targets.yearly) : '',
          quarterly_target: responseData.targets.quarterly != null ? String(responseData.targets.quarterly) : '',
          monthly_target: responseData.targets.monthly != null ? String(responseData.targets.monthly) : ''
        });
      }

      addNotification('Organization targets saved', 'success');
    } catch (error) {
      console.error('[RevenueTargets] Error saving org targets:', error);
      addNotification(`Failed to save organization targets: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

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
          <button
            onClick={saveOrgTargets}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#16A085] disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Organization Targets
              </>
            )}
          </button>
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
