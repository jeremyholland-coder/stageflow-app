/**
 * Offline Store - Queue mutations for sync when back online
 *
 * "Works on a plane" - True offline support for StageFlow
 *
 * Features:
 * - Queue deal mutations (create, update, delete, stage change)
 * - Persist queue to IndexedDB (survives page refresh)
 * - Process queue in FIFO order when back online
 * - Simple "last writer wins" conflict resolution (v1)
 * - Phase 7: Telemetry integration for observability
 *
 * Usage:
 * - When offline: enqueueCommand({ type: 'update_deal', payload: {...} })
 * - When online: getPendingCommands() → sync each → clearCommands([ids])
 *
 * @author StageFlow Engineering
 * @date November 25, 2025
 * @updated December 2025 - Phase 7 offline resilience
 */

import { indexedDBCache, STORES } from './indexeddb-cache';
import { logger } from './logger';
import { trackEvent, addBreadcrumb } from './sentry';

// Command types for offline queue
export const OFFLINE_COMMAND_TYPES = {
  CREATE_DEAL: 'create_deal',
  UPDATE_DEAL: 'update_deal',
  DELETE_DEAL: 'delete_deal',
  MOVE_DEAL_STAGE: 'move_deal_stage',
};

// Command status
export const COMMAND_STATUS = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed',
};

/**
 * Generate unique ID for offline commands
 */
