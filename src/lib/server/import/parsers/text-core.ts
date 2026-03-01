import type {
	ImportDraft,
	ImportDraftBlock,
	ImportDraftDay,
	ImportDraftNode,
	ImportInferenceReason,
	ImportShapeV1
} from '$lib/import/types';
import type { ParsedLine, ParserContext } from './types';
import { IMPORT_DRAFT_VERSION } from '../constants';
import { makeId, makeProvenance, mapSpanishWeekdayToKey, toConfidence } from '../utils';
import {
	parseCircuitEntry,
	parseContractCandidate,
	parseLadderEntries,
	splitCircuitSegments
} from './contract-matchers';
import { parseLegacyLine } from './legacy-matchers';

const DAY_HEADING_REGEX =
	/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|d[ií]a\s*\d+|day\s*\d+)\b\s*:?\s*(.*)?$/iu;
const CUSTOM_DAY_HEADING_REGEX = /^(d[ií]a|day)\s+([^:]+?)(?:\s*:\s*(.*))?$/iu;

const SUPERSET_HEADING_REGEX =
	/^(?:superset|super\s*set|superserie|super\s*serie|serie\s+gigante)(?:\s*(?:x\s*(\d{1,2})|(\d{1,2})\s*vueltas?|#?\s*(\d{1,2})))?\b\s*:?\s*(.*)?$/iu;
const CIRCUIT_HEADING_REGEX =
	/^circuito(?:\s*x?\s*(\d{1,2})\s*(?:vueltas?|rondas?|rounds?)?)?\b\s*:?\s*(.*)?$/iu;
const LOAD_HEADER_REGEX = /^([^:]{2,80}):\s*(.*)$/u;

const NOISE_LINE_REGEX =
	/^(rutina|semana|objetivo|total|resumen|importar|paso\s*\d+|bloque\s*\d+)\b/iu;

const INDEXED_DAY_TO_WEEKDAY = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
] as const;

const parseIndexedDayKey = (value: string): ImportDraftDay['mapped_day_key'] => {
	const normalized = value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
	const match = normalized.match(/^(?:dia|day)\s*(\d{1,2})/u);
	if (!match?.[1]) return null;
	const index = Number.parseInt(match[1], 10);
	if (!Number.isFinite(index) || index < 1) return null;
	return INDEXED_DAY_TO_WEEKDAY[index - 1] ?? null;
};

type LineUnit = {
	id: string;
	parent_id?: string;
	raw: string;
	line_index: number;
	source_page?: number;
	source_kind: 'input' | 'synthetic' | 'rollback';
	skip_context_open?: boolean;
};

type ParserCounters = {
	linesIn: number;
	candidateLines: number;
	parsedLines: number;
	requiredFieldsCompleted: number;
	linesWithPrescriptionDetected: number;
	multiExerciseSplitsApplied: number;
	unresolvedMultiExerciseLines: number;
	contractLinesTotal: number;
	contractLinesParsed: number;
	contractLinesFailedInvariants: number;
	legacyFallbackHits: number;
};

type ParseOutcome = {
	node: ImportDraftNode | null;
	usedContract: boolean;
	usedLegacy: boolean;
	detectedPrescription: boolean;
	failedInvariant: boolean;
};

type CircuitLineEntry =
	| { kind: 'shape'; name: string; shape: ImportShapeV1; path: 'contract' }
	| {
			kind: 'special';
			name: string;
			sets: number;
			repsSpecial: string;
			note: string | null;
			path: 'legacy';
	  };

type CircuitEntryResult =
	| { kind: 'valid'; entries: CircuitLineEntry[] }
	| { kind: 'noise' }
	| { kind: 'invalid' };

type ParseState =
	| { kind: 'IDLE' }
	| {
			kind: 'PENDING_CIRCUIT';
			headerUnitId: string;
			headerText: string;
			rounds: number;
			blockId: string;
			blockNote: string | null;
			buffer: LineUnit[];
			entries: CircuitLineEntry[];
	  }
	| {
			kind: 'ACTIVE_CIRCUIT';
			headerUnitId: string;
			headerText: string;
			rounds: number;
			blockId: string;
			blockNote: string | null;
			invalidEntryStreak: number;
	  }
	| {
			kind: 'PENDING_LADDER';
			headerUnitId: string;
			headerText: string;
			blockId: string;
			buffer: LineUnit[];
			entries: ReturnType<typeof parseLadderEntries>;
		}
	| {
			kind: 'ACTIVE_LADDER';
			headerUnitId: string;
			headerText: string;
			blockId: string;
			entries: ReturnType<typeof parseLadderEntries>;
		};

const normalizeCompactWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const sanitizeExerciseName = (raw: string) =>
	raw
		.replace(/^[\s•●▪◦·*+\-:/.()]+/, '')
		.replace(/[\s•●▪◦·*+\-:/.()]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();

const sanitizeNote = (raw: string | null | undefined) => {
	const value = (raw ?? '').trim();
	if (!value) return null;
	const unwrapped = value.replace(/^[\/\\|()[\]{}<>\s]+|[\/\\|()[\]{}<>\s]+$/gu, '');
	if (!unwrapped) return null;
	if (/^(?:rep|reps|repeticion|repeticiones)$/iu.test(unwrapped)) return null;
	if (/^(?:en\s+este|en\s+esta|en\s+ese|en\s+esa)$/iu.test(unwrapped)) return null;
	return value;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SECOND_UNIT_ALIASES = [
	'segundo',
	'segundos',
	'seg.',
	'seg',
	's.',
	's',
	'secs',
	'sec',
	'sec.',
	'segs',
	'sgs',
	'segund',
	'segundo(s)',
	'segndo',
	'segndos',
	'segudos',
	'segunods',
	'segun2',
	'segundos.',
	'segs.',
	'segundoss'
] as const;

const MINUTE_UNIT_ALIASES = [
	'minuto',
	'minutos',
	'min.',
	'min',
	'm.',
	'm',
	'mins',
	'mns',
	'minut',
	'minuto(s)',
	'mnuto',
	'mnutos',
	'minuos',
	'minito',
	'mins.',
	'minutos.',
	'minuttos'
] as const;

const normalizeDurationUnitKey = (rawUnit: string) =>
	normalizeCompactWhitespace(rawUnit)
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[().]/g, '');

const SECOND_UNIT_KEYS = new Set(SECOND_UNIT_ALIASES.map(normalizeDurationUnitKey));
const MINUTE_UNIT_KEYS = new Set(MINUTE_UNIT_ALIASES.map(normalizeDurationUnitKey));
const DURATION_UNIT_PATTERN = [...SECOND_UNIT_ALIASES, ...MINUTE_UNIT_ALIASES]
	.sort((a, b) => b.length - a.length)
	.map(escapeRegex)
	.join('|');

const normalizeDurationUnit = (rawUnit: string) => {
	const unit = normalizeDurationUnitKey(rawUnit);
	if (SECOND_UNIT_KEYS.has(unit)) {
		return 'segundos';
	}
	if (MINUTE_UNIT_KEYS.has(unit)) {
		return 'minutos';
	}
	return rawUnit.trim();
};

const parseStructuredSpecialDurationLine = (
	rawLine: string
): {
	name: string;
	sets: number;
	repsSpecial: string;
	note: string | null;
} | null => {
	const raw = normalizeCompactWhitespace(rawLine.trim());
	if (!raw) return null;

	const nameFirst = raw.match(
		new RegExp(
			`^(.+?)\\s+(\\d{1,2})\\s*(?:x|X|\\*|por)\\s*(\\d{1,3}(?::\\d{2})?)\\s*(${DURATION_UNIT_PATTERN})(?:\\s+(.*))?$`,
			'iu'
		)
	);
	if (nameFirst) {
		const name = sanitizeExerciseName(nameFirst[1] ?? '');
		const sets = Number.parseInt(nameFirst[2] ?? '', 10);
		const amount = (nameFirst[3] ?? '').trim();
		const unit = normalizeDurationUnit(nameFirst[4] ?? '');
		const trailing = sanitizeNote(nameFirst[5] ?? null);
		if (!name || !sets || !amount || !unit) return null;
		return {
			name,
			sets,
			repsSpecial: `${amount} ${unit}`.trim(),
			note: trailing
		};
	}

	const setsFirst = raw.match(
		new RegExp(
			`^(\\d{1,2})\\s*(?:x|X|\\*|por)\\s*(\\d{1,3}(?::\\d{2})?)\\s*(${DURATION_UNIT_PATTERN})\\s+de\\s+(.+)$`,
			'iu'
		)
	);
	if (setsFirst) {
		const sets = Number.parseInt(setsFirst[1] ?? '', 10);
		const amount = (setsFirst[2] ?? '').trim();
		const unit = normalizeDurationUnit(setsFirst[3] ?? '');
		const name = sanitizeExerciseName(setsFirst[4] ?? '');
		if (!name || !sets || !amount || !unit) return null;
		return {
			name,
			sets,
			repsSpecial: `${amount} ${unit}`.trim(),
			note: null
		};
	}

	return null;
};

const parseLooseSpecialDurationLine = (
	rawLine: string
): {
	name: string;
	sets: number;
	repsSpecial: string;
	note: string | null;
} | null => {
	const raw = normalizeCompactWhitespace(rawLine.trim());
	if (!raw) return null;

	const trailing = raw.match(
		new RegExp(`^(.+?)\\s+(\\d{1,3}(?::\\d{2})?)\\s*(${DURATION_UNIT_PATTERN})\\s*$`, 'iu')
	);
	if (trailing) {
		const name = sanitizeLooseDurationExerciseName(trailing[1] ?? '');
		const amount = (trailing[2] ?? '').trim();
		const unit = normalizeDurationUnit(trailing[3] ?? '');
		if (!name || !amount || !unit || isGenericNonExerciseName(name)) return null;
		return {
			name,
			sets: 1,
			repsSpecial: `${amount} ${unit}`.trim(),
			note: null
		};
	}

	const leading = raw.match(
		new RegExp(`^(?:son\\s+)?(\\d{1,3}(?::\\d{2})?)\\s*(${DURATION_UNIT_PATTERN})\\s+de\\s+(.+)$`, 'iu')
	);
	if (leading) {
		const amount = (leading[1] ?? '').trim();
		const unit = normalizeDurationUnit(leading[2] ?? '');
		const name = sanitizeLooseDurationExerciseName(leading[3] ?? '');
		if (!name || !amount || !unit || isGenericNonExerciseName(name)) return null;
		return {
			name,
			sets: 1,
			repsSpecial: `${amount} ${unit}`.trim(),
			note: null
		};
	}

	return null;
};

const isGenericNonExerciseName = (value: string) =>
	/^(?:movilidad|entrada\s+en\s+calor|calentamiento|descanso|pausa|elongacion|elongación|estiramiento|estiramientos)$/iu.test(
		value.trim()
	);

const sanitizeLooseDurationExerciseName = (raw: string) =>
	sanitizeExerciseName(raw).replace(
		/^(?:hace|hacete|mete(le)?|manda(le)?|dale|anda|arranca|empeza|ejecuta)\s+/iu,
		''
	);

const splitInlineNarrativeNote = (name: string, note: string | null) => {
	if (note) return { name, note };
	const match = name.match(
		new RegExp(
			`^(.*?\\S)\\s+(aguantando\\b.*?(?:\\d{1,3}(?::\\d{2})?)\\s*(?:${DURATION_UNIT_PATTERN}).*)$`,
			'iu'
		)
	);
	if (!match?.[1] || !match?.[2]) {
		return { name, note };
	}
	return {
		name: sanitizeExerciseName(match[1]),
		note: sanitizeNote(match[2])
	};
};

const EMBEDDED_DAY_HEADING_REGEX =
	/(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|d[ií]a\s*\d+|day\s*\d+)\s*:?\s*$/iu;

const splitEmbeddedDayHeading = (rawLine: string) => {
	const trimmed = rawLine.trimEnd();
	const match = trimmed.match(EMBEDDED_DAY_HEADING_REGEX);
	if (!match?.[1]) return null;
	const heading = match[1];
	const headingIndex = trimmed.lastIndexOf(heading);
	if (headingIndex <= 0) return null;
	const previousChar = trimmed[headingIndex - 1] ?? '';
	if (!/[0-9):]/.test(previousChar)) return null;
	return {
		before: trimmed.slice(0, headingIndex).trimEnd(),
		after: trimmed.slice(headingIndex).trim()
	};
};

const extractCircuitBlockNote = (raw: string) => {
	const value = sanitizeNote(raw);
	if (!value) return null;
	if (/^nota\s*:?$/iu.test(value)) return null;
	return value;
};

const appendCircuitBlockNote = (current: string | null, rawLine: string) => {
	const next = extractCircuitBlockNote(rawLine);
	if (!next) return current;
	if (!current) return next;
	if (current.toLowerCase() === next.toLowerCase()) return current;
	return `${current} · ${next}`;
};

const isBlank = (value: string) => value.trim().length === 0;

const isNoiseLine = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return true;
	if (NOISE_LINE_REGEX.test(trimmed)) return true;
	if (/^[-–—=]{3,}$/u.test(trimmed)) return true;
	return false;
};

