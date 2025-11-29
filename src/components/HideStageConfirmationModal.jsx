import React from 'react';
import { X, EyeOff, AlertCircle } from 'lucide-react';

/**
 * Confirmation modal for hiding a stage from the Kanban view
 * Warns user about the implications of hiding a stage
 */
export const HideStageConfirmationModal = ({ isOpen, onClose, onConfirm, stageName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-amber-500/20 rounded-xl ring-2 ring-amber-500/10 flex items-center justify-center">
              <EyeOff className="w-6 h-6 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white">
              Hide Stage?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-white">
            Are you sure you want to hide the <strong>"{stageName}"</strong> stage from your Kanban view?
          </p>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-300">
                <p className="font-semibold mb-1 text-white">What happens when you hide a stage:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>The stage column won't appear in your Kanban view</li>
                  <li>Deals in this stage will still exist in the system</li>
                  <li>You can unhide it anytime in Settings → Pipeline</li>
                  <li>Other team members will still see this stage</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700">
          <button
            onClick={onClose}
            title="Cancel and keep stage visible"
            className="px-4 py-3 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50 transition font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            title={`Hide ${stageName} from your Kanban view`}
            className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white transition font-medium flex items-center gap-2 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            <EyeOff className="w-4 h-4" />
            Hide Stage
          </button>
        </div>
      </div>
    </div>
  );
};
