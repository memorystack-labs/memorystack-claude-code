import { validateTaskValue } from './task-context.js';
const text = { type: 'string', minLength: 1, maxLength: 1000 };
export const provenanceSchema = { type: 'object', additionalProperties: false, properties: {
  origin: { type: 'string', enum: ['agent_inference', 'user_statement', 'external_material', 'derived'] },
  reference: text,
  parent_memory_ids: { type: 'array', maxItems: 12, items: { type: 'string', format: 'uuid' } },
  verification: { type: 'string', enum: ['not_verified', 'code_inspection', 'test_result', 'human_review'] },
  checks: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
    required: ['command', 'result', 'coverage'], properties: { command: text, coverage: text, reference: text,
      result: { type: 'string', enum: ['passed', 'failed', 'inconclusive'] } } } },
  limitations: { type: 'array', maxItems: 8, items: text },
} };
export function validateProvenance(value) {
  if (value === undefined) return undefined;
  validateTaskValue(value, provenanceSchema, 'provenance');
  if (value.parent_memory_ids?.some(id => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) throw new Error('parent_memory_ids must be UUIDs');
  if (value.verification === 'test_result' && !value.checks?.length) throw new Error('Test evidence requires command, result and coverage');
  if (['user_statement', 'external_material', 'derived'].includes(value.origin) && !value.reference?.trim()) throw new Error('Attributed origin needs a source reference');
  return value;
}