const isCircuitCommentLine = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return true;
	if (/^descanso\b/iu.test(trimmed)) return true;
	if (/^nota\b/iu.test(trimmed)) return true;
	if (/^\d{1,2}:\d{2}\b/u.test(trimmed)) return true;
	if (/^\d{1,3}\s*(?:s|seg|sec|min|m)\b/iu.test(trimmed)) return true;
	return false;
};

const toRepsText = (repsMin: number | null, repsMax: number | null) => {
	if (!repsMin || repsMin <= 0) return null;
	if (repsMax && repsMax > repsMin) return `${repsMin}-${repsMax}`;
	return `${repsMin}`;
};

const shapeToLegacyFields = (shape: ImportShapeV1) => {
	if (shape.kind === 'fixed') {
		return {
			sets: shape.sets,
			repsMin: shape.reps_min,
			repsMax: null,
			repsText: toRepsText(shape.reps_min, null),
			repsMode: 'number' as const,
			repsSpecial: null as string | null
		};
	}
	if (shape.kind === 'range') {
		return {
			sets: shape.sets,
			repsMin: shape.reps_min,
			repsMax: shape.reps_max,
			repsText: toRepsText(shape.reps_min, shape.reps_max),
			repsMode: 'number' as const,
			repsSpecial: null as string | null
		};
	}
	if (shape.kind === 'scheme') {
		const repsSpecial = shape.reps_list.join('-');
		return {
			sets: shape.sets,
			repsMin: null,
			repsMax: null,
			repsText: repsSpecial,
			repsMode: 'special' as const,
			repsSpecial
		};
	}
	if (shape.kind === 'amrap') {
		return {
			sets: shape.sets,
			repsMin: null,
			repsMax: null,
			repsText: 'AMRAP',
			repsMode: 'special' as const,
			repsSpecial: 'AMRAP'
		};
	}
	const repsValues = shape.load_entries.map((entry) => entry.reps);
	const repsMin = Math.min(...repsValues);
	const repsMax = Math.max(...repsValues);
	return {
		sets: shape.load_entries.length,
		repsMin,
		repsMax: repsMax > repsMin ? repsMax : null,
		repsText: toRepsText(repsMin, repsMax > repsMin ? repsMax : null),
		repsMode: 'number' as const,
		repsSpecial: null as string | null
	};
};

