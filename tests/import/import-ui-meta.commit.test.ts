import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRoutinePlanFromDraft } from '../../src/lib/server/import/adapter-to-routineplan';
import { importCommitPayloadSchema } from '../../src/lib/import/schemas';
import type { ImportDraft } from '../../src/lib/import/types';

const nodeMeta = {
	confidence: { score: 0.95, label: 'high' as const },
	provenance: null
};

const buildDraft = (mode: 'weekday' | 'sequential' | 'custom', displayLabel: string): ImportDraft => ({
	version: 1,
	source_type: 'text',
	parser_version: 'test',
	ruleset_version: 'test',
	extractor_version: 'test',
	coverage: {
		days_detected: 1,
		exercises_parsed: 1,
		candidate_lines: 1,
		parsed_lines: 1,
		parseable_ratio: 1,
		required_fields_ratio: 1
	},
	presentation: {
		day_label_mode: mode
	},
	days: [
		{
			id: 'day-1',
			source_label: 'DIA 1',
			display_label: displayLabel,
			mapped_day_key: 'monday',
			blocks: [
				{
					id: 'block-1',
					block_type: 'single',
					nodes: [
						{
							id: 'node-1',
							source_raw_name: 'Sentadilla 3x8',
							raw_exercise_name: 'Sentadilla',
							sets: 3,
							reps_text: '8',
							reps_min: 8,
							reps_max: null,
							note: null,
							split_meta: null,
							field_meta: {
								day: nodeMeta,
								name: nodeMeta,
								sets: nodeMeta,
								reps: nodeMeta,
								note: null
							}
						}
					]
				}
			]
		}
	]
});

test('adapter: custom mode persists custom display label in plan slot', () => {
	const draft = buildDraft('custom', 'Pierna A');
	const { plan, issues } = deriveRoutinePlanFromDraft(draft);
	assert.equal(issues.length, 0);
	assert.equal(plan['monday'].label, 'Pierna A');
});

test('adapter: non-custom mode does not persist imported display label', () => {
	const draft = buildDraft('sequential', 'Día pesado');
	const { plan, issues } = deriveRoutinePlanFromDraft(draft);
	assert.equal(issues.length, 0);
	assert.equal(plan['monday'].label, 'Lunes');
});

test('commit schema: accepts optional ui_meta when valid and rejects empty object', () => {
	const ok = importCommitPayloadSchema.safeParse({
		policy: 'overwrite_all',
		routine_version_expected: 2,
		commit_idempotency_key: 'abc-123',
		ui_meta: {
			day_label_mode: 'custom',
			hide_empty_days_in_sequential: false
		}
	});
	assert.equal(ok.success, true);

	const invalid = importCommitPayloadSchema.safeParse({
		policy: 'overwrite_all',
		routine_version_expected: 2,
		commit_idempotency_key: 'abc-123',
		ui_meta: {}
	});
	assert.equal(invalid.success, false);
});
