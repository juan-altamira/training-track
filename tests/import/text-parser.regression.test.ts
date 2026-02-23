import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextPayload } from '../../src/lib/server/import/parsers/text';
import {
	IMPORT_EXTRACTOR_VERSION,
	IMPORT_PARSER_VERSION,
	IMPORT_RULESET_VERSION
} from '../../src/lib/server/import/constants';
import { buildDraftBundle } from '../../src/lib/server/import/validation';

const parseDraft = async (raw: string) => {
	const out = await parseTextPayload(new TextEncoder().encode(raw), {
		sourceType: 'text',
		parserVersion: IMPORT_PARSER_VERSION,
		rulesetVersion: IMPORT_RULESET_VERSION,
		extractorVersion: IMPORT_EXTRACTOR_VERSION
	});
	return out.draft;
};

test('regression: full messy routine keeps 43 exercises and splits compact combined line', async () => {
	const raw = `LUNES (Énfasis en Pectoral)
    • Sentadillas 3x6a8
    • Curl Femoral 3x12-8
    • Banco Plano 3*8
    • Press Militar con Barra Parado 3x8 en esa
    • Remo en Maquina 5 x 10 lentas (atento a la tecnica)
    • Cruces de Polea para Pectoral Inferior 3x 10
    • Cruces de Polea para Pectoral Superior 4 x12
    • Biceps con barra  /3x10/
    • Biceps en banco scot  /3x12/
    • Vuelos Laterales ( 3x12 )
    • Vuelos Posteriores  3 series de 12 repeticiones (hacerlo lento en la exentrica)
    • Tríceps Polea Alta 3x10 en este
    • Triceps Polea Baja o Press Frances (3 series x12
    1. Gemelos 4 series de 12 pero tene cuidado con la extentrica, controlala

MIÉRCOLES (Énfasis en Espalda)
      -Prensa Pesada (4x10 a 12repeticiones)
      -Curl Femoral (4x 8
      -(4 series de 12) Remo en Maquina
      -Jalon al Pecho para Espalda (3x12)
      -3 series x12 de Banco Plano
      +Press Militar Sentado con Mancuernas (3x10)
      +tres series de ocho repeticiones en Remo en Maquina
      +Cruces de Polea para Pectoral Superior hacete 3 series de 8 a 12 repeticiones en este
      * Biceps con Barra – aca hace hacete ocho de 15 repeticiones
      *Biceps en Banco Inclinado con Mancuernas (3x12)
      *Vuelos Laterales (3x12)
      Vuelos Posteriores – aca hace hacete ocho de 15 repeticiones
      Tríceps Polea Alta – aca hace hacete ocho de 15 repeticiones
      Triceps Polea Baja o Press Frances – aca hace hacete ocho de 15 repeticiones
      Gemelos (4x12)

VIERNES:
      Sentadillas (3x6)
      Curl Femoral (3x12)
      Banco Plano (3x8)
      Press Militar con Barra Parado (3x8)
      Remo en Maquina (5x10)
      Cruces de Polea para Pectoral Inferior (3x10)
      Cruces de Polea para Pectoral Superior (4x12)
      Biceps con Barra (3x10)
      Biceps en Banco Scott (3x12)
      Vuelos Laterales (3x12)Vuelos Posteriores (3x12)
      Tríceps Polea Alta (3x10)
      Triceps Polea Baja o Press Frances (3x12)
      Gemelos (4x12)`;

	const draft = await parseDraft(raw);
	const nodes = draft.days.flatMap((day) => day.blocks.flatMap((block) => block.nodes));

	assert.equal(nodes.length, 43);
	assert.equal(draft.coverage.multi_exercise_splits_applied, 1);
	assert.equal(draft.coverage.unresolved_multi_exercise_lines, 0);

	const fridayLaterals = nodes.filter((node) =>
		node.raw_exercise_name.toLowerCase().includes('vuelos laterales')
	);
	const fridayPosteriors = nodes.filter((node) =>
		node.raw_exercise_name.toLowerCase().includes('vuelos posteriores')
	);

	assert.ok(fridayLaterals.length >= 1);
	assert.ok(fridayPosteriors.length >= 1);
});

test('regression: does not split false positive in "Triceps Polea Baja o Press Frances"', async () => {
	const raw = `MIERCOLES\nTriceps Polea Baja o Press Frances – aca hace hacete ocho de 15 repeticiones`;
	const draft = await parseDraft(raw);
	const node = draft.days[0]?.blocks[0]?.nodes[0];

	assert.ok(node);
	assert.equal(node.raw_exercise_name, 'Triceps Polea Baja o Press Frances');
	assert.equal(node.sets, 8);
	assert.equal(node.reps_min, 15);
	assert.equal(node.note, null);
	assert.equal(node.split_meta?.decision, 'split_kept_note_dropped');
});

test('regression: drops garbage trailing note for no-split lines ("en esa")', async () => {
	const raw = `LUNES\nPress Militar con Barra Parado 3x8 en esa`;
	const draft = await parseDraft(raw);
	const node = draft.days[0]?.blocks[0]?.nodes[0];

	assert.ok(node);
	assert.equal(node.raw_exercise_name, 'Press Militar con Barra Parado');
	assert.equal(node.sets, 3);
	assert.equal(node.reps_min, 8);
	assert.equal(node.note, null);
	assert.equal(node.split_meta?.reason, 'garbage_note_dropped_no_split');
});

test('regression: emits warning when multi-exercise-like line cannot be safely segmented', async () => {
	const raw = `LUNES\nPress Banca (3x8) 4x12`;
	const draft = await parseDraft(raw);
	const bundle = buildDraftBundle(draft);

	assert.ok((draft.coverage.unresolved_multi_exercise_lines ?? 0) >= 1);
	assert.ok(bundle.issues.some((issue) => issue.code === 'possible_multi_exercise_line'));
});

test('regression: keeps full continuation note when sentence wraps to next line', async () => {
	const raw = `LUNES
• Vuelos Posteriores (4x12) + 2 series aguantando en la parte
final del movimiento`;
	const draft = await parseDraft(raw);
	const node = draft.days[0]?.blocks[0]?.nodes[0];

	assert.ok(node);
	assert.equal(node.raw_exercise_name, 'Vuelos Posteriores');
	assert.equal(node.sets, 4);
	assert.equal(node.reps_min, 12);
	assert.ok(node.note?.includes('2 series aguantando en la parte'));
	assert.ok(node.note?.includes('final del movimiento'));
});

test('regression: auto maps DIA 1/2/3 headings to monday/tuesday/wednesday', async () => {
	const raw = `DIA 1 (Piernas):
Sentadillas (3x8)

DIA 2 (Empuje) :
Banco Plano (3x10)

DIA 3 (Traccion) :
Remo en Maquina (4x12)`;

	const draft = await parseDraft(raw);
	const bundle = buildDraftBundle(draft);

	assert.equal(draft.days[0]?.mapped_day_key, 'monday');
	assert.equal(draft.days[1]?.mapped_day_key, 'tuesday');
	assert.equal(draft.days[2]?.mapped_day_key, 'wednesday');
	assert.equal(draft.presentation.day_label_mode, 'sequential');
	assert.equal(bundle.issues.some((issue) => issue.code === 'day_mapping_required'), false);
});
