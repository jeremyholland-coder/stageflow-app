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
 *
 * Usage:
 * - When offline: enqueueCommand({ type: 'update_deal', payload: {...} })
 * - When online: getPendingCommands() → sync each → clearCommands([ids])
 *
 * @author StageFlow Engineering
 * @date November 25, 2025
 */

import { indexedDBCache, STORES } from './indexeddb-cache';
import { logger } from './logger';

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
      status: COMMAND_STATUS.PENDING,
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
    };

    await indexedDBCache.set(STORES.OFFLINE_QUEUE, id, queueEntry, {
      organizationId: command.organizationId,
      // No TTL - commands persist until synced
    });

    logger.log(`[Offline] Queued command: ${command.type}`, { id, payload: command.payload });
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
 */
export async function clearCommands(commandIds) {
  try {
    const deletePromises = commandIds.map(id =>
      indexedDBCache.delete(STORES.OFFLINE_QUEUE, id)
    );
    await Promise.all(deletePromises);
    logger.log(`[Offline] Cleared ${commandIds.length} synced commands`);
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

export default {
  enqueueCommand,
  getPendingCommands,
  updateCommandStatus,
  clearCommands,
  getPendingCommandCount,
  clearAllCommands,
  OFFLINE_COMMAND_TYPES,
  COMMAND_STATUS,
};
