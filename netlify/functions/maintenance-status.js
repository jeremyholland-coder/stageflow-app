/**
 * Maintenance Status Endpoint
 *
 * Returns the current maintenance mode status for zero-downtime deployments.
 *
 * Usage:
 * 1. Set environment variable: VITE_MAINTENANCE_MODE=true in Netlify to enable
 * 2. App checks this endpoint every 60 seconds
 * 3. Users see maintenance screen within 60 seconds without refresh
 *
 * Response:
 * {
 *   enabled: boolean,
 *   message: string (optional),
 *   estimatedTime: string (optional)
 * }
 */

export default async (req, context) => {
  try {
    // Check if maintenance mode is enabled via environment variable
    const maintenanceEnabled = process.env.VITE_MAINTENANCE_MODE === 'true';

    // Optional: Custom message and estimated time
    const message = process.env.VITE_MAINTENANCE_MESSAGE || "We're upgrading StageFlow to serve you better";
    const estimatedTime = process.env.VITE_MAINTENANCE_ETA || null;

    // Log for monitoring
    if (maintenanceEnabled) {
      console.log('[Maintenance] Mode is ENABLED');
    }

    return new Response(JSON.stringify({
      enabled: maintenanceEnabled,
      message: message,
      estimatedTime: estimatedTime
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      }
    });

  } catch (error) {
    console.error('[Maintenance] Error checking status:', error);

    // FAIL OPEN: If this endpoint errors, return disabled
    // This ensures users can access the app even if this check fails
    return new Response(JSON.stringify({
      enabled: false,
      error: 'Status check failed - failing open'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  }
};

export const config = {
  path: "/api/maintenance-status"
};