const makeFieldMeta = (line: ParsedLine, confidenceScore: number, hasNote: boolean) => {
	const confidence = toConfidence(confidenceScore);
	const provenance = makeProvenance(line.text, line.lineIndex, line.sourcePage);
	return {
		day: { confidence, provenance },
		name: { confidence, provenance },
		sets: { confidence, provenance },
		reps: { confidence, provenance },
		note: hasNote
			? {
					confidence: toConfidence(Math.max(0.35, confidenceScore - 0.2)),
					provenance
			  }
			: null
	};
};

const ensureSingleBlock = (day: ImportDraftDay): ImportDraftBlock => {
	const existing = day.blocks.find((block) => block.block_type === 'single');
	if (existing) return existing;
	const block: ImportDraftBlock = {
		id: makeId(),
		block_type: 'single',
		nodes: []
	};
	day.blocks.push(block);
	return block;
};

const ensureBlockById = (
	day: ImportDraftDay,
	blockType: ImportDraftBlock['block_type'],
	blockId: string
): ImportDraftBlock => {
	const existing = day.blocks.find((block) => block.id === blockId);
	if (existing) return existing;
	const created: ImportDraftBlock = {
		id: blockId,
		block_type: blockType,
		nodes: []
	};
	day.blocks.push(created);
	return created;
};

const createDay = (sourceLabel: string, mapped: string | null): ImportDraftDay => ({
	id: makeId(),
	source_label: sourceLabel,
	display_label: null,
	mapped_day_key: mapped,
	blocks: []
});

