import React, { useState, useEffect, useCallback } from 'react';
import { Target, TrendingUp, Loader2, Users, DollarSign, Calendar, Eye, EyeOff, Save, Plus, AlertCircle, Crown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export const RevenueTargets = ({ organization, userRole, addNotification, onSwitchToBilling }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [orgTargets, setOrgTargets] = useState({
    annual_target: null,
    quarterly_target: null,
    monthly_target: null
  });
  const [userTargets, setUserTargets] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [editMode, setEditMode] = useState(false);

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
        // Load organization-wide targets
        // CRITICAL FIX: Use maybeSingle() instead of single() to prevent errors when no row exists
        const { data: orgData, error: orgError } = await supabase
          .from('organization_targets')
          .select('*')
          .eq('organization_id', organization.id)
          .maybeSingle();

        if (orgError) {
          console.warn('Failed to load org targets:', orgError);
          // Don't throw - continue with null targets
        }

        if (orgData) {
          setOrgTargets({
            annual_target: orgData.annual_target,
            quarterly_target: orgData.quarterly_target,
            monthly_target: orgData.monthly_target
          });
        }

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

        setTeamMembers(enrichedMembers);
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

    setSaving(true);
    try {
      console.log('[RevenueTargets] Saving org targets:', {
        orgId: organization.id,
        annual: orgTargets.annual_target,
        quarterly: orgTargets.quarterly_target,
        monthly: orgTargets.monthly_target
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
          annual_target: orgTargets.annual_target,
          quarterly_target: orgTargets.quarterly_target,
          monthly_target: orgTargets.monthly_target
        })
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('[RevenueTargets] Save failed:', response.status, responseData);
        throw new Error(responseData.error || responseData.details || 'Failed to save targets');
      }

      console.log('[RevenueTargets] Save successful:', responseData);
      addNotification('Organization targets saved', 'success');
    } catch (error) {
      console.error('[RevenueTargets] Error saving org targets:', error);
      addNotification(`Failed to save organization targets: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveUserTargets = async () => {
    if (!isAdmin || !organization) return;
    setSaving(true);
    try {
      // Save all user targets
      const promises = userTargets.map(member => {
        return supabase
          .from('user_targets')
          .upsert({
            user_id: member.user_id,
            organization_id: organization.id,
            annual_target: member.annual_target,
            quarterly_target: member.quarterly_target,
            monthly_target: member.monthly_target,
            show_on_dashboard: member.show_on_dashboard,
            visible_to_team: member.visible_to_team,
            is_active: member.is_active,
            notes: member.notes,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,organization_id'
          });
      });

      const results = await Promise.all(promises);
      const errors = results.filter(r => r.error);

      if (errors.length > 0) {
        throw new Error(`Failed to save ${errors.length} user target(s)`);
      }

      addNotification('Team targets saved', 'success');
      setEditMode(false);
      await loadTargets(); // Reload to get fresh data
    } catch (error) {
      console.error('Error saving user targets:', error);
      addNotification('Failed to save team targets', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateUserTarget = (userId, field, value) => {
    setUserTargets(prev => prev.map(member =>
      member.user_id === userId
        ? { ...member, [field]: value }
        : member
    ));
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
                type="number"
                value={orgTargets.annual_target || ''}
                onChange={(e) => setOrgTargets(prev => ({ ...prev, annual_target: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="e.g., 1000000"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Quarterly Target
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#6B7280] dark:text-[#9CA3AF]" />
              <input
                type="number"
                value={orgTargets.quarterly_target || ''}
                onChange={(e) => setOrgTargets(prev => ({ ...prev, quarterly_target: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="e.g., 250000"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Monthly Target
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#6B7280] dark:text-[#9CA3AF]" />
              <input
                type="number"
                value={orgTargets.monthly_target || ''}
                onChange={(e) => setOrgTargets(prev => ({ ...prev, monthly_target: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="e.g., 83333"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-[#1ABC9C] focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Team Member Targets */}
      <div className="p-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">Team Member Targets</h3>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Individual revenue goals and visibility settings</p>
            </div>
          </div>
          {userTargets.length > 0 && (
            <div className="flex items-center gap-2">
              {editMode && (
                <button
                  onClick={() => {
                    setEditMode(false);
                    loadTargets(); // Reset changes
                  }}
                  disabled={saving}
                  className="px-4 py-2 text-[#6B7280] hover:text-[#1A1A1A] dark:text-[#9CA3AF] dark:hover:text-[#E0E0E0] transition"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => {
                  if (editMode) {
                    saveUserTargets();
                  } else {
                    setEditMode(true);
                  }
                }}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : editMode ? (
                  <>
                    <Save className="w-4 h-4" />
                    Save Team Targets
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Edit Targets
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {userTargets.length === 0 ? (
          // No team members - Show upgrade CTA
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl p-8 border-2 border-dashed border-purple-300 dark:border-purple-700">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                <Users className="w-8 h-8 text-white" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
                  Ready to Set Team Revenue Targets?
                </h4>
                <p className="text-[#6B7280] dark:text-[#9CA3AF] max-w-md mx-auto mb-1">
                  Upgrade your plan to add team members and set individual revenue targets for each person on your team.
                </p>
                <p className="text-sm text-[#9CA3AF] dark:text-gray-500">
                  Track performance, motivate your team, and hit your revenue goals together.
                </p>
              </div>
              <div className="flex items-center justify-center mt-2">
                <button
                  onClick={() => {
                    logger.log('RevenueTargets: Switching to billing tab');
                    if (onSwitchToBilling) {
                      onSwitchToBilling();
                    } else {
                      console.warn('RevenueTargets: onSwitchToBilling not provided, falling back to URL navigation');
                      window.location.href = '/?tab=billing';
                    }
                  }}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold text-base transition shadow-lg hover:shadow-xl"
                >
                  <Crown className="w-5 h-5" />
                  Upgrade to Add Team
                </button>
              </div>
              <div className="mt-4 flex items-center gap-6 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#1ABC9C] rounded-full"></div>
                  <span>Unlimited team members</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#1ABC9C] rounded-full"></div>
                  <span>Individual targets & tracking</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#1ABC9C] rounded-full"></div>
                  <span>Team performance analytics</span>
                </div>
              </div>
            </div>
          </div>
        ) : !editMode ? (
          // View Mode
          <div className="space-y-3">
            {userTargets.map(member => (
              <div
                key={member.user_id}
                className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt={member.full_name} className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 bg-[#1ABC9C] rounded-full flex items-center justify-center text-white font-semibold">
                      {member.full_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Name & Role */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0] truncate">{member.full_name}</p>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] capitalize">{member.role}</p>
                </div>

                {/* Targets */}
                <div className="flex items-center gap-6">
                  {member.annual_target && (
                    <div className="text-right">
                      <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Annual</p>
                      <p className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">{formatCurrency(member.annual_target)}</p>
                    </div>
                  )}
                  {member.quarterly_target && (
                    <div className="text-right">
                      <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Quarterly</p>
                      <p className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">{formatCurrency(member.quarterly_target)}</p>
                    </div>
                  )}
                  {member.monthly_target && (
                    <div className="text-right">
                      <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Monthly</p>
                      <p className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">{formatCurrency(member.monthly_target)}</p>
                    </div>
                  )}
                  {!member.annual_target && !member.quarterly_target && !member.monthly_target && (
                    <p className="text-sm text-[#9CA3AF] dark:text-[#6B7280] italic">No targets set</p>
                  )}
                </div>

                {/* Visibility Indicators */}
                <div className="flex items-center gap-2">
                  {member.show_on_dashboard ? (
                    <Eye className="w-4 h-4 text-[#1ABC9C]" title="Visible on dashboard" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-[#6B7280]" title="Hidden from dashboard" />
                  )}
                  {!member.is_active && (
                    <AlertCircle className="w-4 h-4 text-amber-500" title="Inactive" />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Edit Mode
          <div className="space-y-4">
            {userTargets.map(member => (
              <div
                key={member.user_id}
                className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4"
              >
                {/* Header */}
                <div className="flex items-center gap-3">
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt={member.full_name} className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 bg-[#1ABC9C] rounded-full flex items-center justify-center text-white font-semibold">
                      {member.full_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-[#1A1A1A] dark:text-[#E0E0E0]">{member.full_name}</p>
                    <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] capitalize">{member.role}</p>
                  </div>
                </div>

                {/* Target Inputs */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Annual</label>
                    <input
                      type="number"
                      value={member.annual_target || ''}
                      onChange={(e) => updateUserTarget(member.user_id, 'annual_target', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Quarterly</label>
                    <input
                      type="number"
                      value={member.quarterly_target || ''}
                      onChange={(e) => updateUserTarget(member.user_id, 'quarterly_target', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Monthly</label>
                    <input
                      type="number"
                      value={member.monthly_target || ''}
                      onChange={(e) => updateUserTarget(member.user_id, 'monthly_target', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Visibility Controls */}
                <div className="flex items-center gap-6 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={member.show_on_dashboard}
                      onChange={(e) => updateUserTarget(member.user_id, 'show_on_dashboard', e.target.checked)}
                      className="w-4 h-4 text-[#1ABC9C] border-gray-300 rounded focus:ring-[#1ABC9C]"
                    />
                    <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Show on their dashboard</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={member.is_active}
                      onChange={(e) => updateUserTarget(member.user_id, 'is_active', e.target.checked)}
                      className="w-4 h-4 text-[#1ABC9C] border-gray-300 rounded focus:ring-[#1ABC9C]"
                    />
                    <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Active (counts toward team totals)</span>
                  </label>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={member.notes}
                    onChange={(e) => updateUserTarget(member.user_id, 'notes', e.target.value)}
                    placeholder="e.g., 'New hire - targets start Q2'"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#0D1F2D] text-[#1A1A1A] dark:text-[#E0E0E0] focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
