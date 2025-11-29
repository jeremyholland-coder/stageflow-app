import React from 'react';
import { Settings, Clock, CheckCircle } from 'lucide-react';

/**
 * Maintenance Mode Component
 *
 * Shown when the app is undergoing planned maintenance or upgrades.
 * Controlled via environment variable: VITE_MAINTENANCE_MODE=true
 *
 * Features:
 * - Professional, reassuring design
 * - Estimated time (optional)
 * - Status updates
 * - Contact information
 */

export const MaintenanceMode = ({
  estimatedTime = null,
  message = "We're upgrading StageFlow to serve you better",
  showStatus = true
}) => {
  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
      <div className="max-w-2xl w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <img
              src="/apple-touch-icon.png?v=12"
              alt="StageFlow"
              className="h-12 w-auto"
              style={{
                imageRendering: 'crisp-edges',
                filter: 'contrast(1.05) saturate(1.1)'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-teal-500 to-teal-600 bg-clip-text text-transparent">
              StageFlow
            </h1>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-gradient-to-br from-gray-900 to-black rounded-2xl shadow-2xl border border-teal-500/30 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-gray-800 via-gray-900 to-teal-900 p-8 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur-sm rounded-full mb-4">
              <Settings className="w-10 h-10 text-white animate-spin" style={{ animationDuration: '3s' }} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Scheduled Maintenance
            </h2>
            <p className="text-white/90 text-lg">
              {message}
            </p>
          </div>

          {/* Content */}
          <div className="p-8 space-y-6">
            {/* Estimated Time */}
            {estimatedTime && (
              <div className="flex items-center gap-3 p-4 bg-teal-500/10 border border-teal-500/30 rounded-lg">
                <Clock className="w-5 h-5 text-teal-400 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-white">
                    Estimated Completion
                  </p>
                  <p className="text-sm text-gray-400">
                    {estimatedTime}
                  </p>
                </div>
              </div>
            )}

            {/* Status Updates */}
            {showStatus && (
              <div className="space-y-3">
                <h3 className="font-semibold text-white">
                  What we're doing:
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-gray-400">
                      Deploying performance improvements
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-gray-400">
                      Enhancing security features
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-gray-400">
                      Improving user experience
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Reassurance */}
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-200">
                <strong>Don't worry!</strong> All your data is safe and secure. We'll be back online shortly.
              </p>
            </div>

            {/* Contact */}
            <div className="text-center pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400">
                Questions? Contact us at{' '}
                <a
                  href="mailto:support@startupstage.com"
                  className="text-teal-400 hover:underline font-medium hover:text-teal-300 transition"
                >
                  support@startupstage.com
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-400">
            Thank you for your patience and trust in StageFlow
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * HOC to wrap app with maintenance mode check
 */
export const withMaintenanceMode = (Component) => {
  return (props) => {
    const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

    if (isMaintenanceMode) {
      return <MaintenanceMode />;
    }

    return <Component {...props} />;
  };
};
