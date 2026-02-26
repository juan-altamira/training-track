import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextPayload } from '../../src/lib/server/import/parsers/text';
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

const nodesFrom = (draft: Awaited<ReturnType<typeof parseDraft>>) =>
	draft.days.flatMap((day) => day.blocks.flatMap((block) => block.nodes));

const assertFixed = (
	node: ReturnType<typeof nodesFrom>[number] | undefined,
	sets: number,
	reps: number
) => {
	assert.ok(node);
	assert.equal(node.sets, sets);
	assert.equal(node.reps_min, reps);
	assert.equal(node.parsed_shape?.kind, 'fixed');
};

test('contract format 1: clasico simple 3x8', async () => {
	const draft = await parseDraft('Press banca 3x8\nSentadilla 4x10\nCurl biceps 3x12');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assertFixed(nodes[0], 3, 8);
	assertFixed(nodes[1], 4, 10);
	assertFixed(nodes[2], 3, 12);
	assert.equal(draft.coverage.legacy_fallback_hits, 0);
});

test('contract format 2: con espacios 3 x 8', async () => {
	const draft = await parseDraft('Press banca 3 x 8\nRemo con barra 4 x 10\nPeso muerto 5 x 5');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assertFixed(nodes[0], 3, 8);
	assertFixed(nodes[1], 4, 10);
	assertFixed(nodes[2], 5, 5);
});

test('contract format 3: series separadas por coma', async () => {
	const draft = await parseDraft('Press banca 8,8,8\nDominadas 10,10,8,6\nFondos 12,12,12');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes[0]?.parsed_shape?.kind, 'scheme');
	assert.equal(nodes[1]?.parsed_shape?.kind, 'scheme');
	assert.equal(nodes[2]?.parsed_shape?.kind, 'scheme');
	assert.equal(nodes[0]?.sets, 3);
	assert.equal(nodes[2]?.sets, 3);
	if (nodes[0]?.parsed_shape?.kind === 'scheme') {
		assert.deepEqual(nodes[0].parsed_shape.reps_list, [8, 8, 8]);
	}
});

test('contract format 4: series con guiones', async () => {
	const draft = await parseDraft('Press banca 8-8-8\nSentadilla 10-10-10-10\nCurl biceps 12-10-8');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes.every((node) => node.parsed_shape?.kind === 'scheme'), true);
});

test('contract format 5: carga en nota', async () => {
	const draft = await parseDraft('Press banca 3x8 80kg\nSentadilla 4x6 120 kg\nCurl biceps 3x12 15kg');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.ok(nodes[0]?.note?.includes('80kg'));
	assert.ok(nodes[1]?.note?.includes('120 kg'));
	assert.ok(nodes[2]?.note?.includes('15kg'));
});

test('contract format 6: descanso en nota', async () => {
	const draft = await parseDraft('Press banca 3x8 descanso 90s\nRemo 4x10 (60s)\nPeso muerto 5x5 - 2 min');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.ok(nodes[0]?.note?.toLowerCase().includes('descanso'));
	assert.ok(nodes[2]?.note?.toLowerCase().includes('2 min'));
});

test('contract format 7: RIR en nota', async () => {
	const draft = await parseDraft('Press banca 3x8 RIR2\nSentadilla 4x6 RIR 1\nCurl biceps 3x12 rir3');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.ok(nodes.every((node) => (node.note ?? '').toLowerCase().includes('rir')));
});

test('contract format 8: RPE en nota', async () => {
	const draft = await parseDraft('Press banca 3x8 RPE8\nPeso muerto 5x3 RPE 9\nRemo 4x10 rpe7');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.ok(nodes.every((node) => (node.note ?? '').toLowerCase().includes('rpe')));
});

test('contract format 9: piramidal', async () => {
	const draft = await parseDraft('Press banca 12-10-8-6 aumentando peso\nSentadilla 10-8-6-4\nCurl biceps 15-12-10');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes[0]?.parsed_shape?.kind, 'scheme');
	assert.equal(nodes[1]?.parsed_shape?.kind, 'scheme');
	assert.equal(nodes[2]?.parsed_shape?.kind, 'scheme');
});

test('contract format 10: AMRAP', async () => {
	const draft = await parseDraft('Press banca 3x8 + AMRAP ultima serie\nDominadas 3xAMRAP\nPlancha 3x60s');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes[1]?.parsed_shape?.kind, 'amrap');
	assert.equal(nodes[1]?.sets, 3);
});

