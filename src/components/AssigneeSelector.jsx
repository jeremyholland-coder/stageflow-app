import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { UserCircle, ChevronDown, Check, Loader2, X, Users } from 'lucide-react';
import { supabase, ensureValidSession } from '../lib/supabase';
import { useApp } from './AppShell';
import { api } from '../lib/api-client';

/**
 * AssigneeSelector - Inline dropdown for assigning deals to team members
 *
 * Used on Kanban cards and in the Inactive Deals table to quickly
 * assign or reassign deals to team members.
 *
 * Features:
 * - Shows current assignee with avatar/initials
 * - Dropdown lists all org members (owner/admin first, then alphabetically)
 * - Optimistic UI updates with rollback on error
 * - Permission checks (admins can reassign any, members only their own)
 */
export const AssigneeSelector = memo(({
  dealId,
  currentAssigneeId,
  organizationId,
  onAssignmentChange,
  disabled = false,
  compact = false // For use in Kanban cards
}) => {
  const { user, organization, addNotification } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [currentAssignee, setCurrentAssignee] = useState(null);
  const dropdownRef = useRef(null);

  // Get user's role in the org
  const [userRole, setUserRole] = useState(null);

  // Fetch team members when dropdown opens
  const fetchTeamMembers = useCallback(async () => {
    if (teamMembers.length > 0) return; // Already fetched

    setLoadingMembers(true);
    try {
      // FIX 2025-12-02: Ensure valid session before RLS-protected queries
      // Without this, queries fail with empty results if session is stale
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid) {
        console.warn('[AssigneeSelector] Session invalid:', sessionCheck.error);
        // If session is truly invalid (not just expired), show appropriate error
        if (sessionCheck.code === 'SESSION_INVALID' || sessionCheck.code === 'NO_SESSION') {
          throw new Error('Please log in to view team members');
        }
        // For other errors, still try the query (might work with cached session)
      }

      const { data: members, error } = await supabase
        .from('team_members')
        .select('user_id, role, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // FIX: Handle empty members gracefully (might indicate RLS issue)
      if (!members || members.length === 0) {
        console.warn('[AssigneeSelector] No team members found for org:', organizationId);
        // Set empty array to prevent infinite retries
        setTeamMembers([]);
        setLoadingMembers(false);
        return;
      }

      // Fetch user profiles for all members
      // FIX 2025-12-02: Use user_profiles view (has email, full_name) instead of
      // profiles table (only has avatar_url, first_name, last_name)
      const userIds = members.map(m => m.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      // Map profiles to members
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      const formattedMembers = members.map(m => {
        const profile = profileMap.get(m.user_id);
        const fullName = profile?.full_name;
        const email = profile?.email;

        return {
          id: m.user_id,
          name: fullName || email?.split('@')[0] || 'Team Member',
          email: email,
          role: m.role,
          initials: getInitials(fullName || email?.split('@')[0] || 'TM')
        };
      });

      // Sort: owner first, then admins, then members alphabetically
      formattedMembers.sort((a, b) => {
        const roleOrder = { owner: 0, admin: 1, member: 2 };
        const orderA = roleOrder[a.role] ?? 2;
        const orderB = roleOrder[b.role] ?? 2;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      setTeamMembers(formattedMembers);

      // Set current user's role
      const currentUserMember = members.find(m => m.user_id === user?.id);
      setUserRole(currentUserMember?.role || 'member');

    } catch (error) {
      console.error('[AssigneeSelector] Error fetching team members:', error);
      // FIX: More specific error messages based on error type
      const message = error.message?.includes('log in')
        ? error.message
        : 'Failed to load team members. Try refreshing the page.';
      addNotification?.(message, 'error');
    } finally {
      setLoadingMembers(false);
    }
  }, [organizationId, user?.id, teamMembers.length, addNotification]);

  // Find current assignee name
  useEffect(() => {
    if (currentAssigneeId && teamMembers.length > 0) {
      const assignee = teamMembers.find(m => m.id === currentAssigneeId);
      setCurrentAssignee(assignee || null);
    } else {
      setCurrentAssignee(null);
    }
  }, [currentAssigneeId, teamMembers]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle dropdown open
  const handleToggle = (e) => {
    e.stopPropagation();
    if (disabled) return;

    if (!isOpen) {
      fetchTeamMembers();
    }
    setIsOpen(!isOpen);
  };

  // Handle member selection
  const handleSelect = async (memberId) => {
    if (memberId === currentAssigneeId) {
      setIsOpen(false);
      return;
    }

    // Permission check
    const canReassign = userRole === 'owner' || userRole === 'admin' ||
                        currentAssigneeId === user?.id ||
                        !currentAssigneeId;

    if (!canReassign) {
      addNotification?.('You can only reassign deals you own', 'error');
      setIsOpen(false);
      return;
    }

    setLoading(true);
    const previousAssignee = currentAssigneeId;

    // Optimistic update
    const newAssignee = teamMembers.find(m => m.id === memberId);
    setCurrentAssignee(newAssignee || null);
    onAssignmentChange?.(memberId);

    try {
      // Use the assign-deals endpoint
      await api.post('assign-deals', {
        action: 'assign-deal',
        dealId,
        assignedTo: memberId || null,
        assignedBy: user?.id,
        organizationId
      });

      const assigneeName = newAssignee?.name || 'Unassigned';
      addNotification?.(`Deal assigned to ${assigneeName}`, 'success');
    } catch (error) {
      console.error('Error assigning deal:', error);
      addNotification?.(error.message || 'Failed to assign deal', 'error');

      // Rollback on error
      const prevAssignee = teamMembers.find(m => m.id === previousAssignee);
      setCurrentAssignee(prevAssignee || null);
      onAssignmentChange?.(previousAssignee);
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  };

  // Generate initials from name
  function getInitials(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Compact view for Kanban cards
  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={handleToggle}
          disabled={disabled || loading}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all text-xs ${
            disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-700/50 cursor-pointer'
          } ${currentAssignee ? 'text-gray-300' : 'text-gray-500'}`}
          title={currentAssignee ? `Assigned to ${currentAssignee.name}` : 'Click to assign'}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
          ) : currentAssignee ? (
            <>
              <div className="w-5 h-5 rounded-full bg-teal-500/20 flex items-center justify-center text-[10px] font-medium text-teal-400">
                {currentAssignee.initials}
              </div>
              <span className="truncate max-w-[80px]">{currentAssignee.name}</span>
            </>
          ) : (
            <>
              <UserCircle className="w-4 h-4" />
              <span>Unassigned</span>
            </>
          )}
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-[60] overflow-hidden">
            {loadingMembers ? (
              <div className="p-4 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-teal-400 mx-auto" />
                <p className="text-xs text-gray-400 mt-2">Loading team...</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto py-1" role="listbox">
                {/* Unassigned option */}
                <button
                  onClick={() => handleSelect(null)}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-700/50 transition ${
                    !currentAssigneeId ? 'bg-teal-500/10' : ''
                  }`}
                  role="option"
                  aria-selected={!currentAssigneeId}
                >
                  <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
                    <X className="w-3 h-3 text-gray-400" />
                  </div>
                  <span className="text-sm text-gray-300">Unassigned</span>
                  {!currentAssigneeId && <Check className="w-4 h-4 text-teal-400 ml-auto" />}
                </button>

                <div className="border-t border-gray-700 my-1" />

                {teamMembers.map(member => (
                  <button
                    key={member.id}
                    onClick={() => handleSelect(member.id)}
                    className={`w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-700/50 transition ${
                      member.id === currentAssigneeId ? 'bg-teal-500/10' : ''
                    }`}
                    role="option"
                    aria-selected={member.id === currentAssigneeId}
                  >
                    <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-xs font-medium text-teal-400">
                      {member.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{member.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{member.role}</p>
                    </div>
                    {member.id === currentAssigneeId && (
                      <Check className="w-4 h-4 text-teal-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full view for tables/forms
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        disabled={disabled || loading}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all w-full ${
          disabled
            ? 'opacity-50 cursor-not-allowed border-gray-700 bg-gray-800/30'
            : 'border-gray-700 bg-gray-800/50 hover:border-teal-500/30 cursor-pointer'
        }`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        ) : currentAssignee ? (
          <>
            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-sm font-medium text-teal-400">
              {currentAssignee.initials}
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm text-white">{currentAssignee.name}</p>
              <p className="text-xs text-gray-500">{currentAssignee.email}</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
              <Users className="w-4 h-4 text-gray-400" />
            </div>
            <span className="text-sm text-gray-400">Select assignee...</span>
          </>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-[60] overflow-hidden">
          {loadingMembers ? (
            <div className="p-6 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-teal-400 mx-auto" />
              <p className="text-sm text-gray-400 mt-2">Loading team members...</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1" role="listbox">
              {/* Unassigned option */}
              <button
                onClick={() => handleSelect(null)}
                className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-700/50 transition ${
                  !currentAssigneeId ? 'bg-teal-500/10' : ''
                }`}
                role="option"
                aria-selected={!currentAssigneeId}
              >
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                  <X className="w-4 h-4 text-gray-400" />
                </div>
                <span className="text-sm text-gray-300">Unassigned</span>
                {!currentAssigneeId && <Check className="w-4 h-4 text-teal-400 ml-auto" />}
              </button>

              <div className="border-t border-gray-700 my-1" />

              {teamMembers.map(member => (
                <button
                  key={member.id}
                  onClick={() => handleSelect(member.id)}
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-700/50 transition ${
                    member.id === currentAssigneeId ? 'bg-teal-500/10' : ''
                  }`}
                  role="option"
                  aria-selected={member.id === currentAssigneeId}
                >
                  <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-sm font-medium text-teal-400">
                    {member.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{member.name}</p>
                    <p className="text-xs text-gray-500">{member.email} • <span className="capitalize">{member.role}</span></p>
                  </div>
                  {member.id === currentAssigneeId && (
                    <Check className="w-4 h-4 text-teal-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

AssigneeSelector.displayName = 'AssigneeSelector';
