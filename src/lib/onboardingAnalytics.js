/**
 * Onboarding Analytics Tracker
 * Tracks user behavior and completion metrics for optimization
 */
import { logger } from './logger';

export class OnboardingAnalytics {
  constructor() {
    this.sessionId = this.generateSessionId();
    this.events = [];
    this.startTime = Date.now();
  }

  generateSessionId() {
    return `onboarding_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Track onboarding event
   */
  trackEvent(eventName, properties = {}) {
    const event = {
      sessionId: this.sessionId,
      eventName,
      properties,
      timestamp: Date.now(),
      timeFromStart: Date.now() - this.startTime,
      url: window.location.pathname
    };

    this.events.push(event);

    // Store in localStorage for persistence
    try {
      const stored = JSON.parse(localStorage.getItem('onboarding_analytics') || '[]');
      stored.push(event);
      // Keep last 100 events
      if (stored.length > 100) stored.shift();
      localStorage.setItem('onboarding_analytics', JSON.stringify(stored));
    } catch (error) {
      console.warn('Failed to store analytics:', error);
    }

    // Log to console in development
    if (import.meta.env.DEV) {
      logger.log(`[Onboarding Analytics] ${eventName}`, properties);
    }

    return event;
  }

  /**
   * Track step view
   */
  stepViewed(stepId, stepTitle) {
    return this.trackEvent('step_viewed', {
      stepId,
      stepTitle
    });
  }

  /**
   * Track step completion
   */
  stepCompleted(stepId, stepTitle, timeToComplete) {
    return this.trackEvent('step_completed', {
      stepId,
      stepTitle,
      timeToComplete
    });
  }

  /**
   * Track navigation click
   */
  navigationClicked(stepId, method = 'click') {
    return this.trackEvent('navigation_clicked', {
      stepId,
      method // 'click', 'keyboard', 'auto'
    });
  }

  /**
   * Track hint shown
   */
  hintShown(stepId, hintType, timeUntilShown) {
    return this.trackEvent('hint_shown', {
      stepId,
      hintType, // 'timeout', 'hover', 'manual'
      timeUntilShown
    });
  }

  /**
   * Track dismissal
   */
  dismissed(reason, completionRate) {
    return this.trackEvent('onboarding_dismissed', {
      reason, // 'close_button', 'escape_key', 'completed'
      completionRate,
      totalTime: Date.now() - this.startTime
    });
  }

  /**
   * Track completion
   */
  completed(totalTime, stepsCompleted) {
    return this.trackEvent('onboarding_completed', {
      totalTime,
      stepsCompleted,
      completionRate: 100
    });
  }

  /**
   * Track replay
   */
  replayed() {
    return this.trackEvent('onboarding_replayed', {
      previousSessionId: this.sessionId
    });
  }

  /**
   * Get analytics summary
   */
  getSummary() {
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem('onboarding_analytics') || '[]');
    } catch (error) {
      logger.error('Failed to parse analytics data from localStorage:', error);
      stored = [];
    }

    const completed = stored.filter(e => e.eventName === 'onboarding_completed').length;
    const dismissed = stored.filter(e => e.eventName === 'onboarding_dismissed').length;
    const replayed = stored.filter(e => e.eventName === 'onboarding_replayed').length;

    const avgCompletionTime = stored
      .filter(e => e.eventName === 'onboarding_completed')
      .reduce((sum, e) => sum + e.properties.totalTime, 0) / completed || 0;

    return {
      totalSessions: stored.filter(e => e.eventName === 'step_viewed' && e.properties.stepId === 'create-deal').length,
      completed,
      dismissed,
      replayed,
      completionRate: completed / (completed + dismissed) * 100 || 0,
      avgCompletionTime,
      allEvents: stored
    };
  }

  /**
   * Export metrics as JSON for analysis
   * Returns both summary statistics and raw event data
   */
  exportMetrics() {
    const summary = this.getSummary();

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      sessionId: this.sessionId,
      summary: {
        totalSessions: summary.totalSessions,
        completed: summary.completed,
        dismissed: summary.dismissed,
        replayed: summary.replayed,
        completionRate: summary.completionRate.toFixed(2) + '%',
        avgCompletionTime: summary.avgCompletionTime
      },
      events: summary.allEvents,
      sessionEvents: this.events, // Current session only
      metadata: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        screenSize: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp: Date.now()
      }
    }, null, 2);
  }

  /**
   * Clear analytics data
   */
  clear() {
    localStorage.removeItem('onboarding_analytics');
    this.events = [];
  }
}

// Singleton instance
export const analytics = new OnboardingAnalytics();
