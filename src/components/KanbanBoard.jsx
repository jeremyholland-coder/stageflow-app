import React, { useState, useMemo, memo, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { GripVertical, Plus, TrendingUp, AlertCircle, DollarSign, FileText, CheckCircle, Package, Users, Trophy, CheckCircle2, XCircle, Clock, Mail, Edit2, ArrowRight, Inbox, MoreVertical, Ban, UserCircle } from 'lucide-react';
import { useApp } from './AppShell';
import { LostReasonModal } from './LostReasonModal';
import { StatusChangeConfirmationModal } from './StatusChangeConfirmationModal';
import { ConfidenceTooltip } from './ConfidenceTooltip';
import { STAGE_STATUS_MAP, isWonStage, isLostStage } from '../config/pipelineTemplates';
import { StageMenuDropdown } from './StageMenuDropdown';
import { HideStageConfirmationModal } from './HideStageConfirmationModal';
import { ReorderStagesModal } from './ReorderStagesModal';
import { useStageVisibility } from '../hooks/useStageVisibility';
import { buildUserPerformanceProfiles, calculateDealConfidence, getConfidenceLabel, getConfidenceColor } from '../utils/aiConfidence';
import { ModalErrorBoundary } from './ErrorBoundaries';
// REMOVED: Virtual scrolling - using pure natural stacking for uniform layout (Option A)
// import { useVirtualScroll } from '../lib/virtual-scroll';
import { AssigneeSelector } from './AssigneeSelector';
import { DisqualifyModal } from './DisqualifyModal';

// PERFORMANCE: Lazy load NewDealModal to avoid duplicate imports
const NewDealModal = lazy(() => import('./NewDealModal').then(m => ({ default: m.NewDealModal })));

// Debounce utility for performance optimization
const useDebounce = (callback, delay) => {
  const timeoutRef = useRef(null);
  
  return useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
};

// Detect if mobile device with improved initial state and debouncing
const useIsMobile = () => {
  // Initialize based on window size (prevents hydration mismatch)
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };

    checkMobile();

    // Use debounced resize listener for better performance
    let timeoutId;
    const debouncedCheck = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(checkMobile, 150);
    };

    window.addEventListener('resize', debouncedCheck);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', debouncedCheck);
    };
  }, []);

  return isMobile;
};

// Detect if user prefers reduced motion (accessibility)
const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handleChange = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  
  return prefersReducedMotion;
};

