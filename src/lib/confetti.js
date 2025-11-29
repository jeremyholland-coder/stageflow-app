/**
 * Apple-Quality Confetti Animation
 * Lightweight, performant confetti effect for celebrations
 * No external dependencies, pure JavaScript
 */

export class ConfettiCelebration {
  constructor() {
    this.particles = [];
    this.canvas = null;
    this.ctx = null;
    this.animationFrame = null;
    this.resizeHandler = null;
  }

  /**
   * Creates and launches confetti celebration
   * @param {Object} options - Configuration options
   */
  celebrate(options = {}) {
    const {
      duration = 3000,
      particleCount = 150,
      origin = { x: 0.5, y: 0.5 },
      colors = ['#1ABC9C', '#16A085', '#27AE60', '#2ECC71', '#3498DB', '#9B59B6'],
      spread = 360,
      startVelocity = 45,
      decay = 0.9,
      gravity = 1,
      drift = 0,
      ticks = 200
    } = options;

    // Create canvas if it doesn't exist
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'fixed';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex = '9999';
      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      this.resizeHandler = () => this.resize();
      window.addEventListener('resize', this.resizeHandler);
    }

    // Create particles
    const centerX = this.canvas.width * origin.x;
    const centerY = this.canvas.height * origin.y;

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.random() * spread - spread / 2) * (Math.PI / 180);
      const velocity = startVelocity * (0.5 + Math.random() * 0.5);

      this.particles.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 8 + Math.random() * 4,
        decay,
        gravity,
        drift,
        ticks: ticks + Math.floor(Math.random() * 50),
        ticksElapsed: 0,
        opacity: 1,
        shape: Math.random() > 0.5 ? 'square' : 'circle'
      });
    }

    // Start animation
    if (!this.animationFrame) {
      this.animate();
    }

    // Auto cleanup
    setTimeout(() => this.cleanup(), duration);
  }

  resize() {
    if (this.canvas) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
  }

  animate() {
    if (!this.ctx || !this.canvas) return;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Update and draw particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Update position
      p.x += p.vx;
      p.y += p.vy + p.gravity;
      p.vx *= p.decay;
      p.vy *= p.decay;
      p.vy += p.gravity;
      p.rotation += p.rotationSpeed;
      p.ticksElapsed++;

      // Update opacity (fade out near end)
      const progress = p.ticksElapsed / p.ticks;
      p.opacity = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;

      // Remove if done
      if (p.ticksElapsed >= p.ticks || p.y > this.canvas.height + 100) {
        this.particles.splice(i, 1);
        continue;
      }

      // Draw particle
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate((p.rotation * Math.PI) / 180);
      this.ctx.globalAlpha = p.opacity;
      this.ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        this.ctx.beginPath();
        this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }

      this.ctx.restore();
    }

    // Continue animation if particles exist
    if (this.particles.length > 0) {
      this.animationFrame = requestAnimationFrame(() => this.animate());
    } else {
      this.animationFrame = null;
    }
  }

  cleanup() {
    // CRITICAL FIX: Always cleanup canvas, don't wait for particles to finish
    // Bug: If user switches tabs during animation, browser suspends RAF callbacks
    // Particles never get removed, cleanup() sees particles.length > 0, canvas not removed
    // Result: Memory leak with orphaned canvas in DOM
    if (this.canvas) {
      // CRITICAL FIX: Remove event listener FIRST (before any operations that might throw)
      // This ensures the resize handler is always cleaned up, even if canvas removal fails
      if (this.resizeHandler) {
        try {
          window.removeEventListener('resize', this.resizeHandler);
        } catch (e) {
          // Ignore error, but handler reference is still cleared below
        }
        this.resizeHandler = null;
      }

      // Cancel any pending animation frame
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      // Safely remove canvas from DOM
      try {
        if (this.canvas && this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      } catch (e) {
        // Canvas already removed or DOM error, ignore
      }

      // Clear all references
      this.canvas = null;
      this.ctx = null;
      this.particles = []; // Clear any remaining particles
    }
  }

  /**
   * Preset: Bottom-right burst (perfect for onboarding completion)
   */
  celebrateBottomRight() {
    this.celebrate({
      particleCount: 100,
      origin: { x: 0.9, y: 0.9 },
      spread: 120,
      startVelocity: 35,
      colors: ['#1ABC9C', '#16A085', '#27AE60', '#2ECC71'],
      decay: 0.92
    });
  }

  /**
   * Preset: Full screen explosion
   */
  celebrateFullScreen() {
    this.celebrate({
      particleCount: 200,
      origin: { x: 0.5, y: 0.5 },
      spread: 360,
      startVelocity: 55,
      decay: 0.9
    });
  }

  /**
   * Preset: Subtle celebration (reduced motion)
   */
  celebrateSubtle() {
    this.celebrate({
      particleCount: 30,
      origin: { x: 0.9, y: 0.9 },
      spread: 60,
      startVelocity: 20,
      colors: ['#1ABC9C', '#27AE60'],
      decay: 0.95,
      duration: 1500
    });
  }
}

// Singleton instance
export const confetti = new ConfettiCelebration();

// Convenience function
export function triggerCelebration(type = 'default') {
  // CRITICAL FIX #14: Guard window.matchMedia access
  const prefersReducedMotion = typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    confetti.celebrateSubtle();
  } else {
    switch (type) {
      case 'bottom-right':
        confetti.celebrateBottomRight();
        break;
      case 'full-screen':
        confetti.celebrateFullScreen();
        break;
      default:
        confetti.celebrate();
    }
  }
}
