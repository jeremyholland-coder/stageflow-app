import React, { useMemo, useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, AlertCircle, BarChart3, Target, Activity, DollarSign, Users, Clock } from 'lucide-react';

// CRITICAL FIX: CustomTooltip must be defined OUTSIDE DealAnalyticsChart to prevent React error #310
// Format currency
const formatCurrency = (value) => {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value}`;
};

// Format numbers
const formatNumber = (value) => {
  return value.toLocaleString();
};

// Chart-specific empty state messages and icons
const EMPTY_STATE_CONFIG = {
  weekly_trends: {
    icon: Activity,
    title: 'No Weekly Trends Yet',
    message: 'Add more deals to see your weekly activity patterns. Check back after a few days of pipeline activity.'
  },
  goal_progress: {
    icon: Target,
    title: 'Goals Not Configured',
    message: 'Set your revenue targets in Settings to track progress toward your monthly, quarterly, and annual goals.'
  },
  pipeline_flow: {
    icon: BarChart3,
    title: 'No Active Pipeline',
    message: 'Add active deals to visualize your pipeline distribution across stages.'
  },
  at_risk_deals: {
    icon: AlertCircle,
    title: 'No At-Risk Deals',
    message: 'Great news! All your deals are progressing normally. No stagnant deals detected.'
  },
  revenue_forecast: {
    icon: DollarSign,
    title: 'Not Enough Data for Forecast',
    message: 'Add deals with values to generate revenue forecasts based on your pipeline.'
  },
  icp_analysis: {
    icon: Users,
    title: 'No Won Deals Yet',
    message: 'Close a few deals to analyze your ideal customer profile based on winning patterns.'
  },
  velocity_analysis: {
    icon: Clock,
    title: 'No Velocity Data',
    message: 'Move deals through stages to measure your pipeline velocity and identify bottlenecks.'
  },
  default: {
    icon: BarChart3,
    title: 'No Data Available',
    message: 'Keep working your pipeline and check back soon for insights.'
  }
};

// Enhanced empty state component
const ChartEmptyState = ({ type }) => {
  const config = EMPTY_STATE_CONFIG[type] || EMPTY_STATE_CONFIG.default;
  const IconComponent = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="w-16 h-16 rounded-2xl bg-[#1ABC9C]/10 flex items-center justify-center mb-4">
        <IconComponent className="w-8 h-8 text-[#1ABC9C]/60" />
      </div>
      <h4 className="text-lg font-medium text-white/80 mb-2 text-center">
        {config.title}
      </h4>
      <p className="text-sm text-gray-400 text-center max-w-xs leading-relaxed">
        {config.message}
      </p>
    </div>
  );
};

// Custom tooltip styling with bright, readable colors
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    // Color mapping for readable text on dark background
    const getTextColor = (name) => {
      if (name.includes('Added')) return '#10B981'; // Bright green
      if (name.includes('Closed Won') || name.includes('Closed')) return '#60A5FA'; // Bright blue
      if (name.includes('Lost')) return '#F87171'; // Bright red
      if (name.includes('Pipeline') || name.includes('Value')) return '#1ABC9C'; // Teal
      if (name.includes('Target')) return '#D1D5DB'; // Light gray
      if (name.includes('Actual') || name.includes('Current')) return '#34D399'; // Emerald
      return '#E5E7EB'; // Default light gray
    };

    return (
      <div className="bg-white dark:bg-[#1F2937] border-2 border-[#1ABC9C] rounded-lg p-3 shadow-2xl backdrop-blur-sm">
        <p className="text-gray-900 dark:text-white font-semibold mb-2 text-sm">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm font-medium" style={{ color: getTextColor(entry.name) }}>
            {entry.name}: {entry.name.includes('Value') || entry.name.includes('Pipeline') || entry.name.includes('Revenue')
              ? formatCurrency(entry.value)
              : formatNumber(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

/**
 * DealAnalyticsChart - Renders beautiful inline charts in AI chat
 * Supports multiple chart types with responsive design
 * Desktop: Full features | Mobile: Simplified gracefully
 */
export const DealAnalyticsChart = ({ data, type, title }) => {
  // Detect mobile for graceful degradation (safe client-side check)
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Only access window on client side
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Error handling - Enhanced with chart-specific empty states
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0D1F2D] rounded-2xl p-6 border border-[#1ABC9C]/20 my-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#1ABC9C]" />
            {title || 'Analytics'}
          </h3>
        </div>
        {/* Chart-specific empty state */}
        <ChartEmptyState type={type} />
      </div>
    );
  }

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    switch (type) {
      case 'weekly_trends':
        const totalAdded = data.reduce((sum, d) => sum + (d.added || 0), 0);
        const totalClosed = data.reduce((sum, d) => sum + (d.closed || 0), 0);
        const totalLost = data.reduce((sum, d) => sum + (d.lost || 0), 0);
        return { totalAdded, totalClosed, totalLost };

      case 'pipeline_flow':
        const totalPipeline = data.reduce((sum, d) => sum + (d.value || 0), 0);
        return { totalPipeline };

      case 'revenue_forecast':
        const totalForecast = data.reduce((sum, d) => sum + d.value, 0);
        return { totalForecast };

      case 'icp_analysis':
        const totalDeals = data.reduce((sum, d) => sum + d.count, 0);
        return { totalDeals };

      case 'velocity_analysis':
        const avgVelocity = data.length > 0
          ? Math.round(data.reduce((sum, d) => sum + d.avgDays, 0) / data.length)
          : 0;
        return { avgVelocity };

      default:
        return {};
    }
  }, [data, type]);

  // Render different chart types
  const renderChart = () => {
    const chartHeight = isMobile ? 250 : 350;

    switch (type) {
      case 'weekly_trends':
        return (
          <div className="space-y-4">
            {/* Summary Stats - Enhanced with gradients and shadows */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-lg p-3 border border-green-500/30 shadow-lg shadow-green-500/10">
                <p className="text-xs text-gray-400 mb-1">Added</p>
                <p className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{summaryStats.totalAdded}</p>
              </div>
              <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-lg p-3 border border-blue-500/30 shadow-lg shadow-blue-500/10">
                <p className="text-xs text-gray-400 mb-1">Closed</p>
                <p className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">{summaryStats.totalClosed}</p>
              </div>
              <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-lg p-3 border border-red-500/30 shadow-lg shadow-red-500/10">
                <p className="text-xs text-gray-400 mb-1">Lost</p>
                <p className="text-2xl font-bold bg-gradient-to-r from-red-400 to-rose-400 bg-clip-text text-transparent">{summaryStats.totalLost}</p>
              </div>
            </div>

            {/* Chart - Enhanced with gradients for 3D effect */}
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorAdded" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.9}/>
                  </linearGradient>
                  <linearGradient id="colorClosed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0.9}/>
                  </linearGradient>
                  <linearGradient id="colorLost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#DC2626" stopOpacity={0.9}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="week"
                  stroke="#9CA3AF"
                  style={{ fontSize: isMobile ? '11px' : '12px' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  style={{ fontSize: isMobile ? '11px' : '12px' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: isMobile ? '11px' : '12px' }}
                />
                <Bar dataKey="added" fill="url(#colorAdded)" name="Added" radius={[8, 8, 0, 0]} />
                <Bar dataKey="closed" fill="url(#colorClosed)" name="Closed Won" radius={[8, 8, 0, 0]} />
                <Bar dataKey="lost" fill="url(#colorLost)" name="Closed Lost" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'pipeline_flow':
        return (
          <div className="space-y-4">
            {/* Summary - Enhanced with gradient */}
            <div className="bg-gradient-to-br from-[#1ABC9C]/10 to-[#16A085]/5 rounded-lg p-4 border border-[#1ABC9C]/30 shadow-lg shadow-[#1ABC9C]/10">
              <p className="text-sm text-gray-400 mb-1">Total Pipeline Value</p>
              <p className="text-3xl font-bold bg-gradient-to-r from-[#1ABC9C] to-[#16A085] bg-clip-text text-transparent">
                {formatCurrency(summaryStats.totalPipeline)}
              </p>
            </div>

            {/* Chart - Enhanced gradient and glow effect */}
            <ResponsiveContainer width="100%" height={chartHeight}>
              <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorPipeline" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1ABC9C" stopOpacity={0.9}/>
                    <stop offset="50%" stopColor="#16A085" stopOpacity={0.5}/>
                    <stop offset="100%" stopColor="#1ABC9C" stopOpacity={0.1}/>
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                    <feMerge>
                      <feMergeNode in="coloredBlur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="stage"
                  stroke="#9CA3AF"
                  style={{ fontSize: isMobile ? '10px' : '12px' }}
                  angle={isMobile ? -45 : 0}
                  textAnchor={isMobile ? "end" : "middle"}
                  height={isMobile ? 80 : 60}
                />
                <YAxis
                  stroke="#9CA3AF"
                  tickFormatter={formatCurrency}
                  style={{ fontSize: isMobile ? '11px' : '12px' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#1ABC9C"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorPipeline)"
                  name="Pipeline Value"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );

      case 'goal_progress':
        return (
          <div className="space-y-4">
            {/* Progress Bar - Enhanced with 3D effect */}
            {data[0] && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">{data[0].period} Goal Progress</span>
                  <span className="text-lg font-bold bg-gradient-to-r from-[#1ABC9C] to-[#16A085] bg-clip-text text-transparent">
                    {Math.round((data[0].current / data[0].target) * 100)}%
                  </span>
                </div>
                <div className="h-6 bg-[#0D1F2D] rounded-full overflow-hidden border border-[#1ABC9C]/20 shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-[#1ABC9C] via-[#16A085] to-[#1ABC9C] transition-all duration-500 shadow-lg shadow-[#1ABC9C]/30 relative"
                    style={{
                      width: `${Math.min((data[0].current / data[0].target) * 100, 100)}%`,
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 3s linear infinite'
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">
                    Current: {formatCurrency(data[0].current)}
                  </span>
                  <span className="text-gray-400">
                    Target: {formatCurrency(data[0].target)}
                  </span>
                </div>
              </div>
            )}

            {/* Breakdown Chart */}
            {data.length > 1 && (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="period"
                    stroke="#9CA3AF"
                    style={{ fontSize: isMobile ? '11px' : '12px' }}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    tickFormatter={formatCurrency}
                    style={{ fontSize: isMobile ? '11px' : '12px' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: isMobile ? '11px' : '12px' }} />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="#1ABC9C"
                    strokeWidth={3}
                    dot={{ fill: '#1ABC9C', r: 5 }}
                    name="Actual"
                  />
                  <Line
                    type="monotone"
                    dataKey="target"
                    stroke="#9CA3AF"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ fill: '#9CA3AF', r: 4 }}
                    name="Target"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        );

      case 'at_risk_deals':
        const COLORS = ['#EF4444', '#F59E0B', '#10B981'];

        return (
          <div className="space-y-4">
            {/* Alert Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.map((item, index) => (
                <div
                  key={item.category}
                  className="bg-[#0D1F2D] rounded-lg p-3 border"
                  style={{ borderColor: `${COLORS[index]}40` }}
                >
                  <p className="text-xs text-gray-400 mb-1">{item.category}</p>
                  <p className="text-2xl font-bold" style={{ color: COLORS[index] }}>
                    {item.count}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatCurrency(item.value)}
                  </p>
                </div>
              ))}
            </div>

            {/* Pie Chart */}
            {!isMobile && (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ category, percent }) => `${category}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        );

      case 'revenue_forecast':
        return (
          <div className="space-y-4">
            {/* Forecast Summary - Key Insight */}
            <div className="bg-gradient-to-br from-[#1ABC9C]/10 to-[#16A085]/5 rounded-lg p-4 border border-[#1ABC9C]/30 shadow-lg shadow-[#1ABC9C]/10">
              <p className="text-sm text-gray-400 mb-1">Best Case Forecast</p>
              <p className="text-3xl font-bold bg-gradient-to-r from-[#1ABC9C] to-[#16A085] bg-clip-text text-transparent">
                {formatCurrency(data.reduce((sum, d) => sum + d.value, 0))}
              </p>
              <p className="text-xs text-gray-400 mt-2">Based on pipeline confidence scores</p>
            </div>

            {/* Stacked Bar Chart */}
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" stroke="#9CA3AF" tickFormatter={formatCurrency} style={{ fontSize: isMobile ? '11px' : '12px' }} />
                <YAxis type="category" dataKey="category" stroke="#9CA3AF" style={{ fontSize: isMobile ? '11px' : '12px' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" fill="#1ABC9C" radius={[0, 8, 8, 0]}>
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'icp_analysis':
        const ICP_COLORS = ['#3B82F6', '#1ABC9C', '#8B5CF6'];
        return (
          <div className="space-y-4">
            {/* Deal Size Breakdown */}
            <div className="grid grid-cols-3 gap-3">
              {data.map((item, index) => (
                <div
                  key={item.segment}
                  className="bg-gradient-to-br rounded-lg p-3 border shadow-lg"
                  style={{
                    backgroundImage: `linear-gradient(to bottom right, ${ICP_COLORS[index]}15, ${ICP_COLORS[index]}05)`,
                    borderColor: `${ICP_COLORS[index]}40`,
                    boxShadow: `0 4px 6px -1px ${ICP_COLORS[index]}20`
                  }}
                >
                  <p className="text-xs text-gray-400 mb-1">{item.segment}</p>
                  <p className="text-2xl font-bold" style={{ color: ICP_COLORS[index] }}>{item.count}</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: ICP_COLORS[index] }}>{item.percentage}%</p>
                </div>
              ))}
            </div>

            {/* Pie Chart */}
            <ResponsiveContainer width="100%" height={chartHeight}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ segment, percentage }) => `${segment}: ${percentage}%`}
                  outerRadius={isMobile ? 80 : 120}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={ICP_COLORS[index % ICP_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );

      case 'velocity_analysis':
        return (
          <div className="space-y-4">
            {/* Top Bottleneck */}
            {data[0] && (
              <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-lg p-4 border border-amber-500/30 shadow-lg shadow-amber-500/10">
                <p className="text-sm text-gray-400 mb-1">Slowest Stage</p>
                <p className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">{data[0].stage}</p>
                <p className="text-sm text-gray-400 mt-1">{data[0].avgDays} days average • {data[0].count} deals</p>
              </div>
            )}

            {/* Horizontal Bar Chart */}
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="horizontal">
                <defs>
                  <linearGradient id="velocityGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#EF4444" stopOpacity={0.8}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" stroke="#9CA3AF" label={{ value: 'Days', position: 'insideBottom', offset: -5 }} style={{ fontSize: isMobile ? '11px' : '12px' }} />
                <YAxis type="category" dataKey="stage" stroke="#9CA3AF" width={isMobile ? 80 : 120} style={{ fontSize: isMobile ? '10px' : '12px' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="avgDays" fill="url(#velocityGradient)" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      default:
        return (
          <div className="text-gray-400 text-center py-8">
            Chart type not supported
          </div>
        );
    }
  };

  return (
    // DEVICE-02 FIX: Added overflow-x-auto for iPad horizontal with long stage labels
    <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0D1F2D] rounded-2xl p-6 border border-[#1ABC9C]/30 my-4 shadow-xl overflow-x-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#1ABC9C]" />
          {title || 'Analytics'}
        </h3>
        {isMobile && (
          <span className="text-xs text-gray-400">📱 Mobile View</span>
        )}
      </div>

      {/* Chart Content */}
      {renderChart()}

      {/* Mobile Note */}
      {isMobile && type === 'at_risk_deals' && (
        <p className="text-xs text-gray-500 mt-4 text-center">
          Full chart details available on desktop
        </p>
      )}

      {/* Shimmer Animation CSS */}
      <style>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
      `}</style>
    </div>
  );
};

export default DealAnalyticsChart;
