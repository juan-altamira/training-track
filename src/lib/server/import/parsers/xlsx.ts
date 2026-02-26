import type { ParserContext, ParserOutput } from './types';
import { makeId, normalizeLine, toConfidence } from '../utils';
import type { ImportDraft, ImportDraftBlock, ImportDraftDay, ImportDraftNode } from '$lib/import/types';
import { IMPORT_DRAFT_VERSION } from '../constants';

const WEEKDAY_BY_ALIAS: Record<string, string> = {
	lunes: 'monday',
	martes: 'tuesday',
	miercoles: 'wednesday',
	miércoles: 'wednesday',
	jueves: 'thursday',
	viernes: 'friday',
	sabado: 'saturday',
	sábado: 'saturday',
	domingo: 'sunday',
	monday: 'monday',
	tuesday: 'tuesday',
	wednesday: 'wednesday',
	thursday: 'thursday',
	friday: 'friday',
	saturday: 'saturday',
	sunday: 'sunday'
};

const detectHeaderKey = (raw: string): string => {
	const value = normalizeLine(raw)
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
	if (['day', 'dia', 'd', 'weekday'].includes(value)) return 'day';
	if (['exercise', 'ejercicio', 'nombre'].includes(value)) return 'exercise';
	if (['sets', 'series'].includes(value)) return 'sets';
	if (['reps', 'repes', 'repeticiones'].includes(value)) return 'reps';
	if (['reps_min', 'min', 'rep_min'].includes(value)) return 'reps_min';
	if (['reps_max', 'max', 'rep_max'].includes(value)) return 'reps_max';
	if (['note', 'nota', 'notes'].includes(value)) return 'note';
	return value;
};

const parseReps = (raw: string) => {
	const value = normalizeLine(raw);
	if (!value)
		return {
			repsMin: null as number | null,
			repsMax: null as number | null,
			repsText: null as string | null,
			repsMode: 'number' as const,
			repsSpecial: null as string | null
		};
	const range = value.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
	if (range) {
		const min = Number.parseInt(range[1], 10);
		const max = Number.parseInt(range[2], 10);
		return {
			repsMin: min,
			repsMax: max >= min ? max : null,
			repsText: `${min}-${max}`,
			repsMode: 'number' as const,
			repsSpecial: null as string | null
		};
	}
	const exact = value.match(/^(\d{1,3})$/);
	if (exact) {
		const reps = Number.parseInt(exact[1], 10);
		return {
			repsMin: reps,
			repsMax: null,
			repsText: `${reps}`,
			repsMode: 'number' as const,
			repsSpecial: null as string | null
		};
	}
	return {
		repsMin: null,
		repsMax: null,
		repsText: value,
		repsMode: 'special' as const,
		repsSpecial: value
	};
};

const rowToNode = (
	row: Record<string, unknown>,
	rowIndex: number,
	confidenceScore: number
): { dayLabel: string; node: ImportDraftNode } | null => {
	const dayLabel = normalizeLine(String(row.day ?? row.dia ?? row.weekday ?? ''));
	const name = normalizeLine(String(row.exercise ?? row.ejercicio ?? row.nombre ?? ''));
	const setsRaw = String(row.sets ?? row.series ?? '');
	const noteRaw = normalizeLine(String(row.note ?? row.nota ?? ''));

	if (!name || !dayLabel) return null;
	const parsedSets = Number.parseInt(setsRaw, 10);
	const sets = Number.isFinite(parsedSets) && parsedSets > 0 ? parsedSets : null;

	const repsFromExplicit = {
		min: Number.parseInt(String(row.reps_min ?? ''), 10),
		max: Number.parseInt(String(row.reps_max ?? ''), 10)
	};

	let repsMin: number | null = null;
	let repsMax: number | null = null;
	let repsText: string | null = null;
	let repsMode: 'number' | 'special' = 'number';
	let repsSpecial: string | null = null;

	if (Number.isFinite(repsFromExplicit.min) && repsFromExplicit.min > 0) {
		repsMin = repsFromExplicit.min;
		repsMax =
			Number.isFinite(repsFromExplicit.max) && repsFromExplicit.max >= repsFromExplicit.min
				? repsFromExplicit.max
				: null;
		repsText = repsMax ? `${repsMin}-${repsMax}` : `${repsMin}`;
		repsMode = 'number';
		repsSpecial = null;
	} else {
		const parsed = parseReps(String(row.reps ?? row.repeticiones ?? ''));
		repsMin = parsed.repsMin;
		repsMax = parsed.repsMax;
		repsText = parsed.repsText;
		repsMode = parsed.repsMode;
		repsSpecial = parsed.repsSpecial;
	}

	const confidence = toConfidence(confidenceScore);
	const provenance = {
		source_page: 1,
		line_index: rowIndex,
		line_span: [rowIndex, rowIndex] as [number, number],
		bbox: null,
		raw_snippet: JSON.stringify(row).slice(0, 500)
	};

	return {
		dayLabel,
		node: {
			id: makeId(),
			source_raw_name: name,
			raw_exercise_name: name,
			sets,
			reps_mode: repsMode,
			reps_text: repsText,
			reps_min: repsMin,
			reps_max: repsMax,
			reps_special: repsSpecial,
			note: noteRaw || null,
			split_meta: null,
			field_meta: {
				day: { confidence, provenance },
				name: { confidence, provenance },
				sets: { confidence, provenance },
				reps: { confidence, provenance },
				note: noteRaw ? { confidence: toConfidence(Math.max(0.6, confidenceScore - 0.15)), provenance } : null
			}
		}
	};
};

