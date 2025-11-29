import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * ActionMicroButton - Phase 5.2 Execution Micro-Buttons
 *
 * Subtle mint-outline micro-buttons for inline AI execution actions.
 * Appear under each Plan My Day recommendation for contextual actions.
 *
 * Actions: Draft Message, Research Company, Prepare Conversation, Follow-Up Plan
 *
 * Design: Tiny, subtle mint outline, minimal footprint, disabled when offline
 */
export const ActionMicroButton = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  loading = false,
  tooltip = '',
  className = ''
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={tooltip || label}
      className={`
        group relative inline-flex items-center gap-1.5
        px-2.5 py-1 rounded-lg
        bg-transparent
        border border-[#1ABC9C]/25
        hover:border-[#1ABC9C]/50 hover:bg-[#1ABC9C]/[0.08]
        text-white/70 hover:text-white/90
        text-xs font-medium
        transition-all duration-150 ease-out
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-[#1ABC9C]/25
        ${className}
      `}
    >
      {/* Icon */}
      {loading ? (
        <Loader2 className="w-3 h-3 text-[#1ABC9C] animate-spin" />
      ) : Icon ? (
        <Icon className="w-3 h-3 text-[#1ABC9C]/70 group-hover:text-[#1ABC9C] transition-colors" />
      ) : null}

      {/* Label */}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
};

/**
 * ActionMicroButtonGroup - Container for execution micro-buttons
 *
 * Renders the 4 execution actions for a specific deal/contact context.
 * Handles offline state by disabling all buttons.
 */
export const ActionMicroButtonGroup = ({
  dealId,
  dealName,
  contactName,
  companyName,
  onDraftMessage,
  onResearchCompany,
  onPrepareConversation,
  onFollowUpPlan,
  isOffline = false,
  loadingAction = null, // 'draft' | 'research' | 'prepare' | 'followup' | null
  className = ''
}) => {
  // Import icons inline to keep component self-contained
  const MessageSquare = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );

  const Search = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  );

  const Users = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );

  const ListChecks = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>
    </svg>
  );

  const context = { dealId, dealName, contactName, companyName };
  const offlineTooltip = isOffline ? ' (Offline - unavailable)' : '';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 mt-2 ${className}`}>
      <ActionMicroButton
        icon={MessageSquare}
        label="Draft Message"
        onClick={() => onDraftMessage?.(context)}
        disabled={isOffline || loadingAction !== null}
        loading={loadingAction === 'draft'}
        tooltip={`Draft a message for ${contactName || dealName}${offlineTooltip}`}
      />
      <ActionMicroButton
        icon={Search}
        label="Research"
        onClick={() => onResearchCompany?.(context)}
        disabled={isOffline || loadingAction !== null}
        loading={loadingAction === 'research'}
        tooltip={`Research ${companyName || dealName}${offlineTooltip}`}
      />
      <ActionMicroButton
        icon={Users}
        label="Prepare"
        onClick={() => onPrepareConversation?.(context)}
        disabled={isOffline || loadingAction !== null}
        loading={loadingAction === 'prepare'}
        tooltip={`Prepare for conversation with ${contactName || dealName}${offlineTooltip}`}
      />
      <ActionMicroButton
        icon={ListChecks}
        label="Follow-Up Plan"
        onClick={() => onFollowUpPlan?.(context)}
        disabled={isOffline || loadingAction !== null}
        loading={loadingAction === 'followup'}
        tooltip={`Plan follow-up sequence for ${dealName}${offlineTooltip}`}
      />
    </div>
  );
};

export default ActionMicroButton;
