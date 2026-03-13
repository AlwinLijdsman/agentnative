/**
 * Tests for pauseDisplayFields rendering in pause-formatter.ts.
 *
 * Verifies:
 * - All 4 field types: text, list, key-value, object-list
 * - Display fields are rendered between header and pauseInstructions
 * - Missing/null data is gracefully skipped
 * - Backward compatibility when pauseDisplayFields is absent
 * - Template placeholder replacement in object-list
 * - displayKeys filtering in key-value
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPauseMessage, renderDisplayFields } from '../pause-formatter.ts';
import type { PauseDisplayField } from '../../../agents/types.ts';

// ============================================================================
// renderDisplayFields() unit tests
// ============================================================================

describe('renderDisplayFields()', () => {

  it('renders text field as **Label**: value', () => {
    const fields: PauseDisplayField[] = [
      { key: 'name', label: 'Feature', type: 'text' },
    ];
    const lines = renderDisplayFields(fields, { name: 'Add dark mode' });
    assert.ok(lines.some(l => l === '**Feature**: Add dark mode'), `Expected "**Feature**: Add dark mode" in: ${lines.join('|')}`);
  });

  it('renders number and boolean as text', () => {
    const fields: PauseDisplayField[] = [
      { key: 'count', label: 'Count', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'text' },
    ];
    const lines = renderDisplayFields(fields, { count: 42, enabled: true });
    assert.ok(lines.some(l => l === '**Count**: 42'));
    assert.ok(lines.some(l => l === '**Enabled**: true'));
  });

  it('renders list field as bulleted list', () => {
    const fields: PauseDisplayField[] = [
      { key: 'areas', label: 'Affected Areas', type: 'list' },
    ];
    const lines = renderDisplayFields(fields, {
      areas: ['src/agent.ts', 'src/config.ts'],
    });
    assert.ok(lines.some(l => l === '**Affected Areas**'));
    assert.ok(lines.some(l => l === '- src/agent.ts'));
    assert.ok(lines.some(l => l === '- src/config.ts'));
  });

  it('renders key-value field as comma-separated values', () => {
    const fields: PauseDisplayField[] = [
      { key: 'stack', label: 'Tech Stack', type: 'key-value' },
    ];
    const lines = renderDisplayFields(fields, {
      stack: { language: 'TypeScript', runtime: 'Node.js', db: 'PostgreSQL' },
    });
    assert.ok(lines.some(l => l === '**Tech Stack**: TypeScript, Node.js, PostgreSQL'));
  });

  it('key-value field filters by displayKeys', () => {
    const fields: PauseDisplayField[] = [
      { key: 'stack', label: 'Tech Stack', type: 'key-value', displayKeys: ['language', 'runtime'] },
    ];
    const lines = renderDisplayFields(fields, {
      stack: { language: 'TypeScript', runtime: 'Node.js', db: 'PostgreSQL' },
    });
    const kvLine = lines.find(l => l.startsWith('**Tech Stack**'));
    assert.ok(kvLine, 'Should have Tech Stack line');
    assert.ok(kvLine!.includes('TypeScript'));
    assert.ok(kvLine!.includes('Node.js'));
    assert.ok(!kvLine!.includes('PostgreSQL'), 'Should not include db (not in displayKeys)');
  });

  it('renders object-list with itemTemplate', () => {
    const fields: PauseDisplayField[] = [
      {
        key: 'findings', label: 'Findings', type: 'object-list',
        itemTemplate: '**{id}** ({severity}): {resolution}',
      },
    ];
    const lines = renderDisplayFields(fields, {
      findings: [
        { id: 'F1', severity: 'critical', resolution: 'Fixed null check' },
        { id: 'F2', severity: 'low', resolution: 'Added docs' },
      ],
    });
    assert.ok(lines.some(l => l === '**Findings**'));
    assert.ok(lines.some(l => l === '- **F1** (critical): Fixed null check'));
    assert.ok(lines.some(l => l === '- **F2** (low): Added docs'));
  });

  it('skips fields with missing data keys', () => {
    const fields: PauseDisplayField[] = [
      { key: 'name', label: 'Feature', type: 'text' },
      { key: 'missing_key', label: 'Missing', type: 'text' },
    ];
    const lines = renderDisplayFields(fields, { name: 'Test' });
    assert.ok(lines.some(l => l.includes('**Feature**')));
    assert.ok(!lines.some(l => l.includes('**Missing**')), 'Missing key should be skipped');
  });

  it('skips fields with null values', () => {
    const fields: PauseDisplayField[] = [
      { key: 'name', label: 'Feature', type: 'text' },
    ];
    const lines = renderDisplayFields(fields, { name: null });
    assert.ok(!lines.some(l => l.includes('**Feature**')), 'Null value should be skipped');
  });

  it('skips empty string text fields', () => {
    const fields: PauseDisplayField[] = [
      { key: 'name', label: 'Feature', type: 'text' },
    ];
    const lines = renderDisplayFields(fields, { name: '' });
    assert.ok(!lines.some(l => l.includes('**Feature**')), 'Empty string should be skipped');
  });

  it('skips empty array list fields', () => {
    const fields: PauseDisplayField[] = [
      { key: 'areas', label: 'Areas', type: 'list' },
    ];
    const lines = renderDisplayFields(fields, { areas: [] });
    assert.ok(!lines.some(l => l.includes('**Areas**')), 'Empty array should be skipped');
  });

  it('skips non-array list fields', () => {
    const fields: PauseDisplayField[] = [
      { key: 'areas', label: 'Areas', type: 'list' },
    ];
    const lines = renderDisplayFields(fields, { areas: 'not an array' });
    assert.ok(!lines.some(l => l.includes('**Areas**')), 'Non-array should be skipped for list type');
  });

  it('key-value skips null/false/empty values', () => {
    const fields: PauseDisplayField[] = [
      { key: 'stack', label: 'Stack', type: 'key-value' },
    ];
    const lines = renderDisplayFields(fields, {
      stack: { language: 'TypeScript', unused: null, disabled: false, empty: '' },
    });
    const kvLine = lines.find(l => l.startsWith('**Stack**'));
    assert.ok(kvLine);
    assert.equal(kvLine, '**Stack**: TypeScript');
  });

  it('object-list handles missing template fields gracefully', () => {
    const fields: PauseDisplayField[] = [
      {
        key: 'items', label: 'Items', type: 'object-list',
        itemTemplate: '{name} ({missing_field})',
      },
    ];
    const lines = renderDisplayFields(fields, {
      items: [{ name: 'Item1' }],
    });
    assert.ok(lines.some(l => l === '- Item1 ()'), `Expected "- Item1 ()" in: ${lines.join('|')}`);
  });

  it('renders multiple fields in order', () => {
    const fields: PauseDisplayField[] = [
      { key: 'scope', label: 'Scope', type: 'text' },
      { key: 'areas', label: 'Areas', type: 'list' },
    ];
    const lines = renderDisplayFields(fields, {
      scope: 'medium',
      areas: ['file1.ts', 'file2.ts'],
    });
    const scopeIdx = lines.findIndex(l => l.includes('**Scope**'));
    const areasIdx = lines.findIndex(l => l.includes('**Areas**'));
    assert.ok(scopeIdx >= 0, 'Scope should be present');
    assert.ok(areasIdx >= 0, 'Areas should be present');
    assert.ok(scopeIdx < areasIdx, 'Scope should come before Areas');
  });
});

// ============================================================================
// formatPauseMessage() integration tests with pauseDisplayFields
// ============================================================================

describe('formatPauseMessage() with pauseDisplayFields', () => {

  it('renders display fields between header and pauseInstructions', () => {
    const data = {
      feature_description: 'Add dark mode toggle',
      scope: 'medium',
      affected_areas: ['src/settings.ts', 'src/theme.ts'],
    };
    const fields: PauseDisplayField[] = [
      { key: 'feature_description', label: 'Feature', type: 'text' },
      { key: 'scope', label: 'Scope', type: 'text' },
      { key: 'affected_areas', label: 'Affected Areas', type: 'list' },
    ];
    const result = formatPauseMessage(0, 'analyze_request', data, JSON.stringify(data), {
      pauseInstructions: '1. **Proceed**\n2. **Cancel**',
      pauseDisplayFields: fields,
    });

    const msg = result.message;

    // Header should be first
    assert.ok(msg.includes('**Stage 0 (analyze_request) Complete**'));

    // Fields should appear
    assert.ok(msg.includes('**Feature**: Add dark mode toggle'));
    assert.ok(msg.includes('**Scope**: medium'));
    assert.ok(msg.includes('- src/settings.ts'));

    // Instructions should appear after fields
    assert.ok(msg.includes('1. **Proceed**'));

    // Collapsible JSON should still be present
    assert.ok(msg.includes('<details>'));

    // Verify ordering: fields before instructions
    const featurePos = msg.indexOf('**Feature**');
    const instructionsPos = msg.indexOf('1. **Proceed**');
    assert.ok(featurePos < instructionsPos, 'Fields should appear before instructions');

    assert.equal(result.normalizationPath, 'pauseInstructions');
  });

  it('backward compatible — no pauseDisplayFields renders same as before', () => {
    const data = { scope: 'test' };
    const result = formatPauseMessage(0, 'analyze_request', data, JSON.stringify(data), {
      pauseInstructions: 'Review the scope.',
    });

    const msg = result.message;
    assert.ok(msg.includes('**Stage 0 (analyze_request) Complete**'));
    assert.ok(msg.includes('Review the scope.'));
    assert.ok(msg.includes('<details>'));
    // Should NOT render data fields (no pauseDisplayFields config)
    assert.ok(!msg.includes('**Scope**: test'), 'Should not render fields without config');
  });

  it('empty pauseDisplayFields array renders same as before', () => {
    const data = { scope: 'test' };
    const result = formatPauseMessage(0, 'analyze_request', data, JSON.stringify(data), {
      pauseInstructions: 'Review the scope.',
      pauseDisplayFields: [],
    });

    assert.ok(!result.message.includes('**Scope**: test'));
    assert.ok(result.message.includes('Review the scope.'));
  });

  it('renders Stage 3 dev-loop output correctly', () => {
    const data = {
      refined_plan: 'Updated approach with better error handling',
      addressed_findings: [
        { finding_id: 'F1', severity: 'critical', resolution: 'Added null check' },
        { finding_id: 'F2', severity: 'high', resolution: 'Fixed race condition' },
      ],
      rejected_findings: [
        { finding_id: 'F3', severity: 'low', reason: 'Style preference, not a bug' },
      ],
      final_phases: [
        { phase: 1, name: 'Type System', description: 'Add new interfaces' },
        { phase: 2, name: 'Implementation', description: 'Wire up components' },
      ],
    };
    const fields: PauseDisplayField[] = [
      { key: 'refined_plan', label: 'Refined Approach', type: 'text' },
      { key: 'addressed_findings', label: 'Addressed Findings', type: 'object-list', itemTemplate: '**{finding_id}** ({severity}): {resolution}' },
      { key: 'rejected_findings', label: 'Rejected Findings', type: 'object-list', itemTemplate: '**{finding_id}** ({severity}): {reason}' },
      { key: 'final_phases', label: 'Implementation Phases', type: 'object-list', itemTemplate: '**Phase {phase}: {name}** — {description}' },
    ];

    const result = formatPauseMessage(3, 'refine_plan', data, JSON.stringify(data), {
      pauseInstructions: '1. **Approve**\n2. **Amend**\n3. **Cancel**',
      pauseDisplayFields: fields,
    });

    const msg = result.message;
    assert.ok(msg.includes('**Refined Approach**: Updated approach with better error handling'));
    assert.ok(msg.includes('- **F1** (critical): Added null check'));
    assert.ok(msg.includes('- **F2** (high): Fixed race condition'));
    assert.ok(msg.includes('- **F3** (low): Style preference, not a bug'));
    assert.ok(msg.includes('- **Phase 1: Type System** — Add new interfaces'));
    assert.ok(msg.includes('- **Phase 2: Implementation** — Wire up components'));
  });
});