// Detect dark mode preference (for theme-aware styling)
const useDarkMode = () => {
  const [isDark, setIsDark] = useState(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mediaQuery.matches);
    
    const handleChange = (e) => setIsDark(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  
  return isDark;
};

// Icon mapping for database icon names
const ICON_MAP = {
  'Users': Users,
  'FileText': FileText,
  'CheckCircle': CheckCircle,
  'DollarSign': DollarSign,
  'Package': Package,
  'Trophy': Trophy,
  'AlertCircle': AlertCircle,
  'TrendingUp': TrendingUp
};

// Stage ID to icon mapping
const STAGE_ID_ICONS = {
  lead: Users,
  quote: FileText,
  approval: CheckCircle,
  invoice: DollarSign,
  onboarding: Package,
  delivery: Package,
  retention: Trophy,
  lost: AlertCircle
};

// FIX PHASE 8: Comprehensive color mapping for ALL pipeline templates (60+ stages)
// Removed hardcoded STAGES array - now fully pipeline-aware
const STAGE_COLORS = {
  // Legacy default stages
  lead: '#64748b',
  quote: '#2563eb',
  approval: '#4f46e5',
  invoice: '#7c3aed',
  onboarding: '#9333ea',
  delivery: '#c026d3',
  retention: '#16a34a',
  lost: '#dc2626',

  // New default pipeline (12 stages)
  lead_captured: '#3A86FF',
  lead_qualified: '#1ABC9C',
  contacted: '#8B5CF6',
  needs_identified: '#F39C12',
  proposal_sent: '#3A86FF',
  negotiation: '#8B5CF6',
  deal_won: '#27AE60',
  deal_lost: '#E74C3C',
  invoice_sent: '#1ABC9C',
  payment_received: '#27AE60',
  customer_onboarded: '#8B5CF6',

  // Healthcare pipeline (13 stages)
  lead_generation: '#3A86FF',
  lead_qualification: '#1ABC9C',
  discovery: '#8B5CF6',
  scope_defined: '#F39C12',
  contract_sent: '#8B5CF6',
  client_onboarding: '#8B5CF6',
  renewal_upsell: '#3A86FF',

  // VC/PE pipeline (9 stages)
  deal_sourced: '#3A86FF',
  initial_screening: '#1ABC9C',
  due_diligence: '#8B5CF6',
  term_sheet_presented: '#F39C12',
  investment_closed: '#27AE60',
  capital_call_sent: '#1ABC9C',
  capital_received: '#27AE60',
  portfolio_mgmt: '#8B5CF6',

  // Real Estate pipeline (9 stages)
  qualification: '#1ABC9C',
  property_showing: '#8B5CF6',
  contract_signed: '#27AE60',
  closing_statement_sent: '#1ABC9C',
  escrow_completed: '#27AE60',
  client_followup: '#8B5CF6',

  // Professional Services pipeline (14 stages)
  lead_identified: '#3A86FF',

  // SaaS pipeline (10 stages) - qualification already defined in Real Estate
  prospecting: '#3A86FF',
  contact: '#8B5CF6',
  proposal: '#3A86FF',
  closed: '#27AE60',
  adoption: '#8B5CF6',
  renewal: '#3A86FF',

  // Legacy/deprecated stages (for backwards compatibility)
  discovery_demo: '#8B5CF6',
  closed_won: '#27AE60',
  inquiry: '#3A86FF',
  contract: '#27AE60',
  property_match: '#F39C12',
  offer: '#E74C3C',
  lead_gen: '#3A86FF',
  sourcing: '#3A86FF',
  screening: '#8B5CF6',
  review: '#F39C12',
  diligence: '#E74C3C',
  committee: '#27AE60',
  passed: '#E74C3C'
};

// Apple-like KanbanCard with modern, polished aesthetic
export const KanbanCard = memo(({ deal, onSelect, index, isDarkMode = false, isOrphaned = false, userPerformance = new Map(), globalWinRate = 0.3, organizationId, onDisqualify, onAssignmentChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const cardRef = useRef(null);
  const menuRef = useRef(null);
  const touchCloneRef = useRef(null);
  const touchDataRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  // AI-POWERED CONFIDENCE SCORE - Dynamic and personalized per user
  const confidenceScore = useMemo(() => {
    return calculateDealConfidence(deal, userPerformance, globalWinRate);
  }, [deal, userPerformance, globalWinRate]);

  // Status flags for lost vs disqualified (mutually exclusive)
  const isLost = deal.status === 'lost';
  const isDisqualified = deal.status === 'disqualified';

  // Desktop drag handlers
  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('dealId', deal.id);
    e.dataTransfer.setData('dealName', deal.client || 'Unnamed Deal');
    e.dataTransfer.setData('currentStatus', deal.status);
    setIsDragging(true);
  };

  const handleDragEnd = (e) => {
    setIsDragging(false);
  };

  // MOBILE FIX: Touch event handlers for drag-and-drop on mobile devices
  const handleTouchStart = (e) => {
    // Don't interfere with buttons or links
    if (e.target.closest('button') || e.target.closest('a')) {
      return;
    }

    const touch = e.touches[0];
    touchDataRef.current = {
      dealId: deal.id,
      dealName: deal.client || 'Unnamed Deal',
      currentStatus: deal.status,
      startX: touch.clientX,
      startY: touch.clientY,
      offsetX: 0,
      offsetY: 0,
      isDragging: false
    };
  };

  const handleTouchMove = (e) => {
    if (!touchDataRef.current) return;

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchDataRef.current.startX);
    const deltaY = Math.abs(touch.clientY - touchDataRef.current.startY);

    // Only start dragging if moved more than 10px (prevents accidental drags during scrolling)
    if (!touchDataRef.current.isDragging && (deltaX > 10 || deltaY > 10)) {
      // Horizontal movement = drag, vertical movement = scroll
      if (deltaX > deltaY) {
        // User is dragging horizontally - create clone
        touchDataRef.current.isDragging = true;

        if (cardRef.current) {
          const rect = cardRef.current.getBoundingClientRect();
          touchDataRef.current.offsetX = touchDataRef.current.startX - rect.left;
          touchDataRef.current.offsetY = touchDataRef.current.startY - rect.top;

          // PHASE C FIX (B-RACE-01): Clean up any existing clone before creating new one
          // This prevents DOM orphans from rapid drag attempts
          if (touchCloneRef.current) {
            try {
              touchCloneRef.current.remove();
            } catch (e) {
              // Ignore if already removed
            }
            touchCloneRef.current = null;
          }

          const clone = cardRef.current.cloneNode(true);
          clone.style.position = 'fixed';
          clone.style.top = `${rect.top}px`;
          clone.style.left = `${rect.left}px`;
          clone.style.width = `${rect.width}px`;
          clone.style.height = `${rect.height}px`;
          clone.style.opacity = '0.8';
          clone.style.pointerEvents = 'none';
          clone.style.zIndex = '9999';
          clone.style.transform = 'rotate(2deg) scale(1.05)';
          clone.style.transition = 'none';
          clone.classList.add('touch-drag-clone');

          document.body.appendChild(clone);
          touchCloneRef.current = clone;
          setIsDragging(true);
        }
      } else {
        // User is scrolling vertically - cancel drag
        touchDataRef.current = null;
        return;
      }
    }

    // Only prevent default and update position if actively dragging
    if (!touchDataRef.current.isDragging || !touchCloneRef.current) return;

    // Prevent scrolling while dragging
    e.preventDefault();

    // Update clone position to follow touch
    touchCloneRef.current.style.left = `${touch.clientX - touchDataRef.current.offsetX}px`;
    touchCloneRef.current.style.top = `${touch.clientY - touchDataRef.current.offsetY}px`;

    // Find drop target under touch point
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropZone = elementUnderTouch?.closest('[data-drop-zone]');

    // Visual feedback for valid drop zones
    document.querySelectorAll('[data-drop-zone]').forEach(zone => {
      zone.style.backgroundColor = '';
    });

    if (dropZone) {
      dropZone.style.backgroundColor = 'rgba(20, 184, 166, 0.1)'; // teal-500/10
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchDataRef.current) return;

    // Only process drop if we were actually dragging
    if (touchDataRef.current.isDragging && touchCloneRef.current) {
      const touch = e.changedTouches[0];
      const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropZone = elementUnderTouch?.closest('[data-drop-zone]');

      // Cleanup visual clone
      if (touchCloneRef.current) {
        touchCloneRef.current.remove();
        touchCloneRef.current = null;
      }

      // Clear drop zone highlights
      document.querySelectorAll('[data-drop-zone]').forEach(zone => {
        zone.style.backgroundColor = '';
      });

      setIsDragging(false);

      // Trigger drop if valid drop zone found
      if (dropZone) {
        const stageId = dropZone.dataset.stageId;
        if (stageId) {
          // Dispatch custom event to column with deal data
          const dropEvent = new CustomEvent('touchDrop', {
            detail: {
              dealId: touchDataRef.current.dealId,
              dealName: touchDataRef.current.dealName,
              currentStatus: touchDataRef.current.currentStatus,
              targetStage: stageId
            }
          });
          dropZone.dispatchEvent(dropEvent);
        }
      }
    }

    touchDataRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (touchCloneRef.current) {
        touchCloneRef.current.remove();
      }
    };
  }, []);

  // Keyboard navigation handler for WCAG compliance
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(deal);
    }
  };

  // PREMIUM GLASS DESIGN - Modern deal card with teal accents
  // LAYOUT FIX: Consistent card height (168px) ensures uniform spacing across all columns
  // This matches virtual scroll itemHeight (180px = 168px card + 12px gap from space-y-3)
  return (
    <div
      ref={cardRef}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={() => onSelect(deal)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Deal: ${deal.client || 'Unnamed'}, Value: $${(Number(deal.value) || 0).toLocaleString()}, Stage: ${deal.stage}, ${deal.status === 'active' ? `Confidence: ${confidenceScore}%` : `Status: ${deal.status}`}. Press Enter to view details.`}
      data-deal-id={deal.id}
      data-tour="deal-card"
      className={`
        group relative
        rounded-2xl p-5
        cursor-pointer
        transition-all duration-200 ease-out
        bg-gradient-to-br from-gray-900 to-black
        border border-teal-500/30
        min-h-[168px]
        ${isOrphaned
          ? 'ring-4 ring-amber-400/50 shadow-[0_0_24px_rgba(251,191,36,0.4)] animate-pulse-slow'
          : 'shadow-lg shadow-black/20'
        }
        hover:shadow-xl hover:shadow-teal-500/20
        ${prefersReducedMotion ? '' : 'hover:scale-[1.02]'}
        ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
        active:scale-95 active:shadow-2xl
        focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500 focus-visible:border-teal-500
      `}
      style={{
        transform: isDragging ? 'rotate(2deg)' : 'rotate(0deg)',
        transition: 'all 0.2s ease-out'
      }}
    >
      {/* Top Section: Company Info + Value */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Company Icon/Avatar - PREMIUM DESIGN */}
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-teal-500/20 ring-2 ring-teal-500/10">
            <Users className="w-6 h-6 text-teal-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-lg font-semibold tracking-tight truncate mb-0.5 text-white">
              {deal.client || 'Unnamed Client'}
            </h4>
            <p className="text-base font-normal truncate text-gray-300">
              {deal.email || 'No email provided'}
            </p>
          </div>
        </div>

        {/* Value Badge - PREMIUM DESIGN */}
        <div className="flex-shrink-0 ml-2">
          <span className="text-xl font-bold text-teal-400">
            ${(Number(deal.value) || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Confidence Progress Bar - PREMIUM DESIGN */}
      {deal.status === 'active' && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium tracking-wide uppercase text-gray-300">
              {getConfidenceLabel(confidenceScore)}
            </span>
            <span className="text-sm font-bold tabular-nums text-white">
              {confidenceScore}%
            </span>
          </div>

          {/* Progress Bar with Gradient - PREMIUM DESIGN */}
          <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-800">
            <div
              className={`
                h-full rounded-full
                bg-gradient-to-r ${getConfidenceColor(confidenceScore)}
                transition-all duration-500 ease-out
                shadow-sm
              `}
              style={{ width: `${confidenceScore}%` }}
            />
          </div>
        </div>
      )}

      {/* Status Badge */}
      {(deal.status === 'won' || deal.status === 'lost') && (
        <div className="mb-3">
          {deal.status === 'won' && (
            <span className="
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              text-sm font-medium
              bg-emerald-50 dark:bg-emerald-900/30
              text-emerald-700 dark:text-emerald-400
              border border-emerald-200 dark:border-emerald-800
            ">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Won
            </span>
          )}
          {deal.status === 'lost' && (
            <span className="
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              text-sm font-medium
              bg-rose-50 dark:bg-rose-900/30
              text-rose-700 dark:text-rose-400
              border border-rose-200 dark:border-rose-800
            ">
              <XCircle className="w-3.5 h-3.5" />
              Lost
            </span>
          )}
        </div>
      )}

      {/* Lost Reason – only for truly lost deals */}
      {isLost && deal.lost_reason && (
        <p className="text-sm truncate mb-3 text-red-400">
          {deal.lost_reason === 'other' && deal.lost_reason_notes
            ? deal.lost_reason_notes
            : deal.lost_reason}
        </p>
      )}

      {/* Disqualified Reason – only for disqualified leads */}
      {isDisqualified &&
        (deal.disqualified_reason_notes || deal.disqualified_reason_category) && (
          <p className="text-sm truncate mb-3 text-red-400">
            {deal.disqualified_reason_notes ||
              deal.disqualified_reason_category.replace(/_/g, ' ')}
          </p>
        )}

      {/* Assignee Display - Inline assignment selector */}
      {organizationId && deal.status === 'active' && (
        <div className="mb-3" onClick={(e) => e.stopPropagation()}>
          <AssigneeSelector
            dealId={deal.id}
            currentAssigneeId={deal.assigned_to}
            organizationId={organizationId}
            onAssignmentChange={(newAssigneeId) => onAssignmentChange?.(deal.id, newAssigneeId)}
            compact={true}
          />
        </div>
      )}

      {/* Contextual Actions (appear on hover) - PREMIUM DESIGN */}
      <div className={`
        absolute bottom-4 right-4
        flex items-center gap-2
        transition-all duration-200
        ${prefersReducedMotion ? 'group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0'}
      `}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = `mailto:${deal.email}`;
          }}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
          title="Email client"
          aria-label="Email client"
        >
          <Mail className="w-4 h-4" />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(deal);
          }}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
          title="Edit deal"
          aria-label="Edit deal"
        >
          <Edit2 className="w-4 h-4" />
        </button>

        {/* Context menu for additional actions */}
        {deal.status === 'active' && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    onDisqualify?.(deal);
                  }}
                  className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-amber-500/10 transition text-amber-400"
                  role="menuitem"
                >
                  <Ban className="w-4 h-4" />
                  <span className="text-sm font-medium">Disqualify deal</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drag Handle (subtle, top-left) - PREMIUM DESIGN */}
      <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-40 transition-opacity duration-200">
        <GripVertical className="w-4 h-4 text-gray-500" />
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.deal.id === nextProps.deal.id &&
    prevProps.deal.client === nextProps.deal.client &&
    prevProps.deal.email === nextProps.deal.email &&
    prevProps.deal.value === nextProps.deal.value &&
    prevProps.deal.status === nextProps.deal.status &&
    prevProps.deal.stage === nextProps.deal.stage &&
    prevProps.deal.lost_reason === nextProps.deal.lost_reason &&
    prevProps.deal.assigned_to === nextProps.deal.assigned_to &&
    prevProps.index === nextProps.index &&
    prevProps.organizationId === nextProps.organizationId
  );
});

KanbanCard.displayName = 'KanbanCard';

// Modern KanbanColumn - Always visible, no accordion behavior
export const KanbanColumn = memo(({
  stage,
  deals,
  onUpdateDeal,
  onDealCreated,
  onDealSelected,
  onLostReasonRequired,
  columnIndex,
  totalColumns,
  onAnalyticsEvent = () => {},
  isMobile = false,
  isDarkMode = false,
  orphanedDealIds = new Set(),
  onHideStage,
  onMoveLeft,
  onMoveRight,
  onOpenReorderModal,
  userPerformance = new Map(),
  globalWinRate = 0.3,
  organizationId,
  onDisqualify,
  onAssignmentChange
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const columnRef = useRef(null);
  
  // Resolve icon component with stage ID fallback
  let Icon = Users;
  if (typeof stage.icon === 'function') {
    Icon = stage.icon;
  } else if (stage.icon_name && ICON_MAP[stage.icon_name]) {
    Icon = ICON_MAP[stage.icon_name];
  } else if (typeof stage.icon === 'string' && ICON_MAP[stage.icon]) {
    Icon = ICON_MAP[stage.icon];
  } else if (stage.id && STAGE_ID_ICONS[stage.id]) {
    Icon = STAGE_ID_ICONS[stage.id];
  }
  
  // SORTING FIX: Filter deals for this stage, then sort by:
  // 1. Confidence/probability DESC (highest first)
  // 2. Alphabetical by client name ASC (A-Z)
  const stageDeals = useMemo(() => {
    const filtered = deals.filter(d => d.stage === stage.id);

    // Sort: confidence DESC, then client name ASC
    return filtered.sort((a, b) => {
      // Calculate confidence scores for sorting
      // Using the same calculateDealConfidence function used for display
      const confA = calculateDealConfidence(a, userPerformance, globalWinRate);
      const confB = calculateDealConfidence(b, userPerformance, globalWinRate);

      // Primary sort: confidence DESC (higher probability first)
      if (confB !== confA) {
        return confB - confA;
      }

      // Secondary sort: alphabetical by client name ASC
      const nameA = (a.client || '').toLowerCase();
      const nameB = (b.client || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [deals, stage.id, userPerformance, globalWinRate]);

  const totalValue = useMemo(
    () => stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0),
    [stageDeals]
  );

  // OPTION A: Pure Natural Stacking - NO virtual scroll
  // All columns use identical space-y-3 (12px gap) natural stacking
  // This ensures uniform layout matching Lead Captured + Lead Qualified

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dealId = e.dataTransfer.getData('dealId');
    const dealName = e.dataTransfer.getData('dealName');
    const currentStatus = e.dataTransfer.getData('currentStatus');

    if (!dealId) return;

    processDrop(dealId, dealName, currentStatus);
  };

  // MOBILE FIX: Handle touch drop events
  const handleTouchDrop = useCallback((e) => {
    const { dealId, dealName, currentStatus } = e.detail;
    if (!dealId) return;

    processDrop(dealId, dealName, currentStatus);
  }, []);

  // Shared drop processing logic for both desktop and touch
  const processDrop = (dealId, dealName, currentStatus) => {
    if (stage.id === 'lost') {
      onLostReasonRequired(dealId, dealName, stage.id);
    } else if (stage.id === 'retention') {
      onUpdateDeal(dealId, { stage: stage.id, status: 'won' });
    } else {
      const isMovingFromWonOrLost = currentStatus === 'won' || currentStatus === 'lost';
      const isMovingToActiveStage = stage.id !== 'retention' && stage.id !== 'lost';

      if (isMovingFromWonOrLost && isMovingToActiveStage) {
        onLostReasonRequired(dealId, dealName, stage.id, currentStatus, 'status-change');
      } else {
        onUpdateDeal(dealId, { stage: stage.id });
      }
    }
  };

  // MOBILE FIX: Add touch drop event listener
  useEffect(() => {
    const dropZone = columnRef.current?.querySelector('[data-drop-zone]');
    if (dropZone) {
      dropZone.addEventListener('touchDrop', handleTouchDrop);
      return () => dropZone.removeEventListener('touchDrop', handleTouchDrop);
    }
  }, [handleTouchDrop]);

  const stageColor = stage.color || STAGE_COLORS[stage.id] || '#64748b';

  return (
    <>
      {/* MEDIUM FIX: Add error boundary around lazy-loaded modal */}
      <ModalErrorBoundary onClose={() => setShowNewDeal(false)}>
        <Suspense fallback={null}>
          <NewDealModal
            isOpen={showNewDeal}
            onClose={() => setShowNewDeal(false)}
            initialStage={stage.id}
            onDealCreated={onDealCreated}
          />
        </Suspense>
      </ModalErrorBoundary>

      {/* PREMIUM GLASS COLUMN - Modern with teal accents */}
      {/* COMPREHENSIVE RESPONSIVE: Progressive column widths for all screen sizes (Webflow-inspired) */}
      {/* MOBILE FIX: Conditional widths prevent horizontal scroll on mobile */}
      {/* Mobile: 100% (w-full) | Tablets: 280px | Desktop: 320px | Large: 360px | XL: 380px | 2XL: 400px | Full HD: 420px | 4K: 450px */}
      <div
        ref={columnRef}
        className={`flex flex-col flex-shrink-0 rounded-2xl border border-teal-500/30 bg-gradient-to-br from-gray-900/50 to-black/50 backdrop-blur-sm ${isMobile ? 'w-full' : 'w-[280px] md:w-[300px] lg:w-[320px] xl:w-[360px] 2xl:w-[380px] 3xl:w-[420px] 4xl:w-[450px]'}`}
        style={{
          maxWidth: isMobile ? '100%' : undefined
        }}
        role="region"
        aria-label={`${stage.name} stage with ${stageDeals.length} deals`}
      >
        {/* Sticky Header with Backdrop Blur - PREMIUM DESIGN */}
        <div
          className="sticky top-0 z-10 rounded-t-2xl mb-4 pb-3 backdrop-blur-xl bg-gray-900/90"
          style={{
            borderBottom: `2px solid ${stageColor}40`
          }}
        >
          <div className="px-4 pt-3 pb-1 relative">
            {/* Stage name with icon and action buttons inline - PREMIUM DESIGN */}
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className="p-1.5 rounded-lg flex-shrink-0"
                  style={{ backgroundColor: `${stageColor}20` }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: stageColor }}
                    aria-hidden="true"
                  />
                </div>
                <h3
                  className="font-semibold text-sm truncate text-white"
                  title={stage.name}
                >
                  {stage.name}
                </h3>
              </div>

              {/* Action buttons - inline with title */}
              <div className="flex items-center gap-0.5 flex-shrink-0" data-tour="column-header-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewDeal(true);
                  }}
                  className="w-7 h-7 rounded-md flex items-center justify-center transition-all bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 hover:text-teal-300 shadow-sm hover:shadow-md"
                  title={`Add new deal to ${stage.name}`}
                  aria-label={`Add new deal to ${stage.name}`}
                  data-tour="column-add-deal"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {onHideStage && (
                  <div data-tour="column-menu">
                    <StageMenuDropdown
                      stageName={stage.name}
                      onHideStage={() => onHideStage(stage.id, stage.name)}
                      onReorderStages={onOpenReorderModal}
                      onMoveLeft={onMoveLeft}
                      onMoveRight={onMoveRight}
                      canMoveLeft={columnIndex > 0}
                      canMoveRight={columnIndex < totalColumns - 1}
                      showReorderOption={columnIndex === 0}
                      isDarkMode={isDarkMode}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Value prominent, count subtle - PREMIUM DESIGN */}
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-white">
                ${(totalValue / 1000).toFixed(0)}k
              </span>
              <span className="text-xs font-medium tabular-nums text-gray-500">
                {stageDeals.length}
              </span>
            </div>
          </div>
        </div>

        {/* Cards Container with Drop Zone - PREMIUM DESIGN */}
        {/* FIX: justify-start ensures cards stack from top, not distributed */}
        <div
          data-drop-zone="true"
          data-stage-id={stage.id}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`px-4 pb-4 flex flex-col justify-start transition-all duration-200 ${
            dragOver ? 'bg-teal-500/10 rounded-2xl' : ''
          }`}
          style={{ minHeight: '120px' }}
        >
          {stageDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div
                className={`p-4 rounded-full mb-3 transition-all duration-300 ${
                  dragOver
                    ? 'bg-teal-500/20 scale-110'
                    : 'bg-gray-800/50'
                }`}
              >
                <Icon
                  className={`w-8 h-8 transition-colors duration-300 ${
                    dragOver ? 'text-teal-400' : 'text-gray-500'
                  }`}
                />
              </div>
              <p
                className={`text-sm font-medium transition-colors duration-300 ${
                  dragOver ? 'text-teal-400' : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {dragOver ? 'Drop deal here!' : 'Drag a deal here or click + to add'}
              </p>
            </div>
          ) : (
            // OPTION A: Pure Natural Stacking for ALL columns
            // Identical to Lead Captured + Lead Qualified - no virtual scroll
            // Cards take natural height, space-y-3 provides uniform 12px gaps
            <div className="space-y-3">
              {stageDeals.map((deal, idx) => (
                <KanbanCard
                  key={deal.id}
                  deal={deal}
                  onSelect={onDealSelected}
                  index={idx}
                  isDarkMode={isDarkMode}
                  isOrphaned={orphanedDealIds.has(deal.id)}
                  userPerformance={userPerformance}
                  globalWinRate={globalWinRate}
                  organizationId={organizationId}
                  onDisqualify={onDisqualify}
                  onAssignmentChange={onAssignmentChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
});

KanbanColumn.displayName = 'KanbanColumn';

// Main KanbanBoard - Modern, Always-Visible Layout
export const KanbanBoard = memo(({
  deals,
  filterStatus,
  onUpdateDeal,
  onDealCreated,
  onDealSelected,
  pipelineStages = [],
  stagesLoading = false,
  hasNoFilteredResults = false,
  searchTerm = '',
  onAnalyticsEvent = () => {},
  orphanedDealIds = new Set(), // Track orphaned deals for orange glow
  dealsError = null, // MEDIUM FIX: Error state for retry UI
  onRetryDeals = () => {} // MEDIUM FIX: Retry function
}) => {
  const { organization, user } = useApp();
  const [isDragging, setIsDragging] = useState(false);
  const isMobile = useIsMobile();
  const { darkMode: isDarkMode } = useApp();
  const prefersReducedMotion = usePrefersReducedMotion();

  // AI-POWERED: Build user performance profiles for dynamic confidence scoring
  const { userPerformance, globalWinRate } = useMemo(() => {
    const profiles = buildUserPerformanceProfiles(deals);
    const wonDeals = deals.filter(d => d.status === 'won' || d.stage === 'retention');
    const lostDeals = deals.filter(d => d.status === 'lost' || d.stage === 'lost');
    const totalClosed = wonDeals.length + lostDeals.length;
    const winRate = totalClosed > 0 ? wonDeals.length / totalClosed : 0.3;

    return { userPerformance: profiles, globalWinRate: winRate };
  }, [deals]);

  // Stage visibility and ordering
  const {
    hiddenStageIds,
    stageOrder,
    hideStage,
    updateStageOrder,
    filterVisibleStages,
    applyStageOrder
  } = useStageVisibility(user?.id, organization?.id);

  // State for hide stage confirmation modal
  const [showHideStageModal, setShowHideStageModal] = useState(false);
  const [stageToHide, setStageToHide] = useState(null);

  // State for reorder stages modal
  const [showReorderModal, setShowReorderModal] = useState(false);

  // State for column drag-and-drop reordering
  const [draggedColumnIndex, setDraggedColumnIndex] = useState(null);

  const stages = useMemo(() => {
    // FIX PHASE 8: Removed hardcoded STAGES fallback - pipelineStages always provided by Dashboard
    if (pipelineStages && pipelineStages.length > 0) {
      return pipelineStages.map((stage, idx) => ({
        id: stage.id || stage.stage_key || `stage-${idx}`,
        name: stage.name || stage.stage_name || stage.id || `Stage ${idx + 1}`,
        icon: ICON_MAP[stage.icon_name || stage.icon] || DollarSign,
        color: stage.color || STAGE_COLORS[stage.id || stage.stage_key] || '#64748b'
      }));
    }
    // If no stages provided, return empty array (Dashboard will handle this)
    return [];
  }, [pipelineStages]);

  // CRITICAL FIX: Pre-compute deal stages map BEFORE hooks that depend on it
  // This fixes "Cannot access 'te' before initialization" error
  // FIX: Filter out disqualified deals from the active Kanban pipeline
  const dealsByStage = useMemo(() => {
    const map = new Map();
    if (!deals || !Array.isArray(deals)) return map;

    deals.forEach(deal => {
      if (!deal || !deal.stage) return;
      // Exclude disqualified deals from the active Kanban
      if (deal.status === 'disqualified') return;
      if (!map.has(deal.stage)) {
        map.set(deal.stage, []);
      }
      map.get(deal.stage).push(deal);
    });
    return map;
  }, [deals]);

  // CRITICAL FIX: Compute visibleStages BEFORE hooks that depend on it
  const visibleStages = useMemo(() => {
    if (stagesLoading || !stages || stages.length === 0) return [];

    // CRITICAL FIX: Only show columns that have deals in them for filtered views
    // This prevents empty columns from appearing when using specific filters
    let filteredStages;

    if (filterStatus === 'won') {
      // Show only won stages that have deals
      filteredStages = stages.filter(stage =>
        isWonStage(stage.id) && (dealsByStage.get(stage.id)?.length || 0) > 0
      );
    } else if (filterStatus === 'lost') {
      // Show only lost stages that have deals
      filteredStages = stages.filter(stage =>
        isLostStage(stage.id) && (dealsByStage.get(stage.id)?.length || 0) > 0
      );
    } else if (filterStatus === 'active') {
      // Show only active stages (not won/lost) that have deals
      filteredStages = stages.filter(stage =>
        !isLostStage(stage.id) && !isWonStage(stage.id) && (dealsByStage.get(stage.id)?.length || 0) > 0
      );
    } else if (filterStatus === 'invoice_sent') {
      // Show only invoice-related stages that have deals
      filteredStages = stages.filter(stage =>
        ['invoice_sent', 'invoice'].includes(stage.id?.toLowerCase()) && (dealsByStage.get(stage.id)?.length || 0) > 0
      );
    } else if (filterStatus === 'payment_received') {
      // Show only payment-related stages that have deals
      filteredStages = stages.filter(stage =>
        ['payment_received', 'payment'].includes(stage.id?.toLowerCase()) && (dealsByStage.get(stage.id)?.length || 0) > 0
      );
    } else if (filterStatus === 'retention') {
      // Show only retention-related stages that have deals
      filteredStages = stages.filter(stage =>
        ['retention', 'retention_renewal', 'onboarding'].includes(stage.id?.toLowerCase()) && (dealsByStage.get(stage.id)?.length || 0) > 0
      );
    } else {
      // "All" filter - show all stages (empty columns OK for visual context)
      filteredStages = stages;
    }

    // Apply user's hidden stage preferences (filter out hidden stages)
    const visibleFilteredStages = filterVisibleStages(filteredStages);

    // Apply user's custom stage order
    return applyStageOrder(visibleFilteredStages);
  }, [filterStatus, stages, stagesLoading, dealsByStage, deals.length, filterVisibleStages, applyStageOrder]);

  const [showLostModal, setShowLostModal] = useState(false);
  const [pendingLostDeal, setPendingLostDeal] = useState(null);
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);

  // State for disqualify modal
  const [showDisqualifyModal, setShowDisqualifyModal] = useState(false);
  const [pendingDisqualifyDeal, setPendingDisqualifyDeal] = useState(null);

  // Track dragging globally
  useEffect(() => {
    const handleDragStart = () => setIsDragging(true);
    const handleDragEnd = () => setIsDragging(false);

    window.addEventListener('dragstart', handleDragStart);
    window.addEventListener('dragend', handleDragEnd);

    return () => {
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('dragend', handleDragEnd);
    };
  }, []);

  // NEXT-LEVEL: Memoize modal handlers to prevent breaking KanbanColumn child memoization
  // These handlers are passed as props to KanbanColumn → KanbanCard (3-level deep)
  // Without useCallback, they recreate on every render, breaking child memo optimizations
  const handleLostReasonRequired = useCallback((dealId, dealName, targetStage, currentStatus = null, modalType = 'lost-reason') => {
    // PHASE C FIX (B-RACE-02): Prevent opening multiple modals simultaneously
    // Check if any modal is already open to avoid race conditions
    if (showLostModal || showStatusChangeModal) {
      return; // Already showing a modal, ignore rapid clicks
    }

    if (modalType === 'status-change') {
      setPendingStatusChange({ dealId, dealName, targetStage, currentStatus });
      setShowStatusChangeModal(true);
    } else {
      setPendingLostDeal({ dealId, dealName, targetStage });
      setShowLostModal(true);
    }
  }, [showLostModal, showStatusChangeModal]); // PHASE C: Added modal state as dependencies

  const handleLostReasonConfirm = useCallback(async (reason) => {
    if (!pendingLostDeal) return;
    await onUpdateDeal(pendingLostDeal.dealId, {
      stage: 'lost',
      status: 'lost',
      lost_reason: reason
    });
    setPendingLostDeal(null);
    setShowLostModal(false);
  }, [pendingLostDeal, onUpdateDeal]); // Depends on pendingLostDeal and onUpdateDeal

  const handleLostReasonCancel = useCallback(() => {
    setPendingLostDeal(null);
    setShowLostModal(false);
  }, []); // No dependencies - only updates state

  const handleStatusChangeConfirm = useCallback(async () => {
    if (!pendingStatusChange) return;
    await onUpdateDeal(pendingStatusChange.dealId, {
      stage: pendingStatusChange.targetStage,
      status: 'active',
      lost_reason: null
    });
    setPendingStatusChange(null);
    setShowStatusChangeModal(false);
  }, [pendingStatusChange, onUpdateDeal]); // Depends on pendingStatusChange and onUpdateDeal

  const handleStatusChangeCancel = useCallback(() => {
    setPendingStatusChange(null);
    setShowStatusChangeModal(false);
  }, []); // No dependencies - only updates state

  // Handle disqualify deal request
  const handleDisqualifyRequest = useCallback((deal) => {
    if (showDisqualifyModal) return; // Prevent multiple modals
    setPendingDisqualifyDeal(deal);
    setShowDisqualifyModal(true);
  }, [showDisqualifyModal]);

  // Confirm disqualifying a deal
  const handleDisqualifyConfirm = useCallback(async ({ reasonCategory, reasonLabel, notes }) => {
    if (!pendingDisqualifyDeal) return;

    await onUpdateDeal(pendingDisqualifyDeal.id, {
      status: 'disqualified',
      disqualified_reason_category: reasonCategory,
      disqualified_reason_notes: notes || null,
      stage_at_disqualification: pendingDisqualifyDeal.stage,
      disqualified_at: new Date().toISOString()
    });

    setPendingDisqualifyDeal(null);
    setShowDisqualifyModal(false);
  }, [pendingDisqualifyDeal, onUpdateDeal]);

  // Cancel disqualify
  const handleDisqualifyCancel = useCallback(() => {
    setPendingDisqualifyDeal(null);
    setShowDisqualifyModal(false);
  }, []);

  // Handle deal assignment change (for optimistic UI in cards)
  const handleAssignmentChange = useCallback((dealId, newAssigneeId) => {
    // The AssigneeSelector handles the actual API call
    // This callback is for parent-level state updates if needed
    console.log('[KanbanBoard] Assignment changed:', { dealId, newAssigneeId });
  }, []);

  // PERFORMANCE FIX: Memoize handlers to prevent breaking KanbanColumn memoization
  // Handle hide stage request
  const handleHideStageRequest = useCallback((stageId, stageName) => {
    setStageToHide({ id: stageId, name: stageName });
    setShowHideStageModal(true);
  }, []);

  // Confirm hiding a stage
  const handleHideStageConfirm = useCallback(async () => {
    if (!stageToHide) return;
    await hideStage(stageToHide.id);
    setStageToHide(null);
    setShowHideStageModal(false);
  }, [stageToHide, hideStage]);

  // Handle moving a column left or right
  const handleMoveStage = useCallback(async (currentIndex, direction) => {
    if (currentIndex < 0 || currentIndex >= visibleStages.length) return;

    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visibleStages.length) return;

    // Create new order by swapping stages
    const newOrder = [...visibleStages];
    const [movedStage] = newOrder.splice(currentIndex, 1);
    newOrder.splice(targetIndex, 0, movedStage);

    // Save the new order (just the IDs)
    const newOrderIds = newOrder.map(s => s.id);
    await updateStageOrder(newOrderIds);
  }, [visibleStages, updateStageOrder]);

  // Handle column drag-and-drop for reordering
  const handleColumnDragStart = (e, index) => {
    setDraggedColumnIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
  };

  const handleColumnDragOver = (e, index) => {
    e.preventDefault();
    if (draggedColumnIndex === null || draggedColumnIndex === index) return;

    // Visual feedback
    e.dataTransfer.dropEffect = 'move';
  };

  const handleColumnDrop = async (e, dropIndex) => {
    e.preventDefault();
    if (draggedColumnIndex === null || draggedColumnIndex === dropIndex) return;

    // Reorder the visible stages
    const newOrder = [...visibleStages];
    const [draggedStage] = newOrder.splice(draggedColumnIndex, 1);
    newOrder.splice(dropIndex, 0, draggedStage);

    // Save the new order (just the IDs)
    const newOrderIds = newOrder.map(s => s.id);
    await updateStageOrder(newOrderIds);

    setDraggedColumnIndex(null);
  };

  const handleColumnDragEnd = () => {
    setDraggedColumnIndex(null);
  };

  // MEDIUM FIX: Show retry UI when deals fail to load
  if (dealsError && deals.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Failed to Load Deals
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            {dealsError.message}
          </p>
          <button
            onClick={() => onRetryDeals()}
            className="px-4 py-2 bg-[#1ABC9C] text-white rounded-lg hover:bg-[#16A085] transition-colors focus:ring-2 focus:ring-[#1ABC9C] focus:ring-offset-2"
            aria-label="Retry loading deals"
            title="Reload deals from database"
          >
            Retry Loading Deals
          </button>
        </div>
      </div>
    );
  }

  if (stagesLoading || stages.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1ABC9C] mx-auto mb-4" />
          <p className="text-sm text-slate-600">
            {stagesLoading ? 'Loading pipeline...' : 'No pipeline stages found'}
          </p>
        </div>
      </div>
    );
  }

  // CRITICAL FIX: Show empty state when there are NO visible stages with deals
  // This fixes empty states not showing for Won/Lost/Invoiced/Paid/Retention filters
  // IMPORTANT: For "All" view, ALWAYS show Kanban columns (even if empty) - users need to see pipeline structure
  // Only show empty state for specific filters (won, lost, etc.) when no stages match
  const shouldShowEmptyState = filterStatus !== 'all' && visibleStages.length === 0;

  if (shouldShowEmptyState) {
    const emptyStateConfig = {
      active: {
        icon: Inbox,
        title: 'No Active Deals',
        description: searchTerm
          ? `No active deals match "${searchTerm}". Try adjusting your search or check other filters.`
          : 'All your active deals are either won or lost. Create a new deal to get started!',
        cta: 'Create New Deal'
      },
      won: {
        icon: Trophy,
        title: 'No Won Deals Yet',
        description: searchTerm
          ? `No won deals match "${searchTerm}". Try adjusting your search.`
          : 'Close your first deal to see it here! Deals marked as won will appear in this view.',
        cta: null
      },
      invoice_sent: {
        icon: DollarSign,
        title: 'No Invoices Sent',
        description: searchTerm
          ? `No invoiced deals match "${searchTerm}". Try adjusting your search.`
          : 'Move won deals to the "Invoice Sent" stage to track outstanding invoices here.',
        cta: null
      },
      payment_received: {
        icon: CheckCircle2,
        title: 'No Payments Received Yet',
        description: searchTerm
          ? `No paid deals match "${searchTerm}". Try adjusting your search.`
          : 'Track revenue recognition here! Move deals to "Payment Received" stage when payment comes in.',
        cta: null
      },
      retention: {
        icon: Trophy,
        title: 'No Clients in Retention',
        description: searchTerm
          ? `No retention clients match "${searchTerm}". Try adjusting your search.`
          : 'Current clients needing renewal or nurture will appear here. Move completed deals to retention stage.',
        cta: null
      },
      lost: {
        icon: XCircle,
        title: 'No Lost Deals',
        description: searchTerm
          ? `No lost deals match "${searchTerm}". Try adjusting your search.`
          : 'No deals have been marked as lost yet. This is a good thing!',
        cta: null
      },
      all: {
        icon: Inbox,
        title: searchTerm ? 'No Results Found' : 'No Deals Yet',
        description: searchTerm
          ? `No deals match "${searchTerm}". Try a different search term or create a new deal.`
          : 'Start by adding your first deal to the pipeline.',
        cta: 'Create Your First Deal'
      }
    };

    const config = emptyStateConfig[filterStatus] || emptyStateConfig.all;
    const Icon = config.icon;

    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 bg-gradient-to-b from-transparent to-gray-50/50 dark:to-gray-900/20 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
        <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-full flex items-center justify-center mb-6 opacity-90">
          <Icon className="w-10 h-10 text-gray-300 dark:text-gray-500" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3 text-center">
          {config.title}
        </h3>
        <p className="text-gray-600 dark:text-gray-300 text-center max-w-md mb-6">
          {config.description}
        </p>
        {config.cta && onDealCreated && (
          <button
            onClick={() => onDealCreated()}
            className="bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 transition-all flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="w-5 h-5" />
            {config.cta}
          </button>
        )}
        <div className="mt-8 flex items-center gap-2 text-sm text-gray-300 dark:text-gray-500">
          <span className="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full animate-pulse"></span>
          <span>Try changing filters or creating a new deal</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Modern Horizontal Scroll Layout */}
      <div
        data-tour="pipeline-columns"
        className={`flex ${isMobile ? 'flex-col gap-4' : 'gap-4 overflow-x-auto items-start'} ${isMobile ? 'pb-24' : 'pb-6'} ${isMobile ? 'w-full' : 'kanban-full-width'}`}
        style={{
          height: isMobile ? 'auto' : 'auto',
          overflowY: 'visible',
          scrollbarWidth: 'thin',
          scrollbarColor: isDarkMode ? '#475569 #1e293b' : '#cbd5e1 #f1f5f9',
          // CRITICAL FIX: Prevent horizontal scroll on mobile (multiple safeguards)
          maxWidth: isMobile ? '100%' : 'none',
          width: isMobile ? '100%' : 'auto',
          overflowX: isMobile ? 'hidden' : 'auto',
          paddingLeft: isMobile ? '1rem' : '0',
          paddingRight: isMobile ? '1rem' : '0',
          boxSizing: 'border-box',  // Include padding in width calculation
          // CRITICAL FIX: Allow vertical page scroll while keeping horizontal scroll for Kanban
          overscrollBehavior: 'auto',
          touchAction: 'auto',
          WebkitOverflowScrolling: 'touch'
        }}
        role="region"
        aria-label="Pipeline stages"
      >
        {visibleStages.map((stage, idx) => {
          // CRITICAL FIX: Don't use hooks inside loops - create handlers inline
          // Hooks must be called in the same order every render
          return (
            // DEV NOTE (LAYOUT FIX): Added self-start + h-fit to prevent columns
            // from stretching to match tallest column. This ensures each column
            // sizes to its own content, fixing vertical spacing inconsistencies.
            <div
              key={stage.id}
              className="transition-all duration-200 self-start h-fit"
            >
              <KanbanColumn
                stage={stage}
                deals={deals}
                onUpdateDeal={onUpdateDeal}
                onDealCreated={onDealCreated}
                onDealSelected={onDealSelected}
                onLostReasonRequired={handleLostReasonRequired}
                columnIndex={idx}
                totalColumns={visibleStages.length}
                onAnalyticsEvent={onAnalyticsEvent}
                isMobile={isMobile}
                isDarkMode={isDarkMode}
                orphanedDealIds={orphanedDealIds}
                onHideStage={handleHideStageRequest}
                onMoveLeft={() => handleMoveStage(idx, 'left')}
                onMoveRight={() => handleMoveStage(idx, 'right')}
                onOpenReorderModal={() => setShowReorderModal(true)}
                userPerformance={userPerformance}
                globalWinRate={globalWinRate}
                organizationId={organization?.id}
                onDisqualify={handleDisqualifyRequest}
                onAssignmentChange={handleAssignmentChange}
              />
            </div>
          );
        })}
      </div>

      <LostReasonModal
        isOpen={showLostModal}
        onClose={handleLostReasonCancel}
        onConfirm={handleLostReasonConfirm}
        dealName={pendingLostDeal?.dealName || ''}
      />

      <StatusChangeConfirmationModal
        isOpen={showStatusChangeModal}
        onClose={handleStatusChangeCancel}
        onConfirm={handleStatusChangeConfirm}
        dealName={pendingStatusChange?.dealName || ''}
        currentStatus={pendingStatusChange?.currentStatus || 'won'}
        targetStage={pendingStatusChange?.targetStage || ''}
      />

      <HideStageConfirmationModal
        isOpen={showHideStageModal}
        onClose={() => setShowHideStageModal(false)}
        onConfirm={handleHideStageConfirm}
        stageName={stageToHide?.name || ''}
      />

      <ReorderStagesModal
        isOpen={showReorderModal}
        onClose={() => setShowReorderModal(false)}
        stages={visibleStages}
        onSave={updateStageOrder}
      />

      <DisqualifyModal
        isOpen={showDisqualifyModal}
        onClose={handleDisqualifyCancel}
        onConfirm={handleDisqualifyConfirm}
        dealName={pendingDisqualifyDeal?.client || ''}
      />

      {/* Webkit Scrollbar Styling */}
      <style>{`
        .flex::-webkit-scrollbar {
          height: 8px;
        }
        .flex::-webkit-scrollbar-track {
          background: ${isDarkMode ? '#1e293b' : '#f1f5f9'};
          border-radius: 4px;
        }
        .flex::-webkit-scrollbar-thumb {
          background: ${isDarkMode ? '#475569' : '#cbd5e1'};
          border-radius: 4px;
        }
        .flex::-webkit-scrollbar-thumb:hover {
          background: ${isDarkMode ? '#64748b' : '#94a3b8'};
        }
      `}</style>
    </>
  );
});

KanbanBoard.displayName = 'KanbanBoard';
