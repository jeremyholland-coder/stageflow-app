import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, DollarSign, TrendingUp, Target, ExternalLink, BarChart3 } from 'lucide-react';

/**
 * Enhanced AI Message Renderer
 * - Removes markdown symbols (###, **, --)
 * - Extracts and visualizes revenue data
 * - Collapsible sections for detailed info
 * - Mobile-responsive and fast
 */
export const AIMessageRenderer = ({ content }) => {
  const [expandedSections, setExpandedSections] = useState(new Set(['summary']));

  // Parse message content into structured sections
  const parsedContent = useMemo(() => {
    if (!content) return null;

    // Remove markdown formatting symbols
    let cleaned = content
      .replace(/###\s*/g, '') // Remove ### headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove ** bold markers
      .replace(/^---+$/gm, '') // Remove --- dividers
      .replace(/^\s*[-•]\s*/gm, '• '); // Normalize bullets

    // Extract sections
    const sections = [];
    const lines = cleaned.split('\n');
    let currentSection = { title: 'Summary', content: [], type: 'text' };

    lines.forEach(line => {
      const trimmed = line.trim();

      // Detect section headers (lines ending with ** or ##)
      if (trimmed && (
        trimmed.includes('Revenue Forecast') ||
        trimmed.includes('Strategic Directive') ||
        trimmed.includes('Action Items') ||
        trimmed.includes('Closures') ||
        trimmed.includes('Focus')
      )) {
        // Save previous section if it has content
        if (currentSection.content.length > 0) {
          sections.push(currentSection);
        }
        // Start new section
        currentSection = {
          title: trimmed.replace(/[:*#]/g, '').trim(),
          content: [],
          type: 'text'
        };
      } else if (trimmed) {
        currentSection.content.push(trimmed);
      }
    });

    // Add last section
    if (currentSection.content.length > 0) {
      sections.push(currentSection);
    }

    // Extract revenue data from content
    const revenueData = extractRevenueData(cleaned);

    return { sections, revenueData, cleaned };
  }, [content]);

  // Extract revenue numbers and deal info
  const extractRevenueData = (text) => {
    const data = {
      secured: [],
      highProbability: [],
      potential: [],
      total: null
    };

    // Regex patterns for currency amounts
    const currencyRegex = /\$[\d,]+/g;

    // Find secured revenue
    const securedMatch = text.match(/Secured Revenue[^$]*\$[\d,]+/i);
    if (securedMatch) {
      const amounts = securedMatch[0].match(currencyRegex);
      if (amounts) data.secured.push({ label: 'Secured', amount: amounts[0] });
    }

    // Find high-probability closures
    const highProbMatch = text.match(/High-Probability Closures[^$]*(?:\$[\d,]+[^$]*){1,5}/i);
    if (highProbMatch) {
      const deals = highProbMatch[0].match(/([A-Za-z\s]+)\s*\$[\d,]+/g);
      if (deals) {
        deals.forEach(deal => {
          const match = deal.match(/([A-Za-z\s]+)\s*(\$[\d,]+)/);
          if (match) {
            data.highProbability.push({ label: match[1].trim(), amount: match[2] });
          }
        });
      }
    }

    // Find potential closures
    const potentialMatch = text.match(/Potential Closures[^$]*(?:\$[\d,]+[^$]*){1,5}/i);
    if (potentialMatch) {
      const deals = potentialMatch[0].match(/([A-Za-z\s]+)\s*\$[\d,]+/g);
      if (deals) {
        deals.forEach(deal => {
          const match = deal.match(/([A-Za-z\s]+)\s*(\$[\d,]+)/);
          if (match) {
            data.potential.push({ label: match[1].trim(), amount: match[2] });
          }
        });
      }
    }

    // Find total projected revenue
    const totalMatch = text.match(/Total Projected[^$]*\$[\d,]+[^$]*to[^$]*\$[\d,]+/i);
    if (totalMatch) {
      const amounts = totalMatch[0].match(currencyRegex);
      if (amounts && amounts.length >= 2) {
        data.total = { low: amounts[0], high: amounts[1] };
      }
    }

    return data;
  };

  const toggleSection = (title) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const formatCurrency = (str) => {
    return str.replace(/\$/g, '').replace(/,/g, '');
  };

  if (!parsedContent) {
    return <p className="text-sm whitespace-pre-wrap">{content}</p>;
  }

  const { sections, revenueData } = parsedContent;

  return (
    <div className="space-y-3">
      {/* Revenue Visualization Card */}
      {revenueData.total && (
        <div className="bg-gradient-to-br from-[#1ABC9C]/10 to-[#16A085]/10 dark:from-[#1ABC9C]/20 dark:to-[#16A085]/20 rounded-xl p-4 border border-[#1ABC9C]/30">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-[#1ABC9C] rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">Revenue Forecast</h4>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">This Month</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/50 dark:bg-[#0D1F2D]/50 rounded-lg p-3 backdrop-blur-sm">
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Conservative</p>
              <p className="text-lg font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">{revenueData.total.low}</p>
            </div>
            <div className="bg-white/50 dark:bg-[#0D1F2D]/50 rounded-lg p-3 backdrop-blur-sm">
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mb-1">Optimistic</p>
              <p className="text-lg font-bold text-[#16A085] dark:text-[#1ABC9C]">{revenueData.total.high}</p>
            </div>
          </div>

          {/* Visual bar chart */}
          {revenueData.highProbability.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">High Priority Deals</p>
              {revenueData.highProbability.slice(0, 3).map((deal, idx) => {
                const amount = parseInt(formatCurrency(deal.amount));
                const maxAmount = Math.max(...revenueData.highProbability.map(d => parseInt(formatCurrency(d.amount))));
                const width = (amount / maxAmount) * 100;

                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#6B7280] dark:text-[#9CA3AF] truncate">{deal.label}</span>
                      <span className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] ml-2">{deal.amount}</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#1ABC9C] to-[#16A085] rounded-full transition-all duration-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rendered Sections */}
      {sections.map((section, idx) => {
        const isExpanded = expandedSections.has(section.title);
        const isSummary = section.title.toLowerCase().includes('summary');

        return (
          <div key={idx} className="space-y-2">
            {/* Section Header - Collapsible */}
            {!isSummary && (
              <button
                onClick={() => toggleSection(section.title)}
                className="w-full flex items-center justify-between text-left p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-[#1ABC9C]/10 dark:bg-[#1ABC9C]/20 rounded flex items-center justify-center">
                    {section.title.includes('Action') || section.title.includes('Directive') ? (
                      <Target className="w-3 h-3 text-[#1ABC9C]" />
                    ) : section.title.includes('Revenue') ? (
                      <DollarSign className="w-3 h-3 text-[#1ABC9C]" />
                    ) : (
                      <BarChart3 className="w-3 h-3 text-[#1ABC9C]" />
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-[#1A1A1A] dark:text-[#E0E0E0]">
                    {section.title}
                  </h4>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-[#6B7280] dark:text-[#9CA3AF] group-hover:text-[#1ABC9C]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#6B7280] dark:text-[#9CA3AF] group-hover:text-[#1ABC9C]" />
                )}
              </button>
            )}

            {/* Section Content */}
            {(isExpanded || isSummary) && (
              <div className="space-y-2 text-sm text-[#1A1A1A] dark:text-[#E0E0E0] pl-2">
                {section.content.map((line, lineIdx) => {
                  // Action items with icons
                  if (line.startsWith('•') || line.match(/^\d+\./)) {
                    return (
                      <div key={lineIdx} className="flex items-start gap-2 py-1">
                        <span className="text-[#1ABC9C] mt-1">•</span>
                        <span className="flex-1 leading-relaxed">{line.replace(/^[•\d.]\s*/, '')}</span>
                      </div>
                    );
                  }
                  // Regular text
                  return (
                    <p key={lineIdx} className="leading-relaxed">
                      {line}
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Learn More Link */}
      <button className="flex items-center gap-1 text-xs text-[#1ABC9C] hover:text-[#16A085] transition-colors group mt-2">
        <ExternalLink className="w-3 h-3" />
        <span className="group-hover:underline">Learn more about deal strategies</span>
      </button>
    </div>
  );
};
