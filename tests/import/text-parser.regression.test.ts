import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextPayload } from '../../src/lib/server/import/parsers/text';
import { buildDraftBundle } from '../../src/lib/server/import/validation';
import {
	IMPORT_EXTRACTOR_VERSION,
	IMPORT_PARSER_VERSION,
	IMPORT_RULESET_VERSION
} from '../../src/lib/server/import/constants';

const parseDraft = async (raw: string) => {
	const out = await parseTextPayload(new TextEncoder().encode(raw), {
		sourceType: 'text',
		parserVersion: IMPORT_PARSER_VERSION,
		rulesetVersion: IMPORT_RULESET_VERSION,
		extractorVersion: IMPORT_EXTRACTOR_VERSION
	});
	return out.draft;
};

const getNodes = (draft: Awaited<ReturnType<typeof parseDraft>>) =>
	draft.days.flatMap((day) => day.blocks.flatMap((block) => block.nodes));

test('anti-regression: tempo tail does not override explicit set x reps', async () => {
	const draft = await parseDraft('Sentadilla 3x8 tempo 3-1-1');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.raw_exercise_name, 'Sentadilla');
	assert.equal(node.sets, 3);
	assert.equal(node.reps_min, 8);
	assert.equal(node.note, 'tempo 3-1-1');
});

test('anti-regression: note literal preserves internal spacing', async () => {
	const draft = await parseDraft('Press banca 3x8 descanso  90s');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.note, 'descanso  90s');
});

test('anti-regression: note literal preserves decimal comma', async () => {
	const draft = await parseDraft('Press banca 3x8 82,5kg');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.note, '82,5kg');
});

test('anti-regression: day heading is not parsed as exercise', async () => {
	const draft = await parseDraft('Día 1:\nPress banca 3x8');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0]?.raw_exercise_name, 'Press banca');
	assert.equal(draft.days[0]?.mapped_day_key, 'monday');
	assert.equal(draft.presentation.day_label_mode, 'sequential');
});

test('anti-regression: superset heading is not parsed as exercise', async () => {
	const draft = await parseDraft('Superset:\nPress banca 3x8\nRemo 3x10');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 2);
	assert.ok(nodes.every((node) => node.parsed_shape?.block?.kind === 'superset'));
});

test('anti-regression: load header without entries creates no ghost exercise', async () => {
	const draft = await parseDraft('Press banca:');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 0);
});

test('anti-regression: circuit inline header and first entry works', async () => {
	const draft = await parseDraft('Circuito x3 vueltas: 10 flexiones\n15 sentadillas');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 2);
	assert.equal(nodes[0]?.raw_exercise_name, 'flexiones');
	assert.equal(nodes[0]?.sets, 3);
	assert.equal(nodes[1]?.raw_exercise_name, 'sentadillas');
	assert.equal(nodes[1]?.sets, 3);
	assert.ok(nodes.every((node) => node.parsed_shape?.block?.kind === 'circuit'));
});

test('anti-regression: ladder inline header and entries in same line', async () => {
	const draft = await parseDraft('Press banca: 60x12, 70x10');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0]?.raw_exercise_name, 'Press banca');
	assert.equal(nodes[0]?.parsed_shape?.kind, 'load_ladder');
	if (nodes[0]?.parsed_shape?.kind === 'load_ladder') {
		assert.equal(nodes[0].parsed_shape.load_entries.length, 2);
	}
});

test('anti-regression: circuit ignores time-like lines as entries', async () => {
	const draft = await parseDraft('Circuito x3 vueltas:\n60s descanso\n10 flexiones\n15 sentadillas');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 2);
	assert.equal(nodes[0]?.raw_exercise_name, 'flexiones');
	assert.equal(nodes[1]?.raw_exercise_name, 'sentadillas');
});

test('anti-regression: comma scheme does not split into multiple exercises', async () => {
	const draft = await parseDraft('Press banca 8,8,8');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0]?.parsed_shape?.kind, 'scheme');
	assert.equal(draft.coverage.multi_exercise_splits_applied, 0);
});