function generateCommandId() {
  return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Enqueue a command for offline sync
 *
 * @param {Object} command - Command to queue
 * @param {string} command.type - One of OFFLINE_COMMAND_TYPES
 * @param {Object} command.payload - Command-specific data (dealId, updates, etc.)
 * @param {string} command.organizationId - Organization context
 * @param {string} [command.localId] - Temporary ID for optimistic UI (for creates)
 * @returns {Promise<string>} - Command ID
 */
export async function enqueueCommand(command) {
  try {
    const id = generateCommandId();
    const queueEntry = {
      id,
      type: command.type,
      payload: command.payload,
      organizationId: command.organizationId,
      localId: command.localId || null, // For tracking optimistic creates
      status: COMMAND_STATUS.PENDING,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 5, // Phase 7: Configurable retry limit
      lastError: null,
      lastAttemptAt: null,
    };

    await indexedDBCache.set(STORES.OFFLINE_QUEUE, id, queueEntry, {
      organizationId: command.organizationId,
      // No TTL - commands persist until synced
    });

    logger.log(`[Offline] Queued command: ${command.type}`, { id, payload: command.payload });

    // Phase 7: Telemetry for offline queue
    trackEvent('offline_queue_enqueued', {
      commandType: command.type,
      commandId: id,
    });

    addBreadcrumb('Offline command queued', {
      category: 'offline',
      data: { type: command.type, commandId: id },
    });

    return id;
  } catch (error) {
    console.error('[Offline] Failed to enqueue command:', error);
    throw error;
  }
}

/**
 * Get all pending commands for an organization (sorted by creation time)
 *
 * @param {string} organizationId - Organization to get commands for
 * @returns {Promise<Array>} - Array of pending commands in FIFO order
 */
export async function getPendingCommands(organizationId) {
  try {
    const allCommands = await indexedDBCache.getAll(STORES.OFFLINE_QUEUE, {
      organizationId,
    });

    // Filter to pending only and sort by creation time (FIFO)
    const pending = allCommands
      .filter(cmd => cmd.status === COMMAND_STATUS.PENDING || cmd.status === COMMAND_STATUS.FAILED)
      .sort((a, b) => a.createdAt - b.createdAt);

    logger.log(`[Offline] Found ${pending.length} pending commands for org ${organizationId}`);
    return pending;
  } catch (error) {
    console.error('[Offline] Failed to get pending commands:', error);
    return [];
  }
}

/**
 * Update command status (for tracking sync progress)
 *
 * @param {string} commandId - Command ID to update
 * @param {string} status - New status
 * @param {string} [error] - Error message if failed
 */
export async function updateCommandStatus(commandId, status, error = null) {
  try {
    const command = await indexedDBCache.get(STORES.OFFLINE_QUEUE, commandId);
    if (!command) {
      logger.log(`[Offline] Command not found: ${commandId}`);
      return;
    }

    const updated = {
      ...command,
      status,
      lastError: error,
      attempts: status === COMMAND_STATUS.SYNCING ? command.attempts + 1 : command.attempts,
      syncedAt: status === COMMAND_STATUS.SYNCED ? Date.now() : command.syncedAt,
    };

    await indexedDBCache.set(STORES.OFFLINE_QUEUE, commandId, updated, {
      organizationId: command.organizationId,
    });

    logger.log(`[Offline] Updated command ${commandId} status: ${status}`);
  } catch (error) {
    console.error('[Offline] Failed to update command status:', error);
  }
}

/**
 * Clear synced commands from the queue
 *
 * @param {Array<string>} commandIds - Array of command IDs to remove
 * @param {string} [reason='synced'] - Why commands were cleared (synced, conflict, permanent_failure)
 */
export async function clearCommands(commandIds, reason = 'synced') {
  try {
    const deletePromises = commandIds.map(id =>
      indexedDBCache.delete(STORES.OFFLINE_QUEUE, id)
    );
    await Promise.all(deletePromises);
    logger.log(`[Offline] Cleared ${commandIds.length} commands (reason: ${reason})`);

    // Phase 7: Telemetry for queue flush
    if (commandIds.length > 0) {
      trackEvent('offline_queue_flushed', {
        count: commandIds.length,
        reason,
      });
    }
  } catch (error) {
    console.error('[Offline] Failed to clear commands:', error);
  }
}

/**
 * Get count of pending commands (for UI indicators)
 *
 * @param {string} organizationId - Organization to check
 * @returns {Promise<number>} - Number of pending commands
 */
export async function getPendingCommandCount(organizationId) {
  const pending = await getPendingCommands(organizationId);
  return pending.length;
}

/**
 * Clear all commands for an organization (use with caution)
 *
 * @param {string} organizationId - Organization to clear
 */
export async function clearAllCommands(organizationId) {
  try {
    await indexedDBCache.clear(STORES.OFFLINE_QUEUE, organizationId);
    logger.log(`[Offline] Cleared all commands for org ${organizationId}`);
  } catch (error) {
    console.error('[Offline] Failed to clear all commands:', error);
  }
}

/**
 * Phase 7: Mark command as having a conflict (server version wins)
 * Used when a deal was modified on server while offline edit was queued
 *
 * @param {string} commandId - Command that had conflict
 * @param {object} serverVersion - The server's version of the data
 */
export async function markCommandConflict(commandId, serverVersion = null) {
  try {
    const command = await indexedDBCache.get(STORES.OFFLINE_QUEUE, commandId);
    if (!command) return;

    const updated = {
      ...command,
      status: COMMAND_STATUS.SYNCED, // Mark as "synced" since server version wins
      hadConflict: true,
      serverVersion,
      resolvedAt: Date.now(),
    };

    await indexedDBCache.set(STORES.OFFLINE_QUEUE, commandId, updated, {
      organizationId: command.organizationId,
    });

    // Phase 7: Telemetry for conflict
    trackEvent('offline_queue_conflict', {
      commandType: command.type,
      commandId,
      dealId: command.payload?.dealId,
    });

    addBreadcrumb('Offline command conflict resolved', {
      category: 'offline',
      data: { type: command.type, commandId, resolution: 'server_wins' },
    });

    logger.log(`[Offline] Conflict resolved for command ${commandId} (server version wins)`);
  } catch (error) {
    console.error('[Offline] Failed to mark command conflict:', error);
  }
}

/**
 * Phase 7: Mark command as permanently failed (exceeded max retries)
 *
 * @param {string} commandId - Command that permanently failed
 * @param {string} error - Final error message
 */
export async function markCommandPermanentFailure(commandId, error) {
  try {
    const command = await indexedDBCache.get(STORES.OFFLINE_QUEUE, commandId);
    if (!command) return;

    const updated = {
      ...command,
      status: COMMAND_STATUS.FAILED,
      permanentFailure: true,
      lastError: error,
      failedAt: Date.now(),
    };

    await indexedDBCache.set(STORES.OFFLINE_QUEUE, commandId, updated, {
      organizationId: command.organizationId,
    });

    // Phase 7: Telemetry for permanent failure
    trackEvent('offline_queue_permanent_failure', {
      commandType: command.type,
      commandId,
      attempts: command.attempts,
      error,
    });

    addBreadcrumb('Offline command permanently failed', {
      category: 'offline',
      level: 'error',
      data: { type: command.type, commandId, attempts: command.attempts },
    });

    logger.log(`[Offline] Command ${commandId} permanently failed after ${command.attempts} attempts`);
  } catch (err) {
    console.error('[Offline] Failed to mark permanent failure:', err);
  }
}

/**
 * Phase 7: Get commands for a specific deal (for pending sync indicator)
 *
 * @param {string} organizationId - Organization context
 * @param {string} dealId - Deal to check
 * @returns {Promise<Array>} - Pending commands for this deal
 */
export async function getPendingCommandsForDeal(organizationId, dealId) {
  const pending = await getPendingCommands(organizationId);
  return pending.filter(cmd => cmd.payload?.dealId === dealId);
}

/**
 * Phase 7: Check if a deal has pending offline changes
 *
 * @param {string} organizationId - Organization context
 * @param {string} dealId - Deal to check
 * @returns {Promise<boolean>} - True if deal has pending changes
 */
export async function hasPendingChanges(organizationId, dealId) {
  const pending = await getPendingCommandsForDeal(organizationId, dealId);
  return pending.length > 0;
}

/**
 * Phase 7: Get all deals with pending changes (for batch indicator)
 *
 * @param {string} organizationId - Organization context
 * @returns {Promise<Set<string>>} - Set of deal IDs with pending changes
 */
export async function getDealsWithPendingChanges(organizationId) {
  const pending = await getPendingCommands(organizationId);
  const dealIds = new Set();

  for (const cmd of pending) {
    if (cmd.payload?.dealId) {
      dealIds.add(cmd.payload.dealId);
    }
    // For CREATE_DEAL, use the localId if available
    if (cmd.localId) {
      dealIds.add(cmd.localId);
    }
  }

  return dealIds;
}

export default {
  enqueueCommand,
  getPendingCommands,
  updateCommandStatus,
  clearCommands,
  getPendingCommandCount,
  clearAllCommands,
  markCommandConflict,
  markCommandPermanentFailure,
  getPendingCommandsForDeal,
  hasPendingChanges,
  getDealsWithPendingChanges,
  OFFLINE_COMMAND_TYPES,
  COMMAND_STATUS,
};
