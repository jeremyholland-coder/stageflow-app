import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { UserCircle, ChevronDown, Check, Loader2, X, Users } from 'lucide-react';
// PRODUCTION FIX 2025-12-06: Removed direct Supabase import
// Direct client queries fail with RLS when persistSession: false (auth.uid() is NULL)
// All queries now go through API client which uses backend service role
import { useApp } from './AppShell';
import { api } from '../lib/api-client';
import { Portal, calculateDropdownPosition, Z_INDEX } from './ui/Portal';

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
  const triggerRef = useRef(null);

  // PORTAL FIX: Track dropdown position for portal rendering
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  // Get user's role in the org
  const [userRole, setUserRole] = useState(null);

  // Fetch team members when dropdown opens
  // PRODUCTION FIX 2025-12-06: Use API client instead of direct Supabase queries
  // Direct client queries fail with RLS when persistSession: false
  const fetchTeamMembers = useCallback(async () => {
    if (teamMembers.length > 0) return; // Already fetched

    setLoadingMembers(true);
    try {
      // Use get-team-members endpoint which uses service role (bypasses RLS)
      const response = await api.post('get-team-members', {
        organization_id: organizationId
      });

      // Handle response - API returns { success, teamMembers, organizationId }
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch team members');
      }

      const members = response.teamMembers || [];

      // Handle empty members gracefully
      if (members.length === 0) {
        console.warn('[AssigneeSelector] No team members found for org:', organizationId);
        setTeamMembers([]);
        setLoadingMembers(false);
        return;
      }

      // Add initials to each member (backend doesn't provide them)
      const formattedMembers = members.map(m => ({
        ...m,
        initials: getInitials(m.name || 'TM')
      }));

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
      const currentUserMember = formattedMembers.find(m => m.id === user?.id);
      setUserRole(currentUserMember?.role || 'member');

    } catch (error) {
      console.error('[AssigneeSelector] Error fetching team members:', error);
      // Provide user-friendly error messages
      const message = error.message?.toLowerCase().includes('auth')
        ? 'Please log in to view team members'
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

  // PORTAL FIX: Close dropdown when clicking outside (handles portal-rendered dropdown)
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is on trigger button
      if (triggerRef.current && triggerRef.current.contains(event.target)) {
        return; // Let the button's onClick handle it
      }
      // Check if click is inside the portal dropdown (by data attribute)
      if (event.target.closest('[data-assignee-dropdown]')) {
        return; // Click is inside dropdown
      }
      setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // PORTAL FIX: Recalculate position on scroll/resize when open
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownWidth = compact ? 224 : 320; // w-56 = 224px, w-full = varies
      const dropdownHeight = 280; // Approximate max height

      const pos = calculateDropdownPosition(triggerRef.current, {
        placement: 'bottom-start',
        offset: 4,
        dropdownWidth,
        dropdownHeight,
      });
      setDropdownPosition(pos);
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, compact]);

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
      // PORTAL FIX: Removed z-50 hack - dropdown now rendered via Portal
      <div className="relative">
        <button
          ref={triggerRef}
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

        {/* PORTAL FIX: Render dropdown via Portal to escape stacking contexts */}
        {isOpen && (
          <Portal>
            <div
              data-assignee-dropdown
              className="fixed w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
              style={{
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                zIndex: Z_INDEX.portalDropdown,
              }}
            >
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
          </Portal>
        )}
      </div>
    );
  }

  // Full view for tables/forms
  return (
    // PORTAL FIX: Removed z-50 hack - dropdown now rendered via Portal
    <div className="relative">
      <button
        ref={triggerRef}
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

      {/* PORTAL FIX: Render dropdown via Portal to escape stacking contexts */}
      {isOpen && (
        <Portal>
          <div
            data-assignee-dropdown
            className="fixed bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: triggerRef.current ? triggerRef.current.offsetWidth : 320,
              zIndex: Z_INDEX.portalDropdown,
            }}
          >
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
        </Portal>
      )}
    </div>
  );
});

AssigneeSelector.displayName = 'AssigneeSelector';
