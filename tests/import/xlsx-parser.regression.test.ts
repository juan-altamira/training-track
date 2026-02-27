import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvPayload } from '../../src/lib/server/import/parsers/xlsx';
import {
	IMPORT_EXTRACTOR_VERSION,
	IMPORT_PARSER_VERSION,
	IMPORT_RULESET_VERSION
} from '../../src/lib/server/import/constants';

const parseCsvDraft = async (rawCsv: string) => {
	const out = await parseCsvPayload(new TextEncoder().encode(rawCsv), {
		sourceType: 'csv',
		parserVersion: IMPORT_PARSER_VERSION,
		rulesetVersion: IMPORT_RULESET_VERSION,
		extractorVersion: IMPORT_EXTRACTOR_VERSION
	});
	return out.draft;
};

const nodesFrom = (draft: Awaited<ReturnType<typeof parseCsvDraft>>) =>
	draft.days.flatMap((day) => day.blocks.flatMap((block) => block.nodes));

test('csv parser: reps usa la misma heurística nueva que el editor', async () => {
	const draft = await parseCsvDraft(
		[
			'day,exercise,sets,reps,note',
			'Día 1,Dominadas,3,amrap,',
			'Día 1,Press militar,3,de 8 a 10,',
			'Día 1,Curl bíceps,3,12-10-8,',
			'Día 1,Fondos,3,fallo,'
		].join('\n')
	);
	const nodes = nodesFrom(draft);
	assert.equal(nodes.length, 4);

	const byName = (needle: string) =>
		nodes.find((node) => node.raw_exercise_name.toLowerCase().includes(needle.toLowerCase()));

	const amrap = byName('dominadas');
	assert.ok(amrap);
	assert.equal(amrap.reps_mode, 'special');
	assert.equal(amrap.reps_special, 'AMRAP');

	const range = byName('press militar');
	assert.ok(range);
	assert.equal(range.reps_mode, 'number');
	assert.equal(range.reps_min, 8);
	assert.equal(range.reps_max, 10);
	assert.equal(range.reps_text, '8-10');

	const scheme = byName('curl');
	assert.ok(scheme);
	assert.equal(scheme.reps_mode, 'special');
	assert.equal(scheme.reps_special, '12-10-8');

	const fail = byName('fondos');
	assert.ok(fail);
	assert.equal(fail.reps_mode, 'special');
	assert.equal(fail.reps_special, 'fallo');
});

