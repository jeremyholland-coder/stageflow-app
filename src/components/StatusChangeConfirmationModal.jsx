import React from 'react';
import { X, AlertTriangle, TrendingDown } from 'lucide-react';

export const StatusChangeConfirmationModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  dealName,
  currentStatus,
  targetStage 
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
  };

  // Use proper conditional classes instead of template literals
  const isWon = currentStatus === 'won';
  
  const bgColor = isWon 
    ? 'bg-emerald-100 dark:bg-emerald-900/30' 
    : 'bg-red-100 dark:bg-red-900/30';
    
  const borderColor = isWon
    ? 'border-emerald-200 dark:border-emerald-800'
    : 'border-red-200 dark:border-red-800';
    
  const iconColor = isWon
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
    
  const textPrimaryColor = isWon
    ? 'text-emerald-900 dark:text-emerald-100'
    : 'text-red-900 dark:text-red-100';
    
  const textSecondaryColor = isWon
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-red-700 dark:text-red-300';

  const StatusIcon = isWon ? TrendingDown : AlertTriangle;

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 md:p-4">
      <div className="modal-content bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-none md:rounded-2xl w-full md:max-w-md h-full md:h-auto max-h-none md:max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isWon ? 'bg-emerald-500/20 ring-2 ring-emerald-500/10' : 'bg-red-500/20 ring-2 ring-red-500/10'
            }`}>
              <StatusIcon className={`w-6 h-6 ${isWon ? 'text-emerald-400' : 'text-red-400'}`} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                Change Deal Status?
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                {dealName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition touch-target rounded-lg"
            aria-label="Close status change confirmation"
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>

        {/* Warning Message */}
        <div className={`rounded-xl p-4 mb-6 border ${
          isWon ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className="flex gap-3">
            <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isWon ? 'text-emerald-400' : 'text-red-400'}`} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">
                This deal is currently marked as <span className="font-bold capitalize">"{currentStatus}"</span>.
              </p>
              <p className="text-sm text-gray-300">
                Moving it to "<span className="font-semibold capitalize">{targetStage}</span>" will change its status to <span className="font-bold">"Active"</span>.
              </p>
              <p className="text-sm font-medium text-gray-300">
                ⚠️ This will affect your dashboard statistics and win/loss metrics.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 min-h-touch border border-gray-700 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800/50 font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            title={`Move ${dealName} to ${targetStage} stage`}
            className="flex-1 px-6 py-3 min-h-touch bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold transition shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            Move to {targetStage}
          </button>
        </div>

        {/* Help Text */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-xs text-center text-gray-400">
            Tip: You can always manually change the status back to {currentStatus} in the deal details if needed.
          </p>
        </div>
      </div>
    </div>
  );
};
