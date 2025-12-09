/**
 * DOMAIN SPINE INDEX
 *
 * Re-exports all domain modules for convenient importing.
 *
 * Usage:
 *   import { Deal, isValidStageId, getStageDisplayName } from '@/domain';
 *   import { classifyAIError, normalizeAIResponse } from '@/domain';
 *
 * @module domain
 * @since Engine Rebuild Phase 5
 */

// Deal domain
export {
  type Deal,
  type DealStatus,
  type DealStageId,
  type OutcomeViolation,
  CORE_STAGES,
  CORE_STAGES_SET,
  isValidStageId,
  isCoreStage,
  validateStage,
  isValidStatus,
  getImpliedStatusForStage,
  syncStageAndStatus,
  validateOutcome,
  normalizeDeal,
  clearOutcomeFields,
} from './deal';

// Stage labels domain
export {
  getStageDisplayName,
  getLostReasonDisplay,
  getDisqualifiedReasonDisplay,
  getOutcomeReasonDisplay,
  getStatusDisplay,
} from './stageLabels';

// AI domain
export {
  type AIProviderStatus,
  type AIErrorCode,
  type AIErrorInfo,
  type NormalizedAIResponse,
  classifyAIError,
  normalizeAIResponse,
  isAIErrorResponse,
  getProviderStatusFromError,
} from './ai';