const mapDayHeading = (
	line: string
): {
	mapped: ImportDraftDay['mapped_day_key'];
	label: string;
	rest: string;
	kind: 'weekday' | 'indexed' | 'custom';
} | null => {
	const heading = line.trim().match(DAY_HEADING_REGEX);
	if (heading) {
		const token = normalizeCompactWhitespace(heading[1] ?? '');
		const rest = (heading[2] ?? '').trim();
		const mappedWeekday = mapSpanishWeekdayToKey(token);
		const mappedIndexed = mappedWeekday ? null : parseIndexedDayKey(token);
		if (mappedWeekday || mappedIndexed) {
			return {
				mapped: mappedWeekday ?? mappedIndexed,
				label: token,
				rest,
				kind: mappedWeekday ? 'weekday' : 'indexed'
			};
		}
	}
	const custom = line.trim().match(CUSTOM_DAY_HEADING_REGEX);
	if (!custom) return null;
	const prefix = normalizeCompactWhitespace(custom[1] ?? '');
	const customLabel = normalizeCompactWhitespace(custom[2] ?? '');
	if (!customLabel) return null;
	return {
		mapped: null,
		label: normalizeCompactWhitespace(`${prefix} ${customLabel}`),
		rest: (custom[3] ?? '').trim(),
		kind: 'custom'
	};
};

const parseSupersetHeading = (line: string) => {
	const match = line.trim().match(SUPERSET_HEADING_REGEX);
	if (!match) return null;
	const roundsRaw = match[1] ?? match[2] ?? null;
	const roundsParsed = roundsRaw ? Number.parseInt(roundsRaw, 10) : null;
	const rounds = Number.isFinite(roundsParsed) && roundsParsed && roundsParsed > 0 ? roundsParsed : 1;
	return {
		rounds,
		rest: (match[4] ?? '').trim(),
		headerText: line.trim()
	};
};

const parseCircuitHeading = (line: string) => {
	const match = line.trim().match(CIRCUIT_HEADING_REGEX);
	if (!match) return null;
	const roundsParsed = match[1] ? Number.parseInt(match[1], 10) : null;
	const rounds = Number.isFinite(roundsParsed) && roundsParsed && roundsParsed > 0 ? roundsParsed : 1;
	return {
		rounds,
		rest: (match[2] ?? '').trim(),
		headerText: line.trim()
	};
};

const parseLoadHeading = (line: string) => {
	const match = line.trim().match(LOAD_HEADER_REGEX);
	if (!match) return null;
	const header = sanitizeExerciseName(match[1] ?? '');
	if (!header) return null;
	if (/^(?:hoy\s+hacemos|despues|después|finalizamos\s+con|hoy)$/iu.test(header)) return null;
	if (mapDayHeading(header)) return null;
	if (parseCircuitHeading(header)) return null;
	if (parseSupersetHeading(header)) return null;
	return {
		headerText: header,
		rest: (match[2] ?? '').trim()
	};
};

const splitGlobalMultiExerciseLine = (
	line: string,
	counters: ParserCounters
): { segments: string[]; unresolved: boolean } => {
	const raw = line.trim();
	if (!raw) return { segments: [], unresolved: false };
	const compact = normalizeCompactWhitespace(raw);
	if (/\b\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\b/u.test(compact)) {
		return { segments: [raw], unresolved: false };
	}
	if (
		/\b\d+(?:[.,]\d+)?\s*(?:kg|lb|lbs)?\s*[xX*]\s*\d+\s*,\s*\d+(?:[.,]\d+)?\s*(?:kg|lb|lbs)?\s*[xX*]\s*\d+/u.test(
			compact
		)
	) {
		return { segments: [raw], unresolved: false };
	}
	if (/\btempo\b/iu.test(compact) && /\b\d\s*-\s*\d\s*-\s*\d\b/u.test(compact)) {
		return { segments: [raw], unresolved: false };
	}

	const stageA = raw
		.split(/\)\s*(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/u)
		.map((segment) => segment.trim())
		.filter(Boolean);
	if (stageA.length > 1) {
		const valid = stageA.every((segment) => parseContractCandidate(segment).candidate || parseLegacyLine(segment));
		if (valid) {
			counters.multiExerciseSplitsApplied += stageA.length - 1;
			return { segments: stageA, unresolved: false };
		}
	}

	for (const separator of [/\s+y\s+/iu, /\s*;\s*/u]) {
		const segments = raw
			.split(separator)
			.map((segment) => segment.trim())
			.filter(Boolean);
		if (segments.length < 2) continue;
		const valid = segments.every((segment) => parseContractCandidate(segment).candidate || parseLegacyLine(segment));
		if (valid) {
			counters.multiExerciseSplitsApplied += segments.length - 1;
			return { segments, unresolved: false };
		}
	}

	const prescriptions = compact.match(/\d{1,2}\s*(?:x|X|\*|por)\s*\d{1,3}/gu) ?? [];
	if (prescriptions.length >= 2) {
		counters.unresolvedMultiExerciseLines += 1;
		return { segments: [raw], unresolved: true };
	}
	return { segments: [raw], unresolved: false };
};

const assertCandidateInvariants = (
	rawLine: string,
	candidate: ReturnType<typeof parseContractCandidate>['candidate']
) => {
	if (!candidate) return true;
	if (candidate.nameSpanStart < 0) return false;
	if (candidate.nameSpanEnd < candidate.nameSpanStart) return false;
	if (candidate.structureEndOffset < candidate.nameSpanEnd) return false;
	if (candidate.structureEndOffset > rawLine.length) return false;
	if (candidate.noteStartOffset < candidate.nameSpanEnd) return false;
	if (candidate.noteStartOffset > rawLine.length) return false;
	return true;
};

