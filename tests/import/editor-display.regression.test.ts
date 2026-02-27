import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextPayload } from '../../src/lib/server/import/parsers/text';
import { buildDraftBundle } from '../../src/lib/server/import/validation';
import {
	IMPORT_EXTRACTOR_VERSION,
	IMPORT_PARSER_VERSION,
	IMPORT_RULESET_VERSION
} from '../../src/lib/server/import/constants';
import { buildRoutineEditorBlocks, normalizePlan } from '../../src/lib/routines';

const buildEditorBundle = async (raw: string) => {
	const parsed = await parseTextPayload(new TextEncoder().encode(raw), {
		sourceType: 'text',
		parserVersion: IMPORT_PARSER_VERSION,
		rulesetVersion: IMPORT_RULESET_VERSION,
		extractorVersion: IMPORT_EXTRACTOR_VERSION
	});
	return buildDraftBundle(parsed.draft);
};

test('editor display regression: normal imported exercises stay visible as separate editable blocks', async () => {
	const bundle = await buildEditorBundle(
		'Día Push:\nPress banca 3x8 82,5kg\nPress inclinado 8,8,8\nFondos 3xAMRAP descanso 90s\n\nDía Pull:\nRemo con barra 4x6\nDominadas 3xAMRAP\nFace pull 3 x 12\n\nDía Piernas:\nSentadilla 5por5\nPrensa 12-10-8-6\nPeso muerto rumano 3x8-10'
	);

	const mondayBlocks = buildRoutineEditorBlocks('monday', bundle.derivedPlan.monday.exercises);
	const tuesdayBlocks = buildRoutineEditorBlocks('tuesday', bundle.derivedPlan.tuesday.exercises);
	const wednesdayBlocks = buildRoutineEditorBlocks('wednesday', bundle.derivedPlan.wednesday.exercises);

	assert.equal(mondayBlocks.length, 3);
	assert.equal(tuesdayBlocks.length, 3);
	assert.equal(wednesdayBlocks.length, 3);

	assert.deepEqual(
		mondayBlocks.map((block) => block.exercises.map((exercise) => exercise.name)),
		[['Press banca'], ['Press inclinado'], ['Fondos']]
	);
	assert.deepEqual(
		tuesdayBlocks.map((block) => block.exercises.map((exercise) => exercise.name)),
		[['Remo con barra'], ['Dominadas'], ['Face pull']]
	);
	assert.deepEqual(
		wednesdayBlocks.map((block) => block.exercises.map((exercise) => exercise.name)),
		[['Sentadilla'], ['Prensa'], ['Peso muerto rumano']]
	);

	assert.ok(mondayBlocks.every((block) => block.type === 'normal'));
	assert.ok(tuesdayBlocks.every((block) => block.type === 'normal'));
	assert.ok(wednesdayBlocks.every((block) => block.type === 'normal'));
	assert.ok(mondayBlocks.every((block) => block.exercises.length === 1));
	assert.ok(tuesdayBlocks.every((block) => block.exercises.length === 1));
	assert.ok(wednesdayBlocks.every((block) => block.exercises.length === 1));
});

test('editor display regression: imported circuit stays grouped as one editable circuit block', async () => {
	const bundle = await buildEditorBundle(
		'Circuito x4 vueltas:\n10 flexiones\n15 sentadillas\n20 abdominales'
	);

	const mondayBlocks = buildRoutineEditorBlocks('monday', bundle.derivedPlan.monday.exercises);

	assert.equal(mondayBlocks.length, 1);
	assert.equal(mondayBlocks[0]?.type, 'circuit');
	assert.equal(mondayBlocks[0]?.rounds, 4);
	assert.deepEqual(
		mondayBlocks[0]?.exercises.map((exercise) => exercise.name),
		['flexiones', 'sentadillas', 'abdominales']
	);
});

test('editor display regression: normalizePlan repairs legacy normal exercises sharing one blockId', () => {
	const plan = normalizePlan({
		monday: {
			key: 'monday',
			label: 'Lunes',
			exercises: [
				{
					id: 'ex-1',
					name: 'Sentadilla',
					scheme: '',
					order: 0,
					totalSets: 5,
					repsMode: 'number',
					repsMin: 5,
					repsMax: null,
					repsSpecial: null,
					showRange: false,
					blockType: 'normal',
					blockId: 'legacy-block',
					blockOrder: 0,
					blockLabel: 'Bloque 1',
					circuitRounds: null
				},
				{
					id: 'ex-2',
					name: 'Prensa',
					scheme: '',
					order: 1,
					totalSets: 4,
					repsMode: 'special',
					repsMin: undefined,
					repsMax: null,
					repsSpecial: '12-10-8-6',
					showRange: false,
					blockType: 'normal',
					blockId: 'legacy-block',
					blockOrder: 0,
					blockLabel: 'Bloque 1',
					circuitRounds: null
				},
				{
					id: 'ex-3',
					name: 'Peso muerto rumano',
					scheme: '',
					order: 2,
					totalSets: 3,
					repsMode: 'number',
					repsMin: 8,
					repsMax: 10,
					repsSpecial: null,
					showRange: true,
					blockType: 'normal',
					blockId: 'legacy-block',
					blockOrder: 0,
					blockLabel: 'Bloque 1',
					circuitRounds: null
				}
			]
		},
		tuesday: { key: 'tuesday', label: 'Martes', exercises: [] },
		wednesday: { key: 'wednesday', label: 'Miércoles', exercises: [] },
		thursday: { key: 'thursday', label: 'Jueves', exercises: [] },
		friday: { key: 'friday', label: 'Viernes', exercises: [] },
		saturday: { key: 'saturday', label: 'Sábado', exercises: [] },
		sunday: { key: 'sunday', label: 'Domingo', exercises: [] }
	});

	const blocks = buildRoutineEditorBlocks('monday', plan.monday.exercises);

	assert.equal(blocks.length, 3);
	assert.deepEqual(
		blocks.map((block) => block.exercises.map((exercise) => exercise.name)),
		[['Sentadilla'], ['Prensa'], ['Peso muerto rumano']]
	);
	assert.equal(new Set(plan.monday.exercises.map((exercise) => exercise.blockId)).size, 3);
});
