import { describe, it, expect } from 'vitest';
import { WON_STAGES, LOST_STAGES, getStatusForStage } from '../../shared/stageStatusMap';
import { STAGE_STATUS_MAP, getStatusForStage as feGetStatusForStage } from '../../src/config/pipelineTemplates';

const toSortedArray = (set: Set<string>) => Array.from(set).sort();

describe('Shared stage → status map parity', () => {
  it('includes all canonical won stages', () => {
    expect(WON_STAGES.has('retention_renewal')).toBe(true);
    expect(WON_STAGES.has('contract_signed')).toBe(true);
  });

  it('includes all canonical lost stages', () => {
    expect(LOST_STAGES.has('passed')).toBe(true);
    expect(LOST_STAGES.has('deal_lost')).toBe(true);
  });

  it('frontend map matches shared map', () => {
    expect(toSortedArray(STAGE_STATUS_MAP.WON_STAGES)).toEqual(toSortedArray(WON_STAGES));
    expect(toSortedArray(STAGE_STATUS_MAP.LOST_STAGES)).toEqual(toSortedArray(LOST_STAGES));
  });

  it('getStatusForStage parity across frontend/backend', () => {
    expect(getStatusForStage('retention_renewal')).toBe('won');
    expect(feGetStatusForStage('retention_renewal')).toBe('won');
    expect(getStatusForStage('passed')).toBe('lost');
    expect(feGetStatusForStage('passed')).toBe('lost');
    expect(getStatusForStage('custom_stage')).toBe('active');
    expect(feGetStatusForStage('custom_stage')).toBe('active');
  });
});
