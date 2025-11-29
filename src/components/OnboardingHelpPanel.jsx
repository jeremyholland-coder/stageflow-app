import React, { useState } from 'react';
import { HelpCircle, BookOpen, Video, MessageCircle, ExternalLink, X } from 'lucide-react';
import { getHelpForStep, trackHelpView } from '../lib/onboardingHelp';
import { analytics } from '../lib/onboardingAnalytics';

/**
 * OnboardingHelpPanel Component
 * Contextual help panel that appears when user needs assistance
 * Shows relevant documentation, videos, and FAQs for current step
 */
export const OnboardingHelpPanel = ({ stepId, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('articles');
  const helpContent = getHelpForStep(stepId);

  if (!isOpen || !helpContent) return null;

  const handleArticleClick = (article) => {
    trackHelpView(stepId, article.title, analytics);
    // In a real app, you'd navigate to the article or open in new tab
    window.open(article.url, '_blank');
  };

  return (
    <div className="fixed bottom-24 right-6 w-full max-w-md bg-[#0D1F2D] border-2 border-[#1ABC9C]/30 rounded-xl shadow-2xl z-40 max-h-[600px] flex flex-col animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1ABC9C]/20 to-[#16A085]/20 border-b border-[#1ABC9C]/20 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-[#1ABC9C]" />
          <div>
            <h3 className="font-bold text-white">{helpContent.title}</h3>
            <p className="text-xs text-white/60">{helpContent.description}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/10 rounded-lg transition-all text-white/70 hover:text-white"
          aria-label="Close help panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        <TabButton
          icon={BookOpen}
          label="Articles"
          isActive={activeTab === 'articles'}
          onClick={() => setActiveTab('articles')}
          count={helpContent.articles.length}
        />
        <TabButton
          icon={Video}
          label="Video"
          isActive={activeTab === 'video'}
          onClick={() => setActiveTab('video')}
        />
        <TabButton
          icon={MessageCircle}
          label="FAQs"
          isActive={activeTab === 'faqs'}
          onClick={() => setActiveTab('faqs')}
          count={helpContent.faqs.length}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'articles' && (
          <div className="space-y-3">
            {helpContent.articles && helpContent.articles.length > 0 ? (
              helpContent.articles.map((article, index) => (
                <ArticleCard
                  key={index}
                  article={article}
                  onClick={() => handleArticleClick(article)}
                />
              ))
            ) : (
              <EmptyState
                icon={BookOpen}
                title="No articles available"
                description="Help articles for this step are coming soon."
              />
            )}
          </div>
        )}

        {activeTab === 'video' && (
          helpContent.video ? (
            <VideoCard video={helpContent.video} />
          ) : (
            <EmptyState
              icon={Video}
              title="No video available"
              description="Video tutorial for this step is coming soon."
            />
          )
        )}

        {activeTab === 'faqs' && (
          <div className="space-y-4">
            {helpContent.faqs && helpContent.faqs.length > 0 ? (
              helpContent.faqs.map((faq, index) => (
                <FAQItem key={index} faq={faq} />
              ))
            ) : (
              <EmptyState
                icon={MessageCircle}
                title="No FAQs available"
                description="Frequently asked questions for this step are coming soon."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Helper Components

const TabButton = ({ icon: Icon, label, isActive, onClick, count }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 transition-all ${
      isActive
        ? 'bg-[#1ABC9C]/10 border-b-2 border-[#1ABC9C] text-white'
        : 'text-white/60 hover:text-white hover:bg-white/5'
    }`}
  >
    <Icon className="w-4 h-4" />
    <span className="text-sm font-medium">{label}</span>
    {count !== undefined && (
      <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded-full">{count}</span>
    )}
  </button>
);

const ArticleCard = ({ article, onClick }) => (
  <button
    onClick={onClick}
    className="w-full text-left p-4 bg-[#0A0F14] border border-white/10 rounded-lg hover:border-[#1ABC9C]/30 hover:bg-[#1ABC9C]/5 transition-all group"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <h4 className="font-semibold text-white mb-1 group-hover:text-[#1ABC9C] transition-colors">
          {article.title}
        </h4>
        <div className="flex items-center gap-2 text-xs text-white/50">
          <span>{article.duration}</span>
          <span>•</span>
          <div className="flex gap-1">
            {article.tags.map((tag, i) => (
              <span key={i} className="px-2 py-0.5 bg-white/10 rounded">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-[#1ABC9C] transition-colors flex-shrink-0" />
    </div>
  </button>
);

const VideoCard = ({ video }) => (
  <div className="bg-[#0A0F14] border border-white/10 rounded-lg overflow-hidden">
    {/* Video thumbnail */}
    <div className="relative aspect-video bg-black/50">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-16 h-16 bg-[#1ABC9C] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#16A085] transition-colors">
          <Video className="w-8 h-8 text-white ml-1" />
        </div>
      </div>
      <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 rounded text-xs text-white">
        {video.duration}
      </div>
    </div>

    {/* Video info */}
    <div className="p-4">
      <h4 className="font-semibold text-white mb-1">{video.title}</h4>
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-[#1ABC9C] hover:underline inline-flex items-center gap-1"
      >
        Watch on YouTube
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  </div>
);

const FAQItem = ({ faq }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-[#0A0F14] border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-start justify-between gap-3"
      >
        <span className="font-medium text-white">{faq.question}</span>
        <svg
          className={`w-5 h-5 text-white/60 transition-transform flex-shrink-0 ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 text-sm text-white/70 border-t border-white/10 pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {faq.answer}
        </div>
      )}
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, description }) => (
  <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
      <Icon className="w-8 h-8 text-white/40" />
    </div>
    <h4 className="text-white font-semibold mb-2">{title}</h4>
    <p className="text-white/60 text-sm">{description}</p>
  </div>
);
