import React, { useState } from 'react';
import { X, Star, MessageSquare, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api-client';

const CATEGORIES = [
  { id: 'bug', label: 'Bug Report', emoji: '🐛' },
  { id: 'feature', label: 'Feature Request', emoji: '💡' },
  { id: 'love', label: 'Love it!', emoji: '❤️' },
  { id: 'confused', label: 'Confused', emoji: '🤔' },
  { id: 'other', label: 'Other', emoji: '💬' },
];

export const FeedbackWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // SIMPLIFIED: Widget is always visible - onboarding spotlight system handles visibility

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Must have at least rating OR message
    if (!rating && !message.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // CRITICAL FIX v1.7.59: Use backend endpoint with HttpOnly cookie authentication
      // PROBLEM: Direct Supabase calls depend on client-side session being set
      // SOLUTION: Use backend endpoint like create-checkout-session, api-keys-create
      // This fixes 401 "not authenticated" errors when session not set in client
      const { data } = await api.post('submit-feedback', {
        rating: rating || null,
        category: category || 'other',
        message: message.trim() || null,
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
      }, {
        timeout: 10000, // 10s timeout
        maxRetries: 1 // Only 1 retry for user-initiated action
      });

      if (!data.success) {
        throw new Error(data.error || 'Failed to submit feedback');
      }

      // CRITICAL FIX v1.7.63: Email is now sent atomically in submit-feedback backend
      // No separate call needed - backend handles storage + email in single request
      // data.emailSent indicates if email was sent successfully (non-blocking)
      if (data.emailSent === false) {
        console.warn('Feedback stored but email notification failed');
      }

      // Show success
      setShowSuccess(true);
      setRating(0);
      setCategory('');
      setMessage('');

      // Auto-close after 2 seconds
      setTimeout(() => {
        setShowSuccess(false);
        setIsOpen(false);
      }, 2000);

    } catch (error) {
      console.error('Error submitting feedback:', error);

      // Use enhanced error message from API client
      const userMessage = error.userMessage || error.message || 'Failed to submit feedback. Please try again.';
      alert(userMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setIsOpen(false);
      setShowSuccess(false);
    }
  };

  return (
    <>
      {/* Feedback Tab - Fixed on right side (hidden on mobile) - PREMIUM DESIGN */}
      {/* P0 FIX 2025-12-09: Changed z-index from 185 to 50 to render BELOW modals (z-[70]+) */}
      {/* This prevents the FEEDBACK tab from appearing above DealDetailsModal/LostReasonModal */}
      <button
        onClick={() => setIsOpen(true)}
        className="hidden sm:flex fixed top-1/2 right-0 -translate-y-1/2 bg-gradient-to-br from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 text-white px-3 py-4 sm:py-6 rounded-l-xl shadow-lg hover:shadow-xl border-l border-t border-b border-teal-500/30 z-50 group flex-col items-center transition-all duration-200"
        style={{
          writingMode: 'vertical-rl',
          transform: 'translateY(-50%)',
          willChange: 'transform, box-shadow'
        }}
        aria-label="Open feedback panel"
        data-feedback-button="true"
      >
        <MessageSquare className="w-4 h-4 inline-block mr-2" style={{ writingMode: 'horizontal-tb', pointerEvents: 'none' }} />
        <span className="font-semibold text-sm tracking-wider" style={{ pointerEvents: 'none' }}>FEEDBACK</span>
      </button>

      {/* Mobile Feedback Button - Floating at bottom-right corner - PREMIUM DESIGN */}
      {/* P0 FIX 2025-12-09: Changed z-index from 185 to 50 to render BELOW modals (z-[70]+) */}
      <button
        onClick={() => setIsOpen(true)}
        className="sm:hidden fixed bottom-6 right-6 bg-teal-500 hover:bg-teal-600 text-white p-4 rounded-full shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 z-50 hover:scale-110 active:scale-95 transition-all duration-200"
        style={{
          minWidth: '56px',
          minHeight: '56px'
        }}
        aria-label="Open feedback panel"
        data-feedback-button="true"
      >
        <MessageSquare className="w-6 h-6" style={{ pointerEvents: 'none' }} />
      </button>

      {/* Slide-out Panel */}
      {isOpen && (
        <>
          {/* Backdrop - PREMIUM GLASS DESIGN */}
          <div
            className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[190] transition-opacity duration-300"
            onClick={handleClose}
          />

          {/* Panel - MOBILE: Centered modal with padding, DESKTOP: Right slide-out - PREMIUM DESIGN */}
          <div className="fixed inset-4 sm:top-0 sm:right-0 sm:inset-auto sm:h-screen sm:w-full sm:max-w-md bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 shadow-2xl z-[200] flex flex-col animate-in slide-in-from-right duration-300 rounded-2xl sm:rounded-l-2xl sm:rounded-r-none overflow-hidden">
            {/* Header - Mobile safe area aware - PREMIUM DESIGN */}
            <div className="bg-gray-800/50 border-b border-gray-700 p-4 sm:p-6 text-white">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg sm:text-xl font-bold">Share Your Feedback</h2>
                <button
                  onClick={handleClose}
                  className="p-2.5 hover:bg-white/20 rounded-lg transition-colors active:scale-95 -mr-1"
                  style={{ minWidth: '44px', minHeight: '44px' }}
                  aria-label="Close feedback panel"
                  disabled={isSubmitting}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-white/90 text-xs sm:text-sm">We read every submission and use your feedback to improve StageFlow</p>
            </div>

            {/* Success Message - PREMIUM DESIGN */}
            {showSuccess ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <div className="w-20 h-20 bg-emerald-500/20 ring-2 ring-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Thank You!</h3>
                  <p className="text-gray-300">Your feedback has been submitted.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Form Content */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
                  {/* Star Rating - PREMIUM DESIGN */}
                  <div>
                    <label className="block text-sm font-semibold text-white mb-3">
                      How would you rate StageFlow? (optional)
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          className="transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-8 h-8 ${
                              star <= (hoverRating || rating)
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-gray-600'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    {rating > 0 && (
                      <p className="text-xs text-gray-300 mt-2">
                        {rating === 5 && "Amazing! 🎉"}
                        {rating === 4 && "Great! 👍"}
                        {rating === 3 && "Good"}
                        {rating === 2 && "Could be better"}
                        {rating === 1 && "Needs improvement"}
                      </p>
                    )}
                  </div>

                  {/* Category Tags - PREMIUM DESIGN */}
                  <div>
                    <label className="block text-sm font-semibold text-white mb-3">
                      What's this about? (optional)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(category === cat.id ? '' : cat.id)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            category === cat.id
                              ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20 scale-105'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                          }`}
                        >
                          <span className="mr-1">{cat.emoji}</span>
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message - PREMIUM DESIGN */}
                  <div>
                    <label htmlFor="feedback-message" className="block text-sm font-semibold text-white mb-3">
                      Tell us more (optional)
                    </label>
                    <textarea
                      id="feedback-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="What's on your mind? Feature requests, bugs, or just saying hi - we want to hear it!"
                      className="w-full h-32 px-4 py-3 rounded-xl border border-gray-700 bg-gray-800/50 text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none hover:border-gray-600 transition-colors"
                      disabled={isSubmitting}
                      aria-invalid={!rating && !message.trim() ? 'true' : 'false'}
                      aria-describedby={!rating && !message.trim() ? 'feedback-error feedback-help' : 'feedback-help'}
                    />
                    <p id="feedback-help" className="text-xs text-gray-400 mt-2">
                      Your feedback helps us build a better product
                    </p>
                  </div>
                </form>

                {/* Footer with Submit Button - PREMIUM DESIGN */}
                <div className="p-4 sm:p-6 border-t border-gray-700">
                  <button
                    type="submit"
                    onClick={handleSubmit}
                    disabled={isSubmitting || (!rating && !message.trim())}
                    className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Sending Feedback...
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Submit Feedback
                      </>
                    )}
                  </button>
                  {!rating && !message.trim() && (
                    <p className="text-xs text-center text-gray-400 mt-2">
                      Please add a rating or message
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
};