const makeNodeFromContractCandidate = (
	line: ParsedLine,
	rawSegment: string,
	candidate: NonNullable<ReturnType<typeof parseContractCandidate>['candidate']>,
	blockContext: ImportShapeV1['block'] | null,
	path: 'contract' | 'legacy'
): ImportDraftNode => {
	const shape = blockContext
		? {
				...candidate.parsedShape,
				block: blockContext
		  }
		: candidate.parsedShape;
	const { sets, repsMin, repsMax, repsText, repsMode, repsSpecial } = shapeToLegacyFields(shape);
	const note = sanitizeNote(rawSegment.slice(candidate.noteStartOffset));
	const name = sanitizeExerciseName(candidate.rawExerciseName);
	const normalized = splitInlineNarrativeNote(name, note);
	return {
		id: makeId(),
		source_raw_name: normalized.name,
		raw_exercise_name: normalized.name,
		sets: sets ?? null,
		reps_mode: repsMode,
		reps_text: repsText,
		reps_min: repsMin ?? null,
		reps_max: repsMax ?? null,
		reps_special: repsSpecial,
		note: normalized.note,
		parsed_shape: shape,
		split_meta: null,
		field_meta: makeFieldMeta(line, path === 'contract' ? 0.9 : 0.65, Boolean(normalized.note)),
		debug: {
			path,
			struct_tokens_used_count: candidate.structTokensUsed.length
		}
	};
};

const makeNodeFromRawShape = (
	line: ParsedLine,
	rawSegment: string,
	name: string,
	shape: ImportShapeV1,
	path: 'contract' | 'legacy'
): ImportDraftNode => {
	const { sets, repsMin, repsMax, repsText, repsMode, repsSpecial } = shapeToLegacyFields(shape);
	return {
		id: makeId(),
		source_raw_name: name,
		raw_exercise_name: name,
		sets: sets ?? null,
		reps_mode: repsMode,
		reps_text: repsText,
		reps_min: repsMin ?? null,
		reps_max: repsMax ?? null,
		reps_special: repsSpecial,
		note: null,
		parsed_shape: shape,
		split_meta: null,
		field_meta: makeFieldMeta(line, path === 'contract' ? 0.9 : 0.65, false),
		debug: {
			path,
			struct_tokens_used_count: 0
		}
	};
};

const makeNodeFromLooseSpecial = (
	line: ParsedLine,
	name: string,
	sets: number,
	repsSpecial: string,
	note: string | null,
	path: 'contract' | 'legacy'
): ImportDraftNode => ({
	id: makeId(),
	source_raw_name: name,
	raw_exercise_name: name,
	sets,
	reps_mode: 'special',
	reps_text: repsSpecial,
	reps_min: null,
	reps_max: null,
	reps_special: repsSpecial,
	note,
	parsed_shape: null,
	split_meta: null,
	field_meta: makeFieldMeta(line, path === 'contract' ? 0.9 : 0.55, Boolean(note)),
	debug: {
		path,
		struct_tokens_used_count: 0
	}
});

const hasRequiredNodeFields = (node: ImportDraftNode) => {
	if (!node.raw_exercise_name || !node.sets) return false;
	if (node.reps_mode === 'special') {
		return Boolean((node.reps_special ?? '').trim());
	}
	return Boolean(node.reps_min && node.reps_text);
};

const parseLineToNode = (
	line: ParsedLine,
	rawSegment: string,
	counters: ParserCounters,
	blockContext: ImportShapeV1['block'] | null
): ParseOutcome => {
	counters.candidateLines += 1;
	counters.contractLinesTotal += 1;

	const structuredSpecial = parseStructuredSpecialDurationLine(rawSegment);
	if (structuredSpecial) {
		counters.legacyFallbackHits += 1;
		counters.parsedLines += 1;
		counters.linesWithPrescriptionDetected += 1;
		const node = makeNodeFromLooseSpecial(
			line,
			structuredSpecial.name,
			structuredSpecial.sets,
			structuredSpecial.repsSpecial,
			structuredSpecial.note,
			'legacy'
		);
		if (hasRequiredNodeFields(node)) {
			counters.requiredFieldsCompleted += 1;
		}
		return {
			node,
			usedContract: false,
			usedLegacy: true,
			detectedPrescription: true,
			failedInvariant: false
		};
	}

	const contract = parseContractCandidate(rawSegment);
	if (contract.candidate) {
		const isValid = assertCandidateInvariants(rawSegment, contract.candidate);
		if (!isValid) {
			counters.contractLinesFailedInvariants += 1;
			if (process.env.NODE_ENV !== 'production') {
				throw new Error(`contract matcher invariant failure on line: ${rawSegment}`);
			}
			const noteOnlyNode: ImportDraftNode = {
				id: makeId(),
				source_raw_name: sanitizeExerciseName(rawSegment),
				raw_exercise_name: sanitizeExerciseName(rawSegment),
				sets: null,
				reps_mode: 'number',
				reps_text: null,
				reps_min: null,
				reps_max: null,
				reps_special: null,
				note: sanitizeNote(rawSegment),
				parsed_shape: null,
				split_meta: null,
				field_meta: makeFieldMeta(line, 0.45, true),
				debug: {
					path: 'contract',
					struct_tokens_used_count: 0
				}
			};
			return {
				node: noteOnlyNode,
				usedContract: true,
				usedLegacy: false,
			detectedPrescription: false,
			failedInvariant: true
		};
	}
		const node = makeNodeFromContractCandidate(line, rawSegment, contract.candidate, blockContext, 'contract');
		counters.contractLinesParsed += 1;
		counters.parsedLines += 1;
		counters.linesWithPrescriptionDetected += 1;
		if (hasRequiredNodeFields(node)) {
			counters.requiredFieldsCompleted += 1;
		}
		return {
			node,
			usedContract: true,
			usedLegacy: false,
			detectedPrescription: true,
			failedInvariant: false
		};
	}

	const legacy = parseLegacyLine(rawSegment);
	if (legacy) {
		counters.legacyFallbackHits += 1;
		counters.parsedLines += 1;
		counters.linesWithPrescriptionDetected += 1;
		const blockShape = blockContext ? { ...legacy.shape, block: blockContext } : legacy.shape;
		const node = makeNodeFromRawShape(line, rawSegment, legacy.name, blockShape, 'legacy');
		node.note = sanitizeNote(rawSegment.slice(legacy.structureEndOffset));
		node.field_meta.note = node.note ? makeFieldMeta(line, 0.55, true).note : null;
		if (hasRequiredNodeFields(node)) {
			counters.requiredFieldsCompleted += 1;
		}
		return {
			node,
			usedContract: false,
			usedLegacy: true,
			detectedPrescription: true,
			failedInvariant: false
		};
	}

	const looseSpecial = parseLooseSpecialDurationLine(rawSegment);
	if (looseSpecial) {
		counters.legacyFallbackHits += 1;
		counters.parsedLines += 1;
		counters.linesWithPrescriptionDetected += 1;
		const node = makeNodeFromLooseSpecial(
			line,
			looseSpecial.name,
			looseSpecial.sets,
			looseSpecial.repsSpecial,
			looseSpecial.note,
			'legacy'
		);
		if (hasRequiredNodeFields(node)) {
			counters.requiredFieldsCompleted += 1;
		}
		return {
			node,
			usedContract: false,
			usedLegacy: true,
			detectedPrescription: true,
			failedInvariant: false
		};
	}

	return {
		node: null,
		usedContract: false,
		usedLegacy: false,
		detectedPrescription: false,
		failedInvariant: false
	};
};

