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
        return 'from-emerald-500/30 to-emerald-600/20 border-emerald-500/40 text-emerald-400';
      case 'alert':
        return 'from-amber-500/30 to-amber-600/20 border-amber-500/40 text-amber-400';
      case 'users':
        return 'from-purple-500/30 to-purple-600/20 border-purple-500/40 text-purple-400';
      case 'momentum':
        return 'from-blue-500/30 to-blue-600/20 border-blue-500/40 text-blue-400';
      default:
        return 'from-[#1ABC9C]/30 to-[#16A085]/20 border-[#1ABC9C]/40 text-[#1ABC9C]';
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b border-white/10">
      {extractedMetrics.map((metric, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-br border backdrop-blur-sm ${getAccentColor(metric.icon || 'default')}`}
        >
          <span className="opacity-80">{getIcon(metric.icon || 'default')}</span>
          <span className="text-xs font-medium text-white/70">{metric.label}:</span>
          <span className="text-sm font-bold text-white">{metric.value}</span>
        </div>
      ))}
    </div>
  );
};

export default PlanMyDaySummary;
