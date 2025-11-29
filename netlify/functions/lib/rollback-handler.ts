/**
 * Rollback Failure Handler
 * Logs critical rollback failures for admin cleanup
 */

import { createClient } from "@supabase/supabase-js";

interface FailedOperationLog {
  organizationId: string;
  operationType: string;
  entityType: string;
  entityId?: string;
  errorMessage: string;
  context?: Record<string, any>;
}

/**
 * Log a failed rollback operation for admin attention
 * This is CRITICAL - if rollback fails, deal/data is in inconsistent state
 */
export async function logFailedRollback(
  supabase: any,
  operation: FailedOperationLog
): Promise<void> {
  try {
    const { error } = await supabase
      .from("failed_operations")
      .insert([{
        organization_id: operation.organizationId,
        operation_type: operation.operationType,
        entity_type: operation.entityType,
        entity_id: operation.entityId,
        error_message: operation.errorMessage,
        context: operation.context,
        attempted_at: new Date().toISOString()
      }]);

    if (error) {
      // Can't even log the failure - this is critical
      console.error("❌ CRITICAL: Failed to log rollback failure:", error);
      console.error("Original operation:", operation);
    } else {
      console.error("⚠️ Rollback failed - logged for admin cleanup:", operation);
    }
  } catch (logError) {
    console.error("❌ CRITICAL: Exception logging rollback failure:", logError);
    console.error("Original operation:", operation);
  }
}

/**
 * Safely execute a rollback operation
 * Logs failure if rollback itself fails
 */
export async function safeRollback<T>(
  rollbackFn: () => Promise<T>,
  failureLog: FailedOperationLog,
  supabase: any
): Promise<{ success: boolean; error?: Error }> {
  try {
    await rollbackFn();
    return { success: true };
  } catch (rollbackError: any) {
    console.error("❌ Rollback failed:", rollbackError);
    
    // Log this critical failure
    await logFailedRollback(supabase, {
      ...failureLog,
      errorMessage: `Rollback failed: ${rollbackError.message}`,
      context: {
        ...failureLog.context,
        rollbackError: rollbackError.message,
        rollbackStack: rollbackError.stack
      }
    });
    
    return { success: false, error: rollbackError };
  }
}

export default { logFailedRollback, safeRollback };
