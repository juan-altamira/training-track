import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRoutinePlanFromDraft } from '../../src/lib/server/import/adapter-to-routineplan';
import { importCommitPayloadSchema } from '../../src/lib/import/schemas';
import type { ImportDraft } from '../../src/lib/import/types';
import { normalizePlan } from '../../src/lib/routines';

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
							reps_mode: 'number',
							reps_text: '8',
							reps_min: 8,
							reps_max: null,
							reps_special: null,
							note: null,
							parsed_shape: {
								version: 1,
								kind: 'fixed',
								sets: 3,
								reps_min: 8,
								reps_max: null,
								evidence: 'explicit',
								block: {
									kind: 'circuit',
									rounds: 3,
									header_text: 'Circuito x3 vueltas',
									header_unit_id: 'header-circuit-1'
								}
							},
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

test('adapter: custom mode auto-maps day by order when mapped_day_key is missing', () => {
	const draft = buildDraft('custom', 'Push');
	draft.days[0].mapped_day_key = null;
	const { plan, issues } = deriveRoutinePlanFromDraft(draft);
	assert.equal(issues.length, 0);
	assert.equal(plan['monday'].label, 'Push');
	assert.equal(plan['monday'].exercises.length, 1);
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

test('adapter + normalizePlan: preserves importShape and block header metadata', () => {
	const draft = buildDraft('custom', 'Pierna A');
	const { plan, issues } = deriveRoutinePlanFromDraft(draft);
	assert.equal(issues.length, 0);

	const normalized = normalizePlan(plan);
	const exercise = normalized['monday'].exercises[0];
	assert.ok(exercise?.importShape);
	assert.equal(exercise.importShape?.kind, 'fixed');
	assert.equal(exercise.importShape?.sets, 3);
	assert.equal(exercise.importShape?.block?.kind, 'circuit');
	assert.equal(exercise.importShape?.block?.header_text, 'Circuito x3 vueltas');
	assert.equal(exercise.importShape?.block?.header_unit_id, 'header-circuit-1');
});
