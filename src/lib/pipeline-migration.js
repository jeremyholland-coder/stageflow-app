// Pipeline Migration Utility
// Maps deals from one pipeline to another intelligently

// Stage mapping logic: generic → industry-specific
const STAGE_MAPPINGS = {
  // From Generic → SaaS
  'generic_to_saas': {
    'prospecting': 'lead_captured',
    'lead': 'lead_captured',
    'quote': 'proposal',
    'approval': 'negotiation',
    'invoice': 'closed_won',
    'onboarding': 'closed_won',
    'delivery': 'closed_won',
    'retention': 'closed_won'
  },
  
  // From Generic → Services
  'generic_to_services': {
    'prospecting': 'inquiry',
    'lead': 'inquiry',
    'quote': 'proposal',
    'approval': 'negotiation',
    'invoice': 'contract',
    'onboarding': 'closed_won',
    'delivery': 'closed_won',
    'retention': 'closed_won'
  },
  
  // From Generic → Real Estate
  'generic_to_real_estate': {
    'prospecting': 'lead',
    'lead': 'lead',
    'quote': 'property_match',
    'approval': 'offer',
    'invoice': 'contract',
    'onboarding': 'closed_won',
    'delivery': 'closed_won',
    'retention': 'closed_won'
  },
  
  // From Generic → Healthcare
  'generic_to_healthcare': {
    'prospecting': 'lead_gen',
    'lead': 'lead_gen',
    'quote': 'proposal',
    'approval': 'negotiation',
    'invoice': 'closed_won',
    'onboarding': 'closed_won',
    'delivery': 'closed_won',
    'retention': 'closed_won'
  },
  
  // From Generic → Investment
  'generic_to_investment': {
    'prospecting': 'sourcing',
    'lead': 'screening',
    'quote': 'review',
    'approval': 'diligence',
    'invoice': 'committee',
    'onboarding': 'closed',
    'delivery': 'closed',
    'retention': 'closed'
  },
  
  // Reverse mappings: industry → generic
  'saas_to_generic': {
    'lead_captured': 'lead',
    'qualified': 'lead',
    'discovery_demo': 'quote',
    'proposal': 'quote',
    'negotiation': 'approval',
    'closed_won': 'retention'
  },
  
  'services_to_generic': {
    'inquiry': 'lead',
    'discovery': 'lead',
    'proposal': 'quote',
    'negotiation': 'approval',
    'contract': 'invoice',
    'closed_won': 'retention'
  },
  
  'real_estate_to_generic': {
    'lead': 'lead',
    'qualification': 'lead',
    'property_match': 'quote',
    'offer': 'approval',
    'contract': 'invoice',
    'closed_won': 'retention'
  },
  
  'healthcare_to_generic': {
    'lead_gen': 'lead',
    'qualification': 'lead',
    'proposal': 'quote',
    'negotiation': 'approval',
    'closed_won': 'retention'
  },
  
  'investment_to_generic': {
    'sourcing': 'prospecting',
    'screening': 'lead',
    'review': 'quote',
    'diligence': 'approval',
    'committee': 'invoice',
    'closed': 'retention'
  }
};

export const getMappingKey = (fromIndustry, toIndustry) => {
  return fromIndustry + '_to_' + toIndustry;
};

export const mapStage = (stage, fromIndustry, toIndustry) => {
  const mappingKey = getMappingKey(fromIndustry, toIndustry);
  const mapping = STAGE_MAPPINGS[mappingKey];
  
  if (!mapping) {
    console.warn('No mapping found for ' + mappingKey);
    return stage;
  }
  
  return mapping[stage] || stage;
};

export const migrateDealsToPipeline = async (supabase, organizationId, fromIndustry, toIndustry) => {
  try {
    const { data: deals, error: fetchError } = await supabase
      .from('deals')
      .select('id, stage, status')
      .eq('organization_id', organizationId)
      .eq('status', 'active');
    
    if (fetchError) throw fetchError;
    if (!deals || deals.length === 0) return { success: true, migrated: 0 };
    
    let migrated = 0;
    const errors = [];
    
    for (const deal of deals) {
      const newStage = mapStage(deal.stage, fromIndustry, toIndustry);
      
      if (newStage === deal.stage) {
        migrated++;
        continue;
      }
      
      const { error: updateError } = await supabase
        .from('deals')
        .update({ stage: newStage })
        .eq('id', deal.id);
      
      if (updateError) {
        console.error('Failed to update deal ' + deal.id + ':', updateError);
        errors.push({ dealId: deal.id, error: updateError.message });
      } else {
        migrated++;
      }
    }
    
    if (errors.length > 0) {
      console.warn('Migration completed with ' + errors.length + ' errors');
    }
    
    return { 
      success: errors.length === 0, 
      migrated,
      errors: errors.length > 0 ? errors : undefined 
    };
  } catch (error) {
    console.error('Deal migration failed:', error);
    return { success: false, error: error.message };
  }
};

export const getMigrationPreview = async (supabase, organizationId, fromIndustry, toIndustry) => {
  try {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, client, stage, status')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .limit(100);
    
    if (error) throw error;
    if (!deals || deals.length === 0) return [];
    
    return deals.map(deal => ({
      id: deal.id,
      client: deal.client,
      oldStage: deal.stage,
      newStage: mapStage(deal.stage, fromIndustry, toIndustry)
    }));
  } catch (error) {
    console.error('Preview generation failed:', error);
    return [];
  }
};
