/**
 * Onboarding Sound Effects
 * Subtle audio feedback for interactions (with accessibility support)
 */

export class OnboardingSounds {
  constructor() {
    // CRITICAL FIX #14: Don't call shouldEnableSounds() in constructor
    // Defer to first use to prevent TDZ errors
    this.enabled = null; // Will be set on first use
    this.audioContext = null;
    this.initialized = false;
  }

  /**
   * Check if sounds should be enabled based on user preferences
   * Lazy initialization - only called when needed
   */
  shouldEnableSounds() {
    if (typeof window === 'undefined') return false;

    // Check if Web Audio API is supported
    if (!window.AudioContext && !window.webkitAudioContext) {
      return false;
    }

    // Check for reduced motion preference (often correlates with reduced sensory input)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Check localStorage preference
    let userPreference = null;
    try {
      userPreference = localStorage.getItem('onboarding_sounds_enabled');
    } catch (error) {
      // localStorage might be disabled or unavailable
      console.warn('[OnboardingSounds] localStorage not available:', error);
    }

    if (userPreference !== null) {
      return userPreference === 'true';
    }

    // Default: enabled unless reduced motion is preferred
    return !prefersReducedMotion;
  }

  /**
   * Get enabled state (lazy initialization)
   */
  isEnabled() {
    if (this.enabled === null) {
      this.enabled = this.shouldEnableSounds();
    }
    return this.enabled;
  }

  /**
   * Initialize audio context (must be called after user interaction)
   */
  init() {
    // CRITICAL FIX: Check actual audioContext existence, not just initialized flag
    // Prevents race condition where initialized=true but audioContext=null after failed init
    if (this.audioContext || !this.isEnabled()) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.initialized = true;
    } catch (error) {
      console.warn('Web Audio API not supported:', error);
      this.enabled = false;
      // CRITICAL FIX: Reset initialized flag on error to prevent stale state
      this.initialized = false;
    }
  }

  /**
   * Play a frequency for a duration
   */
  playTone(frequency, duration, type = 'sine') {
    if (!this.isEnabled() || !this.initialized) return;

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      // Gentle fade in/out to avoid clicks
      const now = this.audioContext.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.1, now + 0.01); // Very subtle volume
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (error) {
      console.warn('Failed to play sound:', error);
    }
  }

  /**
   * Play step complete sound (pleasant upward tone)
   */
  playStepComplete() {
    this.init();
    this.playTone(800, 0.1, 'sine');
    setTimeout(() => this.playTone(1000, 0.15, 'sine'), 50);
  }

  /**
   * Play all complete sound (celebration chord)
   */
  playAllComplete() {
    this.init();
    // C major chord (C, E, G)
    this.playTone(523.25, 0.3, 'sine'); // C5
    setTimeout(() => this.playTone(659.25, 0.3, 'sine'), 50); // E5
    setTimeout(() => this.playTone(783.99, 0.4, 'sine'), 100); // G5
  }

  /**
   * Play navigation sound (subtle click)
   */
  playNavigation() {
    this.init();
    this.playTone(600, 0.05, 'triangle');
  }

  /**
   * Play hint sound (gentle notification)
   */
  playHint() {
    this.init();
    this.playTone(700, 0.1, 'sine');
    setTimeout(() => this.playTone(750, 0.1, 'sine'), 100);
  }

  /**
   * Enable/disable sounds
   */
  setEnabled(enabled) {
    this.enabled = enabled;

    // Safely save to localStorage
    try {
      localStorage.setItem('onboarding_sounds_enabled', enabled.toString());
    } catch (error) {
      console.warn('[OnboardingSounds] Failed to save preference:', error);
    }

    if (!enabled && this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.initialized = false;
    }
  }

  /**
   * Toggle sounds on/off
   */
  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }
}

// Singleton instance
export const sounds = new OnboardingSounds();
