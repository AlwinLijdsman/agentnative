/**
 * Stage Output Schema Validation — Unit Tests
 *
 * Tests the shared validateStageOutput() function used by both
 * the SDK path (agent-stage-gate.ts) and the orchestrator path (index.ts).
 *
 * Tests:
 * - Required field validation
 * - Type validation
 * - Enum validation
 * - Array minItems validation
 * - Dev-loop stage 2 (review) schema
 * - Dev-loop stage 3 (refine_plan) schema
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStageOutput } from '../stage-output-validation.ts';
import type { StageOutputSchema } from '../stage-output-validation.ts';

// ============================================================
// Stage 2 (review) schema — mirrors agents/dev-loop/config.json
// ============================================================

const STAGE_2_SCHEMA: StageOutputSchema = {
  required: ['findings', 'plan_verdict'],
  properties: {
    findings: { type: 'array' },
    severity_distribution: { type: 'object' },
    critical_count: { type: 'number' },
    plan_verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
  },
  enforcement: 'block',
};

// ============================================================
// Stage 3 (refine_plan) schema — mirrors agents/dev-loop/config.json
// ============================================================

const STAGE_3_SCHEMA: StageOutputSchema = {
  required: ['refined_plan', 'final_phases'],
  properties: {
    refined_plan: { type: 'string' },
    addressed_findings: { type: 'array' },
    rejected_findings: { type: 'array' },
    final_phases: { type: 'array', minItems: 1 },
  },
  enforcement: 'block',
};

describe('validateStageOutput', () => {
  // ============================================================
  // Basic validation
  // ============================================================

  describe('required fields', () => {
    it('should pass when all required fields present', () => {
      const result = validateStageOutput(
        { findings: [], plan_verdict: 'pass' },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, true);
      assert.equal(result.warnings.length, 0);
    });

    it('should fail when required field is missing', () => {
      const result = validateStageOutput(
        { plan_verdict: 'pass' },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('findings')));
    });

    it('should fail when multiple required fields are missing', () => {
      const result = validateStageOutput(
        { severity_distribution: {} },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('findings')));
      assert.ok(result.warnings.some(w => w.includes('plan_verdict')));
    });
  });

  describe('type validation', () => {
    it('should pass when types match', () => {
      const result = validateStageOutput(
        { findings: [{ id: 'F1' }], plan_verdict: 'pass', critical_count: 0 },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, true);
    });

    it('should warn when type mismatches', () => {
      const result = validateStageOutput(
        { findings: 'not-an-array', plan_verdict: 'pass' },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('findings') && w.includes('array')));
    });
  });

  describe('enum validation', () => {
    it('should pass when value in enum', () => {
      const result = validateStageOutput(
        { findings: [], plan_verdict: 'warn' },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, true);
    });

    it('should warn when value not in enum', () => {
      const result = validateStageOutput(
        { findings: [], plan_verdict: 'invalid_verdict' },
        STAGE_2_SCHEMA,
      );
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('plan_verdict') && w.includes('enum')));
    });
  });

  describe('array minItems', () => {
    it('should pass when array meets minItems', () => {
      const result = validateStageOutput(
        { refined_plan: 'Updated approach', final_phases: [{ phase: 1 }] },
        STAGE_3_SCHEMA,
      );
      assert.equal(result.valid, true);
    });

    it('should warn when array is empty but minItems > 0', () => {
      const result = validateStageOutput(
        { refined_plan: 'Updated approach', final_phases: [] },
        STAGE_3_SCHEMA,
      );
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('final_phases') && w.includes('minimum')));
    });
  });

  // ============================================================
  // Dev-loop stage 2 (review) — realistic scenarios
  // ============================================================

  describe('stage 2 (review) schema', () => {
    it('should pass with complete review output', () => {
      const result = validateStageOutput({
        findings: [
          { id: 'F1', severity: 'high', category: 'correctness', title: 'Missing null check' },
          { id: 'F2', severity: 'medium', category: 'architecture', title: 'Circular dep risk' },
        ],
        severity_distribution: { critical: 0, high: 1, medium: 1, low: 0 },
        critical_count: 0,
        plan_verdict: 'warn',
      }, STAGE_2_SCHEMA);
      assert.equal(result.valid, true);
    });

    it('should fail with rubber-stamp output (missing findings)', () => {
      const result = validateStageOutput({
        review_result: 'approved',
        review_notes: 'Plan looks good.',
      }, STAGE_2_SCHEMA);
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('findings')));
      assert.ok(result.warnings.some(w => w.includes('plan_verdict')));
    });

    it('should fail with invalid plan_verdict value', () => {
      const result = validateStageOutput({
        findings: [],
        plan_verdict: 'approved',
      }, STAGE_2_SCHEMA);
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('plan_verdict') && w.includes('enum')));
    });
  });

  // ============================================================
  // Dev-loop stage 3 (refine_plan) — realistic scenarios
  // ============================================================

  describe('stage 3 (refine_plan) schema', () => {
    it('should pass with complete refinement output', () => {
      const result = validateStageOutput({
        refined_plan: 'Updated approach addressing F1.',
        addressed_findings: [{ finding_id: 'F1', resolution: 'Added null check' }],
        rejected_findings: [],
        final_phases: [
          { phase: 1, name: 'Fix null check', steps: ['Add guard'] },
        ],
      }, STAGE_3_SCHEMA);
      assert.equal(result.valid, true);
    });

    it('should fail with rubber-stamp output (missing refined_plan and final_phases)', () => {
      const result = validateStageOutput({
        refined_plan: 'No refinement needed',
        changes_made: 'none',
      }, STAGE_3_SCHEMA);
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('final_phases')));
    });

    it('should fail when final_phases is empty array', () => {
      const result = validateStageOutput({
        refined_plan: 'Updated plan',
        final_phases: [],
      }, STAGE_3_SCHEMA);
      assert.equal(result.valid, false);
      assert.ok(result.warnings.some(w => w.includes('final_phases') && w.includes('minimum')));
    });
  });

  // ============================================================
  // No schema / empty schema
  // ============================================================

  describe('edge cases', () => {
    it('should pass with no required fields', () => {
      const result = validateStageOutput(
        { anything: 'goes' },
        { properties: {} },
      );
      assert.equal(result.valid, true);
    });

    it('should pass with empty data and no requirements', () => {
      const result = validateStageOutput({}, {});
      assert.equal(result.valid, true);
    });
  });
});
