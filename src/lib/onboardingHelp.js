/**
 * Contextual Help System
 * Provides quick access to documentation and help resources
 * Maps onboarding steps to relevant documentation
 */

export const helpResources = {
  'add_first_deal': {
    title: 'Creating Deals',
    description: 'Learn how to create and manage deals in your pipeline',
    articles: [
      {
        title: 'Quick Start: Your First Deal',
        url: '/docs/deals/quick-start',
        duration: '2 min read',
        tags: ['beginner', 'deals']
      },
      {
        title: 'Deal Properties and Custom Fields',
        url: '/docs/deals/properties',
        duration: '5 min read',
        tags: ['advanced', 'customization']
      },
      {
        title: 'Keyboard Shortcuts',
        url: '/docs/shortcuts',
        duration: '3 min read',
        tags: ['productivity']
      }
    ],
    video: {
      title: 'Creating Your First Deal',
      url: 'https://www.youtube.com/watch?v=example',
      thumbnail: '/images/help/first-deal-thumbnail.jpg',
      duration: '1:30'
    },
    faqs: [
      {
        question: 'Can I import deals from a CSV file?',
        answer: 'Yes! Go to Settings → Import/Export to upload a CSV file with your deals.'
      },
      {
        question: 'How do I assign a deal to a team member?',
        answer: 'Click on the deal, then use the "Assigned To" dropdown to select a team member.'
      }
    ]
  },

  'connect_integration': {
    title: 'Setting Up Integrations',
    description: 'Connect your favorite tools and AI providers',
    articles: [
      {
        title: 'AI Provider Setup Guide',
        url: '/docs/integrations/ai-providers',
        duration: '4 min read',
        tags: ['ai', 'setup']
      },
      {
        title: 'Webhooks and API Access',
        url: '/docs/integrations/webhooks',
        duration: '6 min read',
        tags: ['advanced', 'api']
      },
      {
        title: 'Troubleshooting Integration Issues',
        url: '/docs/integrations/troubleshooting',
        duration: '3 min read',
        tags: ['help']
      }
    ],
    video: {
      title: 'Connecting OpenAI Integration',
      url: 'https://www.youtube.com/watch?v=example2',
      thumbnail: '/images/help/integration-thumbnail.jpg',
      duration: '2:15'
    },
    faqs: [
      {
        question: 'Which AI providers are supported?',
        answer: 'We support OpenAI (GPT-4), Anthropic (Claude), Google (Gemini), and more. Check the integrations page for the full list.'
      },
      {
        question: 'Is my API key secure?',
        answer: 'Yes! All API keys are encrypted at rest and never logged. We follow industry best practices for security.'
      }
    ]
  }
};

/**
 * Get help resources for a specific step
 */
export function getHelpForStep(stepId) {
  return helpResources[stepId] || null;
}

/**
 * Search help resources
 */
export function searchHelp(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();

  Object.entries(helpResources).forEach(([stepId, resource]) => {
    // Search in articles
    resource.articles.forEach(article => {
      if (
        article.title.toLowerCase().includes(lowerQuery) ||
        article.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      ) {
        results.push({
          type: 'article',
          stepId,
          ...article
        });
      }
    });

    // Search in FAQs
    resource.faqs.forEach(faq => {
      if (
        faq.question.toLowerCase().includes(lowerQuery) ||
        faq.answer.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          type: 'faq',
          stepId,
          ...faq
        });
      }
    });
  });

  return results;
}

/**
 * Track help article views (integrate with analytics)
 */
export function trackHelpView(stepId, articleTitle, analytics) {
  if (analytics) {
    analytics.trackEvent('help_article_viewed', {
      stepId,
      articleTitle,
      timestamp: Date.now()
    });
  }
}
