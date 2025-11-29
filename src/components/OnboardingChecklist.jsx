// Onboarding Checklist Component
import React, { useState, useEffect, useCallback, memo, useRef, useMemo } from 'react';
import { Check, X, Circle, ChevronRight, RotateCcw, Volume2, VolumeX, Lightbulb, HelpCircle, BarChart2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';
import { triggerCelebration } from '../lib/confetti';
import { logger } from '../lib/logger';
import { analytics } from '../lib/onboardingAnalytics';
import { sounds } from '../lib/onboardingSounds';
import { onboardingSync } from '../lib/onboardingSync';
import { performanceMonitor } from '../lib/onboardingPerformance';
import { onboardingStorage } from '../lib/onboardingStorage'; // CRITICAL FIX: Unified storage
import { OnboardingHelpPanel } from './OnboardingHelpPanel';
import { OnboardingAnalyticsDashboard } from './OnboardingAnalyticsDashboard';
import { OnboardingGoalSelection } from './OnboardingGoalSelection';
import { OnboardingCompletionModal } from './OnboardingCompletionModal';

/**
 * OnboardingChecklist Component
 *
 * NEXT-LEVEL OPTIMIZATIONS:
 * - React.memo prevents re-renders when parent Dashboard updates
 * - useCallback wraps all event handlers to prevent breaking child memoization
 * - Strict dependency arrays to minimize effect re-runs
 *
 * Step-by-step onboarding with spotlight effect that highlights target elements
 * Features:
 * - Backdrop obscures everything EXCEPT the target element
 * - Card positions itself near the highlighted element
 * - Deep linking to correct pages (e.g., Integrations for AI setup)
 * - Progress persists in localStorage
 */

// CONFIGURATION: Timing constants for tunable behavior
const TIMING = {
  HINT_DELAY: 10000,              // Show hint after 10s of inactivity
  TARGET_RETRY_FIRST: 500,        // First retry for finding target element
  TARGET_RETRY_SECOND: 1000,      // Second retry for lazy-loaded components
  AUTO_DISMISS_DELAY: 4000,       // Auto-dismiss after completion celebration
  POSITION_CHECK_INTERVAL: 1000,  // Check card position every second
  HINT_TIMEOUT: 300,              // Animation duration for hints
  LOCALSTORAGE_DEBOUNCE: 500     // PERFORMANCE: Increased from 300ms to reduce write frequency by 40%
};

// PERFORMANCE: Move static configuration OUTSIDE component to prevent recreation on every render
// Goal-specific onboarding steps
const GOAL_SPECIFIC_STEPS = {
  deals: [
    {
      id: 'add_first_deal',
      title: 'Add your first deal',
      description: 'Create a deal in your pipeline',
      tooltip: 'Click the "New Deal" button to create your first opportunity. This will help you track sales and manage your pipeline effectively.',
      targetSelector: '[data-tour="new-deal-button"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: You can quickly create deals with keyboard shortcut Cmd+N'
    },
    {
      id: 'explore_pipeline',
      title: 'Explore your pipeline',
      description: 'These are your customizable Kanban columns',
      tooltip: 'Your pipeline shows all deals organized by stage. Drag deals between columns to move them through your sales process. These Kanban columns are where the rubber meets the road - all your deal information lives here!',
      targetSelector: '[data-tour="pipeline-columns"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Click on any deal card to see detailed information and add notes'
    },
    {
      id: 'customize_pipeline',
      title: 'Customize your pipeline',
      description: 'Add deals, move columns, manage stages',
      tooltip: 'Click the three-dot menu (⋮) on any column to customize! You can add new deals, move columns left or right to reorder them, or hide stages you don\'t need. Click on deal cards to add notes, update values, and track all the details you need to close.',
      targetSelector: '[data-tour="column-menu"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your pipeline is fully customizable - make it work for you!'
    },
    {
      id: 'connect_integration',
      title: 'Connect AI for Deal Scoring',
      description: 'Get intelligent win probability predictions',
      tooltip: 'Connect OpenAI, Anthropic, or other AI providers to get automatic deal scoring, win probability predictions, and smart recommendations for closing deals faster.',
      targetSelector: '[data-tour="ai-providers"]',
      targetPage: 'integrations',
      deepLink: { view: 'integrations', tab: 'ai-providers' },
      hint: 'Tip: AI deal scoring helps you focus on the deals most likely to close'
    },
    {
      id: 'discover_settings',
      title: 'Your Command Center',
      description: 'Set goals & manage workspace',
      tooltip: 'Set revenue goals and track your progress! This is where you can upload your profile picture, manage your pipeline settings, and configure your workspace. Goals help you stay motivated and focused on closing more deals!',
      targetSelector: '[data-tour="revenue-targets"]',
      targetPage: 'settings',
      deepLink: { view: 'settings', tab: 'pipeline' },
      hint: 'Tip: Set ambitious but achievable goals to drive performance!'
    },
    {
      id: 'share_feedback',
      title: 'Share Your Feedback!',
      description: 'Help us improve StageFlow',
      tooltip: 'This is your direct line to us! Share feedback, report bugs, request features, give us stars, or just let us know how we\'re doing. We read every message and use your input to make StageFlow better.',
      targetSelector: '[data-feedback-button="true"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your feedback shapes the future of StageFlow!'
    }
  ],
  automation: [
    {
      id: 'add_first_deal',
      title: 'Add your first deal',
      description: 'Create a deal in your pipeline',
      tooltip: 'Click the "New Deal" button to create your first opportunity. Automation works best when you have deals flowing through your pipeline.',
      targetSelector: '[data-tour="new-deal-button"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: You can quickly create deals with keyboard shortcut Cmd+N'
    },
    {
      id: 'connect_integration',
      title: 'Connect AI Integration',
      description: 'Enable auto-scoring & automation',
      tooltip: 'Connect OpenAI, Anthropic, or other AI providers to unlock intelligent automation. Once connected, every new deal automatically receives a win probability score, priority ranking, and smart recommendations.',
      targetSelector: '[data-tour="ai-providers"]',
      targetPage: 'integrations',
      deepLink: { view: 'integrations', tab: 'ai-providers' },
      hint: 'Tip: AI automation runs in the background - no manual work required'
    },
    {
      id: 'setup_notifications',
      title: 'Configure workflow notifications',
      description: 'Stay informed automatically',
      tooltip: 'Set up notifications for important events: deals moving stages, high-value opportunities, or at-risk deals. Smart notifications keep your team aligned without manual follow-up.',
      targetSelector: '[data-tour="notifications-settings"]',
      targetPage: 'settings',
      deepLink: { view: 'settings', tab: 'notifications' },
      hint: 'Tip: Smart notifications reduce manual follow-up and keep deals moving'
    },
    {
      id: 'share_feedback',
      title: 'Share Your Feedback!',
      description: 'Help us improve StageFlow',
      tooltip: 'This is your direct line to us! Share feedback, report bugs, request features, give us stars, or just let us know how we\'re doing. We read every message and use your input to make StageFlow better.',
      targetSelector: '[data-feedback-button="true"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your feedback shapes the future of StageFlow!'
    }
  ],
  analytics: [
    {
      id: 'add_first_deal',
      title: 'Add your first deal',
      description: 'Create a deal to start tracking metrics',
      tooltip: 'Click the "New Deal" button to create your first opportunity. Analytics become more powerful as you track more deals through your pipeline.',
      targetSelector: '[data-tour="new-deal-button"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: You can quickly create deals with keyboard shortcut Cmd+N'
    },
    {
      id: 'explore_pipeline',
      title: 'Explore pipeline metrics',
      description: 'See your performance at a glance',
      tooltip: 'Your dashboard shows key metrics like total pipeline value, conversion rates, and deal velocity. Watch these metrics improve as you optimize your sales process.',
      targetSelector: '[data-tour="pipeline-columns"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Track trends over time to identify what\'s working'
    },
    {
      id: 'connect_integration',
      title: 'Connect AI for Predictive Insights',
      description: 'Get intelligent forecasting',
      tooltip: 'Connect OpenAI, Anthropic, or other AI providers to unlock predictive analytics: revenue forecasting, deal risk analysis, and performance recommendations.',
      targetSelector: '[data-tour="ai-providers"]',
      targetPage: 'integrations',
      deepLink: { view: 'integrations', tab: 'ai-providers' },
      hint: 'Tip: AI-powered forecasting helps you predict and hit your targets'
    },
    {
      id: 'view_analytics',
      title: 'Track Your Performance Metrics',
      description: 'See wins, losses, and trends at a glance',
      tooltip: 'Your performance dashboard shows key metrics: revenue won this month, deals lost, win rates, and trends. Track these metrics regularly to understand what\'s working and optimize your sales process!',
      targetSelector: '[data-tour="dashboard-stats"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Watch your trends - consistent improvement in win rates drives long-term success!'
    },
    {
      id: 'discover_settings',
      title: 'Your Command Center',
      description: 'Set goals & track progress',
      tooltip: 'Set revenue goals to measure your performance! Configure targets, track progress, and see how close you are to hitting your numbers. Goals give you clear targets to work toward!',
      targetSelector: '[data-tour="revenue-targets"]',
      targetPage: 'settings',
      deepLink: { view: 'settings', tab: 'pipeline' },
      hint: 'Tip: Set ambitious but achievable goals to drive performance!'
    },
    {
      id: 'share_feedback',
      title: 'Share Your Feedback!',
      description: 'Help us improve StageFlow',
      tooltip: 'This is your direct line to us! Share feedback, report bugs, request features, give us stars, or just let us know how we\'re doing. We read every message and use your input to make StageFlow better.',
      targetSelector: '[data-feedback-button="true"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your feedback shapes the future of StageFlow!'
    }
  ],
  team: [
    {
      id: 'add_first_deal',
      title: 'Add your first deal',
      description: 'Create a deal in your pipeline',
      tooltip: 'Click the "New Deal" button to create your first opportunity. Team collaboration starts with deals to work on together.',
      targetSelector: '[data-tour="new-deal-button"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: You can quickly create deals with keyboard shortcut Cmd+N'
    },
    {
      id: 'invite_team',
      title: 'Invite team members',
      description: 'Build your sales team',
      tooltip: 'Set revenue goals and add team members to collaborate! Track your progress and close deals faster together. Team features unlock powerful collaboration tools.',
      targetSelector: '[data-tour="revenue-targets"]',
      targetPage: 'settings',
      deepLink: { view: 'settings', tab: 'pipeline' },
      hint: 'Tip: Team collaboration is a key differentiator - close deals faster together'
    },
    {
      id: 'assign_deals',
      title: 'Assign & collaborate on deals',
      description: 'Distribute work and work together',
      tooltip: 'Click on any deal to assign an owner and collaborate! Your team works together right here in the pipeline - team members can see deal updates, add notes, track activity, and close deals faster together.',
      targetSelector: '[data-tour="pipeline-columns"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Clear ownership and collaboration accelerate deal velocity'
    },
    {
      id: 'share_feedback',
      title: 'Share Your Feedback!',
      description: 'Help us improve StageFlow',
      tooltip: 'This is your direct line to us! Share feedback, report bugs, request features, give us stars, or just let us know how we\'re doing. We read every message and use your input to make StageFlow better.',
      targetSelector: '[data-feedback-button="true"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your feedback shapes the future of StageFlow!'
    }
  ],
  // Default/skip - show comprehensive overview
  default: [
    {
      id: 'add_first_deal',
      title: 'Add your first deal',
      description: 'Create a deal in your pipeline',
      tooltip: 'Click the "New Deal" button to create your first opportunity. This will help you track sales and manage your pipeline effectively.',
      targetSelector: '[data-tour="new-deal-button"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: You can quickly create deals with keyboard shortcut Cmd+N'
    },
    {
      id: 'explore_pipeline',
      title: 'Explore your pipeline',
      description: 'These are your customizable Kanban columns',
      tooltip: 'Your pipeline shows all deals organized by stage. Drag deals between columns to move them through your sales process. These Kanban columns are where the rubber meets the road - all your deal information lives here!',
      targetSelector: '[data-tour="pipeline-columns"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Click on any deal card to see detailed information and add notes'
    },
    {
      id: 'customize_pipeline',
      title: 'Customize your pipeline',
      description: 'Add deals, move columns, or hide stages',
      tooltip: 'Click the three-dot menu (⋮) on any column to customize your pipeline! You can: (1) Add new deals directly to a stage using the + button, (2) Move columns left or right to reorder them, (3) Hide columns you don\'t need. This is YOUR pipeline - make it work for you!',
      targetSelector: '[data-tour="column-menu"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: The + button on each column lets you add deals directly to that stage'
    },
    {
      id: 'connect_integration',
      title: 'Transform Your Dashboard',
      description: 'Connect AI to unlock superpowers',
      tooltip: 'Connect OpenAI, Anthropic, or other AI providers to transform your basic pipeline into an intelligent revenue command center with deal scoring, win probability predictions, and automated insights.',
      targetSelector: '[data-tour="ai-providers"]',
      targetPage: 'integrations',
      deepLink: { view: 'integrations', tab: 'ai-providers' },
      hint: 'Tip: AI transforms your dashboard with predictive analytics and smart recommendations'
    },
    {
      id: 'invite_team',
      title: 'Set Goals & Invite Your Team',
      description: 'Track progress and collaborate',
      tooltip: 'Set individual and team revenue goals to track your progress. Right below goals, you can add team members to collaborate on deals, assign ownership, and close faster together. Team features are available on Growth and Pro plans - click to see billing options!',
      targetSelector: '[data-tour="revenue-targets"]',
      targetPage: 'settings',
      deepLink: { view: 'settings', tab: 'pipeline' },
      hint: 'Tip: Goals create accountability, and teams accelerate success - combine them for maximum impact!'
    },
    {
      id: 'discover_settings',
      title: 'Your Command Center',
      description: 'Access all settings from here',
      tooltip: 'Click your profile avatar to access your command center! From here you can: (1) Upload your profile picture, (2) Customize notifications, (3) Manage team members, (4) Configure billing & subscriptions, and more.',
      targetSelector: '[data-tour="settings-button"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your settings are always accessible from this button!'
    },
    {
      id: 'share_feedback',
      title: 'Share Your Feedback!',
      description: 'Help us improve StageFlow',
      tooltip: 'This is your direct line to us! Share feedback, report bugs, request features, give us stars, or just let us know how we\'re doing. We read every message and use your input to make StageFlow better.',
      targetSelector: '[data-feedback-button="true"]',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'Tip: Your feedback shapes the future of StageFlow!'
    }
  ]
};

// Helper function to get steps based on user goal
// CRITICAL FIX: Validate steps array to prevent empty array / division by zero
const getOnboardingSteps = (userGoal) => {
  let steps;

  if (!userGoal || userGoal === 'skip') {
    steps = GOAL_SPECIFIC_STEPS.default;
  } else {
    steps = GOAL_SPECIFIC_STEPS[userGoal] || GOAL_SPECIFIC_STEPS.default;
  }

  // CRITICAL: Validate steps is a non-empty array
  if (!Array.isArray(steps) || steps.length === 0) {
    logger.error('[Onboarding] Invalid or empty steps array for goal:', userGoal);
    // Return minimal fallback to prevent crashes
    return [{
      id: 'error_fallback',
      title: 'Onboarding Configuration Error',
      description: 'Please contact support',
      tooltip: 'An error occurred loading onboarding steps. Please refresh the page or contact support.',
      targetSelector: 'body',
      targetPage: 'dashboard',
      deepLink: { view: 'dashboard' },
      hint: 'If this persists, please report it to support@stageflow.com'
    }];
  }

  return steps;
};

// NEXT-LEVEL: Memoize component to prevent re-renders
// Self-sufficient component that fetches its own data
const OnboardingChecklistComponent = ({ onComplete }) => {
  const { user, organization, setActiveView, activeView } = useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [isVisible, setIsVisible] = useState(true);
  const [targetElement, setTargetElement] = useState(null);
  const [spotlightPosition, setSpotlightPosition] = useState(null);
  const [deals, setDeals] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showReplayButton, setShowReplayButton] = useState(false);
  const [cardPosition, setCardPosition] = useState({ bottom: 24, right: 24 });
  const [showHint, setShowHint] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(sounds.enabled);
  const [showHelp, setShowHelp] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataFetchAttempts, setDataFetchAttempts] = useState(0);
  const [welcomeModalDismissed, setWelcomeModalDismissed] = useState(false);
  const [showGoalSelection, setShowGoalSelection] = useState(false);
  const [userGoal, setUserGoal] = useState(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const checklistRef = useRef(null);
  const previousStepRef = useRef(currentStep);
  const hasPlayedConfetti = useRef(false);
  const stepStartTime = useRef(Date.now());
  const hintTimeout = useRef(null);
  const localStorageDebounceTimer = useRef(null); // PERFORMANCE: Debounce localStorage writes
  const pendingLocalStorageData = useRef(null); // MEDIUM PRIORITY: Track pending localStorage data for flush on unmount
  const elementWatcher = useRef(null); // PERFORMANCE: Watch for target elements to appear
  const feedbackButtonsRef = useRef(null); // PERFORMANCE: Cache feedback button elements to avoid repeated DOM queries
  const mountedRef = useRef(true); // CRITICAL: Track component mount state to prevent state updates after unmount
  const replayInProgressRef = useRef(false); // CRITICAL: Prevent race conditions from rapid replay clicks
  const welcomeDismissedProcessedRef = useRef(false); // CRITICAL: Prevent race condition between polling and event listener
  const nextInProgressRef = useRef(false); // CRITICAL: Prevent state corruption from rapid Next button clicks
  const rafIdRef = useRef(null); // PERFORMANCE FIX: Track RAF ID to prevent multiple concurrent animation loops

  // GOAL-SPECIFIC: Get the appropriate onboarding steps based on user's selected goal
  // CRITICAL FIX: Memoize ONBOARDING_STEPS to prevent new array reference on every render
  // This was causing handleNext to be recreated constantly, leading to stale closures
  const ONBOARDING_STEPS = useMemo(() => getOnboardingSteps(userGoal), [userGoal]);

  // PERFORMANCE: Create Map for O(1) step lookups instead of O(n) find() operations
  const stepMap = useMemo(() => {
    const map = new Map();
    // SAFETY: Filter out any undefined steps before mapping
    ONBOARDING_STEPS.filter(step => step).forEach(step => map.set(step.id, step));
    return map;
  }, [ONBOARDING_STEPS]);

  // PERFORMANCE FIX: Use refs to stabilize values read inside useEffect
  // Prevents unnecessary re-runs when these values change but aren't reactive deps
  const activeViewRef = useRef(activeView);
  const currentStepRef = useRef(currentStep);
  const completedStepsRef = useRef(completedSteps); // CIRCULAR DEP FIX
  const setActiveViewRef = useRef(setActiveView);
  const debouncedSaveRef = useRef(null); // CRITICAL TDZ FIX: Initialize to null, updated in useEffect below
  const stepsRef = useRef(ONBOARDING_STEPS);
  const stepMapRef = useRef(stepMap);

  // Keep refs in sync
  useEffect(() => {
    activeViewRef.current = activeView;
    currentStepRef.current = currentStep;
    completedStepsRef.current = completedSteps; // CIRCULAR DEP FIX
    setActiveViewRef.current = setActiveView;
    debouncedSaveRef.current = debouncedLocalStorageSave;
    stepsRef.current = ONBOARDING_STEPS;
    stepMapRef.current = stepMap;
  });

  // CRITICAL: Track component mounted state to prevent state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // PERFORMANCE: Debounced localStorage save to batch multiple writes
  const debouncedLocalStorageSave = useCallback((userId, data) => {
    if (!userId) return;

    // MEDIUM PRIORITY FIX: Store pending data for flush on unmount
    pendingLocalStorageData.current = { userId, data };

    // Clear existing timer
    if (localStorageDebounceTimer.current) {
      clearTimeout(localStorageDebounceTimer.current);
    }

    // Set new timer to batch writes
    localStorageDebounceTimer.current = setTimeout(() => {
      // UNIFIED STORAGE: Use setState with QuotaExceededError fallback
      const success = onboardingStorage.setState(
        userId,
        data,
        // Fallback function for quota exceeded
        (updates) => {
          onboardingSync.saveProgress(userId, updates).catch(syncErr => {
            logger.error('[Onboarding] Sync fallback also failed:', syncErr);
          });
        }
      );

      if (success) {
        pendingLocalStorageData.current = null; // Clear pending data after successful write
      }
    }, TIMING.LOCALSTORAGE_DEBOUNCE);
  }, []);

  // PERFORMANCE FIX: Async localStorage save using requestIdleCallback
  // Uses browser idle time for writes to avoid blocking main thread (30-70ms savings)
  const asyncLocalStorageSave = useCallback((userId, data) => {
    const write = () => {
      // UNIFIED STORAGE: Use setState with QuotaExceededError fallback
      onboardingStorage.setState(
        userId,
        data,
        // Fallback function for quota exceeded
        (updates) => {
          onboardingSync.saveProgress(userId, updates).catch(syncErr => {
            logger.error('[Onboarding] Sync fallback also failed:', syncErr);
          });
        }
      );
    };

    // Use requestIdleCallback if available, otherwise setTimeout as fallback
    if ('requestIdleCallback' in window) {
      requestIdleCallback(write, { timeout: 2000 }); // Max 2s delay
    } else {
      setTimeout(write, 0); // Next tick fallback
    }
  }, []);

  // MEDIUM PRIORITY FIX: Flush pending localStorage writes on unmount instead of cancelling them
  // Previous bug: Clearing timeout lost user progress if component unmounted during debounce delay
  useEffect(() => {
    return () => {
      // Clear the timer
      if (localStorageDebounceTimer.current) {
        clearTimeout(localStorageDebounceTimer.current);
      }

      // Flush any pending write immediately
      if (pendingLocalStorageData.current) {
        const { userId, data } = pendingLocalStorageData.current;

        // UNIFIED STORAGE: Use setState with QuotaExceededError fallback
        onboardingStorage.setState(
          userId,
          data,
          // Fallback function for quota exceeded
          (updates) => {
            onboardingSync.saveProgress(userId, updates).catch(syncErr => {
              logger.error('[Onboarding] Unmount sync fallback failed:', syncErr);
            });
          }
        );

        // Always clear pending data after flush attempt
        pendingLocalStorageData.current = null;
      }
    };
  }, []);

  // PERFORMANCE: Logging removed from hot path (runs on every render)

  // CRITICAL: Check if welcome modal has been shown and goal selected
  // PERFORMANCE FIX: No polling - uses unified storage + event listeners only
  useEffect(() => {
    if (!user?.id) {
      return;
    }

    // CRITICAL FIX: Reset processed flag when user changes
    welcomeDismissedProcessedRef.current = false;

    // UNIFIED STORAGE: Get state from single source of truth
    const state = onboardingStorage.getState(user.id);

    // CRITICAL FIX: Always check dismissed flag FIRST - don't re-show onboarding if user completed it
    if (state?.dismissed) {
      // Onboarding was completed/dismissed - don't show anything
      setWelcomeModalDismissed(true);
      setShowGoalSelection(false);
      setIsVisible(false);
      return;
    }

    if (state?.welcomeShown) {
      // CRITICAL FIX: Mark as processed immediately to prevent race with event listener
      welcomeDismissedProcessedRef.current = true;
      setWelcomeModalDismissed(true);

      if (state.selectedGoal) {
        // Goal already selected, proceed to onboarding
        setUserGoal(state.selectedGoal);
        setShowGoalSelection(false);
      } else {
        // Welcome dismissed but no goal yet, show goal selection
        setShowGoalSelection(true);
      }
    } else {
      // Welcome hasn't been shown yet, wait for it
      setWelcomeModalDismissed(false);
      setShowGoalSelection(false);
    }

    // PERFORMANCE: Listen for storage changes across tabs (no polling needed!)
    const cleanup = onboardingStorage.addListener((userId, newState) => {
      if (userId !== user.id || !mountedRef.current) return;

      // CRITICAL FIX: Don't show goal selection if onboarding was dismissed
      if (newState?.dismissed) {
        setIsVisible(false);
        setShowGoalSelection(false);
        return;
      }

      if (newState?.welcomeShown && !welcomeDismissedProcessedRef.current) {
        welcomeDismissedProcessedRef.current = true;
        setWelcomeModalDismissed(true);
        setShowGoalSelection(true);
      }
    });

    return cleanup;
  }, [user?.id]);

  // CRITICAL FIX: Listen for welcome dismissal event from Dashboard
  useEffect(() => {
    if (!user?.id) return;

    const handleWelcomeDismissed = (event) => {
      // CRITICAL FIX: Check if already processed by polling to prevent duplicate state updates
      if (welcomeDismissedProcessedRef.current) return;

      if (event.detail?.userId === user.id) {
        // CRITICAL FIX: Check if onboarding was already dismissed - don't re-show goal selection
        const state = onboardingStorage.getState(user.id);
        if (state?.dismissed) {
          setIsVisible(false);
          setShowGoalSelection(false);
          return;
        }

        welcomeDismissedProcessedRef.current = true; // Mark processed
        setWelcomeModalDismissed(true);
        setShowGoalSelection(true);
      }
    };

    window.addEventListener('onboardingWelcomeDismissed', handleWelcomeDismissed);

    return () => {
      window.removeEventListener('onboardingWelcomeDismissed', handleWelcomeDismissed);
    };
  }, [user?.id]);

  // Handle goal selection
  const handleGoalSelected = useCallback((goal) => {
    if (!user?.id) return;

    // CRITICAL FIX: Set welcome as dismissed (goal selection means welcome was already dismissed)
    setWelcomeModalDismissed(true);

    // CRITICAL FIX: Force isVisible to true when goal is selected (user wants to see onboarding!)
    setIsVisible(true);

    // HIGH PRIORITY FIX: Remove unnecessary functional updates - goal is not derived from previous state
    // Previous code used functional updates unnecessarily (performance hit, no benefit)
    setUserGoal(goal);
    setShowGoalSelection(false);

    // SAFARI COMPATIBILITY FIX: Use requestIdleCallback with fallback for Safari
    // requestIdleCallback is not supported in Safari - use setTimeout as fallback
    const deferredSave = () => {
      // CRITICAL FIX: Check if component is still mounted
      if (!mountedRef.current) return;

      // UNIFIED STORAGE: Save goal to unified state
      onboardingStorage.setState(user.id, {
        selectedGoal: goal,
        welcomeShown: true // Goal selection implies welcome was shown
      });

      // CRITICAL FIX: Wrap analytics in try-catch (non-blocking)
      try {
        analytics.trackEvent('goal_selected', { goal });
      } catch (err) {
        logger.error('[Onboarding] Analytics error (non-blocking):', err);
      }
    };

    // Use requestIdleCallback if available, fallback to setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(deferredSave);
    } else {
      // Safari fallback - defer to next event loop
      setTimeout(deferredSave, 1);
    }
  }, [user?.id]);

  // PERFORMANCE: Debug watcher disabled (runs on every state change)

  // NEXT-LEVEL v2.5: Detect mobile devices
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // NEXT-LEVEL v2.5: Start performance monitoring
  // PERFORMANCE FIX: Only run in development mode
  useEffect(() => {
    if (isVisible && import.meta.env.DEV) {
      performanceMonitor.start();
    } else {
      performanceMonitor.stop();
    }

    return () => performanceMonitor.stop();
  }, [isVisible]);

  // NEXT-LEVEL v2.5: Initialize sync and load completion state
  useEffect(() => {
    if (!user?.id) return;

    // Initialize cross-device sync
    const initializeSync = async () => {
      const syncedProgress = await onboardingSync.initialize(user.id);

      // PERFORMANCE: Disabled debug logging

      if (syncedProgress) {
        // CRITICAL FIX: Always respect dismissed flag (completed onboarding should stay dismissed)
        if (syncedProgress.dismissed) {
          setIsVisible(false);
          return false; // Don't track view if dismissed
        }
        setCompletedSteps(new Set(syncedProgress.completed || []));
        setCurrentStep(syncedProgress.currentStep || 0);
        return syncedProgress.currentStep || 0;
      } else {
        // UNIFIED STORAGE: Fallback to unified local storage
        const state = onboardingStorage.getState(user.id);

        if (state) {
          // CRITICAL FIX: Always respect dismissed flag (completed onboarding should stay dismissed)
          if (state.dismissed) {
            setIsVisible(false);
            return false;
          }
          setCompletedSteps(new Set(state.completed || []));
          setCurrentStep(state.currentStep || 0);
          return state.currentStep || 0;
        }
      }
      return 0;
    };

    // CRITICAL FIX: Await sync initialization before tracking analytics
    initializeSync().then((stepIndex) => {
      if (stepIndex !== false) {
        // Only track if not dismissed and step exists
        const step = ONBOARDING_STEPS[stepIndex];
        if (step) {
          analytics.stepViewed(step.id, step.title);
        }
      }
    });

    // Listen for sync updates from other devices
    const handleSync = (event) => {
      // FIX v1.7.61 (#2): Add mounted guard to prevent state updates after unmount
      if (!mountedRef.current || !isVisible) {
        return; // Don't update state if component unmounted or onboarding already dismissed
      }

      const { completed, dismissed, currentStep: syncedStep } = event.detail;
      if (dismissed) {
        setIsVisible(false);
      } else {
        setCompletedSteps(new Set(completed || []));
        setCurrentStep(syncedStep || 0);
      }
    };

    window.addEventListener('onboarding:synced', handleSync);

    return () => {
      window.removeEventListener('onboarding:synced', handleSync);
      onboardingSync.cleanup();
    };
    // FIX v1.7.61 (#2): Remove ONBOARDING_STEPS from deps - it's an unstable array reference
    // Only depend on user?.id to avoid infinite loop from array recreation
  }, [user?.id, isVisible]);

  // CRITICAL FIX: Preserve completedSteps when workflow changes (was wiping all progress)
  // SAFETY: Reset currentStep if out of bounds when workflow changes
  // CIRCULAR DEP FIX: Use refs to avoid currentStep and completedSteps in deps (refs declared at top)
  useEffect(() => {
    if (currentStepRef.current >= ONBOARDING_STEPS.length) {
      logger.warn(`[Onboarding] currentStep (${currentStepRef.current}) out of bounds for workflow length (${ONBOARDING_STEPS.length}). Finding first incomplete step.`);

      // CRITICAL FIX: Don't wipe completedSteps - preserve cross-workflow progress
      // Find first incomplete step instead of resetting to 0
      const firstIncompleteIndex = ONBOARDING_STEPS.findIndex(s => !completedStepsRef.current.has(s.id));
      setCurrentStep(firstIncompleteIndex !== -1 ? firstIncompleteIndex : 0);

      // DON'T reset completedSteps - preserve user's progress across workflows
      // OLD BUG: setCompletedSteps(new Set()); - This wiped all progress!
    }
  }, [ONBOARDING_STEPS.length]); // FIXED: Removed currentStep and completedSteps from deps

  // Fetch deals and integrations to check completion
  useEffect(() => {
    if (!user?.id) return;

    // CRITICAL FIX: Use ref to track attempts reset state to prevent infinite loop
    // Previous bug: setDataFetchAttempts(0) triggered effect re-run because dataFetchAttempts was in deps
    // Now: Only react to user/org changes, track reset state with ref
    const hasResetAttemptsRef = { current: false };

    // If organization is not yet loaded, wait and retry
    if (!organization?.id) {
      setDataLoading(true);

      // Retry up to 5 times with exponential backoff
      if (dataFetchAttempts < 5) {
        const retryDelay = Math.min(1000 * Math.pow(2, dataFetchAttempts), 10000);
        const timer = setTimeout(() => {
          setDataFetchAttempts(prev => prev + 1);
        }, retryDelay);
        return () => clearTimeout(timer);
      } else {
        // After 5 attempts, stop retrying but log warning
        logger.warn('[Onboarding] Organization not loaded after 5 attempts');
        setDataLoading(false);
      }
      return;
    }

    // Organization is loaded - reset attempts if needed and fetch data
    if (!hasResetAttemptsRef.current && dataFetchAttempts > 0) {
      hasResetAttemptsRef.current = true;
      setDataFetchAttempts(0);
    }

    // PERFORMANCE FIX: Track cancellation to prevent state updates on unmounted component
    let cancelled = false;

    const fetchData = async () => {
      if (!cancelled) setDataLoading(true);

      try {
        // Fetch deals count
        const { data: dealsData, error: dealsError } = await supabase
          .from('deals')
          .select('id')
          .eq('organization_id', organization.id)
          .limit(1);

        // PERFORMANCE FIX: Check if cancelled before state update
        if (cancelled) return;

        if (dealsError) {
          logger.error('[Onboarding] Failed to fetch deals:', dealsError);
        } else if (dealsData) {
          setDeals(dealsData);
        }

        // Fetch integrations count
        const { data: integrationsData, error: integrationsError } = await supabase
          .from('integrations')
          .select('id')
          .eq('organization_id', organization.id)
          .limit(1);

        // PERFORMANCE FIX: Check if cancelled before state update
        if (cancelled) return;

        if (integrationsError) {
          logger.error('[Onboarding] Failed to fetch integrations:', integrationsError);
        } else if (integrationsData) {
          setIntegrations(integrationsData);
        }
      } catch (error) {
        if (!cancelled) {
          logger.error('[Onboarding] Unexpected error fetching data:', error);
        }
      } finally {
        if (!cancelled) {
          setDataLoading(false);
          // Don't reset attempts here - already handled above
        }
      }
    };

    fetchData();

    // PERFORMANCE: Removed real-time subscriptions - unnecessary for onboarding
    // Onboarding doesn't need instant updates; initial fetch is sufficient
    // This saves websocket connection overhead and improves mobile performance

    // PERFORMANCE FIX: Cleanup function to cancel pending requests
    return () => {
      cancelled = true;
    };
  }, [user?.id, organization?.id]); // CRITICAL FIX: Removed dataFetchAttempts from deps

  // PERFORMANCE FIX: Auto-complete steps based on user's progress
  // Simplified from 11 deps to 5 by using refs for non-reactive values
  // CIRCULAR DEP FIX: Use completedStepsRef to avoid completedSteps in deps
  useEffect(() => {
    const newCompleted = new Set(completedStepsRef.current);

    // Check if user has deals
    if (deals && deals.length > 0) {
      newCompleted.add('add_first_deal');
      // After creating first deal, auto-complete "explore pipeline" since they can now see it
      newCompleted.add('explore_pipeline');
      // NOTE: customize_pipeline should NOT auto-complete - user needs to interact with column menu
      // NOTE: edit_deal_details should NOT auto-complete - user needs to click on a deal

      // GOAL-SPECIFIC: For analytics goal, mark explore metrics as complete
      if (userGoal === 'analytics') {
        // Metrics are now visible with deals in pipeline
        // Note: step is already named 'explore_pipeline' in analytics flow
      }
    }

    // Check if user has integrations
    if (integrations && integrations.length > 0) {
      newCompleted.add('connect_integration');

      // CRITICAL FIX: Only auto-complete enable_auto_scoring if integration is AI-specific
      // Don't auto-complete just because ANY integration exists
      // User must click "Next" to confirm AI is properly configured
      // REMOVED: Lenient auto-completion of enable_auto_scoring
    }

    // CRITICAL FIX: Remove lenient auto-completion for action-based steps
    // These steps require user to actually perform an action, not just visit a page
    // User must click "Next" to complete these steps

    // REMOVED: Auto-completion of invite_team (line 836)
    // REMOVED: Auto-completion of setup_collaboration (line 837)
    // REMOVED: Auto-completion of setup_notifications (line 839)
    // REMOVED: Auto-completion of view_analytics (line 851)
    // REMOVED: Auto-completion of assign_deals (line 859)

    // NOTE: Only "viewing" steps auto-complete (add_first_deal, explore_pipeline)
    // Action steps (invite, assign, setup) require manual "Next" click

    // Save to localStorage and track completion
    if (user?.id && newCompleted.size > completedStepsRef.current.size) {
      // NEXT-LEVEL: Track which steps were just completed
      const justCompleted = Array.from(newCompleted).filter(id => !completedStepsRef.current.has(id));
      justCompleted.forEach(stepId => {
        // PERFORMANCE: Use ref for stable stepMap access
        const step = stepMapRef.current.get(stepId);
        const timeToComplete = Date.now() - stepStartTime.current;
        analytics.stepCompleted(stepId, step?.title || stepId, timeToComplete);

        // NEXT-LEVEL: Play completion sound
        sounds.playStepComplete();
      });

      setCompletedSteps(newCompleted);

      // PERFORMANCE: Use ref for stable debounced save function
      // Use ref for stable ONBOARDING_STEPS array
      const currentStepId = stepsRef.current[currentStepRef.current]?.id;
      debouncedSaveRef.current(user.id, {
        completed: Array.from(newCompleted),
        dismissed: false,
        currentStepId
      });

      // AUTO-ADVANCE: If current step was just completed, move to next incomplete step
      // CRITICAL FIX: Don't auto-advance for certain steps to prevent layout shifts
      const shouldAutoAdvance = currentStepId && justCompleted.includes(currentStepId) &&
        // Don't auto-advance for these steps - let user click Next manually
        !['add_first_deal', 'explore_pipeline'].includes(currentStepId);

      if (shouldAutoAdvance) {
        // Find next incomplete step using ref for stable array
        const nextIncompleteIndex = stepsRef.current.findIndex(
          (step, idx) => idx > currentStepRef.current && !newCompleted.has(step.id)
        );

        if (nextIncompleteIndex !== -1) {
          // Delay slightly for better UX (let them see the checkmark)
          setTimeout(() => {
            // CRITICAL FIX: Check if component is still mounted before state updates
            if (!mountedRef.current) return;

            setCurrentStep(nextIncompleteIndex);
            const nextStep = stepsRef.current[nextIncompleteIndex];

            // Navigate to the required page for the next step using ref
            if (nextStep.deepLink?.view) {
              setActiveViewRef.current(nextStep.deepLink.view);
            }
            if (nextStep.deepLink?.tab) {
              const url = new URL(window.location);
              url.searchParams.set('tab', nextStep.deepLink.tab);
              window.history.pushState({}, '', url);
            }
          }, 800); // 800ms delay to show completion animation
        }
      }
    }
  }, [deals, integrations, user?.id, userGoal]); // FIXED: Removed completedSteps from deps (uses ref)

  // NEXT-LEVEL: Smooth step transitions with animation + analytics
  useEffect(() => {
    if (previousStepRef.current !== currentStep) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), TIMING.HINT_TIMEOUT);
      previousStepRef.current = currentStep;

      // Track step view
      const step = ONBOARDING_STEPS[currentStep];
      // SAFETY: Only track if step exists (prevent errors during workflow switches)
      if (step) {
        analytics.stepViewed(step.id, step.title);
      }

      // Reset step timer and hint
      stepStartTime.current = Date.now();
      setShowHint(false);

      return () => clearTimeout(timer);
    }
  }, [currentStep, ONBOARDING_STEPS]);

  // CRITICAL: Save currentStepId to localStorage so FeedbackWidget can detect share_feedback step
  // PERFORMANCE: Use debounced save to avoid excessive writes
  useEffect(() => {
    if (!user?.id || !isVisible) return;

    try {
      // UNIFIED STORAGE: Get existing state
      const existingData = onboardingStorage.getState(user.id) || {};
      const newStepId = ONBOARDING_STEPS[currentStep]?.id;

      debouncedLocalStorageSave(user.id, {
        ...existingData,
        currentStepId: newStepId
      });

    } catch (error) {
      logger.error('[Onboarding] Failed to save currentStepId:', error);
    }
  }, [currentStep, user?.id, isVisible, debouncedLocalStorageSave, ONBOARDING_STEPS]);

  // NEXT-LEVEL: Smart contextual hints - show after 10 seconds of inactivity
  useEffect(() => {
    if (!isVisible || completedSteps.has(ONBOARDING_STEPS[currentStep]?.id)) {
      return;
    }

    // Clear any existing timeout
    if (hintTimeout.current) {
      clearTimeout(hintTimeout.current);
    }

    // Show hint after configured delay
    hintTimeout.current = setTimeout(() => {
      // CRITICAL FIX: Check if component is still mounted before setState
      if (!mountedRef.current) return;

      setShowHint(true);
      const step = ONBOARDING_STEPS[currentStep];
      // SAFETY: Only track hint if step exists
      if (step) {
        analytics.hintShown(step.id, 'timeout', TIMING.HINT_DELAY);
      }
      sounds.playHint();
    }, TIMING.HINT_DELAY);

    return () => {
      if (hintTimeout.current) {
        clearTimeout(hintTimeout.current);
      }
    };
  }, [currentStep, isVisible, completedSteps, ONBOARDING_STEPS]);

  // CRITICAL: No auto-complete - user must click Done button on final feedback step
  // This ensures users see the feedback tab and can choose to provide feedback

  // Find and highlight target element with smooth scrolling
  // CIRCULAR DEP FIX: Use ref to avoid targetElement in deps
  const targetElementRef = useRef(targetElement);
  useEffect(() => {
    targetElementRef.current = targetElement;
  }, [targetElement]);

  useEffect(() => {
    if (!isVisible) return;

    const step = ONBOARDING_STEPS[currentStep];
    if (!step) return;

    // Check if we're on the correct page for this step
    const isCorrectPage = step.targetPage === activeView;

    // PERFORMANCE FIX: Use ref to track RAF ID consistently
    // Cancel any existing RAF before starting new one
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Find the target element
    const findTarget = () => {
      const el = document.querySelector(step.targetSelector);
      if (el && isCorrectPage) {
        // FIX v1.7.63 - E2: Add mounted guard before setState (prevent React #300)
        if (!mountedRef.current) return;

        setTargetElement(el);

        // Calculate spotlight position using RAF for smoother updates
        const updatePosition = () => {
          // FIX v1.7.63 - E2: Guard spotlight updates (runs via RAF/ResizeObserver)
          if (!mountedRef.current) return;

          const rect = el.getBoundingClientRect();

          // CRITICAL FIX: Validate rect values to prevent NaN in spotlight positioning
          // getBoundingClientRect can return NaN if element is detached, display:none, or in collapsed iframe
          const isValidRect = (
            Number.isFinite(rect.top) &&
            Number.isFinite(rect.left) &&
            Number.isFinite(rect.width) &&
            Number.isFinite(rect.height) &&
            rect.width > 0 &&
            rect.height > 0
          );

          if (!isValidRect) {
            logger.warn('[Onboarding] Invalid getBoundingClientRect result, skipping spotlight update');
            return;
          }

          // CRITICAL: Extra padding for AI providers to show all 4 cards clearly
          const isAIProvidersStep = step.id === 'connect_integration';
          const padding = isAIProvidersStep ? 24 : 8;

          setSpotlightPosition({
            top: rect.top - padding,
            left: rect.left - padding,
            width: rect.width + (padding * 2),
            height: rect.height + (padding * 2)
          });
        };

        // Initial position update
        updatePosition();

        // NEXT-LEVEL: Smooth scroll target into view if not visible
        const rect = el.getBoundingClientRect();
        const isInViewport = (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.right <= window.innerWidth
        );

        if (!isInViewport) {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
          });
        }

        // Boost z-index to ensure element sits above spotlight layers (z-170, z-171, z-172)
        // Store original z-index so we can restore it later
        if (!el.dataset.originalZIndex) {
          el.dataset.originalZIndex = el.style.zIndex || 'auto';
        }
        // CRITICAL FIX: Don't change position if element is already fixed/absolute
        // Only set to relative if it's static (default)
        const computedPosition = window.getComputedStyle(el).position;
        if (computedPosition === 'static') {
          el.style.position = 'relative';
        }
        el.style.zIndex = '175';

        // CRITICAL FIX: Also boost z-index of all children to ensure they're visible above spotlight
        // This is especially important for grids/containers like the AI providers section
        const children = el.querySelectorAll('*');
        children.forEach((child) => {
          if (!child.dataset.originalZIndex) {
            child.dataset.originalZIndex = child.style.zIndex || 'auto';
            child.dataset.originalPosition = child.style.position || '';
          }
          // CRITICAL FIX: Don't change position if child is already fixed/absolute
          const childComputedPosition = window.getComputedStyle(child).position;
          if (childComputedPosition === 'static') {
            child.style.position = 'relative';
          }
          child.style.zIndex = '175';
        });

        // NEXT-LEVEL: Pulse animation on target element
        el.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.transform = 'scale(1.02)';
        setTimeout(() => {
          // FIX v1.7.63 - E2: Guard DOM manipulation in timeout
          if (!mountedRef.current) return;
          el.style.transform = 'scale(1)';
        }, 300);

        // SAFARI COMPATIBILITY FIX: ResizeObserver with fallback for older browsers
        // ResizeObserver not supported in Safari <13.1 (iOS 13.0 and older)
        // This handles layout shifts when deals are added/removed
        let resizeObserver = null;
        let resizeCleanup = null;

        if (typeof ResizeObserver !== 'undefined') {
          // Modern browsers: Use ResizeObserver for efficient position tracking
          resizeObserver = new ResizeObserver(() => {
            if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = requestAnimationFrame(updatePosition);
          });
          resizeObserver.observe(el);
        } else {
          // Fallback for Safari <13.1: Use window resize + periodic checks
          const handleResize = () => {
            if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = requestAnimationFrame(updatePosition);
          };
          window.addEventListener('resize', handleResize);

          // Also check position every 500ms as fallback for element size changes
          const fallbackInterval = setInterval(handleResize, 500);

          resizeCleanup = () => {
            window.removeEventListener('resize', handleResize);
            clearInterval(fallbackInterval);
          };
        }

        // CRITICAL FIX: Add MutationObserver to detect DOM changes in parent container
        // This catches when new deals are inserted into the pipeline
        const parentContainer = el.closest('[data-tour="pipeline-columns"]') || el.parentElement;
        const mutationObserver = new MutationObserver(() => {
          if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = requestAnimationFrame(updatePosition);
        });

        if (parentContainer) {
          mutationObserver.observe(parentContainer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
          });
        }

        return () => {
          // Cleanup ResizeObserver (if used)
          if (resizeObserver) {
            resizeObserver.disconnect();
          }
          // Cleanup fallback listeners (if used)
          if (resizeCleanup) {
            resizeCleanup();
          }
          mutationObserver.disconnect();
          if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        };
      } else {
        // FIX v1.7.63 - E2: Guard setState when clearing spotlight
        if (!mountedRef.current) return;

        setTargetElement(null);
        setSpotlightPosition(null);
        // CRITICAL FIX: Always return cleanup function (even if no observers to clean up)
        return () => {}; // Empty cleanup - no observers were created
      }
    };

    // Try immediately
    const cleanup = findTarget();

    // PERFORMANCE: Use MutationObserver to detect when target element appears
    // This is MUCH faster than setTimeout retries - detects elements instantly!
    if (!targetElementRef.current && isCorrectPage) {
      const observer = new MutationObserver(() => {
        // FIX v1.7.63 - E2: Guard MutationObserver callback
        if (!mountedRef.current) return;

        // Check if target now exists
        const el = document.querySelector(step.targetSelector);
        if (el) {
          findTarget();
          observer.disconnect(); // Stop observing once found
        }
      });

      // Watch entire body for changes
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Store observer reference for cleanup
      elementWatcher.current = observer;
    }

    // Fallback: Single retry after delay as safety net (reduced from 2 retries)
    const timeout = setTimeout(findTarget, TIMING.TARGET_RETRY_SECOND);

    // PERFORMANCE: Throttle window resize and scroll listeners to reduce CPU usage
    let resizeTimeout = null;
    let scrollTimeout = null;

    const handleResize = () => {
      if (resizeTimeout) return; // Throttle: ignore if already scheduled
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null;
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(findTarget);
      }, 100); // Throttle to 100ms
    };

    const handleScroll = () => {
      if (scrollTimeout) return; // Throttle: ignore if already scheduled
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(findTarget);
      }, 50); // Throttle to 50ms for scroll (faster for better UX)
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (cleanup) cleanup();
      // PERFORMANCE: Disconnect MutationObserver
      if (elementWatcher.current) {
        elementWatcher.current.disconnect();
        elementWatcher.current = null;
      }

      // Cleanup: restore original z-index when target changes or component unmounts
      if (targetElementRef.current && targetElementRef.current.dataset.originalZIndex) {
        targetElementRef.current.style.zIndex = targetElementRef.current.dataset.originalZIndex;
        delete targetElementRef.current.dataset.originalZIndex;

        // Also restore children's z-index and position
        const children = targetElementRef.current.querySelectorAll('*');
        children.forEach((child) => {
          if (child.dataset.originalZIndex) {
            child.style.zIndex = child.dataset.originalZIndex;
            delete child.dataset.originalZIndex;
          }
          if (child.dataset.originalPosition !== undefined) {
            child.style.position = child.dataset.originalPosition;
            delete child.dataset.originalPosition;
          }
        });
      }
    };
  }, [currentStep, isVisible, activeView, ONBOARDING_STEPS]); // FIXED: Removed targetElement from deps (uses ref)

  // CRITICAL: Auto-open dropdown menu for "customize_pipeline" step
  // This ensures users can see the actual menu options (move left/right, hide stage, etc.)
  useEffect(() => {
    const step = ONBOARDING_STEPS[currentStep];

    if (!isVisible || !step || step.id !== 'customize_pipeline' || activeView !== 'dashboard') {
      return;
    }

    // CRITICAL FIX: Track all timers including nested ones for proper cleanup
    const timers = [];

    // Wait for target element to be found and rendered
    const openDropdown = () => {
      const menuContainer = document.querySelector('[data-tour="column-menu"]');
      if (!menuContainer) {
        return;
      }

      // Find the button (MoreVertical icon button)
      const dropdownButton = menuContainer.querySelector('button[aria-haspopup="true"]');
      if (!dropdownButton) {
        return;
      }

      // Check if dropdown is already open
      const isOpen = dropdownButton.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        // Dropdown already open, now expand spotlight to include it
        const dropdownMenu = menuContainer.querySelector('[role="region"], div[class*="absolute"]');
        if (dropdownMenu && targetElement) {
          // Get bounding boxes of both button and dropdown
          const buttonRect = menuContainer.getBoundingClientRect();
          const dropdownRect = dropdownMenu.getBoundingClientRect();

          // Calculate combined bounding box
          const combinedRect = {
            top: Math.min(buttonRect.top, dropdownRect.top),
            left: Math.min(buttonRect.left, dropdownRect.left),
            right: Math.max(buttonRect.right, dropdownRect.right),
            bottom: Math.max(buttonRect.bottom, dropdownRect.bottom)
          };

          const padding = 12;
          setSpotlightPosition({
            top: combinedRect.top - padding,
            left: combinedRect.left - padding,
            width: (combinedRect.right - combinedRect.left) + (padding * 2),
            height: (combinedRect.bottom - combinedRect.top) + (padding * 2)
          });

          // Boost z-index of dropdown to ensure it's above spotlight
          dropdownMenu.style.position = 'relative';
          dropdownMenu.style.zIndex = '175';
        }
        return;
      }

      // Click the button to open the dropdown
      dropdownButton.click();

      // Wait for dropdown to render, then expand spotlight
      // CRITICAL FIX: Track this nested timeout and add mount check
      const nestedTimer = setTimeout(() => {
        // CRITICAL FIX: Check if component is still mounted before state updates
        if (!mountedRef.current) return;

        const dropdownMenu = menuContainer.querySelector('div[class*="absolute"]');
        if (dropdownMenu && targetElement) {
          // Get bounding boxes of both button and dropdown
          const buttonRect = menuContainer.getBoundingClientRect();
          const dropdownRect = dropdownMenu.getBoundingClientRect();

          // Calculate combined bounding box
          const combinedRect = {
            top: Math.min(buttonRect.top, dropdownRect.top),
            left: Math.min(buttonRect.left, dropdownRect.left),
            right: Math.max(buttonRect.right, dropdownRect.right),
            bottom: Math.max(buttonRect.bottom, dropdownRect.bottom)
          };

          const padding = 12;
          setSpotlightPosition({
            top: combinedRect.top - padding,
            left: combinedRect.left - padding,
            width: (combinedRect.right - combinedRect.left) + (padding * 2),
            height: (combinedRect.bottom - combinedRect.top) + (padding * 2)
          });

          // Boost z-index of dropdown to ensure it's above spotlight
          dropdownMenu.style.position = 'relative';
          dropdownMenu.style.zIndex = '175';
        }
      }, 100); // Small delay for dropdown animation

      timers.push(nestedTimer);
    };

    // Initial attempt
    openDropdown();

    // Retry after delays (in case target element isn't ready yet)
    timers.push(setTimeout(openDropdown, 300));
    timers.push(setTimeout(openDropdown, 600));

    return () => {
      // CRITICAL FIX: Clear all timers including nested ones
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [currentStep, isVisible, activeView, ONBOARDING_STEPS]); // FIXED: Removed targetElement from deps (uses ref)

  const handleStepClick = useCallback((step, index) => {
    // NEXT-LEVEL v2.5: Measure interaction performance
    const startTime = performance.now();

    // NEXT-LEVEL: Haptic-like feedback via animation
    if (checklistRef.current) {
      checklistRef.current.style.transform = 'scale(0.98)';
      setTimeout(() => {
        // CRITICAL FIX: Check if component is still mounted before DOM manipulation
        if (mountedRef.current && checklistRef.current) {
          checklistRef.current.style.transform = 'scale(1)';
        }
      }, 100);
    }

    // Track navigation
    analytics.navigationClicked(step.id, 'click');
    sounds.playNavigation();

    // NEXT-LEVEL v2.5: Record interaction latency
    const endTime = performance.now();
    performanceMonitor.recordInteraction('step_click', endTime - startTime);

    setCurrentStep(index);

    // Handle deep linking
    if (step.deepLink) {
      if (step.deepLink.view) {
        setActiveView(step.deepLink.view);
      }
      if (step.deepLink.tab) {
        // Set URL parameter for tab
        const url = new URL(window.location);
        url.searchParams.set('tab', step.deepLink.tab);
        window.history.pushState({}, '', url);
      }
    }
  }, [setActiveView]);

  // CRITICAL FIX: Move handleDismiss BEFORE useEffect that depends on it
  // This fixes "Cannot access 'X' before initialization" TDZ error
  const handleDismiss = useCallback(() => {
    // CRITICAL FIX: Wrap analytics in try-catch (non-blocking)
    try {
      const completionRate = (completedSteps.size / ONBOARDING_STEPS.length) * 100;
      analytics.dismissed('close_button', completionRate);
    } catch (err) {
      logger.error('[Onboarding] Analytics error (non-blocking):', err);
    }

    // Save dismissed state to localStorage
    // PERFORMANCE FIX: Use async save to avoid blocking UI (30-70ms savings)
    if (user?.id) {
      const dismissalData = {
        completed: Array.from(completedSteps),
        dismissed: true,
        currentStep,
        currentStepId: null
      };
      asyncLocalStorageSave(user.id, dismissalData);

      // NEXT-LEVEL v2.5: Sync dismissal to server
      const progress = {
        completed: Array.from(completedSteps),
        dismissed: true,
        currentStep
      };

      onboardingSync.saveProgress(user.id, progress);
    }

    setIsVisible(false);
    // Only show replay button if tour was NOT fully completed
    // CRITICAL FIX: Check storage for tourFullyCompleted flag
    const state = user?.id ? onboardingStorage.getState(user.id) : null;
    if (!state?.tourFullyCompleted) {
      setShowReplayButton(true);
    }
    if (onComplete) onComplete();
  }, [user?.id, completedSteps, currentStep, onComplete]);

  // CRITICAL FIX: Handle completion modal dismissal with persistence
  // This fixes the bug where completing onboarding doesn't persist dismissal
  const handleCompletionDismiss = useCallback((navigateToView = null) => {
    // Save completion + dismissal to localStorage and Supabase
    if (user?.id) {
      const dismissalData = {
        completed: Array.from(completedSteps),
        dismissed: true,
        currentStep,
        currentStepId: null
      };
      asyncLocalStorageSave(user.id, dismissalData);

      // UNIFIED STORAGE: Welcome dismissal is part of unified state, no separate write needed
      // The dismissalData above already includes dismissed: true which triggers welcome dismissal

      // Sync to Supabase
      onboardingSync.saveProgress(user.id, {
        completed: Array.from(completedSteps),
        dismissed: true,
        currentStep
      });
    }

    // Close modal and hide onboarding
    setShowCompletionModal(false);
    setIsVisible(false);

    // Navigate if requested
    if (navigateToView) {
      setActiveView(navigateToView);
    }
  }, [user?.id, completedSteps, currentStep, setActiveView]);

  // NEXT-LEVEL: Replay tour functionality
  const handleReplay = useCallback(async (event) => {
    // CRITICAL FIX: Prevent race conditions from rapid clicks
    if (replayInProgressRef.current) {
      logger.warn('[Onboarding] Replay already in progress, ignoring duplicate call');
      return;
    }

    replayInProgressRef.current = true;

    // DEVELOPMENT MODE: Full reset including deals (Shift + Click)
    const isFullReset = event?.shiftKey || event?.metaKey || event?.ctrlKey;

    if (isFullReset && organization?.id) {
      // Confirm before destructive action
      const confirmed = window.confirm(
        '🔥 FULL RESET MODE\n\n' +
        'This will:\n' +
        '✅ Clear onboarding progress\n' +
        '✅ Delete ALL deals\n' +
        '✅ Delete ALL integrations\n' +
        '✅ Reset goal selection\n\n' +
        'This is useful for testing the onboarding flow from scratch.\n\n' +
        'Continue?'
      );

      if (!confirmed) {
        replayInProgressRef.current = false;
        return;
      }

      try {
        // ATOMIC RESET v1.7.98: Use RPC for all-or-nothing reset
        // Prevents partial states where some data is deleted and some isn't
        const { data: resetResult, error: resetError } = await supabase
          .rpc('reset_onboarding_data', {
            p_organization_id: organization.id,
            p_user_id: user.id
          });

        if (resetError) {
          logger.error('[Onboarding] Atomic reset failed:', resetError);
          alert('Error resetting onboarding: ' + resetError.message);
          replayInProgressRef.current = false;
          return;
        }

        logger.log('[Onboarding] Atomic reset complete:', resetResult);

        // UNIFIED STORAGE: Clear goal selection via setState
        if (user?.id) {
          onboardingStorage.setState(user.id, { selectedGoal: null });
        }

        // Clear deals and integrations state
        setDeals([]);
        setIntegrations([]);

        // Show success message with counts
        const { deals_deleted, integrations_deleted, ai_providers_deactivated } = resetResult || {};
        alert(
          `✅ Full reset complete!\n\n` +
          `• ${deals_deleted || 0} deals archived\n` +
          `• ${integrations_deleted || 0} integrations removed\n` +
          `• ${ai_providers_deactivated || 0} AI providers deactivated\n` +
          `• Onboarding progress cleared`
        );
      } catch (error) {
        logger.error('[Onboarding] Unexpected error during full reset:', error);
        alert('Error during full reset: ' + error.message);
        replayInProgressRef.current = false;
        return;
      }
    }

    // CRITICAL FIX: Wrap analytics in try-catch (non-blocking)
    try {
      analytics.replayed();
    } catch (err) {
      logger.error('[Onboarding] Analytics error (non-blocking):', err);
    }

    // UNIFIED STORAGE: Clear onboarding progress
    if (user?.id) {
      onboardingStorage.clearState(user.id);

      // Sync the reset to server
      onboardingSync.saveProgress(user.id, {
        completed: [],
        dismissed: false,
        currentStep: 0
      });
    }

    setCompletedSteps(new Set());
    setCurrentStep(0);
    setIsVisible(true);
    setShowReplayButton(false);
    hasPlayedConfetti.current = false;
    stepStartTime.current = Date.now();

    // If full reset, also trigger goal selection
    if (isFullReset) {
      setUserGoal(null);
      setShowGoalSelection(true);
      setIsVisible(false); // Hide checklist until goal is selected
    }

    // CRITICAL FIX: Always reset the lock at the end
    replayInProgressRef.current = false;
  }, [user?.id, organization?.id]);

  // NEXT-LEVEL: Toggle sound effects
  const handleToggleSound = useCallback(() => {
    const newState = sounds.toggle();
    setSoundEnabled(newState);

    // Play a sample sound if enabling
    if (newState) {
      sounds.playNavigation();
    }
  }, []);

  const handleSkip = useCallback(() => {
    // CRITICAL FIX: Skip button should dismiss the ENTIRE onboarding, not advance to next step
    // Users expect "Skip" to close the onboarding tour completely
    handleDismiss();
  }, [handleDismiss]);

  // PERFORMANCE: Memoize expensive computed values to prevent recalculation on every render
  const allCompleted = useMemo(() =>
    ONBOARDING_STEPS.every(step => completedSteps.has(step.id)),
    [completedSteps, ONBOARDING_STEPS]
  );

  // CRITICAL FIX: Add safety check to prevent division by zero if ONBOARDING_STEPS is empty
  const progressPercentage = useMemo(() => {
    if (ONBOARDING_STEPS.length === 0) return 0;
    return (completedSteps.size / ONBOARDING_STEPS.length) * 100;
  }, [completedSteps.size, ONBOARDING_STEPS.length]);

  // SAFETY: Ensure currentStepData is never undefined
  const currentStepData = useMemo(() => {
    const step = ONBOARDING_STEPS[currentStep];
    if (!step) {
      logger.warn(`[Onboarding] Step at index ${currentStep} is undefined. Steps length: ${ONBOARDING_STEPS.length}`);
      return ONBOARDING_STEPS[0] || null;
    }
    return step;
  }, [currentStep, ONBOARDING_STEPS]);

  // PERFORMANCE: Memoize final step check to avoid recalculation on every render
  const isLastStep = useMemo(() =>
    currentStep === ONBOARDING_STEPS.length - 1,
    [currentStep, ONBOARDING_STEPS.length]
  );

  const handleNext = useCallback(() => {
    // CRITICAL FIX: Prevent state corruption from rapid button clicks
    if (nextInProgressRef.current) {
      logger.warn('[Onboarding] Next already in progress, ignoring duplicate click');
      return;
    }
    nextInProgressRef.current = true;

    // CRITICAL FIX: Mark current step as completed before advancing
    const currentStepObj = ONBOARDING_STEPS[currentStep];

    // Mark current step as completed
    const newCompleted = new Set(completedSteps);
    if (currentStepObj) {
      newCompleted.add(currentStepObj.id);
      setCompletedSteps(newCompleted);

      // Save to localStorage and database immediately
      if (user?.id) {
        // CRITICAL FIX: Ensure next step index is valid before saving
        const nextStepIndex = currentStep + 1;
        const isNextStepValid = nextStepIndex < ONBOARDING_STEPS.length;

        const dataToSave = {
          completed: Array.from(newCompleted),
          dismissed: false,
          // Save valid step index, or current if at end
          currentStep: isNextStepValid ? nextStepIndex : currentStep,
          // Save valid step ID, or current step ID if at end
          currentStepId: isNextStepValid
            ? ONBOARDING_STEPS[nextStepIndex]?.id
            : ONBOARDING_STEPS[currentStep]?.id
        };

        // Immediate save (not debounced) for Next button clicks
        // PERFORMANCE FIX: Use async save to avoid blocking UI on Next click (30-70ms savings)
        asyncLocalStorageSave(`onboarding_${user.id}`, dataToSave);

        // Also update database via sync
        onboardingSync.saveProgress(user.id, dataToSave).catch(err => {
          logger.error('[Onboarding] Failed to sync progress on Next:', err);
        });
      }

      // CRITICAL FIX: Wrap analytics in try-catch to prevent blocking user progress
      // If localStorage quota exceeded or Safari private mode, analytics could throw
      try {
        analytics.stepCompleted(currentStepObj.id, currentStepObj.title);
      } catch (err) {
        logger.error('[Onboarding] Analytics error (non-blocking):', err);
      }
    }

    // Find the next step in sequence
    const nextIndex = currentStep + 1;

    if (nextIndex >= ONBOARDING_STEPS.length) {
      // At the last step - all steps are now complete
      // Don't call handleDismiss - let the useEffect celebration trigger automatically
      // The allCompleted state change will trigger confetti + completion modal
      nextInProgressRef.current = false; // Reset flag
      return;
    }

    // Advance to next step
    setCurrentStep(nextIndex);
    const nextStep = ONBOARDING_STEPS[nextIndex];

    // Navigate to the required page for the next step
    if (nextStep.deepLink?.view) {
      setActiveView(nextStep.deepLink.view);
    }
    if (nextStep.deepLink?.tab) {
      const url = new URL(window.location);
      url.searchParams.set('tab', nextStep.deepLink.tab);
      // HIGH PRIORITY FIX: Use replaceState instead of pushState
      // pushState creates history entries for each step, making browser back button confusing
      window.history.replaceState({}, '', url);
    }

    // CRITICAL FIX: Wrap analytics in try-catch to prevent blocking user progress
    try {
      analytics.navigationClicked(nextStep.id, 'next_button');
    } catch (err) {
      logger.error('[Onboarding] Analytics error (non-blocking):', err);
    }

    // Reset flag after all operations complete
    // Use setTimeout to allow state updates to process first
    // PERFORMANCE FIX: Check if component is still mounted
    setTimeout(() => {
      if (mountedRef.current) {
        nextInProgressRef.current = false;
      }
    }, 100);
  }, [currentStep, completedSteps, user?.id, setActiveView, ONBOARDING_STEPS]);
  // CRITICAL FIX: Removed handleDismiss and onboardingSync from deps to prevent stale closures

  // NEXT-LEVEL: Keyboard navigation (Esc to dismiss, Arrow keys to navigate)
  // CRITICAL FIX: Placed AFTER handleNext/handleSkip definitions to avoid TDZ error
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleDismiss();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        // HIGH PRIORITY FIX: Don't intercept arrow keys if user is typing in input/textarea
        // Previous bug: Arrow keys were blocked globally, preventing cursor navigation in text fields
        const isTyping = e.target.matches('input, textarea, [contenteditable="true"]');
        if (isTyping) return; // Let browser handle arrow keys in inputs

        e.preventDefault();
        // Use Next button logic for forward navigation
        handleNext();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        // HIGH PRIORITY FIX: Don't intercept arrow keys if user is typing
        const isTyping = e.target.matches('input, textarea, [contenteditable="true"]');
        if (isTyping) return;

        e.preventDefault();
        // Use Skip button logic for backward navigation
        handleSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, handleNext, handleSkip, handleDismiss]);

  // PERFORMANCE: Adaptive positioning with optimized checks
  // Only runs when visibility changes or when notifications appear/disappear
  useEffect(() => {
    if (!isVisible) return;

    const checkPosition = () => {
      // PERFORMANCE: Early bailout if no notifications present
      const notifications = document.querySelector('.fixed.bottom-6.right-6.space-y-3');

      if (!notifications) {
        // No notifications, use default position
        setCardPosition({ bottom: 24, right: 24 });
        return;
      }

      // If notifications exist, position above them
      const rect = notifications.getBoundingClientRect();
      const notificationHeight = window.innerHeight - rect.top;
      const bottom = Math.max(24, notificationHeight + 16);
      setCardPosition({ bottom, right: 24 });
    };

    // Initial check
    checkPosition();

    // PERFORMANCE: Use MutationObserver to detect when notifications change
    // instead of polling every second - more efficient!
    const observer = new MutationObserver(checkPosition);
    const notificationArea = document.querySelector('.fixed.bottom-6.right-6') || document.body;

    observer.observe(notificationArea, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    return () => observer.disconnect();
  }, [isVisible]);

  // NEXT-LEVEL: Celebration + show completion modal when all complete
  useEffect(() => {
    if (allCompleted && isVisible && !hasPlayedConfetti.current) {
      // CRITICAL FIX: Set flag immediately to prevent double-trigger in React Strict Mode
      hasPlayedConfetti.current = true;

      // CRITICAL FIX: Wrap analytics in try-catch (non-blocking)
      try {
        const totalTime = Date.now() - stepStartTime.current;
        analytics.completed(totalTime, ONBOARDING_STEPS.length);
      } catch (err) {
        logger.error('[Onboarding] Analytics error (non-blocking):', err);
      }

      // CRITICAL: Mark tour as fully completed (hides replay button permanently)
      if (user?.id) {
        onboardingStorage.setState(user.id, { tourFullyCompleted: true });
        logger.info('[Onboarding] Tour fully completed - replay button permanently hidden');
      }

      // Trigger confetti celebration + sound
      triggerCelebration('bottom-right');
      sounds.playAllComplete();

      // Show completion modal after celebration
      // CRITICAL FIX: Don't call setIsVisible(false) here - it will be called by handleDismiss()
      // Calling it here causes double state update and hooks count mismatch error
      // CRITICAL FIX #2: Check if component is still mounted before state update
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          setShowCompletionModal(true);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [allCompleted, isVisible, ONBOARDING_STEPS, user?.id]);

  // NEXT-LEVEL: Check if dismissed user wants to replay
  // CRITICAL FIX: Never show replay button if tour was fully completed
  useEffect(() => {
    if (!user?.id) return;

    // UNIFIED STORAGE: Check if user dismissed onboarding
    const state = onboardingStorage.getState(user.id);

    // If tour was fully completed, NEVER show replay button
    if (state?.tourFullyCompleted) {
      setShowReplayButton(false);
      return;
    }

    // Only show replay if dismissed but NOT fully completed
    if (state?.dismissed) {
      setShowReplayButton(true);
    }
  }, [user?.id]);

  // CRITICAL FIX: Move hooks BEFORE early returns to fix React error #300
  // SIMPLIFIED: Manage feedback button z-index to make it blend with background during onboarding
  // Lower z-index during onboarding so it sits below backdrops, boost on step 7 to spotlight
  // PERFORMANCE: Cache buttons on mount to avoid repeated DOM queries
  useEffect(() => {
    // Cache buttons on first run
    if (!feedbackButtonsRef.current) {
      feedbackButtonsRef.current = document.querySelectorAll('[data-feedback-button="true"]');
    }

    const feedbackButtons = feedbackButtonsRef.current;
    if (!feedbackButtons.length) return;

    const shouldLowerZIndex = user && (
      !welcomeModalDismissed ||  // Welcome modal showing
      showGoalSelection ||        // Goal selection showing
      (isVisible && currentStepData?.id !== 'share_feedback')  // Steps 1-6
    );

    feedbackButtons.forEach(btn => {
      if (shouldLowerZIndex) {
        // Apply blur and darkness directly to the button to blend with background
        btn.style.filter = 'blur(4px) brightness(0.3)';
        btn.style.opacity = '0.4';
        btn.style.pointerEvents = 'none'; // Disable clicks during onboarding
        btn.style.transition = 'all 0.5s ease';
      } else if (currentStepData?.id === 'share_feedback') {
        // Remove blur, restore brightness for spotlighting
        btn.style.filter = 'none';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.zIndex = '160'; // Will be boosted to 175 by spotlight system
      } else {
        // Normal state (post-onboarding) - clear and clickable
        btn.style.filter = 'none';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.zIndex = '160';
      }
    });
  }, [user, welcomeModalDismissed, showGoalSelection, isVisible, currentStepData]);

  // CRITICAL UX FIX: Disable Kanban column "+" buttons during onboarding tour
  // Prevents users from opening New Deal modal behind the spotlight, which blocks subsequent steps
  // Issue: https://github.com/jeremyholland/StageFlow/issues/onboarding-kanban-plus-button
  useEffect(() => {
    // Query for all column "+" buttons (they have data-tour="column-add-deal")
    const addDealButtons = document.querySelectorAll('[data-tour="column-add-deal"]');
    if (!addDealButtons.length) return;

    // Disable during onboarding steps that involve the pipeline
    const shouldDisable = user && isVisible && (
      currentStepData?.id === 'explore_pipeline' ||     // Step 2: Exploring pipeline
      currentStepData?.id === 'customize_pipeline' ||   // Step 3: Customizing pipeline
      currentStepData?.id === 'add_first_deal'          // Step 1: Adding first deal (top button used instead)
    );

    addDealButtons.forEach(btn => {
      if (shouldDisable) {
        // Disable button completely - prevent modal from opening during tour
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.style.transition = 'all 0.3s ease';
      } else {
        // Re-enable after onboarding or on other steps
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      }
    });
  }, [user, isVisible, currentStepData]);

  // REMOVED: Replay Tour button - per user request
  // The floating button in bottom-right corner has been permanently removed from the UI
  // Users can still access onboarding through Settings if needed in the future

  // MOBILE BYPASS: Skip onboarding for phones (< 768px)
  const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768;
  if (isMobileDevice) return null;

  // Show goal selection if needed
  if (showGoalSelection) {
    return (
      <OnboardingGoalSelection
        isOpen={showGoalSelection}
        onGoalSelected={handleGoalSelected}
      />
    );
  }

  // CRITICAL FIX: Conditional rendering to avoid early returns (fixes React Hooks Error #300)
  // Early returns after hooks violate React's rules of hooks
  const shouldShowCompletionModal = showCompletionModal && user;
  const shouldShowOnboarding = user && welcomeModalDismissed && userGoal && isVisible;

  // currentStepData is now memoized above - no need to recalculate

  // CRITICAL: Single return statement with conditional JSX (no early returns after hooks)
  return (
    <>
      {/* Completion Modal - always render when needed, even if onboarding is hidden */}
      {shouldShowCompletionModal && (
        <OnboardingCompletionModal
          isOpen={true}
          userId={user?.id}
          onClose={() => handleCompletionDismiss()}
          onExploreMore={(view) => handleCompletionDismiss(view)}
        />
      )}

      {/* Only render the full onboarding checklist if all conditions are met */}
      {shouldShowOnboarding && (
        <>

      {/* NEXT-LEVEL v2.5: Help Panel */}
      <OnboardingHelpPanel
        stepId={ONBOARDING_STEPS[currentStep]?.id}
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
      />

      {/* NEXT-LEVEL v2.5: Analytics Dashboard */}
      <OnboardingAnalyticsDashboard
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
      />

      {/* Premium Spotlight Effect - darkens everything except highlighted element */}
      {/* CRITICAL UX FIX: Hide spotlight when completion modal is showing */}
      {spotlightPosition && !showCompletionModal && (
        <>
          {/* Dark backdrop overlay with cutout - PREMIUM GLASS DESIGN
              CRITICAL: z-index must be above feedback widget (z-160) to darken it */}
          <div
            className="fixed z-[170] pointer-events-none"
            style={{
              top: spotlightPosition.top,
              left: spotlightPosition.left,
              width: spotlightPosition.width,
              height: spotlightPosition.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.95)',
              borderRadius: '16px',
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />

          {/* CRITICAL FIX: Edge glow only - clear center for visibility */}
          <div
            className="fixed z-[171] pointer-events-none"
            style={{
              top: spotlightPosition.top - 12,
              left: spotlightPosition.left - 12,
              width: spotlightPosition.width + 24,
              height: spotlightPosition.height + 24,
              borderRadius: '18px',
              background: 'radial-gradient(ellipse at center, transparent 0%, transparent 40%, rgba(255, 255, 255, 0.15) 70%, rgba(255, 255, 255, 0.05) 100%)',
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />

          {/* Premium Teal Glow - using Tailwind teal-500 (rgb(20, 184, 166)) */}
          <div
            className="fixed z-[172] pointer-events-none animate-pulse"
            style={{
              top: spotlightPosition.top,
              left: spotlightPosition.left,
              width: spotlightPosition.width,
              height: spotlightPosition.height,
              borderRadius: '16px',
              boxShadow: `
                0 0 0 4px rgba(20, 184, 166, 1),
                0 0 40px 15px rgba(20, 184, 166, 0.9),
                0 0 80px 25px rgba(20, 184, 166, 0.7)
              `,
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />
        </>
      )}

      {/* Onboarding Card - positioned smartly near the highlighted element */}
      {/* CRITICAL UX FIX: Hide checklist when completion modal is showing */}
      {!showCompletionModal && (
      <div
        ref={checklistRef}
        data-testid="onboarding-checklist"
        className={`fixed z-[180] transition-all duration-500 ${isMobile ? 'w-full px-4 left-0 right-0' : 'w-full max-w-md'}`}
        style={(() => {
          // PERFORMANCE: Use memoized currentStepData instead of recalculating
          const navbarHeight = 80; // h-16 (64px) + 16px padding = 80px clearance

          // CRITICAL UX FIX: On final step (share_feedback), CENTER the card
          // so it doesn't cover the feedback button in the bottom-right corner
          if (currentStepData?.id === 'share_feedback') {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const cardWidth = isMobile ? viewportWidth - 32 : 400; // Account for mobile padding

            return {
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              right: 'auto',
              bottom: 'auto'
            };
          }

          // CRITICAL FIX: For steps involving scrollable containers (pipeline exploration),
          // use FIXED positioning that doesn't change when scrolling
          const isScrollableStep = currentStepData && [
            'explore_pipeline',
            'customize_pipeline',
            'edit_deal_details',
            'assign_deals',
            'invite_team'
          ].includes(currentStepData.id);

          if (!spotlightPosition || isScrollableStep) {
            // Fixed position: upper right corner with navbar clearance
            // CRITICAL: Add extra clearance to prevent overlap with navbar (h-16 = 64px)
            return {
              top: isMobile ? '80px' : '96px', // Mobile: 80px, Desktop: 96px for extra clearance
              right: isMobile ? '0' : '24px',
              left: isMobile ? '0' : 'auto',
              bottom: 'auto'
            };
          }

          const cardWidth = 400;
          const cardHeight = 500;
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const padding = 24;

          // CRITICAL UX FIX: ALWAYS keep card on right side - no left/right shifting
          // User feedback: Card shifting left-to-right during Settings navigation is glitchy
          // Calculate which vertical half the spotlight is in
          const spotlightCenterY = spotlightPosition.top + (spotlightPosition.height / 2);
          const isTopHalf = spotlightCenterY < viewportHeight / 2;

          // Position card ALWAYS on right side, adjust top/bottom only
          let position = { top: 'auto', bottom: 'auto', right: padding };

          if (isTopHalf) {
            // Spotlight is in top half → position card bottom-right
            position.bottom = padding;
          } else {
            // Spotlight is in bottom half → position card top-right
            position.top = Math.max(navbarHeight, padding); // Ensure navbar clearance
          }

          return {
            top: position.top !== 'auto' ? `${position.top}px` : 'auto',
            bottom: position.bottom !== 'auto' ? `${position.bottom}px` : 'auto',
            left: 'auto', // NEVER use left - always right side
            right: isMobile ? '0' : `${position.right}px`
          };
        })()}
        role="dialog"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        aria-live="polite"
      >
        <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gray-800/50 border-b border-gray-700 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-teal-500/20 ring-2 ring-teal-500/10 flex items-center justify-center">
                <Circle className="w-4 h-4 text-teal-400" aria-hidden="true" />
              </div>
              <div>
                <h3 id="onboarding-title" className="text-lg font-bold text-white">Getting Started</h3>
                <p id="onboarding-description" className="text-xs text-gray-400">
                  {completedSteps.size} of {ONBOARDING_STEPS.length} completed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* NEXT-LEVEL v2.5: Help button */}
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="p-2 hover:bg-gray-800/50 rounded-lg transition-all hover:scale-110 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                aria-label="Show help"
                title="Get Help"
              >
                <HelpCircle className="w-4 h-4" />
              </button>

              {/* NEXT-LEVEL v2.5: Analytics button (dev mode) */}
              {import.meta.env.DEV && (
                <button
                  onClick={() => setShowAnalytics(!showAnalytics)}
                  className="p-2 hover:bg-gray-800/50 rounded-lg transition-all hover:scale-110 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  aria-label="Show analytics"
                  title="View Analytics"
                >
                  <BarChart2 className="w-4 h-4" />
                </button>
              )}

              {/* DEVELOPMENT MODE: Full reset button */}
              {import.meta.env.DEV && (
                <button
                  onClick={(e) => {
                    e.shiftKey = true; // Force full reset mode
                    handleReplay(e);
                  }}
                  className="p-2 hover:bg-red-900/50 rounded-lg transition-all hover:scale-110 text-red-400 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                  aria-label="Full reset (clears deals and progress)"
                  title="Full Reset (Dev Mode)"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}

              {/* NEXT-LEVEL: Sound toggle button (dev mode only) */}
              {import.meta.env.DEV && (
                <button
                  onClick={handleToggleSound}
                  className="p-2 hover:bg-gray-800/50 rounded-lg transition-all hover:scale-110 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  aria-label={soundEnabled ? 'Disable sound effects' : 'Enable sound effects'}
                  title={soundEnabled ? 'Sound On' : 'Sound Off'}
                >
                  {soundEnabled ? (
                    <Volume2 className="w-4 h-4" />
                  ) : (
                    <VolumeX className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                onClick={handleDismiss}
                className="p-2 hover:bg-gray-800/50 rounded-lg transition-all hover:scale-110 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                aria-label="Close onboarding checklist (Esc)"
                title="Press Esc to close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* NEXT-LEVEL: Progress bar with milestones */}
          <div className="relative h-1 bg-gray-900">
            <div
              className="h-full bg-teal-500 transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            >
              {/* PERFORMANCE: Removed shimmer animation - CPU intensive on mobile */}
            </div>
            {/* Milestone markers */}
            {ONBOARDING_STEPS.map((_, index) => (
              <div
                key={index}
                className={`absolute top-0 h-full w-0.5 transition-colors duration-300 ${
                  index < completedSteps.size ? 'bg-gray-600' : 'bg-gray-800'
                }`}
                style={{ left: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }}
              />
            ))}
          </div>

          {/* Steps list */}
          <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
            {ONBOARDING_STEPS.map((step, index) => {
              const isCompleted = completedSteps.has(step.id);
              const isCurrent = index === currentStep;

              return (
                <div key={step.id} className="relative">
                  <div
                    className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                      isCurrent
                        ? 'border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/20'
                        : isCompleted
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-gray-700 bg-gray-800/50'
                    }`}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Step ${index + 1}: ${step.title}. ${isCompleted ? 'Completed' : isCurrent ? 'Current step' : 'Not started'}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox/Status icon with animation */}
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                        isCompleted
                          ? 'bg-green-500 border-green-500 scale-100'
                          : isCurrent
                          ? 'border-teal-500 bg-teal-500/20 scale-110'
                          : 'border-gray-600'
                      }`}>
                        {isCompleted ? (
                          <Check
                            className="w-4 h-4 text-white animate-in fade-in zoom-in duration-300"
                            strokeWidth={3}
                            aria-hidden="true"
                          />
                        ) : isCurrent ? (
                          <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse" aria-hidden="true" />
                        ) : (
                          <div className="w-2 h-2 bg-gray-600 rounded-full" aria-hidden="true" />
                        )}
                      </div>

                      {/* Step content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className={`font-semibold text-sm mb-1 ${
                            isCurrent ? 'text-white' : isCompleted ? 'text-green-400' : 'text-gray-400'
                          }`}>
                            {step.title}
                          </h4>
                          {isCurrent && !isCompleted && (
                            <ChevronRight className="w-4 h-4 text-teal-400 animate-pulse" aria-hidden="true" />
                          )}
                        </div>
                        <p className={`text-xs ${
                          isCurrent ? 'text-gray-300' : 'text-gray-500'
                        }`}>
                          {step.description}
                        </p>

                        {/* NEXT-LEVEL: Enhanced tooltip with rich description */}
                        {isCurrent && step.tooltip && (
                          <p className="text-xs text-white/60 mt-2 pt-2 border-t border-white/10">
                            {step.tooltip}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* NEXT-LEVEL: Smart contextual hint */}
                  {isCurrent && !isCompleted && showHint && step.hint && (
                    <div className="mt-2 p-3 bg-gradient-to-r from-[#F39C12]/20 to-[#E67E22]/20 border border-[#F39C12]/30 rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 text-[#F39C12] flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-xs text-white/90">{step.hint}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="p-4 border-t border-white/10 flex gap-3">
            <button
              onClick={handleSkip}
              data-testid="onboarding-skip"
              className="flex-1 px-4 py-2.5 border border-white/20 text-white/70 rounded-lg hover:bg-white/10 hover:text-white transition-all duration-200 hover:scale-105 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-[#1ABC9C] focus:ring-offset-2 focus:ring-offset-[#0D1F2D]"
              aria-label="Skip to next incomplete step"
            >
              Skip
            </button>
            {allCompleted ? (
              <button
                onClick={handleDismiss}
                data-testid="onboarding-next"
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white rounded-lg hover:shadow-lg hover:shadow-[#1ABC9C]/30 transition-all duration-200 hover:scale-105 font-medium text-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#1ABC9C] focus:ring-offset-2 focus:ring-offset-[#0D1F2D]"
                aria-label="Complete onboarding and close"
              >
                {/* PERFORMANCE: Removed shimmer effect - CPU intensive on mobile */}
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>Complete 🎉</span>
              </button>
            ) : (
              <button
                onClick={handleNext}
                data-testid="onboarding-next"
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#1ABC9C] to-[#16A085] text-white rounded-lg hover:shadow-lg hover:shadow-[#1ABC9C]/30 transition-all duration-200 hover:scale-105 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-[#1ABC9C] focus:ring-offset-2 focus:ring-offset-[#0D1F2D]"
                aria-label={isLastStep ? 'Complete onboarding' : (completedSteps.has(currentStepData.id) ? 'Advance to next step' : 'Navigate to complete this step')}
              >
                {isLastStep ? 'Complete ✓' : (completedSteps.has(currentStepData.id) ? 'Next →' : 'Next')}
              </button>
            )}
          </div>

          {/* NEXT-LEVEL: Keyboard hint */}
          <div className="px-4 pb-3 text-center">
            <p className="text-xs text-white/40">
              Use <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">←</kbd> <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">→</kbd> to navigate • <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">Esc</kbd> to close
            </p>
          </div>
        </div>
      </div>
      )}
        </>
      )}
    </>
  );
};

// NEXT-LEVEL: Export memoized version to prevent unnecessary re-renders
export const OnboardingChecklist = memo(OnboardingChecklistComponent, (prevProps, nextProps) => {
  return prevProps.onComplete === nextProps.onComplete;
});

OnboardingChecklist.displayName = 'OnboardingChecklist';
