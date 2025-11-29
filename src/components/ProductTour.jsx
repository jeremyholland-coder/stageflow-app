import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowRight, Check } from 'lucide-react';
import { useApp } from './AppShell';
import { VIEWS } from '../lib/supabase';

const TOUR_STEPS = [
  {
    id: 'pipeline-board',
    title: 'Your Visual Pipeline',
    description: 'Drag and drop deals through stages. Each card shows real-time AI confidence scores based on YOUR win rates.',
    target: '[data-tour="pipeline-board"]',
    position: 'bottom-center',
    highlightTarget: true,
    scrollTo: true
  },
  {
    id: 'new-deal',
    title: 'Create Deals',
    description: 'Click the + button to quickly add new deals to your pipeline. Keyboard shortcut: ⌘N (Mac) or Ctrl+N (Windows/Linux)',
    target: '[data-tour="new-deal"]',
    position: 'bottom',
    highlightTarget: true,
    scrollTo: true
  },
  {
    id: 'ai-insights',
    title: 'AI-Powered Insights',
    description: 'Connect your AI LLM to unlock intelligent analysis, health scores, stage predictions, and smart recommendations for your deals.',
    target: '[data-tour="ai-insights"]',
    position: 'center',
    highlightTarget: true,
    makeVisible: true,
    scrollTo: true,
    bounce: true
  },
  {
    id: 'integrations',
    title: 'Integrations & API',
    description: 'Connect AI providers, set up webhooks, and configure API access to integrate StageFlow with your tools.',
    target: null, // Will navigate to integrations view
    view: VIEWS.INTEGRATIONS,
    position: 'center',
    highlightTarget: false
  },
  {
    id: 'settings',
    title: 'Settings & Profile',
    description: 'Manage your account settings, billing, notifications, and team members. Customize your experience.',
    target: '[data-tour="settings-button"]',
    position: 'bottom-right',
    highlightTarget: true
  }
];