test('anti-regression: circuit can split a line containing two valid entries', async () => {
	const draft = await parseDraft('Circuito x3 vueltas:\n10 flexiones y 15 sentadillas\n20 abdominales');
	const nodes = getNodes(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes[0]?.raw_exercise_name, 'flexiones');
	assert.equal(nodes[1]?.raw_exercise_name, 'sentadillas');
	assert.equal(nodes[2]?.raw_exercise_name, 'abdominales');
});

test('anti-regression: contract path metrics are reported', async () => {
	const draft = await parseDraft('Press banca 3x8\nRemo 4x10');
	assert.equal(draft.coverage.legacy_fallback_hits, 0);
	assert.equal(draft.coverage.contract_lines_failed_invariants, 0);
	assert.ok((draft.coverage.contract_lines_parsed ?? 0) >= 2);
});

test('anti-regression: 3xAMRAP maps to special reps without blocking issues', async () => {
	const draft = await parseDraft('Dominadas 3xAMRAP');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.reps_mode, 'special');
	assert.equal(node.reps_special, 'AMRAP');
	assert.equal(node.reps_min, null);

	const bundle = buildDraftBundle(draft);
	const blocking = bundle.issues.filter((issue) =>
		['hard_error', 'needs_review_blocking'].includes(issue.severity)
	);
	assert.equal(blocking.length, 0);
	const exercise = bundle.derivedPlan['monday'].exercises[0];
	assert.ok(exercise);
	assert.equal(exercise.repsMode, 'special');
	assert.equal(exercise.repsSpecial, 'AMRAP');
});

test('anti-regression: scheme number run maps to special reps preserving sequence text', async () => {
	const draft = await parseDraft('Curl bíceps 12-10-8');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.sets, 3);
	assert.equal(node.reps_mode, 'special');
	assert.equal(node.reps_special, '12-10-8');
	assert.equal(node.reps_min, null);
	assert.equal(node.reps_max, null);
	assert.equal(node.parsed_shape?.kind, 'scheme');
});

test('anti-regression: comma sequences keep all reps and do not collapse as decimal', async () => {
	const draft = await parseDraft('Press inclinado 8,8,8');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.sets, 3);
	assert.equal(node.reps_mode, 'special');
	assert.equal(node.reps_special, '8-8-8');
	assert.equal(node.parsed_shape?.kind, 'scheme');
	if (node.parsed_shape?.kind === 'scheme') {
		assert.deepEqual(node.parsed_shape.reps_list, [8, 8, 8]);
	}
});

test('anti-regression: series wording with explicit range keeps max reps', async () => {
	const draft = await parseDraft('Press militar 3 series de 8 a 10');
	const node = getNodes(draft)[0];
	assert.ok(node);
	assert.equal(node.sets, 3);
	assert.equal(node.reps_mode, 'number');
	assert.equal(node.reps_min, 8);
	assert.equal(node.reps_max, 10);
	assert.equal(node.note, null);
	assert.equal(node.parsed_shape?.kind, 'range');
});

test('anti-regression: custom day headings infer custom mode and preserve labels', async () => {
	const draft = await parseDraft(
		'Día Push:\nPress banca 3x8\nDía Pull\nRemo con barra 4x10\nDia empuje\nFondos 3x12'
	);
	assert.equal(draft.presentation.day_label_mode, 'custom');
	assert.equal(draft.days.length, 3);
	assert.equal(draft.days[0]?.source_label, 'Día Push');
	assert.equal(draft.days[1]?.source_label, 'Día Pull');
	assert.equal(draft.days[2]?.source_label, 'Dia empuje');
	assert.equal(draft.days[0]?.mapped_day_key, null);
	assert.equal(draft.days[1]?.mapped_day_key, null);
	assert.equal(draft.days[2]?.mapped_day_key, null);

	const bundle = buildDraftBundle(draft);
	const blocking = bundle.issues.filter((issue) =>
		['hard_error', 'needs_review_blocking'].includes(issue.severity)
	);
	assert.equal(blocking.length, 0);
});