const rollbackPendingContext = (queue: LineUnit[], buffered: LineUnit[]) => {
	for (let i = buffered.length - 1; i >= 0; i -= 1) {
		const unit = buffered[i];
		if (!unit) continue;
		queue.unshift({
			...unit,
			source_kind: 'rollback',
			skip_context_open: true
		});
	}
};

const parseCircuitLine = (
	rawLine: string,
	rounds: number
): CircuitEntryResult => {
	const trimmed = rawLine.trim();
	if (!trimmed) return { kind: 'noise' };
	if (isCircuitCommentLine(trimmed)) return { kind: 'noise' };
	const segments = splitCircuitSegments(trimmed);
	if (segments.length === 0) return { kind: 'noise' };

	const entries: CircuitLineEntry[] = [];
	for (const segment of segments) {
		const parsed = parseCircuitEntry(segment);
		if (parsed) {
			let shape = parsed.shape;
			if (shape.kind === 'fixed' && shape.inference_reasons?.includes('circuit_grouped')) {
				shape = {
					...shape,
					sets: rounds,
					evidence: 'heuristic',
					inference_reasons: Array.from(new Set([...(shape.inference_reasons ?? []), 'circuit_grouped']))
				};
			}
			entries.push({ kind: 'shape', name: parsed.name, shape, path: 'contract' });
			continue;
		}

		const structuredSpecial = parseStructuredSpecialDurationLine(segment);
		const looseSpecial = structuredSpecial ?? parseLooseSpecialDurationLine(segment);
		if (looseSpecial) {
			entries.push({
				kind: 'special',
				name: looseSpecial.name,
				sets: structuredSpecial ? looseSpecial.sets : rounds,
				repsSpecial: looseSpecial.repsSpecial,
				note: looseSpecial.note,
				path: 'legacy'
			});
			continue;
		}

		return { kind: 'invalid' };
	}
	return { kind: 'valid', entries };
};

const maybeInlineUnit = (baseUnit: LineUnit, inlineText: string): LineUnit | null => {
	const value = inlineText.trim();
	if (!value) return null;
	return {
		id: makeId(),
		parent_id: baseUnit.id,
		raw: value,
		line_index: baseUnit.line_index,
		source_page: baseUnit.source_page,
		source_kind: 'synthetic',
		skip_context_open: true
	};
};

