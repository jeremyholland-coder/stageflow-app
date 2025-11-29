/**
 * Advanced Image Optimization System
 * Automatic WebP conversion, lazy loading, responsive images
 *
 * Features:
 * - WebP format with fallback
 * - Lazy loading with Intersection Observer
 * - Responsive images (srcset)
 * - Blur-up placeholder technique
 * - Progressive loading
 *
 * Performance Impact:
 * - 30-50% smaller image sizes (WebP)
 * - Faster initial page load (lazy loading)
 * - Better perceived performance (blur-up)
 *
 * @author StageFlow Engineering
 * @date November 14, 2025
 */

import { useState, useEffect, useRef } from 'react';
import { logger } from './logger';

/**
 * Check WebP support
 */
export function supportsWebP() {
  if (typeof window === 'undefined') return false;

  const elem = document.createElement('canvas');
  if (elem.getContext && elem.getContext('2d')) {
    return elem.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  }
  return false;
}

/**
 * Generate responsive image URLs
 */
export function generateResponsiveUrls(baseUrl, sizes = [320, 640, 960, 1280, 1920]) {
  const urls = sizes.map((size) => {
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set('width', size);
    url.searchParams.set('quality', '80');

    return {
      url: url.toString(),
      width: size,
    };
  });

  return urls;
}

/**
 * Convert image to WebP format
 */
export function toWebP(imageUrl) {
  if (!imageUrl) return null;

  // If Supabase storage or similar, add format parameter
  try {
    const url = new URL(imageUrl, window.location.origin);
    url.searchParams.set('format', 'webp');
    return url.toString();
  } catch {
    // If URL parsing fails, return original
    return imageUrl;
  }
}

/**
 * Generate blur placeholder (tiny, blurred version)
 */
export function generateBlurPlaceholder(imageUrl, width = 20) {
  try {
    const url = new URL(imageUrl, window.location.origin);
    url.searchParams.set('width', width);
    url.searchParams.set('quality', '10');
    url.searchParams.set('blur', '50');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Lazy load image with Intersection Observer
 */
export function useLazyImage(src, options = {}) {
  const {
    threshold = 0.01,
    rootMargin = '50px',
    placeholderSrc = null,
  } = options;

  const [imageSrc, setImageSrc] = useState(placeholderSrc);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!src) return;

    // If IntersectionObserver not supported, load immediately
    if (!window.IntersectionObserver) {
      setImageSrc(src);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Load image when visible
          const img = new Image();

          img.onload = () => {
            setImageSrc(src);
            setIsLoaded(true);
            logger.log('[LazyImage] ✓ Loaded:', src);
          };

          img.onerror = (err) => {
            setError('Failed to load image');
            console.error('[LazyImage] ✗ Failed:', src, err);
          };

          img.src = src;

          // Disconnect observer after loading
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [src, threshold, rootMargin]);

  return { imgRef, imageSrc, isLoaded, error };
}

/**
 * Optimized Image Component
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = '',
  lazy = true,
  blur = true,
  responsive = true,
  onLoad = () => {},
  onError = () => {},
}) {
  const placeholderSrc = blur ? generateBlurPlaceholder(src) : null;
  const { imgRef, imageSrc, isLoaded, error } = lazy
    ? useLazyImage(src, { placeholderSrc })
    : { imgRef: null, imageSrc: src, isLoaded: true, error: null };

  // Generate responsive srcset
  const srcSet = responsive && isLoaded
    ? generateResponsiveUrls(src)
        .map((r) => `${r.url} ${r.width}w`)
        .join(', ')
    : null;

  // WebP support
  const webpSrc = supportsWebP() && isLoaded ? toWebP(imageSrc) : imageSrc;

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ width, height }}>
      {/* Blur placeholder */}
      {blur && !isLoaded && placeholderSrc && (
        <img
          src={placeholderSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-cover filter blur-xl scale-110"
          aria-hidden="true"
        />
      )}

      {/* Main image */}
      <img
        ref={imgRef}
        src={webpSrc}
        srcSet={srcSet}
        sizes={responsive ? '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw' : null}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        loading={lazy ? 'lazy' : 'eager'}
        onLoad={onLoad}
        onError={onError}
      />

      {/* Loading skeleton */}
      {!isLoaded && !placeholderSrc && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse" />
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <span className="text-sm text-gray-400">Failed to load</span>
        </div>
      )}
    </div>
  );
}

/**
 * Preload critical images
 */
export function preloadImage(src, priority = 'low') {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = src;

  if (priority === 'high') {
    link.fetchPriority = 'high';
  }

  document.head.appendChild(link);

  logger.log(`[ImageOptimization] Preloading image: ${src}`);
}

/**
 * Batch image loader
 */
export class ImageBatchLoader {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.queue = [];
    this.loading = 0;
  }

  /**
   * Add image to load queue
   */
  load(src) {
    return new Promise((resolve, reject) => {
      this.queue.push({ src, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process queue with concurrency limit
   */
  processQueue() {
    while (this.loading < this.concurrency && this.queue.length > 0) {
      const { src, resolve, reject } = this.queue.shift();
      this.loading++;

      const img = new Image();

      img.onload = () => {
        this.loading--;
        resolve(img);
        this.processQueue();
      };

      img.onerror = (error) => {
        this.loading--;
        reject(error);
        this.processQueue();
      };

      img.src = src;
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      loading: this.loading,
      queued: this.queue.length,
    };
  }
}

// Export singleton
export const imageBatchLoader = new ImageBatchLoader(3);

/**
 * Monitor image performance
 */
export function monitorImagePerformance() {
  if (!performance || !performance.getEntriesByType) return;

  const images = performance
    .getEntriesByType('resource')
    .filter((r) => r.initiatorType === 'img');

  const totalSize = images.reduce((sum, img) => sum + (img.transferSize || 0), 0);
  const avgLoadTime =
    images.reduce((sum, img) => sum + img.duration, 0) / images.length || 0;

  logger.log('[ImagePerformance] Images loaded:', images.length);
  logger.log('[ImagePerformance] Total size:', (totalSize / 1024).toFixed(2), 'KB');
  logger.log('[ImagePerformance] Avg load time:', avgLoadTime.toFixed(0), 'ms');

  // Find slow images (>500ms)
  const slowImages = images.filter((img) => img.duration > 500);
  if (slowImages.length > 0) {
    console.warn('[ImagePerformance] Slow images:', slowImages.map((img) => ({
      name: img.name.split('/').pop(),
      duration: Math.round(img.duration) + 'ms',
      size: (img.transferSize / 1024).toFixed(2) + ' KB',
    })));
  }

  return { totalSize, avgLoadTime, slowImages: slowImages.length };
}

export default OptimizedImage;
