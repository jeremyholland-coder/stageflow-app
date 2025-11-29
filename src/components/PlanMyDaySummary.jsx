import React from 'react';
import { Target, Zap, AlertTriangle, Users, TrendingUp } from 'lucide-react';

/**
 * PlanMyDaySummary - PHASE 19B Compact Summary Strip
 *
 * Displays at-a-glance metrics at the top of Plan My Day responses
 * before the detailed section cards
 */

export const PlanMyDaySummary = ({ structuredResponse, content }) => {
  // Extract metrics from structuredResponse if available
  const metrics = structuredResponse?.metrics || [];

  // Parse content to extract summary counts if no structured metrics
  const extractedMetrics = React.useMemo(() => {
    if (metrics.length > 0) {
      return metrics.slice(0, 4); // Max 4 metrics
    }

    // Fallback: Extract counts from content text
    const extracted = [];
    const contentLower = (content || '').toLowerCase();

    // Count deals mentioned in "closest to close" section
    const closeMatch = contentLower.match(/(\d+)\s*(?:deal|opportunit)/i);
    if (closeMatch) {
      extracted.push({ label: 'Priority Deals', value: closeMatch[1], icon: 'target' });
    }

    // Count "at risk" mentions
    const riskMatch = contentLower.match(/(\d+)\s*(?:at risk|stall|stuck)/i);
    if (riskMatch) {
      extracted.push({ label: 'At Risk', value: riskMatch[1], icon: 'alert' });
    }

    // Count follow-ups
    const followMatch = contentLower.match(/(\d+)\s*(?:follow[- ]?up|touchpoint|check[- ]?in)/i);
    if (followMatch) {
      extracted.push({ label: 'Follow-ups', value: followMatch[1], icon: 'users' });
    }

    return extracted;
  }, [metrics, content]);

  // Don't render if no metrics to show
  if (extractedMetrics.length === 0) {
    return null;
  }

  const getIcon = (iconType) => {
    switch (iconType) {
      case 'target':
        return <Target className="w-3.5 h-3.5" />;
      case 'alert':
        return <AlertTriangle className="w-3.5 h-3.5" />;
      case 'users':
        return <Users className="w-3.5 h-3.5" />;
      case 'momentum':
        return <Zap className="w-3.5 h-3.5" />;
      default:
        return <TrendingUp className="w-3.5 h-3.5" />;
    }
  };

  const getAccentColor = (iconType) => {
    switch (iconType) {
      case 'target':
        return 'from-emerald-500/20 to-emerald-600/5 border-emerald-400/30 text-emerald-400';
      case 'alert':
        return 'from-amber-500/20 to-amber-600/5 border-amber-400/30 text-amber-400';
      case 'users':
        return 'from-purple-500/20 to-purple-600/5 border-purple-400/30 text-purple-400';
      case 'momentum':
        return 'from-sky-500/20 to-sky-600/5 border-sky-400/30 text-sky-400';
      default:
        return 'from-[#0CE3B1]/20 to-[#0CE3B1]/5 border-[#0CE3B1]/30 text-[#0CE3B1]';
    }
  };

  return (
    <div className="flex flex-wrap gap-3 mb-5 pb-4 border-b border-white/[0.07]">
      {extractedMetrics.map((metric, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-gradient-to-br border backdrop-blur-md shadow-[0_4px_16px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] transition-all duration-300 ease-out hover:scale-[1.02] ${getAccentColor(metric.icon || 'default')}`}
          style={{ animationDelay: `${idx * 100}ms` }}
        >
          <span className="opacity-90">{getIcon(metric.icon || 'default')}</span>
          <span className="text-xs font-medium text-white/60">{metric.label}:</span>
          <span className="text-sm font-bold text-white tracking-tight">{metric.value}</span>
        </div>
      ))}
    </div>
  );
};

export default PlanMyDaySummary;
