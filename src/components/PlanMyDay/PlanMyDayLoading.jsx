/**
 * PlanMyDayLoading.jsx
 *
 * Premium loading experience for Plan My Day feature.
 * Displays immediately after clicking "Plan My Day" with:
 * - Three-column performance snapshot (MTD, QTD, YTD)
 * - Mint gradient progress arcs
 * - Clean glass container matching StageFlow design system
 * - Subtle motion with opacity pulse
 * - Fully responsive
 *
 * @author StageFlow Engineering
 * @since 2025-12-06
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Target, TrendingUp, DollarSign, Calendar, Sparkles, Activity } from 'lucide-react';

/**
 * Animated progress arc component
 */
const ProgressArc = ({ value = 0, label, sublabel, delay = 0 }) => {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    // Animate the value in
    const timer = setTimeout(() => {
      setAnimatedValue(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  // Calculate stroke dasharray for the arc
  const circumference = 2 * Math.PI * 40; // radius = 40
  const strokeDasharray = `${(animatedValue / 100) * circumference} ${circumference}`;

  return (
    <div className="flex flex-col items-center gap-3 animate-[fadeIn_0.5s_ease-out]" style={{ animationDelay: `${delay}ms` }}>
      {/* Arc container */}
      <div className="relative w-24 h-24 md:w-28 md:h-28">
        {/* Background arc */}
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="8"
          />
          {/* Animated progress arc */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="url(#mintGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={strokeDasharray}
            className="transition-all duration-1000 ease-out"
            style={{
              filter: 'drop-shadow(0 0 8px rgba(12, 227, 177, 0.4))'
            }}
          />
          {/* Gradient definition */}
          <defs>
            <linearGradient id="mintGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0CE3B1" />
              <stop offset="100%" stopColor="#16A085" />
            </linearGradient>
          </defs>
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl md:text-2xl font-bold text-white tracking-tight">
            {animatedValue > 0 ? `${Math.round(animatedValue)}%` : '—'}
          </span>
        </div>
      </div>

      {/* Labels */}
      <div className="text-center">
        <p className="text-xs font-semibold text-white/80 tracking-wide">{label}</p>
        {sublabel && (
          <p className="text-[10px] text-white/40 mt-0.5">{sublabel}</p>
        )}
      </div>
    </div>
  );
};

/**
 * Skeleton metric card
 */
const SkeletonMetric = ({ icon: Icon, delay = 0 }) => (
  <div
    className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] animate-pulse"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="p-2 rounded-lg bg-gradient-to-br from-[#0CE3B1]/15 to-[#0CE3B1]/5">
      <Icon className="w-4 h-4 text-[#0CE3B1]/60" />
    </div>
    <div className="flex-1 space-y-2">
      <div className="h-2.5 w-16 bg-white/10 rounded-full" />
      <div className="h-3.5 w-24 bg-white/[0.06] rounded-full" />
    </div>
  </div>
);

/**
 * Main PlanMyDayLoading component
 */
export const PlanMyDayLoading = ({
  deals = [],
  performanceMetrics = null,
  onCancel = null
}) => {
  const [showContent, setShowContent] = useState(false);
  const [pulseOpacity, setPulseOpacity] = useState(0.6);

  // Fade in content after mount
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Subtle opacity pulse animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseOpacity(prev => prev === 0.6 ? 0.9 : 0.6);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Calculate quick metrics from deals
  const quickMetrics = useMemo(() => {
    if (!deals || deals.length === 0) {
      return {
        mtdProgress: 0,
        qtdProgress: 0,
        ytdProgress: 0,
        activeDeals: 0,
        totalPipeline: 0
      };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const activeDeals = deals.filter(d => d.status === 'active');
    const wonDeals = deals.filter(d => d.status === 'won');

    // Calculate won revenue by period
    const mtdWon = wonDeals
      .filter(d => new Date(d.closed_at || d.updated_at) >= monthStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const qtdWon = wonDeals
      .filter(d => new Date(d.closed_at || d.updated_at) >= quarterStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const ytdWon = wonDeals
      .filter(d => new Date(d.closed_at || d.updated_at) >= yearStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // Calculate total pipeline
    const totalPipeline = activeDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // Estimate progress (if no targets, use reasonable defaults)
    const monthlyTarget = performanceMetrics?.monthlyTarget || totalPipeline * 0.3 || 50000;
    const quarterlyTarget = performanceMetrics?.quarterlyTarget || monthlyTarget * 3;
    const yearlyTarget = performanceMetrics?.yearlyTarget || monthlyTarget * 12;

    return {
      mtdProgress: monthlyTarget > 0 ? Math.min(100, Math.round((mtdWon / monthlyTarget) * 100)) : 0,
      qtdProgress: quarterlyTarget > 0 ? Math.min(100, Math.round((qtdWon / quarterlyTarget) * 100)) : 0,
      ytdProgress: yearlyTarget > 0 ? Math.min(100, Math.round((ytdWon / yearlyTarget) * 100)) : 0,
      activeDeals: activeDeals.length,
      totalPipeline,
      mtdWon,
      qtdWon,
      ytdWon
    };
  }, [deals, performanceMetrics]);

  // Format currency
  const formatCurrency = (value) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <div
      className={`w-full transition-opacity duration-500 ${showContent ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Main glass container */}
      <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 md:p-8 shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/25 to-[#0CE3B1]/5 border border-[#0CE3B1]/20 flex items-center justify-center shadow-[0_4px_16px_rgba(12,227,177,0.15)] animate-pulse">
              <Sparkles className="w-6 h-6 text-[#0CE3B1]" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-semibold text-white tracking-tight">
                Preparing your daily plan...
              </h3>
              <p
                className="text-xs text-white/50 mt-1 transition-opacity duration-1000"
                style={{ opacity: pulseOpacity }}
              >
                Analyzing your pipeline and priorities
              </p>
            </div>
          </div>

          {/* Cancel button */}
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-xs text-white/40 hover:text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Performance snapshot - Three columns */}
        <div className="grid grid-cols-3 gap-4 md:gap-8 mb-8">
          <ProgressArc
            value={quickMetrics.mtdProgress}
            label="Month to Date"
            sublabel={quickMetrics.mtdWon > 0 ? formatCurrency(quickMetrics.mtdWon) : null}
            delay={100}
          />
          <ProgressArc
            value={quickMetrics.qtdProgress}
            label="Quarter to Date"
            sublabel={quickMetrics.qtdWon > 0 ? formatCurrency(quickMetrics.qtdWon) : null}
            delay={250}
          />
          <ProgressArc
            value={quickMetrics.ytdProgress}
            label="Year to Date"
            sublabel={quickMetrics.ytdWon > 0 ? formatCurrency(quickMetrics.ytdWon) : null}
            delay={400}
          />
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] mb-6" />

        {/* Quick stats skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SkeletonMetric icon={Target} delay={500} />
          <SkeletonMetric icon={TrendingUp} delay={600} />
          <SkeletonMetric icon={DollarSign} delay={700} />
          <SkeletonMetric icon={Activity} delay={800} />
          <SkeletonMetric icon={Calendar} delay={900} />
          <div className="hidden md:block">
            <SkeletonMetric icon={Sparkles} delay={1000} />
          </div>
        </div>

        {/* Loading indicator bar */}
        <div className="mt-8">
          <div className="h-1 w-full bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#0CE3B1] to-[#16A085] rounded-full animate-[shimmer_2s_ease-in-out_infinite]"
              style={{
                width: '40%',
                animation: 'shimmer 2s ease-in-out infinite'
              }}
            />
          </div>
        </div>
      </div>

      {/* CSS for shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(150%);
          }
          100% {
            transform: translateX(-100%);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default PlanMyDayLoading;