const toDraft = (
	rows: Record<string, unknown>[],
	context: ParserContext,
	confidenceScore: number
): ImportDraft => {
	const dayByLabel = new Map<string, ImportDraftDay>();
	let candidateRows = 0;
	let parsedRows = 0;
	let requiredFields = 0;

	rows.forEach((row, index) => {
		candidateRows += 1;
		const parsed = rowToNode(row, index + 1, confidenceScore);
		if (!parsed) return;

		parsedRows += 1;
		if (
			parsed.node.raw_exercise_name &&
			parsed.node.sets &&
			((parsed.node.reps_mode === 'number' && parsed.node.reps_min && parsed.node.reps_text) ||
				(parsed.node.reps_mode === 'special' && parsed.node.reps_special))
		) {
			requiredFields += 1;
		}

		const key = parsed.dayLabel.toLowerCase();
		let day = dayByLabel.get(key);
		if (!day) {
			const mapped =
				WEEKDAY_BY_ALIAS[key] ??
				(null as ImportDraftDay['mapped_day_key']);
			const block: ImportDraftBlock = { id: makeId(), block_type: 'single', nodes: [] };
			day = {
				id: makeId(),
				source_label: parsed.dayLabel,
				display_label: null,
				mapped_day_key: mapped,
				blocks: [block]
			};
			dayByLabel.set(key, day);
		}
		day.blocks[0].nodes.push(parsed.node);
	});

	const days = Array.from(dayByLabel.values());
	const exercisesParsed = days.reduce(
		(acc, day) => acc + day.blocks.reduce((sum, block) => sum + block.nodes.length, 0),
		0
	);

	return {
		version: IMPORT_DRAFT_VERSION,
		source_type: context.sourceType,
		parser_version: context.parserVersion,
		ruleset_version: context.rulesetVersion,
		extractor_version: context.extractorVersion,
		coverage: {
			days_detected: days.length,
			exercises_parsed: exercisesParsed,
			candidate_lines: candidateRows,
			parsed_lines: parsedRows,
			parseable_ratio: candidateRows > 0 ? parsedRows / candidateRows : 0,
			required_fields_ratio: parsedRows > 0 ? requiredFields / parsedRows : 0,
			lines_in: candidateRows,
			lines_after_split: candidateRows,
			lines_with_prescription_detected: parsedRows,
			exercise_nodes_out: exercisesParsed,
			multi_exercise_splits_applied: 0,
			unresolved_multi_exercise_lines: 0
		},
		presentation: {
			day_label_mode: 'weekday'
		},
		days
	};
};

const normalizeRows = (rows: Record<string, unknown>[]) =>
	rows.map((row) => {
		const mapped: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			mapped[detectHeaderKey(key)] = value;
		}
		return mapped;
	});

const parseSheetRows = async (payload: Uint8Array): Promise<Record<string, unknown>[]> => {
	const xlsx = await import('xlsx');
	const workbook = xlsx.read(payload, { type: 'array' });
	const firstSheetName = workbook.SheetNames[0];
	if (!firstSheetName) return [];
	const sheet = workbook.Sheets[firstSheetName];
	const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
		defval: '',
		raw: false
	});
	return normalizeRows(rows);
};

export const parseXlsxPayload = async (
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	const rows = await parseSheetRows(payload);
	return {
		draft: toDraft(rows, context, 0.95)
	};
};

export const parseCsvPayload = async (
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	const rows = await parseSheetRows(payload);
	return {
		draft: toDraft(rows, context, 0.9)
	};
};
