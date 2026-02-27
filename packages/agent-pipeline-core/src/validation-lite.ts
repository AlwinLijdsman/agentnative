/**
 * Agent Pipeline Core - Validation Lite Utilities
 *
 * Minimal validation helpers used by agent pipeline handlers.
 * Deliberately excludes filesystem, frontmatter, and zod dependencies.
 */

import type { ValidationResult, ValidationIssue } from './types.ts';

// ============================================================
// Validation Result Helpers
// ============================================================

/**
 * Create an empty valid result
 */
export function validResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

/**
 * Create an invalid result with a single error
 */
export function invalidResult(path: string, message: string, suggestion?: string): ValidationResult {
  return {
    valid: false,
    errors: [{ path, message, suggestion }],
    warnings: [],
  };
}

/**
 * Merge multiple validation results into one
 */
export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const result of results) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// Validation Result Formatting
// ============================================================

/**
 * Format validation result as human-readable text for tool responses.
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push('✓ Validation passed');
  } else {
    lines.push('✗ Validation failed');
  }

  if (result.errors.length > 0) {
    lines.push('\nErrors:');
    for (const error of result.errors) {
      lines.push(`  - ${error.path}: ${error.message}`);
      if (error.suggestion) {
        lines.push(`    → ${error.suggestion}`);
      }
    }
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarnings:');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning.path}: ${warning.message}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Slug Validation
// ============================================================

/**
 * Regex for valid slugs: lowercase alphanumeric with hyphens
 */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Validate a slug format
 */
export function validateSlug(slug: string): ValidationResult {
  if (!SLUG_REGEX.test(slug)) {
    const suggestedSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');

    return invalidResult(
      'slug',
      'Slug must be lowercase alphanumeric with hyphens',
      `Suggested: '${suggestedSlug || 'valid-slug-name'}'`
    );
  }

  return validResult();
}