test('contract format 11: tempo', async () => {
	const draft = await parseDraft('Sentadilla 3x8 tempo 3-1-1\nPress banca 4x6 2-0-2');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 2);
	assertFixed(nodes[0], 3, 8);
	assert.ok(nodes[0]?.note?.includes('3-1-1'));
});

test('contract format 12: superseries', async () => {
	const draft = await parseDraft(
		'Superset:\nPress banca 3x8\nRemo 3x10\n\nSuperset 2:\nCurl biceps 3x12\nTriceps polea 3x12'
	);
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 4);
	assert.ok(nodes.every((node) => node.parsed_shape?.block?.kind === 'superset'));
});

test('contract format 13: con dias', async () => {
	const draft = await parseDraft('Día 1:\nPress banca 3x8\nSentadilla 4x6\n\nDía 2:\nDominadas 4x8\nPeso muerto 5x5');
	assert.equal(draft.days.length >= 2, true);
	assert.equal(draft.days[0]?.mapped_day_key, 'monday');
	assert.equal(draft.days[1]?.mapped_day_key, 'tuesday');
});

test('contract format 14: numeracion', async () => {
	const draft = await parseDraft('1) Press banca - 3x8\n2) Sentadilla - 4x10\n3) Curl biceps - 3x12');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assertFixed(nodes[0], 3, 8);
	assertFixed(nodes[1], 4, 10);
	assertFixed(nodes[2], 3, 12);
});

test('contract format 15: texto mezclado', async () => {
	const draft = await parseDraft('Hoy hacemos:\nPress banca 3x8 pesado\nDespués sentadilla 4x6 controlado\nFinalizamos con curl 3x12 suave');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes[0]?.raw_exercise_name, 'Press banca');
	assert.equal(nodes[1]?.raw_exercise_name, 'sentadilla');
	assert.equal(nodes[2]?.raw_exercise_name, 'curl');
});

test('contract format 16: caotico', async () => {
	const draft = await parseDraft('Press banca 8 8 8\nSentadilla x4 10 reps\nCurl 12x3\nPeso muerto 5por5\nRemo 4*10\nFondos 3 series de 12');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 6);
	const byName = (needle: string) =>
		nodes.find((node) => node.raw_exercise_name.toLowerCase().includes(needle.toLowerCase()));
	assert.equal(byName('Press banca')?.sets, 3);
	assert.equal(byName('Sentadilla')?.sets, 4);
	assert.equal(byName('Curl')?.sets, 3);
	assert.equal(byName('Peso muerto')?.sets, 5);
	assert.equal(byName('Remo')?.sets, 4);
	assert.equal(byName('Fondos')?.sets, 3);
});

test('contract format 17: abreviaturas', async () => {
	const draft = await parseDraft('PB 3x8\nSQ 4x6\nDL 5x5');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assertFixed(nodes[0], 3, 8);
	assertFixed(nodes[1], 4, 6);
	assertFixed(nodes[2], 5, 5);
});

test('contract format 18: escalera con encabezado', async () => {
	const draft = await parseDraft('Press banca:\n60x12\n70x10\n80x8\n90x6');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 1);
	assert.equal(nodes[0]?.parsed_shape?.kind, 'load_ladder');
	if (nodes[0]?.parsed_shape?.kind === 'load_ladder') {
		assert.equal(nodes[0].parsed_shape.load_entries.length, 4);
	}
});

test('contract format 19: circuito', async () => {
	const draft = await parseDraft('Circuito x3 vueltas:\n10 flexiones\n15 sentadillas\n20 abdominales');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assert.equal(nodes[0]?.sets, 3);
	assert.equal(nodes[1]?.sets, 3);
	assert.equal(nodes[2]?.sets, 3);
	assert.ok(nodes.every((node) => node.parsed_shape?.block?.kind === 'circuit'));
});

test('contract format 20: reps x series wording', async () => {
	const draft = await parseDraft('Press banca 8 reps x 3 series\nSentadilla 10 rep x 4\nCurl 12 reps x 3');
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 3);
	assertFixed(nodes[0], 3, 8);
	assertFixed(nodes[1], 4, 10);
	assertFixed(nodes[2], 3, 12);
	assert.equal(draft.coverage.legacy_fallback_hits, 0);
});
