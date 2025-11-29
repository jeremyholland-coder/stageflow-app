/**
 * Deal Recovery Utility
 *
 * Fixes orphaned deals and helps migrate deals between pipeline templates
 */

import { supabase } from '../lib/supabase';
import { PIPELINE_TEMPLATES } from '../config/pipelineTemplates';

/**
 * Find all orphaned deals (deals with stage_id that doesn't exist in current pipeline)
 * @param {string} organizationId - Organization ID
 * @param {Array} currentStages - Current pipeline stages
 * @returns {Promise<Array>} - List of orphaned deals
 */
export async function findOrphanedDeals(organizationId, currentStages) {
  if (!organizationId || !currentStages || currentStages.length === 0) {
    throw new Error('Missing required parameters');
  }

  const validStageIds = currentStages.map(s => s.id);

  const { data: allDeals, error } = await supabase
    .from('deals')
    .select('*')
    .eq('organization_id', organizationId);

  if (error) throw error;

  // Find deals whose stage doesn't match any current stage
  const orphaned = allDeals.filter(deal => !validStageIds.includes(deal.stage));

  return orphaned;
}

/**
 * Map orphaned deal stage to closest matching stage in new pipeline
 * @param {string} oldStage - Old stage ID
 * @param {Array} newStages - New pipeline stages
 * @returns {string} - Best matching new stage ID
 */
function mapStageToClosestMatch(oldStage, newStages) {
  // Stage mapping logic - maps common stages across different pipelines
  const stageMapping = {
    // Lead stages → first stage
    'lead': newStages[0]?.id,
    'lead_captured': newStages[0]?.id,
    'lead_generation': newStages[0]?.id,
    'lead_identified': newStages[0]?.id,
    'prospecting': newStages[0]?.id,

    // Discovery/Contact stages → second stage
    'discovery': newStages[1]?.id,
    'contacted': newStages[1]?.id,
    'contact': newStages[1]?.id,
    'qualification': newStages[1]?.id,
    'lead_qualification': newStages[1]?.id,

    // Proposal stages → middle stage
    'quote': Math.floor(newStages.length / 2) >= 0 ? newStages[Math.floor(newStages.length / 2)]?.id : newStages[0]?.id,
    'proposal': Math.floor(newStages.length / 2) >= 0 ? newStages[Math.floor(newStages.length / 2)]?.id : newStages[0]?.id,
    'proposal_sent': Math.floor(newStages.length / 2) >= 0 ? newStages[Math.floor(newStages.length / 2)]?.id : newStages[0]?.id,

    // Won/Closed stages → last non-lost stage
    'deal_won': newStages[newStages.length - 2]?.id || newStages[newStages.length - 1]?.id,
    'closed': newStages[newStages.length - 2]?.id || newStages[newStages.length - 1]?.id,
    'closed_won': newStages[newStages.length - 2]?.id || newStages[newStages.length - 1]?.id,

    // Lost stage → last stage (if exists) or first
    'lost': newStages.find(s => s.id === 'lost' || s.id === 'deal_lost')?.id || newStages[newStages.length - 1]?.id,
    'deal_lost': newStages.find(s => s.id === 'lost' || s.id === 'deal_lost')?.id || newStages[newStages.length - 1]?.id,
  };

  // Return mapped stage or default to first stage
  return stageMapping[oldStage] || newStages[0]?.id;
}

/**
 * Recover orphaned deals by mapping them to valid stages
 * @param {string} organizationId - Organization ID
 * @param {Array} currentStages - Current pipeline stages
 * @param {boolean} dryRun - If true, only returns what would change without updating
 * @returns {Promise<Object>} - Recovery results
 */
export async function recoverOrphanedDeals(organizationId, currentStages, dryRun = false) {
  const orphaned = await findOrphanedDeals(organizationId, currentStages);

  if (orphaned.length === 0) {
    return {
      fixed: 0,
      skipped: 0,
      errors: [],
      message: 'No orphaned deals found'
    };
  }

  const results = {
    fixed: 0,
    skipped: 0,
    errors: [],
    changes: []
  };

  for (const deal of orphaned) {
    try {
      const newStage = mapStageToClosestMatch(deal.stage, currentStages);

      if (!newStage) {
        results.skipped++;
        results.errors.push({
          dealId: deal.id,
          client: deal.client,
          error: 'Could not map stage'
        });
        continue;
      }

      const change = {
        dealId: deal.id,
        client: deal.client,
        oldStage: deal.stage,
        newStage: newStage
      };

      if (dryRun) {
        results.changes.push(change);
        continue;
      }

      // Actually update the deal
      const { error } = await supabase
        .from('deals')
        .update({
          stage: newStage,
          last_activity: new Date().toISOString()
        })
        .eq('id', deal.id);

      if (error) {
        results.errors.push({
          dealId: deal.id,
          client: deal.client,
          error: error.message
        });
        results.skipped++;
      } else {
        results.fixed++;
        results.changes.push(change);
      }
    } catch (err) {
      results.errors.push({
        dealId: deal.id,
        client: deal.client,
        error: err.message
      });
      results.skipped++;
    }
  }

  return results;
}

/**
 * Get stats about current pipeline health
 * @param {string} organizationId - Organization ID
 * @param {Array} currentStages - Current pipeline stages
 * @returns {Promise<Object>} - Pipeline health stats
 */
export async function getPipelineHealth(organizationId, currentStages) {
  const { data: allDeals, error } = await supabase
    .from('deals')
    .select('*')
    .eq('organization_id', organizationId);

  if (error) throw error;

  const validStageIds = currentStages.map(s => s.id);
  const orphaned = allDeals.filter(deal => !validStageIds.includes(deal.stage));
  const valid = allDeals.filter(deal => validStageIds.includes(deal.stage));

  return {
    totalDeals: allDeals.length,
    validDeals: valid.length,
    orphanedDeals: orphaned.length,
    healthPercentage: allDeals.length > 0
      ? Math.round((valid.length / allDeals.length) * 100)
      : 100,
    orphanedStages: [...new Set(orphaned.map(d => d.stage))]
  };
}

/**
 * Migrate all deals from one pipeline template to another
 * @param {string} organizationId - Organization ID
 * @param {string} fromTemplate - Old template ID (e.g., 'default', 'saas', 'real_estate')
 * @param {string} toTemplate - New template ID
 * @param {boolean} dryRun - If true, only returns what would change
 * @returns {Promise<Object>} - Migration results
 */
export async function migratePipeline(organizationId, fromTemplate, toTemplate, dryRun = false) {
  const newTemplate = PIPELINE_TEMPLATES[toTemplate];

  if (!newTemplate) {
    throw new Error(`Invalid template: ${toTemplate}`);
  }

  const newStages = newTemplate.stages.map((stage, index) => ({
    id: stage.id,
    name: stage.name,
    stage_order: index
  }));

  // Find and recover all orphaned deals
  const results = await recoverOrphanedDeals(organizationId, newStages, dryRun);

  if (!dryRun && results.fixed > 0) {
    // Update organization pipeline template
    await supabase
      .from('organizations')
      .update({ pipeline_template: toTemplate })
      .eq('id', organizationId);

    // Clear sessionStorage cache
    sessionStorage.removeItem(`pipeline_template_${organizationId}`);
  }

  return {
    ...results,
    templateChanged: !dryRun,
    fromTemplate,
    toTemplate,
    newStageCount: newStages.length
  };
}
