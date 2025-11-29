import React from 'react';
import { Sparkles, Zap, Shield, TrendingUp, Users, Check, ArrowRight, Target, Eye, Brain } from 'lucide-react';
import { Logo } from './ui/Logo';

export const LandingPage = ({ onGetStarted }) => {
  const scrollToAuth = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Small delay then trigger auth
    setTimeout(() => {
      if (onGetStarted) onGetStarted();
    }, 300);
  };

  const features = [
    {
      icon: Eye,
      title: 'Pipeline Visibility',
      description: 'See every deal, every stage, every opportunity at a glance. No more wondering what\'s happening.'
    },
    {
      icon: Brain,
      title: 'AI Insights on Every Tier',
      description: 'AI-powered predictions and next-step recommendations. Not hidden behind paywalls—included in Free Forever.'
    },
    {
      icon: Target,
      title: 'Built for Founders',
      description: 'Not bloated enterprise software. Just the essentials to track deals and close faster.'
    },
    {
      icon: Zap,
      title: 'Lightning Fast Setup',
      description: 'Import your pipeline in 60 seconds. No training required. Start closing deals today.'
    },
    {
      icon: Shield,
      title: 'Enterprise Security',
      description: 'Bank-level encryption and data protection. Your pipeline data stays yours, always.'
    },
    {
      icon: TrendingUp,
      title: 'Know Every Next Step',
      description: 'AI tells you which deals need attention, when to follow up, and what actions drive results.'
    }
  ];

  const pricing = [
    {
      name: 'Free Forever',
      price: '$0',
      period: 'forever',
      description: 'Perfect for solo founders',
      features: [
        '1 user',
        'Up to 100 deals',
        'Full Kanban pipeline',
        'AI insights included',
        'Basic analytics',
        'Email support'
      ],
      cta: 'Start Free',
      highlight: false,
      badge: null
    },
    {
      name: 'Startup',
      price: '$10',
      period: 'per month',
      description: 'For small teams',
      features: [
        '2-5 users',
        'Up to 500 deals',
        'AI insights included',
        'Priority support',
        'API access',
        '5 workflows'
      ],
      cta: 'Start Free Trial',
      highlight: true,
      badge: 'MOST POPULAR'
    },
    {
      name: 'Growth',
      price: '$20',
      period: 'per month',
      description: 'For scaling companies',
      features: [
        '6-20 users',
        'Up to 2,000 deals',
        'AI insights included',
        '15 workflows',
        'Advanced analytics',
        'SLA guarantee'
      ],
      cta: 'Start Free Trial',
      highlight: false,
      badge: null
    },
    {
      name: 'Pro',
      price: '$35',
      period: 'per month',
      description: 'For established teams',
      features: [
        '21-50 users',
        'Up to 5,000 deals',
        'AI insights included',
        'Unlimited workflows',
        'White-label options',
        'Premium support'
      ],
      cta: 'Start Free Trial',
      highlight: false,
      badge: null
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F9FAFB] via-white to-[#F9FAFB] dark:from-[#121212] dark:via-[#0D1F2D] dark:to-[#121212]">
      {/* Hero Section - Added safe padding for mobile to avoid navbar overlap */}
      <div className="max-w-7xl mx-auto px-4 pt-20 sm:pt-24 md:pt-16 lg:pt-20 pb-8 md:pb-12 lg:pb-16">
        <div className="text-center">
          {/* Logo with Tagline */}
          <div className="flex justify-center mb-8">
            <Logo size="xl" showText={true} showTagline={true} />
          </div>
          
          {/* NEW: Founder-focused positioning */}
          <p className="text-2xl md:text-3xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-4">
            The AI-powered deal flow platform built for founders who want clarity, not complexity
          </p>
          
          {/* NEW: Direct value prop focusing on core benefits */}
          <p className="text-lg text-[#6B7280] dark:text-[#9CA3AF] max-w-2xl mx-auto mb-8">
            See every deal, know every next step, close faster with AI. 
            No bloat. No learning curve. Just clear pipeline management that actually helps you win.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button 
              onClick={scrollToAuth}
              className="bg-gradient-to-r from-[#118d6d] to-[#108465] text-white px-8 py-4 rounded-xl font-bold text-lg hover:shadow-2xl hover:scale-105 transition-all duration-300 flex items-center gap-2"
            >
              Start Free
              <ArrowRight className="w-5 h-5" />
            </button>
            <button 
              onClick={() => {
                const featuresSection = document.getElementById('features');
                if (featuresSection) {
                  featuresSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              className="stat-card !p-4 !rounded-xl font-bold text-lg hover:scale-105 transition-all duration-300 flex items-center gap-2 text-[#1A1A1A] dark:text-[#E0E0E0]"
            >
              <Sparkles className="w-5 h-5 text-[#118d6d]" />
              See How It Works
            </button>
          </div>

          {/* Social Proof - Enhanced with AI emphasis */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-[#27AE60]" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-[#27AE60]" />
              <span>AI on all plans (even Free)</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-[#27AE60]" />
              <span>Setup in 60 seconds</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-[#27AE60]" />
              <span>Built for founders, not enterprises</span>
            </div>
          </div>
        </div>
      </div>

      {/* Features Grid - Refocused on deal flow management */}
      <div id="features" className="max-w-7xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-4">
            Deal flow management that actually makes sense
          </h2>
          <p className="text-lg text-[#6B7280] dark:text-[#9CA3AF]">
            Built for founders who want to see their pipeline, understand what's happening, and close deals faster.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <div key={idx} className="stat-card group">
                <div className="p-3 bg-gradient-to-br from-[#118d6d]/20 to-[#3A86FF]/20 rounded-xl w-fit mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Icon className="w-8 h-8 text-[#118d6d]" />
                </div>
                <h3 className="text-xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
                  {feature.title}
                </h3>
                <p className="text-[#6B7280] dark:text-[#9CA3AF]">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pricing Section */}
      <div id="pricing" className="max-w-7xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-4">
            Transparent pricing. AI on every tier.
          </h2>
          <p className="text-lg text-[#6B7280] dark:text-[#9CA3AF]">
            Unlike HubSpot and Salesforce, we don't hide AI behind paywalls. Start free, scale when ready.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {pricing.map((plan, idx) => (
            <div 
              key={idx} 
              className={`stat-card relative ${plan.highlight ? '!border-[#118d6d] !border-2 scale-105' : ''}`}
            >
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="bg-gradient-to-r from-[#118d6d] to-[#108465] text-white px-4 py-1 rounded-full text-sm font-bold">
                    {plan.badge}
                  </span>
                </div>
              )}
              
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-5xl font-bold bg-gradient-to-r from-[#118d6d] to-[#108465] bg-clip-text text-transparent">
                    {plan.price}
                  </span>
                  <span className="text-[#6B7280] dark:text-[#9CA3AF]">
                    {plan.period}
                  </span>
                </div>
                <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                  {plan.description}
                </p>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature, fidx) => (
                  <li key={fidx} className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-[#27AE60] flex-shrink-0" />
                    <span className={`text-[#1A1A1A] dark:text-[#E0E0E0] ${feature.includes('AI insights') ? 'font-semibold' : ''}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <button 
                onClick={scrollToAuth}
                className={`w-full py-3 rounded-xl font-bold transition-all duration-300 ${
                  plan.highlight
                    ? 'bg-gradient-to-r from-[#118d6d] to-[#108465] text-white hover:shadow-xl hover:scale-105'
                    : 'bg-[#F9FAFB] dark:bg-[#121212] text-[#1A1A1A] dark:text-[#E0E0E0] border-2 border-[#E0E0E0] dark:border-gray-700 hover:border-[#118d6d]'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
        
        {/* NEW: Competitive differentiation callout */}
        <div className="mt-12 text-center">
          <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] max-w-3xl mx-auto">
            <span className="font-semibold text-[#118d6d]">Why founders choose StageFlow:</span> No enterprise bloat. AI on all tiers (not locked behind $99/mo plans). 
            Built specifically for deal flow visibility, not generic contact management.
          </p>
        </div>
      </div>

      {/* Final CTA - Refocused on founder pain points */}
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="stat-card !p-12">
          <h2 className="text-4xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0] mb-4">
            Ready to see your entire pipeline at a glance?
          </h2>
          <p className="text-lg text-[#6B7280] dark:text-[#9CA3AF] mb-8">
            Join founders who ditched bloated CRMs for clear, AI-powered deal flow management.
          </p>
          <button 
            onClick={scrollToAuth}
            className="bg-gradient-to-r from-[#118d6d] to-[#108465] text-white px-12 py-4 rounded-xl font-bold text-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 inline-flex items-center gap-2"
          >
            Get Started Free
            <ArrowRight className="w-6 h-6" />
          </button>
          <p className="mt-4 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
            No credit card. No setup fees. AI included on Free Forever plan.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[#E0E0E0] dark:border-gray-700 py-8">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Logo size="sm" showText={true} showTagline={true} />
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
              © 2025 StageFlow. Revenue Operations Platform for modern teams.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
