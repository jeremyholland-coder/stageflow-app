/**
 * Unit tests for sanitizeAIOutput utility
 * @file tests/unit/sanitizeAIOutput.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeAIOutput,
  stripMarkdown,
  removePromptLeakage,
  normalizeWhitespace,
  parseIntoSections,
  extractActionItems,
  detectSectionType
} from '../../src/lib/sanitizeAIOutput';

describe('sanitizeAIOutput', () => {
  describe('stripMarkdown', () => {
    it('should remove bold formatting', () => {
      expect(stripMarkdown('This is **bold** text')).toBe('This is bold text');
      expect(stripMarkdown('This is __bold__ text')).toBe('This is bold text');
    });

    it('should remove headers', () => {
      expect(stripMarkdown('# Header 1\nContent')).toBe('Header 1\nContent');
      expect(stripMarkdown('## Header 2\nContent')).toBe('Header 2\nContent');
    });

    it('should remove code blocks', () => {
      const input = 'Before\n```js\nconst x = 1;\n```\nAfter';
      expect(stripMarkdown(input)).toBe('Before\n\nAfter');
    });

    it('should preserve link text but remove link syntax', () => {
      expect(stripMarkdown('Check out [this link](http://example.com)')).toBe('Check out this link');
    });

    it('should handle empty input', () => {
      expect(stripMarkdown('')).toBe('');
      expect(stripMarkdown(null)).toBe('');
      expect(stripMarkdown(undefined)).toBe('');
    });
  });

  describe('removePromptLeakage', () => {
    it('should remove SECTION markers', () => {
      expect(removePromptLeakage('**SECTION 1: Closest to Close**'))
        .not.toContain('SECTION');
    });

    it('should remove TONE instructions', () => {
      expect(removePromptLeakage('TONE: Professional and supportive.'))
        .toBe('');
    });

    it('should remove time focus markers', () => {
      expect(removePromptLeakage('Review deals (20-30 min focus)'))
        .not.toContain('20-30 min focus');
    });

    it('should remove conditional markers', () => {
      expect(removePromptLeakage('Personal insights (Conditional)'))
        .not.toContain('Conditional');
    });

    it('should handle empty input', () => {
      expect(removePromptLeakage('')).toBe('');
      expect(removePromptLeakage(null)).toBe('');
    });
  });

  describe('normalizeWhitespace', () => {
    it('should reduce multiple blank lines', () => {
      expect(normalizeWhitespace('Line 1\n\n\n\nLine 2')).toBe('Line 1\n\nLine 2');
    });

    it('should trim each line', () => {
      expect(normalizeWhitespace('  Line 1  \n  Line 2  ')).toBe('Line 1\nLine 2');
    });

    it('should reduce multiple spaces', () => {
      expect(normalizeWhitespace('Too   many   spaces')).toBe('Too many spaces');
    });
  });

  describe('detectSectionType', () => {
    it('should detect closest to close section', () => {
      expect(detectSectionType('Closest to Close')).toBe('closestToClose');
      expect(detectSectionType('Section 1: Priority Deals')).toBe('closestToClose');
    });

    it('should detect momentum builders section', () => {
      expect(detectSectionType('Momentum Builders')).toBe('momentumBuilders');
      expect(detectSectionType('Section 2')).toBe('momentumBuilders');
    });

    it('should detect relationships section', () => {
      expect(detectSectionType('Relationship Touchpoints')).toBe('relationshipTouchpoints');
      expect(detectSectionType('Section 3: Nurture')).toBe('relationshipTouchpoints');
    });

    it('should detect workflow insights section', () => {
      expect(detectSectionType('Workflow Insights')).toBe('workflowInsights');
      expect(detectSectionType('Personal Work Style')).toBe('workflowInsights');
    });

    it('should return null for unknown sections', () => {
      expect(detectSectionType('Random Header')).toBe(null);
    });
  });

  describe('parseIntoSections', () => {
    it('should parse text into structured sections', () => {
      const input = `
Closest to Close
- Deal 1: $50K
- Deal 2: $30K

Momentum Builders
- New lead from marketing
`;
      const result = parseIntoSections(input);
      expect(result.closestToClose.length).toBeGreaterThan(0);
      expect(result.momentumBuilders.length).toBeGreaterThan(0);
    });

    it('should handle text with no sections', () => {
      const result = parseIntoSections('Just some regular text');
      expect(result.general.length).toBeGreaterThan(0);
    });
  });

  describe('extractActionItems', () => {
    it('should extract action items from bullet points', () => {
      const input = `
- Follow up with Acme Corp
- Contact John at Tech Inc
- Review proposal for Big Deal
`;
      const items = extractActionItems(input);
      expect(items.length).toBe(3);
      expect(items[0].task).toContain('Follow up');
    });

    it('should detect high priority items', () => {
      const input = '- URGENT: Call client immediately high priority';
      const items = extractActionItems(input);
      expect(items[0].priority).toBe('high');
    });

    it('should extract deal values', () => {
      const input = '- Follow up on $50K deal with Acme';
      const items = extractActionItems(input);
      expect(items[0].value).toBe('$50K');
    });

    it('should handle empty input', () => {
      expect(extractActionItems('')).toEqual([]);
      expect(extractActionItems(null)).toEqual([]);
    });
  });

  describe('sanitizeAIOutput (full pipeline)', () => {
    it('should fully sanitize AI output', () => {
      const input = `
**SECTION 1: Closest to Close (20-30 min focus)**

Review these **priority deals**:
- Acme Corp - $50K - high priority

TONE: Keep it professional.
`;
      const result = sanitizeAIOutput(input);

      // Should not contain prompt leakage
      expect(result).not.toContain('SECTION 1:');
      expect(result).not.toContain('20-30 min focus');
      expect(result).not.toContain('TONE:');

      // Should preserve meaningful content
      expect(result).toContain('Acme Corp');
      expect(result).toContain('$50K');
    });

    it('should handle options', () => {
      const input = '**Bold** text with #hashtag';

      // With markdown stripping (default)
      expect(sanitizeAIOutput(input)).toBe('Bold text with #hashtag');

      // Without markdown stripping
      expect(sanitizeAIOutput(input, { stripMarkdown: false })).toContain('**');
    });
  });
});