export const ProductTour = ({ isActive, onComplete }) => {
  const { setActiveView } = useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [arrowPosition, setArrowPosition] = useState({ left: 0, show: false, direction: 'up' });
  const [isVisible, setIsVisible] = useState(false);

  // Track highlighted elements for cleanup
  const highlightedElementRef = useRef(null);
  const navigationTimerRef = useRef(null);
  const positionTimerRef = useRef(null);

  // Cleanup function to remove all classes
  const cleanupHighlight = useCallback(() => {
    if (highlightedElementRef.current) {
      highlightedElementRef.current.classList.remove('tour-highlight', 'tour-visible', 'tour-bounce');
      highlightedElementRef.current = null;
    }
  }, []);

  // Cleanup all timers
  const cleanupTimers = useCallback(() => {
    if (navigationTimerRef.current) {
      clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    }
    if (positionTimerRef.current) {
      clearTimeout(positionTimerRef.current);
      positionTimerRef.current = null;
    }
  }, []);

  // CIRCULAR DEP FIX: Reset tour when becoming inactive (separate effect)
  useEffect(() => {
    if (!isActive) {
      setCurrentStep(0);
      setIsVisible(false);
      cleanupHighlight();
      cleanupTimers();
    }
  }, [isActive, cleanupHighlight, cleanupTimers]); // FIXED: Removed currentStep from deps

  // Main effect for step changes
  useEffect(() => {
    if (!isActive) return; // FIXED: Early return without setCurrentStep

    const step = TOUR_STEPS[currentStep];

    // Cleanup previous highlight before applying new one
    cleanupHighlight();
    cleanupTimers();

    // For steps that navigate to new views
    if (step.view) {
      setIsVisible(true);
      setPosition({
        top: window.innerHeight / 2 - 110,
        left: window.innerWidth / 2 - 190
      });

      // Navigate after showing the card
      navigationTimerRef.current = setTimeout(() => {
        setActiveView(step.view);
      }, 100);

      return () => {
        cleanupTimers();
      };
    }

    // For regular steps with targets
    positionTimerRef.current = setTimeout(() => {
      if (step.scrollTo && step.target) {
        scrollToTarget(step.target);
      }
      updatePosition();
      setIsVisible(true);
    }, 450); // Smoother entrance timing (v1.7.54)

    return () => {
      cleanupTimers();
    };
  }, [isActive, currentStep, setActiveView, cleanupHighlight, cleanupTimers]); // currentStep still in deps but no setter inside

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupHighlight();
      cleanupTimers();
    };
  }, [cleanupHighlight, cleanupTimers]);

  const scrollToTarget = (selector) => {
    if (!selector) return;
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const updatePosition = () => {
    const step = TOUR_STEPS[currentStep];
    const tooltipWidth = 380;
    const tooltipHeight = 260; // Increased to account for actual content height
    const navbarHeight = 80;
    const padding = 20;
    const arrowSize = 16; // Size of the arrow pointer

    // If position is center, always center in viewport regardless of target
    if (step.position === 'center') {
      setPosition({
        top: window.innerHeight / 2 - tooltipHeight / 2,
        left: window.innerWidth / 2 - tooltipWidth / 2
      });

      // No arrow for centered tooltips
      setArrowPosition({ left: 0, show: false, direction: 'up' });

      // Still apply highlight to target element if it exists
      const element = step.target ? document.querySelector(step.target) : null;
      if (element && step.highlightTarget) {
        element.classList.add('tour-highlight');
        if (step.makeVisible) {
          element.classList.add('tour-visible');
        }
        if (step.bounce) {
          element.classList.add('tour-bounce');
        }
        highlightedElementRef.current = element;
      }
      return;
    }

    // For all other positions, need the target element
    const element = step.target ? document.querySelector(step.target) : null;

    if (!element && step.target) {
      console.warn(`Tour target not found: ${step.target}`);
      setPosition({
        top: window.innerHeight / 2 - tooltipHeight / 2,
        left: window.innerWidth / 2 - tooltipWidth / 2
      });
      setArrowPosition({ left: 0, show: false, direction: 'up' });
      return;
    }

    if (element) {
      const rect = element.getBoundingClientRect();
      let top, left;
      let arrowDirection = 'up';

      switch (step.position) {
        case 'bottom':
          top = rect.bottom + padding + 10;
          left = rect.right - tooltipWidth - 20;
          arrowDirection = 'up';
          break;

        case 'bottom-center':
          // Position below the element, centered horizontally
          top = rect.bottom + padding + 10;
          left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
          arrowDirection = 'up';
          break;

        case 'bottom-left':
          top = rect.bottom + padding;
          left = rect.right - tooltipWidth;
          arrowDirection = 'up';
          break;

        case 'bottom-right':
          top = rect.bottom + padding;
          left = rect.left;
          arrowDirection = 'up';
          break;

        case 'top':
          top = rect.top - tooltipHeight - padding;
          left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
          arrowDirection = 'down';
          break;

        default:
          top = rect.bottom + padding;
          left = rect.left;
          arrowDirection = 'up';
      }

      // Calculate original left position before clamping
      const originalLeft = left;

      // Keep tooltip on screen
      left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));
      top = Math.max(navbarHeight + padding, Math.min(top, window.innerHeight - tooltipHeight - padding));

      // Calculate arrow position - should point to center of target element
      const targetCenterX = rect.left + (rect.width / 2);
      let arrowLeft = targetCenterX - left - (arrowSize / 2);

      // Keep arrow within tooltip bounds (with some padding from edges)
      arrowLeft = Math.max(arrowSize, Math.min(arrowLeft, tooltipWidth - arrowSize * 2));

      setPosition({ top, left });
      setArrowPosition({
        left: arrowLeft,
        show: true,
        direction: arrowDirection
      });

      // Apply highlight classes and store reference
      if (step.highlightTarget) {
        element.classList.add('tour-highlight');
        if (step.makeVisible) {
          element.classList.add('tour-visible');
        }
        if (step.bounce) {
          element.classList.add('tour-bounce');
        }
        highlightedElementRef.current = element;
      }
    } else {
      // Fallback to center
      setPosition({
        top: window.innerHeight / 2 - tooltipHeight / 2,
        left: window.innerWidth / 2 - tooltipWidth / 2
      });
      setArrowPosition({ left: 0, show: false, direction: 'up' });
    }
  };

  const handleNext = useCallback(() => {
    cleanupHighlight();

    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  }, [currentStep, cleanupHighlight]);

  const handlePrevious = useCallback(() => {
    cleanupHighlight();

    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep, cleanupHighlight]);

  const handleComplete = useCallback(() => {
    cleanupHighlight();
    cleanupTimers();
    setIsVisible(false);

    // Small delay before completing to ensure cleanup
    setTimeout(() => {
      setActiveView(VIEWS.DASHBOARD);
      onComplete();
    }, 100);
  }, [cleanupHighlight, cleanupTimers, setActiveView, onComplete]);

  if (!isActive || !isVisible) return null;

  const step = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Backdrop with spotlight effect */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999]"
        style={{ pointerEvents: 'none' }}
      />

      {/* Tour Tooltip */}
      <div
        className="fixed z-[10000] w-96 bg-white dark:bg-[#0D1F2D] rounded-2xl shadow-2xl border-2 border-[#1ABC9C] overflow-hidden transition-all duration-300"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          pointerEvents: 'auto',
          maxHeight: '90vh'
        }}
      >
        {/* Arrow pointer - points to target element */}
        {arrowPosition.show && arrowPosition.direction === 'up' && (
          <div
            className="absolute -top-2 w-4 h-4 bg-[#1ABC9C]"
            style={{
              left: `${arrowPosition.left}px`,
              clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
              filter: 'drop-shadow(0 -2px 4px rgba(0, 0, 0, 0.1))'
            }}
          />
        )}
        {arrowPosition.show && arrowPosition.direction === 'down' && (
          <div
            className="absolute -bottom-2 w-4 h-4 bg-white dark:bg-[#0D1F2D]"
            style={{
              left: `${arrowPosition.left}px`,
              clipPath: 'polygon(50% 100%, 0% 0%, 100% 0%)',
              filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1))'
            }}
          />
        )}

        {/* Gradient header */}
        <div className="bg-gradient-to-br from-[#2C3E50] via-[#34495E] to-[#1ABC9C] p-6 text-white">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 backdrop-blur-sm text-white rounded-full flex items-center justify-center text-sm font-bold">
                {currentStep + 1}
              </div>
              <span className="text-sm font-medium text-white/90">
                Step {currentStep + 1} of {TOUR_STEPS.length}
              </span>
            </div>
            <button
              onClick={handleComplete}
              className="p-1.5 hover:bg-white/20 rounded-lg transition"
              aria-label="Close tour"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <h3 className="text-xl font-bold mb-1">
            {step.title}
          </h3>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mb-6 leading-relaxed">
            {step.description}
          </p>

          {/* Progress dots and navigation */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {TOUR_STEPS.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-2 rounded-full transition-all ${
                    idx === currentStep
                      ? 'w-8 bg-[#1ABC9C]'
                      : idx < currentStep
                      ? 'w-2 bg-[#1ABC9C]/50'
                      : 'w-2 bg-gray-300 dark:bg-gray-600'
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {currentStep > 0 && (
                <button
                  onClick={handlePrevious}
                  title="Go to previous tour step"
                  className="px-4 py-2 text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#1A1A1A] dark:hover:text-[#E0E0E0] transition rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Previous Step
                </button>
              )}
              <button
                onClick={handleNext}
                title={isLastStep ? "Complete the tour and start using StageFlow" : "Go to next tour step"}
                className="px-5 py-2 bg-[#1ABC9C] hover:bg-[#16A085] text-white rounded-lg font-semibold flex items-center gap-2 transition shadow-md hover:shadow-lg"
              >
                {isLastStep ? (
                  <>
                    <Check className="w-4 h-4" aria-hidden="true" />
                    Finish Tour
                  </>
                ) : (
                  <>
                    Next Step
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .tour-highlight {
          position: relative;
          z-index: 9998 !important;
          box-shadow: 0 0 0 4px rgba(26, 188, 156, 0.6), 0 0 0 8px rgba(26, 188, 156, 0.3), 0 0 60px rgba(26, 188, 156, 0.4) !important;
          border-radius: 16px;
          pointer-events: auto !important;
          transition: all 0.3s ease-in-out;
        }

        .tour-visible {
          opacity: 1 !important;
          background-color: white !important;
          filter: none !important;
        }

        .dark .tour-visible {
          background-color: #0D1F2D !important;
        }

        .tour-bounce {
          animation: tour-bounce 1.5s ease-in-out infinite;
        }

        @keyframes tour-bounce {
          0%, 100% {
            transform: translateY(0) scale(1);
          }
          50% {
            transform: translateY(-10px) scale(1.03);
          }
        }
      `}</style>
    </>
  );
};