export const parseLinesToDraft = (lines: ParsedLine[], context: ParserContext): ImportDraft => {
	const counters: ParserCounters = {
		linesIn: 0,
		candidateLines: 0,
		parsedLines: 0,
		requiredFieldsCompleted: 0,
		linesWithPrescriptionDetected: 0,
		multiExerciseSplitsApplied: 0,
		unresolvedMultiExerciseLines: 0,
		contractLinesTotal: 0,
		contractLinesParsed: 0,
		contractLinesFailedInvariants: 0,
		legacyFallbackHits: 0
	};

	const days: ImportDraftDay[] = [];
	const fallbackDay = createDay('Día 1', 'monday');
	days.push(fallbackDay);
	let currentDay = fallbackDay;

	let state: ParseState = { kind: 'IDLE' };
	const reopenedContextHeaders = new Set<string>();
	let indexedDayHeadingsDetected = 0;
	let weekDayHeadingsDetected = 0;
	let customDayHeadingsDetected = 0;

	const queue: LineUnit[] = lines.map((line) => ({
		id: makeId(),
		raw: line.text,
		line_index: line.lineIndex,
		source_page: line.sourcePage,
		source_kind: 'input'
	}));

	while (queue.length > 0) {
		const unit = queue.shift();
		if (!unit) break;
		let rawLine = unit.raw;
		const embeddedDayHeading = splitEmbeddedDayHeading(rawLine);
		if (embeddedDayHeading?.after) {
			queue.unshift({
				...unit,
				id: makeId(),
				parent_id: unit.id,
				raw: embeddedDayHeading.after,
				source_kind: 'synthetic',
				skip_context_open: false
			});
			rawLine = embeddedDayHeading.before;
		}
		const trimmed = rawLine.trim();

		const line: ParsedLine = {
			text: rawLine,
			lineIndex: unit.line_index,
			sourcePage: unit.source_page
		};

		if (isBlank(trimmed)) {
			continue;
		}

		const dayHeading = mapDayHeading(trimmed);
		const circuitHeading = !unit.skip_context_open ? parseCircuitHeading(trimmed) : null;
		const supersetHeading = !unit.skip_context_open ? parseSupersetHeading(trimmed) : null;
		const loadHeading = !unit.skip_context_open ? parseLoadHeading(trimmed) : null;

		if (state.kind === 'PENDING_CIRCUIT' || state.kind === 'ACTIVE_CIRCUIT') {
			if (dayHeading || circuitHeading || supersetHeading || loadHeading) {
				if (state.kind === 'PENDING_CIRCUIT') {
					rollbackPendingContext(queue, state.buffer);
				}
				state = { kind: 'IDLE' };
				queue.unshift(unit);
				continue;
			}

			const parsed = parseCircuitLine(trimmed, state.rounds);
			if (parsed.kind === 'valid') {
				const block = ensureBlockById(currentDay, 'circuit', state.blockId);
				let hasBlockContext = block.nodes.some((node) => node.parsed_shape?.block);
				for (const entry of parsed.entries) {
					let node: ImportDraftNode;
					if (entry.kind === 'shape') {
						const shape: ImportShapeV1 = {
							...entry.shape,
							block: {
								kind: 'circuit',
								rounds: state.rounds,
								header_text: state.headerText,
								header_unit_id: state.headerUnitId
							}
						};
						node = makeNodeFromRawShape(line, trimmed, entry.name, shape, entry.path);
						hasBlockContext = true;
						counters.contractLinesTotal += 1;
						counters.contractLinesParsed += 1;
					} else {
						const sets = entry.sets > 0 ? entry.sets : state.rounds;
						node = makeNodeFromLooseSpecial(line, entry.name, sets, entry.repsSpecial, entry.note, entry.path);
						counters.legacyFallbackHits += 1;
					}

					if (state.blockNote) {
						node.note = state.blockNote;
					}
					block.nodes.push(node);
					counters.candidateLines += 1;
					counters.parsedLines += 1;
					counters.linesWithPrescriptionDetected += 1;
					if (hasRequiredNodeFields(node)) {
						counters.requiredFieldsCompleted += 1;
					}
				}

				if (!hasBlockContext && block.nodes.length > 0) {
					const fallbackNode = block.nodes[0];
					fallbackNode.parsed_shape = {
						version: 1,
						kind: 'fixed',
						sets: state.rounds,
						reps_min: 1,
						reps_max: null,
						evidence: 'heuristic',
						inference_reasons: ['circuit_grouped'],
						block: {
							kind: 'circuit',
							rounds: state.rounds,
							header_text: state.headerText,
							header_unit_id: state.headerUnitId
						}
					};
				}
				if (state.kind === 'PENDING_CIRCUIT') {
					if (block.nodes.length >= 2) {
						state = {
							kind: 'ACTIVE_CIRCUIT',
							headerUnitId: state.headerUnitId,
							headerText: state.headerText,
							rounds: state.rounds,
							blockId: state.blockId,
							blockNote: state.blockNote,
							invalidEntryStreak: 0
						};
					} else {
						state.entries.push(...parsed.entries);
						state.buffer.push(unit);
					}
				} else {
					state.invalidEntryStreak = 0;
				}
				continue;
			}

			if (parsed.kind === 'noise') {
				const nextBlockNote = appendCircuitBlockNote(state.blockNote, trimmed);
				if (nextBlockNote !== state.blockNote) {
					state.blockNote = nextBlockNote;
					if (nextBlockNote) {
						const block = ensureBlockById(currentDay, 'circuit', state.blockId);
						if (block.nodes.length > 0) {
							block.nodes = block.nodes.map((node) => ({ ...node, note: nextBlockNote }));
						}
					}
				}
				if (state.kind === 'PENDING_CIRCUIT') {
					state.buffer.push(unit);
				}
				continue;
			}

			if (state.kind === 'PENDING_CIRCUIT') {
				state.buffer.push(unit);
				if (state.entries.length < 2) {
					rollbackPendingContext(queue, state.buffer);
					state = { kind: 'IDLE' };
					continue;
				}
				state = {
					kind: 'ACTIVE_CIRCUIT',
					headerUnitId: state.headerUnitId,
					headerText: state.headerText,
					rounds: state.rounds,
					blockId: state.blockId,
					blockNote: state.blockNote,
					invalidEntryStreak: 1
				};
				continue;
			}

			state.invalidEntryStreak += 1;
			if (state.invalidEntryStreak >= 2) {
				state = { kind: 'IDLE' };
				queue.unshift({ ...unit, skip_context_open: true, source_kind: 'rollback' });
			}
			continue;
		}

		if (state.kind === 'PENDING_LADDER' || state.kind === 'ACTIVE_LADDER') {
			if (dayHeading || circuitHeading || supersetHeading || loadHeading) {
				if (state.kind === 'PENDING_LADDER') {
					rollbackPendingContext(queue, state.buffer);
					state = { kind: 'IDLE' };
					queue.unshift(unit);
					continue;
				}
				const finalizedShape: ImportShapeV1 = {
					version: 1,
					kind: 'load_ladder',
					load_entries: state.entries.map((entry) => ({
						weight: entry.weight,
						reps: entry.reps,
						unit: entry.unit
					})),
					evidence: 'heuristic',
					inference_reasons: ['ladder_grouped']
				};
				const block = ensureBlockById(currentDay, 'single', state.blockId);
				const node = makeNodeFromRawShape(line, state.headerText, state.headerText, finalizedShape, 'contract');
				block.nodes.push(node);
				counters.parsedLines += 1;
				counters.linesWithPrescriptionDetected += 1;
				counters.contractLinesTotal += 1;
				counters.contractLinesParsed += 1;
				counters.candidateLines += 1;
				if (hasRequiredNodeFields(node)) {
					counters.requiredFieldsCompleted += 1;
				}
				state = { kind: 'IDLE' };
				queue.unshift(unit);
				continue;
			}

			const entries = parseLadderEntries(trimmed);
			if (entries.length > 0) {
				if (state.kind === 'PENDING_LADDER') {
					state.buffer.push(unit);
					state.entries.push(...entries);
					if (state.entries.length >= 2) {
						state = {
							kind: 'ACTIVE_LADDER',
							headerUnitId: state.headerUnitId,
							headerText: state.headerText,
							blockId: state.blockId,
							entries: state.entries
						};
					}
				} else {
					state.entries.push(...entries);
				}
				continue;
			}

			if (state.kind === 'PENDING_LADDER') {
				state.buffer.push(unit);
				rollbackPendingContext(queue, state.buffer);
				state = { kind: 'IDLE' };
				continue;
			}

			state = { kind: 'IDLE' };
			queue.unshift({ ...unit, skip_context_open: true, source_kind: 'rollback' });
			continue;
		}

			if (dayHeading) {
				const mapped = dayHeading.mapped;
				if (dayHeading.kind === 'weekday') weekDayHeadingsDetected += 1;
				if (dayHeading.kind === 'indexed') indexedDayHeadingsDetected += 1;
				if (dayHeading.kind === 'custom') customDayHeadingsDetected += 1;
				const nextDay = createDay(dayHeading.label, mapped);
				days.push(nextDay);
				currentDay = nextDay;
			state = { kind: 'IDLE' };
			const inline = maybeInlineUnit(unit, dayHeading.rest);
			if (inline) queue.unshift(inline);
			continue;
		}

		if (isNoiseLine(trimmed)) {
			continue;
		}

		if (circuitHeading && !reopenedContextHeaders.has(unit.id)) {
			reopenedContextHeaders.add(unit.id);
			state = {
				kind: 'PENDING_CIRCUIT',
				headerUnitId: unit.id,
				headerText: circuitHeading.headerText,
				rounds: circuitHeading.rounds,
				blockId: makeId(),
				blockNote: null,
				buffer: [],
				entries: []
			};
			const inline = maybeInlineUnit(unit, circuitHeading.rest);
			if (inline) queue.unshift(inline);
			continue;
		}

		if (supersetHeading && !reopenedContextHeaders.has(unit.id)) {
			reopenedContextHeaders.add(unit.id);
			state = {
				kind: 'PENDING_CIRCUIT',
				headerUnitId: unit.id,
				headerText: supersetHeading.headerText,
				rounds: supersetHeading.rounds,
				blockId: makeId(),
				blockNote: null,
				buffer: [],
				entries: []
			};
			const inline = maybeInlineUnit(unit, supersetHeading.rest);
			if (inline) queue.unshift(inline);
			continue;
		}

		if (loadHeading && !reopenedContextHeaders.has(unit.id)) {
			reopenedContextHeaders.add(unit.id);
			state = {
				kind: 'PENDING_LADDER',
				headerUnitId: unit.id,
				headerText: loadHeading.headerText,
				blockId: makeId(),
				buffer: [],
				entries: []
			};
			const inline = maybeInlineUnit(unit, loadHeading.rest);
			if (inline) queue.unshift(inline);
			continue;
		}

		counters.linesIn += 1;
		const split = splitGlobalMultiExerciseLine(trimmed, counters);
		for (const segment of split.segments) {
			const outcome = parseLineToNode(line, segment, counters, null);
			if (!outcome.node) continue;
			const block = ensureSingleBlock(currentDay);
			block.nodes.push(outcome.node);
		}
	}

	if (state.kind === 'ACTIVE_LADDER') {
		const block = ensureBlockById(currentDay, 'single', state.blockId);
		const node = makeNodeFromRawShape(
			{ text: state.headerText, lineIndex: 0, sourcePage: undefined },
			state.headerText,
			state.headerText,
			{
				version: 1,
				kind: 'load_ladder',
				load_entries: state.entries.map((entry) => ({
					weight: entry.weight,
					reps: entry.reps,
					unit: entry.unit
				})),
				evidence: 'heuristic',
				inference_reasons: ['ladder_grouped']
			},
			'contract'
		);
		block.nodes.push(node);
	}

	const compactDays = days.filter((day) => day.blocks.some((block) => block.nodes.length > 0));
	const effectiveDays = compactDays.length > 0 ? compactDays : [fallbackDay];
	const exercisesParsed = effectiveDays.reduce(
		(acc, day) => acc + day.blocks.reduce((sum, block) => sum + block.nodes.length, 0),
		0
	);
	const parseableRatio = counters.candidateLines > 0 ? counters.parsedLines / counters.candidateLines : 0;
	const requiredFieldsRatio = counters.parsedLines > 0 ? counters.requiredFieldsCompleted / counters.parsedLines : 0;
	const inferredPresentationMode =
		customDayHeadingsDetected > 0
			? 'custom'
			: indexedDayHeadingsDetected > 0 && weekDayHeadingsDetected === 0
				? 'sequential'
				: 'weekday';

	return {
		version: IMPORT_DRAFT_VERSION,
		source_type: context.sourceType,
		parser_version: context.parserVersion,
		ruleset_version: context.rulesetVersion,
		extractor_version: context.extractorVersion,
		coverage: {
			days_detected: effectiveDays.length,
			exercises_parsed: exercisesParsed,
			candidate_lines: counters.candidateLines,
			parsed_lines: counters.parsedLines,
			parseable_ratio: parseableRatio,
			required_fields_ratio: requiredFieldsRatio,
			lines_in: counters.linesIn,
			lines_after_split: counters.candidateLines,
			lines_with_prescription_detected: counters.linesWithPrescriptionDetected,
			exercise_nodes_out: exercisesParsed,
			multi_exercise_splits_applied: counters.multiExerciseSplitsApplied,
			unresolved_multi_exercise_lines: counters.unresolvedMultiExerciseLines,
			contract_lines_total: counters.contractLinesTotal,
			contract_lines_parsed: counters.contractLinesParsed,
			contract_lines_failed_invariants: counters.contractLinesFailedInvariants,
			legacy_fallback_hits: counters.legacyFallbackHits
		},
		presentation: {
			day_label_mode: inferredPresentationMode
		},
		days: effectiveDays
	};
};
