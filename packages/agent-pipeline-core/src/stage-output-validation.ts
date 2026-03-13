/**
 * Stage Output Schema Validation — Shared Module
 *
 * Lightweight JSON schema validation for stage outputs.
 * Used by both the SDK path (agent-stage-gate.ts handleComplete)
 * and the orchestrator path (executePipeline in index.ts).
 *
 * Enforcement modes:
 * - "warn" (default): validation emits warnings but never blocks.
 * - "block": validation failures prevent stage completion / pipeline progression.
 */

// ============================================================
// Types
// ============================================================

export interface StageOutputSchemaProperty {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: unknown[];
  minItems?: number;
  required?: string[];
  properties?: Record<string, StageOutputSchemaProperty>;
}

export interface StageOutputSchema {
  required?: string[];
  properties?: Record<string, StageOutputSchemaProperty>;
  /** When "block", validation failures prevent stage completion. Default: "warn". */
  enforcement?: 'warn' | 'block';
  /** Message returned to the agent when enforcement is "block" and validation fails. */
  blockMessage?: string;
}

export interface StageOutputValidationResult {
  valid: boolean;
  warnings: string[];
}

// ============================================================
// Validation
// ============================================================

function validateValue(
  value: unknown,
  schema: StageOutputSchemaProperty,
  path: string,
): string[] {
  const warnings: string[] = [];

  // Type check
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (value !== undefined && value !== null && actualType !== schema.type) {
      warnings.push(`${path}: expected type '${schema.type}', got '${actualType}'`);
    }
  }

  // Enum check
  if (schema.enum && value !== undefined) {
    if (!schema.enum.includes(value)) {
      warnings.push(`${path}: value '${String(value)}' not in enum [${schema.enum.map(String).join(', ')}]`);
    }
  }

  // Array minItems check
  if (schema.minItems !== undefined && Array.isArray(value)) {
    if (value.length < schema.minItems) {
      warnings.push(`${path}: array has ${value.length} items, minimum is ${schema.minItems}`);
    }
  }

  // Nested object validation
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in obj)) {
          warnings.push(`${path}.${req}: required field missing`);
        }
      }
    }

    // Validate known properties
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        warnings.push(...validateValue(obj[key], propSchema, `${path}.${key}`));
      }
    }
  }

  return warnings;
}

/**
 * Validate stage output data against a schema.
 *
 * Checks required fields at the top level and validates
 * property types/enums/arrays recursively.
 *
 * @param data - Stage output data to validate
 * @param schema - Schema to validate against
 * @returns Validation result with warnings
 */
export function validateStageOutput(
  data: Record<string, unknown>,
  schema: StageOutputSchema,
): StageOutputValidationResult {
  const warnings: string[] = [];

  // Check top-level required fields
  if (schema.required) {
    for (const req of schema.required) {
      if (!(req in data)) {
        warnings.push(`${req}: required field missing`);
      }
    }
  }

  // Validate known properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in data) {
        warnings.push(...validateValue(data[key], propSchema, key));
      }
    }
  }

  return { valid: warnings.length === 0, warnings };
}
