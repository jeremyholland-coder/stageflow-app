/**
 * Onboarding Performance Monitor
 * Tracks FPS, interaction latency, and render performance
 * Helps identify performance bottlenecks
 */

export class OnboardingPerformance {
  constructor() {
    this.metrics = {
      fps: [],
      interactionLatency: [],
      renderTimes: [],
      memoryUsage: []
    };

    this.monitoring = false;
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.fpsInterval = null;
    this.rafId = null;
  }

  /**
   * Start monitoring performance
   */
  start() {
    if (this.monitoring) return;

    this.monitoring = true;
    this.frameCount = 0;
    this.lastFrameTime = performance.now();

    // Monitor FPS
    this.startFPSMonitoring();

    // Monitor memory (if available)
    this.startMemoryMonitoring();
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.monitoring = false;

    if (this.fpsInterval) {
      clearInterval(this.fpsInterval);
      this.fpsInterval = null;
    }

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = null;
    }
  }

  /**
   * Monitor FPS using requestAnimationFrame
   */
  startFPSMonitoring() {
    let frames = 0;
    let lastTime = performance.now();

    const measureFPS = () => {
      if (!this.monitoring) return;

      frames++;
      const currentTime = performance.now();
      const elapsed = currentTime - lastTime;

      // Calculate FPS every second
      if (elapsed >= 1000) {
        const fps = Math.round((frames * 1000) / elapsed);
        this.recordFPS(fps);

        frames = 0;
        lastTime = currentTime;
      }

      this.rafId = requestAnimationFrame(measureFPS);
    };

    this.rafId = requestAnimationFrame(measureFPS);
  }

  /**
   * Monitor memory usage (Chrome only)
   */
  startMemoryMonitoring() {
    if (!performance.memory) {
      console.warn('[Performance] Memory monitoring not available');
      return;
    }

    this.memoryInterval = setInterval(() => {
      if (!this.monitoring) return;

      const memory = {
        usedJSHeapSize: performance.memory.usedJSHeapSize / 1048576, // MB
        totalJSHeapSize: performance.memory.totalJSHeapSize / 1048576, // MB
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit / 1048576, // MB
        timestamp: Date.now()
      };

      this.recordMemory(memory);
    }, 5000); // Every 5 seconds
  }

  /**
   * Record FPS sample
   */
  recordFPS(fps) {
    this.metrics.fps.push({
      value: fps,
      timestamp: Date.now()
    });

    // Keep last 60 samples (1 minute at 1 sample/second)
    if (this.metrics.fps.length > 60) {
      this.metrics.fps.shift();
    }

    // Warn if FPS drops below 30
    if (fps < 30) {
      console.warn(`[Performance] Low FPS detected: ${fps}`);
    }
  }

  /**
   * Record interaction latency
   */
  recordInteraction(eventType, latency) {
    this.metrics.interactionLatency.push({
      eventType,
      latency,
      timestamp: Date.now()
    });

    // Keep last 100 interactions
    if (this.metrics.interactionLatency.length > 100) {
      this.metrics.interactionLatency.shift();
    }

    // Warn if latency exceeds 100ms (noticeable lag)
    if (latency > 100) {
      console.warn(`[Performance] High latency for ${eventType}: ${latency}ms`);
    }
  }

  /**
   * Record render time
   */
  recordRender(componentName, duration) {
    this.metrics.renderTimes.push({
      componentName,
      duration,
      timestamp: Date.now()
    });

    // Keep last 100 renders
    if (this.metrics.renderTimes.length > 100) {
      this.metrics.renderTimes.shift();
    }

    // Warn if render takes more than 16ms (60fps budget)
    if (duration > 16) {
      console.warn(`[Performance] Slow render for ${componentName}: ${duration}ms`);
    }
  }

  /**
   * Record memory usage
   */
  recordMemory(memory) {
    this.metrics.memoryUsage.push(memory);

    // Keep last 60 samples (5 minutes at 1 sample/5s)
    if (this.metrics.memoryUsage.length > 60) {
      this.metrics.memoryUsage.shift();
    }

    // Warn if memory usage exceeds 100MB
    if (memory.usedJSHeapSize > 100) {
      console.warn(`[Performance] High memory usage: ${memory.usedJSHeapSize.toFixed(2)}MB`);
    }
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const avgFPS = this.metrics.fps.length > 0
      ? this.metrics.fps.reduce((sum, m) => sum + m.value, 0) / this.metrics.fps.length
      : 0;

    const avgLatency = this.metrics.interactionLatency.length > 0
      ? this.metrics.interactionLatency.reduce((sum, m) => sum + m.latency, 0) / this.metrics.interactionLatency.length
      : 0;

    const avgRenderTime = this.metrics.renderTimes.length > 0
      ? this.metrics.renderTimes.reduce((sum, m) => sum + m.duration, 0) / this.metrics.renderTimes.length
      : 0;

    const avgMemory = this.metrics.memoryUsage.length > 0
      ? this.metrics.memoryUsage.reduce((sum, m) => sum + m.usedJSHeapSize, 0) / this.metrics.memoryUsage.length
      : 0;

    // HIGH PRIORITY FIX: Prevent Infinity/-Infinity from Math.min/max on empty arrays
    // Math.min() with empty spread returns Infinity, Math.max() returns -Infinity
    // This corrupts analytics data and causes JSON serialization issues
    return {
      fps: {
        average: Math.round(avgFPS),
        min: this.metrics.fps.length > 0 ? Math.min(...this.metrics.fps.map(m => m.value)) : 0,
        max: this.metrics.fps.length > 0 ? Math.max(...this.metrics.fps.map(m => m.value)) : 0,
        samples: this.metrics.fps.length
      },
      interactionLatency: {
        average: Math.round(avgLatency),
        min: this.metrics.interactionLatency.length > 0 ? Math.min(...this.metrics.interactionLatency.map(m => m.latency)) : 0,
        max: this.metrics.interactionLatency.length > 0 ? Math.max(...this.metrics.interactionLatency.map(m => m.latency)) : 0,
        samples: this.metrics.interactionLatency.length
      },
      renderTime: {
        average: avgRenderTime.toFixed(2),
        min: this.metrics.renderTimes.length > 0 ? Math.min(...this.metrics.renderTimes.map(m => m.duration)).toFixed(2) : '0.00',
        max: this.metrics.renderTimes.length > 0 ? Math.max(...this.metrics.renderTimes.map(m => m.duration)).toFixed(2) : '0.00',
        samples: this.metrics.renderTimes.length
      },
      memory: {
        average: avgMemory.toFixed(2),
        current: this.metrics.memoryUsage.length > 0
          ? this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1].usedJSHeapSize.toFixed(2)
          : 0,
        samples: this.metrics.memoryUsage.length
      }
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics = {
      fps: [],
      interactionLatency: [],
      renderTimes: [],
      memoryUsage: []
    };
  }

  /**
   * Measure interaction performance (HOF)
   */
  measureInteraction(eventType, callback) {
    return (...args) => {
      const startTime = performance.now();

      const result = callback(...args);

      // Handle async callbacks
      if (result instanceof Promise) {
        return result.then((value) => {
          const endTime = performance.now();
          this.recordInteraction(eventType, endTime - startTime);
          return value;
        });
      } else {
        const endTime = performance.now();
        this.recordInteraction(eventType, endTime - startTime);
        return result;
      }
    };
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics() {
    return JSON.stringify({
      summary: this.getSummary(),
      metrics: this.metrics,
      timestamp: new Date().toISOString()
    }, null, 2);
  }
}

// Export singleton instance (components expect object, not function)
export const performanceMonitor = new OnboardingPerformance();
