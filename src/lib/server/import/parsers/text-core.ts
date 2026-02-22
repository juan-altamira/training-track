import type {
	ImportDraft,
	ImportDraftBlock,
	ImportDraftDay,
	ImportDraftNode,
	ImportNameSplitConfidenceDelta,
	ImportNameSplitMeta
} from '$lib/import/types';
import type { ParsedLine, ParserContext } from './types';
import { IMPORT_DRAFT_VERSION } from '../constants';
import { makeId, makeProvenance, mapSpanishWeekdayToKey, normalizeLine, toConfidence } from '../utils';

const DAY_HEADING_REGEX =
	/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|d[ií]a\s*\d+|day\s*\d+)\b[:\-]?\s*(.*)?$/i;

const INDEXED_DAY_TO_WEEKDAY = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
] as const;

const NOISE_LINE_REGEX = /^(rutina|semana|objetivo|total|resumen|series?\s+de)\b/i;

const EXERCISE_PATTERNS = [
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)\s*\(\s*(\d{1,2})\s*[xX]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*\)(?:\s*(?:\||•|-)\s*(.*))?$/i,
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)\s*\(\s*(\d{1,2})\s*[xX*]\s*(\d{1,3})(?:\s*(?:[-–]|a|to|\/)\s*(\d{1,3}))?(?:\s*(?:repeticiones?|reps?))?\s*\)(?:\s*(?:\||•|-)\s*(.*))?$/i,
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)\s+(\d{1,2})\s*[xX]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?(?:\s*(?:\||•|-)\s*(.*))?$/i,
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)(?:\s*[:\-–\/]\s*|\s+)\(?\s*(\d{1,2})\s*[xX*]\s*(\d{1,3})(?:\s*(?:[-–]|a|to|\/)\s*(\d{1,3}))?\s*(?:repeticiones?|reps?)?\s*\)?\s*\/?(?:\s*(?:\||•|-)\s*(.*)|\s*(.*))?$/i,
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)(?:\s*[:\-–\/]\s*|\s+)\(?\s*(\d{1,2})\s*series?\s*(?:de|x)?\s*(\d{1,3})(?:\s*(?:a|-|–|to|\/)\s*(\d{1,3}))?\s*(?:repeticiones?|reps?)?\s*\)?\s*\/?(?:\s*(.*))?$/i
];

const REPS_ONLY_PATTERNS = [
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)(?:\s*[:\-–]\s*|\s+)[xX*]\s*(\d{1,3})\s*(?:[-–]|a|to|\/)\s*(\d{1,3})(?:\s*(?:repeticiones?|reps?))?(?:\s*(?:\||•|-)\s*(.*))?$/i,
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)\s*[-–:]\s*(\d{1,3})\s*(?:[-–]|a|to|\/)\s*(\d{1,3})\s*(?:repeticiones?|reps?)\b(?:\s*(.*))?$/i,
	/^(?:[A-Z]\d+\s*[\.\-\)]?\s*)?(.+?)\s+(\d{1,3})\s*(?:[-–]|a|to|\/)\s*(\d{1,3})\s*(?:repeticiones?|reps?)\b(?:\s*(.*))?$/i
];

const SETS_FIRST_PATTERNS = [
	/^\(?\s*(\d{1,2})\s*series?\s*(?:x|de)?\s*(\d{1,3})(?:\s*(?:a|-|–|to|\/)\s*(\d{1,3}))?\s*(?:repeticiones?|reps?)?\s*\)?\s*(?:de|en)?\s+(.+)$/i,
	/^\(?\s*(\d{1,2})\s*[xX*]\s*(\d{1,3})(?:\s*(?:a|-|–|to|\/)\s*(\d{1,3}))?\s*(?:repeticiones?|reps?)?\s*\)?\s*(?:de|en)?\s+(.+)$/i
];

const WORD_NUMBER_MAP: Record<string, number> = {
	cero: 0,
	un: 1,
	uno: 1,
	una: 1,
	dos: 2,
	tres: 3,
	cuatro: 4,
	cinco: 5,
	seis: 6,
	siete: 7,
	ocho: 8,
	nueve: 9,
	diez: 10,
	once: 11,
	doce: 12,
	trece: 13,
	catorce: 14,
	quince: 15,
	dieciseis: 16,
	dieciséis: 16,
	diecisiete: 17,
	dieciocho: 18,
	diecinueve: 19,
	veinte: 20
};

const WORD_SERIES_PATTERNS = [
	/^(uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte)\s+series?\s+de\s+(uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|\d{1,3})\s*(?:repeticiones?|reps?)?\s+(?:en|de)\s+(.+)$/i,
	/^(.+?)\s+(uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|\d{1,2})\s+de\s+(\d{1,3})\s*(?:repeticiones?|reps?)\b(?:\s*(.*))?$/i
];

const PRESCRIPTION_SPAN_PATTERNS = [
	/\d{1,2}\s*(?:[xX*]|series?\s*(?:de|x)?)\s*\d{1,3}(?:\s*(?:-|–|a|to|\/)\s*\d{1,3})?/gi,
	/\b(?:uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte)\s+series?\s+de\s+(?:uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|\d{1,3})\b/giu
] as const;

const STAGE_A_LINE_SPLIT_REGEX = /\)\s*(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/g;
const STAGE_B_SEGMENT_MIN_LENGTH = 6;

const COMMENT_TOKEN_SPLIT_REGEX =
	/(?:^|[\s\-–:\/|])(nota|ac[aá]|ah[ií]|en\s+este|en\s+esta|en\s+esa|en\s+eso|hac[eé]te|tempo|descanso|rir|rpe|fallo|[uú]ltima)\b/i;

const COMMENT_START_REGEX =
	/^(?:nota\b|ac[aá]\b|ah[ií]\b|en\s+(?:este|esta|eso)\b|hac[eé]te\b|hace\b|hacer\b|realiza(?:r)?\b|manten(?:e|é)?\b|controla(?:r)?\b|evita(?:r)?\b|sub[ií]\b|baj[aá]\b|lento\b|r[aá]pido\b|tempo\b|descanso\b|rir\b|rpe\b|fallo\b|[uú]ltima\b|\d{1,2}\s*(?:series?|x)\b)/i;

const DEICTIC_NOTE_TOKENS = new Set([
	'en',
	'este',
	'esta',
	'esa',
	'eso',
	'aca',
	'ahi',
	'aqui',
	'esto',
	'hacete',
	'hace',
	'hacer',
	'realiza',
	'realizar',
	'ok',
	'igual',
	'x'
]);

const STRONG_COMMENT_SIGNAL_TOKENS = [
	'hacete',
	'hace',
	'hacer',
	'realiza',
	'realizar',
	'mantene',
	'controla',
	'evita',
	'subi',
	'baja',
	'lento',
	'rapido',
	'excentrica',
	'concentrica',
	'tempo',
	'pausa',
	'descanso',
	'rir',
	'rpe',
	'fallo',
	'ultima'
] as const;

const VARIANT_KEYWORDS = [
	'agarre',
	'mancuerna',
	'mancuernas',
	'barra',
	'inclinado',
	'declinado',
	'supino',
	'prono',
	'martillo',
	'anillas',
	'unilateral',
	'maquina',
	'maquinas',
	'polea',
	'banco',
	'landmine',
	't'
] as const;

const GENERIC_SINGLE_WORD_BLOCKLIST = new Set([
	'press',
	'remo',
	'curl',
	'vuelos',
	'jalon',
	'banco',
	'sentadilla',
	'prensa'
]);

const SINGLE_WORD_EXERCISE_LEXICON = new Set([
	'gemelos',
	'plancha',
	'dominadas',
	'burpees',
	'abdominales',
	'hiperextensiones'
]);

const SINGLE_WORD_EXERCISE_LEXICON_STRICT = new Set(['gemelos', 'plancha', 'dominadas', 'burpees']);

const isLikelyNoteLine = (line: string) => /^(nota|note|rir|rpe|descanso|tempo)\b/i.test(line);

const NOTE_CONTINUATION_TOKENS = new Set([
	'final',
	'parte',
	'movimiento',
	'tecnica',
	'tecnica',
	'controla',
	'controlalo',
	'controlala',
	'mantene',
	'manten',
	'lento',
	'lenta',
	'lentas',
	'rapido',
	'rapida',
	'rapidas',
	'pausa',
	'tempo',
	'del',
	'de',
	'en',
	'con',
	'para',
	'al'
]);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeComparable = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const countWords = (value: string) => {
	const normalized = normalizeComparable(value);
	if (!normalized) return 0;
	return normalized.split(' ').filter(Boolean).length;
};

const hasWholeToken = (normalized: string, token: string) =>
	new RegExp(`(^|\\s)${escapeRegex(token)}(?=\\s|$)`).test(normalized);

const hasStrongCommentSignal = (value: string) => {
	const normalized = normalizeComparable(value);
	if (!normalized) return false;
	if (STRONG_COMMENT_SIGNAL_TOKENS.some((token) => hasWholeToken(normalized, token))) return true;
	if (/\b(?:rir|rpe)\s*\d?\b/.test(normalized)) return true;
	if (/\b\d+\s*(?:seg|s|min|mins)\b/.test(normalized)) return true;
	return false;
};

const hasVariantKeyword = (value: string) => {
	const normalized = normalizeComparable(value);
	if (!normalized) return false;
	return VARIANT_KEYWORDS.some((token) => hasWholeToken(normalized, token));
};

const sanitizeSourceRawName = (raw: string) =>
	raw
		.replace(/\s+/g, ' ')
		.replace(/^[•●▪◦·\-\s:]+/, '')
		.replace(/\s*[:\-–|]+$/, '')
		.trim();

const sanitizeExerciseName = (raw: string) =>
	raw
		.replace(/\s+/g, ' ')
		.replace(/^[•●▪◦·\-\s:]+/, '')
		.replace(/\s*[:\-–|/]+$/, '')
		.trim();

const sanitizeNote = (raw: string | null) => {
	const value = (raw ?? '')
		.trim()
		.replace(/^[-–:|/()\s]+/, '')
		.replace(/[-–:|/()\s]+$/, '')
		.trim();
	if (!value || /^[\W_]+$/.test(value)) return null;
	if (/^(repeticiones?|reps?)\.?$/i.test(value)) return null;
	return value;
};

const appendNoteContinuation = (existing: string | null, continuation: string) => {
	const left = sanitizeNote(existing);
	const right = sanitizeNote(continuation);
	if (!right) return left;
	if (!left) return right;
	return sanitizeNote(`${left} ${right}`);
};

const mapIndexedDayLabelToKey = (raw: string): ImportDraftDay['mapped_day_key'] => {
	const normalized = raw
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.trim();
	const match = normalized.match(/^(?:dia|day)\s*(\d{1,2})\b/);
	if (!match) return null;
	const dayNumber = Number.parseInt(match[1] ?? '', 10);
	if (!Number.isFinite(dayNumber) || dayNumber < 1) return null;
	return INDEXED_DAY_TO_WEEKDAY[dayNumber - 1] ?? null;
};

const removeLineDecorators = (line: string) =>
	line
		.replace(/^[•●▪◦·*+\-\/]+\s*/, '')
		.replace(/^\d+\s*[\.\-\)]\s*/, '')
		.trim();

const mergeNotes = (...parts: Array<string | null | undefined>) => {
	const merged: string[] = [];
	const seen = new Set<string>();

	for (const part of parts) {
		const cleaned = sanitizeNote(part ?? null);
		if (!cleaned) continue;
		const key = normalizeComparable(cleaned);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		merged.push(cleaned);
	}

	return merged.length > 0 ? merged.join('. ') : null;
};

type ParsedPrescription = {
	sets: number | null;
	repsMin: number | null;
	repsMax: number | null;
	repsText: string | null;
};

const stripRedundantPrescription = (note: string | null, prescription: ParsedPrescription) => {
	let next = sanitizeNote(note);
	if (!next) return null;

	const { sets, repsMin, repsMax } = prescription;
	if (sets && repsMin) {
		const repsPart =
			repsMax && repsMax > repsMin
				? `${repsMin}\\s*(?:-|–|a|to|\\/)\\s*${repsMax}`
				: `${repsMin}`;
		const patterns = [
			new RegExp(`\\b${sets}\\s*[xX*]\\s*${repsPart}(?:\\s*(?:repeticiones?|reps?))?\\b`, 'gi'),
			new RegExp(`\\b${sets}\\s*series?\\s*(?:de|x)?\\s*${repsPart}(?:\\s*(?:repeticiones?|reps?))?\\b`, 'gi')
		];
		for (const pattern of patterns) {
			next = next.replace(pattern, ' ');
		}
	}

	next = next
		.replace(/\s{2,}/g, ' ')
		.replace(/\s+([,.;:])/g, '$1')
		.replace(/^[-–:|/,.;\s]+/, '')
		.replace(/[-–:|/,.;\s]+$/, '')
		.trim();

	return sanitizeNote(next);
};

const isGarbageNote = (note: string | null) => {
	const cleaned = sanitizeNote(note);
	if (!cleaned) return true;
	const normalized = normalizeComparable(cleaned);
	if (!normalized) return true;
	if (/^(?:en\s+(?:este|esta|esa|eso)|ac[aa]|ahi|esto|eso|ok|igual|x)$/.test(normalized)) return true;
	const tokens = normalized.split(' ').filter(Boolean);
	if (tokens.length <= 4 && tokens.every((token) => DEICTIC_NOTE_TOKENS.has(token))) return true;
	return false;
};

const hasSemanticInstructionSignal = (note: string) => {
	const normalized = normalizeComparable(note);
	if (!normalized) return false;
	if (hasStrongCommentSignal(normalized)) return true;
	if (/\b(?:exc|conc|tempo|pausa|descanso|tecnica|tecnica|controlado|controlada)\b/.test(normalized)) return true;
	return false;
};

const isLikelyNoteContinuationLine = (line: string, hasExistingNote: boolean) => {
	if (!hasExistingNote) return false;
	const cleaned = sanitizeNote(line);
	if (!cleaned) return false;
	if (isLikelyNoteLine(cleaned)) return false;
	if (collectPrescriptionSpans(cleaned).length > 0) return false;

	const startsLowercase = /^[a-záéíóúñ]/.test(cleaned);
	const normalized = normalizeComparable(cleaned);
	const tokens = normalized.split(' ').filter(Boolean);
	const firstToken = tokens[0] ?? '';
	const startsWithContinuationToken = NOTE_CONTINUATION_TOKENS.has(firstToken);

	if (!startsLowercase && !startsWithContinuationToken && !hasStrongCommentSignal(cleaned)) return false;
	if (tokens.length <= 1 && !hasStrongCommentSignal(cleaned)) return false;

	return true;
};

const confidencePenaltyByDelta = (delta: ImportNameSplitConfidenceDelta) => {
	if (delta === 'low') return 0.22;
	if (delta === 'medium') return 0.12;
	return 0;
};

type NameSplitCandidate = {
	name: string;
	tail: string;
	reason: string;
	confidenceDelta: ImportNameSplitConfidenceDelta;
};

type NameSplitResult = {
	applied: boolean;
	name: string;
	extraNote: string | null;
	tailOriginal: string | null;
	reason: string;
	confidenceDelta: ImportNameSplitConfidenceDelta;
	clearlyUseful: boolean;
};

const findNameSplitCandidate = (rawName: string): NameSplitCandidate | null => {
	const source = sanitizeSourceRawName(rawName);
	if (!source) return null;

	for (const separatorPattern of [/^(.+?)\s*[-–:]\s+(.+)$/i, /^(.+?)\s*\/\s*(.+)$/i]) {
		const match = source.match(separatorPattern);
		if (!match) continue;
		const name = sanitizeExerciseName(match[1] ?? '');
		const tail = sanitizeNote(match[2] ?? null);
		if (!name || !tail) continue;
		if (!COMMENT_START_REGEX.test(tail) && !hasStrongCommentSignal(tail)) continue;
		return {
			name,
			tail,
			reason: 'separator_comment',
			confidenceDelta: 'medium'
		};
	}

	const tokenMatch = source.match(COMMENT_TOKEN_SPLIT_REGEX);
	if (tokenMatch?.index !== undefined) {
		const token = tokenMatch[1] ?? '';
		const tokenStart = tokenMatch.index + tokenMatch[0].length - token.length;
		if (tokenStart > 1) {
			const name = sanitizeExerciseName(source.slice(0, tokenStart));
			const tail = sanitizeNote(source.slice(tokenStart));
			if (name && tail) {
				return {
					name,
					tail,
					reason: 'comment_token',
					confidenceDelta: 'medium'
				};
			}
		}
	}

	const parenthetical = source.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
	if (parenthetical) {
		const name = sanitizeExerciseName(parenthetical[1] ?? '');
		const tail = sanitizeNote(parenthetical[2] ?? null);
		if (name && tail) {
			const shouldKeepInName = hasVariantKeyword(tail) && !hasStrongCommentSignal(tail);
			if (!shouldKeepInName && (COMMENT_START_REGEX.test(tail) || hasStrongCommentSignal(tail))) {
				return {
					name,
					tail,
					reason: 'parenthetical_instruction',
					confidenceDelta: 'none'
				};
			}
		}
	}

	return null;
};

const isSingleWordNameAccepted = (
	name: string,
	hasParsedPrescription: boolean,
	splitHasStrongSignal: boolean
) => {
	const normalized = normalizeComparable(name);
	if (!normalized || normalized.includes(' ')) return false;
	if (GENERIC_SINGLE_WORD_BLOCKLIST.has(normalized)) return false;
	const lexicon = hasParsedPrescription ? SINGLE_WORD_EXERCISE_LEXICON : SINGLE_WORD_EXERCISE_LEXICON_STRICT;
	if (!lexicon.has(normalized)) return false;
	if (!hasParsedPrescription && !splitHasStrongSignal) return false;
	return true;
};

const isPlausibleExerciseName = (
	candidateName: string,
	sourceRawName: string,
	hasParsedPrescription: boolean,
	tail: string
) => {
	const cleanName = sanitizeExerciseName(candidateName);
	const cleanWordCount = countWords(cleanName);
	if (cleanWordCount >= 2) return true;
	if (cleanWordCount !== 1) return false;

	const splitHasStrongSignal = hasStrongCommentSignal(tail);
	const oneWordAccepted = isSingleWordNameAccepted(cleanName, hasParsedPrescription, splitHasStrongSignal);
	if (!oneWordAccepted) return false;

	const sourceWordCount = countWords(sourceRawName);
	if (sourceWordCount >= 3 && !hasParsedPrescription && !splitHasStrongSignal) return false;
	return true;
};

const splitExerciseNameAndNote = (
	rawName: string,
	hasParsedPrescription: boolean
): NameSplitResult => {
	const source = sanitizeSourceRawName(rawName);
	const candidate = findNameSplitCandidate(source);
	if (!candidate) {
		return {
			applied: false,
			name: source,
			extraNote: null,
			tailOriginal: null,
			reason: 'no_split',
			confidenceDelta: 'none',
			clearlyUseful: false
		};
	}

	const namePlausible = isPlausibleExerciseName(
		candidate.name,
		source,
		hasParsedPrescription,
		candidate.tail
	);
	const splitHasStrongSignal = hasStrongCommentSignal(candidate.tail);
	const clearlyUseful = namePlausible || splitHasStrongSignal;

	return {
		applied: true,
		name: candidate.name,
		extraNote: candidate.tail,
		tailOriginal: candidate.tail,
		reason: candidate.reason,
		confidenceDelta: namePlausible ? candidate.confidenceDelta : 'low',
		clearlyUseful
	};
};

const resolveNameAndNote = (
	rawName: string,
	rawNote: string | null,
	prescription: ParsedPrescription
): { sourceRawName: string; name: string; note: string | null; splitMeta: ImportNameSplitMeta | null } | null => {
	const sourceRawName = sanitizeSourceRawName(rawName);
	if (!sourceRawName) return null;

	const hasParsedPrescription = Boolean(
		(prescription.sets && prescription.sets > 0) || (prescription.repsMin && prescription.repsMin > 0)
	);

	const split = splitExerciseNameAndNote(sourceRawName, hasParsedPrescription);
	const parsedInlineNote = sanitizeNote(rawNote);

	let name = sanitizeExerciseName(split.name || sourceRawName);
	let note = stripRedundantPrescription(mergeNotes(split.extraNote, parsedInlineNote), prescription);
	let splitMeta: ImportNameSplitMeta = {
		decision: split.applied ? 'split_kept' : 'not_applied',
		reason: split.reason,
		confidence_delta: split.confidenceDelta,
		tail_original: split.tailOriginal
	};

	if (split.applied && note && note.length > 120 && !hasSemanticInstructionSignal(note)) {
		name = sanitizeExerciseName(sourceRawName);
		note = stripRedundantPrescription(parsedInlineNote, prescription);
		splitMeta = {
			decision: 'split_reverted',
			reason: 'low_signal_long_tail',
			confidence_delta: 'low',
			tail_original: split.tailOriginal
		};
	}

	if (split.applied && isGarbageNote(note)) {
		if (split.clearlyUseful) {
			note = null;
			splitMeta = {
				decision: 'split_kept_note_dropped',
				reason: 'garbage_note_dropped',
				confidence_delta: split.confidenceDelta,
				tail_original: mergeNotes(split.tailOriginal, parsedInlineNote)
			};
		} else {
			name = sanitizeExerciseName(sourceRawName);
			note = stripRedundantPrescription(parsedInlineNote, prescription);
			splitMeta = {
				decision: 'split_reverted',
				reason: 'garbage_note_without_useful_split',
				confidence_delta: 'low',
				tail_original: split.tailOriginal
			};
		}
	}

	if (!split.applied && isGarbageNote(note)) {
		note = null;
		splitMeta = {
			decision: 'not_applied',
			reason: 'garbage_note_dropped_no_split',
			confidence_delta: 'none',
			tail_original: parsedInlineNote
		};
	}

	if (!name) return null;

	return {
		sourceRawName,
		name,
		note,
		splitMeta
	};
};

const buildNode = (
	parts: {
		sourceRawName: string;
		name: string;
		sets: number | null;
		repsMin: number | null;
		repsMax: number | null;
		note: string | null;
		repsText: string | null;
		splitMeta: ImportNameSplitMeta | null;
	},
	line: ParsedLine,
	confidenceScore: number
): ImportDraftNode => {
	const splitPenalty = confidencePenaltyByDelta(parts.splitMeta?.confidence_delta ?? 'none');
	const fieldConfidence = toConfidence(confidenceScore);
	const nameConfidence = toConfidence(Math.max(0.3, confidenceScore - splitPenalty));
	const noteConfidenceScore = Math.max(0.3, confidenceScore - 0.2 - splitPenalty / 2);
	const provenance = makeProvenance(line.text, line.lineIndex, line.sourcePage);

	return {
		id: makeId(),
		source_raw_name: parts.sourceRawName,
		raw_exercise_name: parts.name,
		sets: parts.sets,
		reps_text: parts.repsText,
		reps_min: parts.repsMin,
		reps_max: parts.repsMax,
		note: parts.note,
		split_meta: parts.splitMeta,
		field_meta: {
			day: { confidence: fieldConfidence, provenance },
			name: { confidence: nameConfidence, provenance },
			sets: { confidence: fieldConfidence, provenance },
			reps: { confidence: fieldConfidence, provenance },
			note: parts.note
				? {
						confidence: toConfidence(noteConfidenceScore),
						provenance
					}
				: null
		}
	};
};

const parseExerciseLine = (line: ParsedLine, confidenceFloor: number): ImportDraftNode | null => {
	const normalized = removeLineDecorators(normalizeLine(line.text));

	const toRange = (minRaw: number, maxRaw: number | null) => {
		const hasRange = maxRaw && Number.isFinite(maxRaw);
		const rangeMin = hasRange ? Math.min(minRaw, maxRaw) : minRaw;
		const rangeMax = hasRange ? Math.max(minRaw, maxRaw) : minRaw;
		return {
			rangeMin,
			rangeMax,
			repsMax: hasRange && rangeMax > rangeMin ? rangeMax : null,
			repsText: hasRange && rangeMax > rangeMin ? `${rangeMin}-${rangeMax}` : `${rangeMin}`
		};
	};

	const createNodeFromRaw = (
		rawName: string,
		rawNote: string | null,
		prescription: ParsedPrescription,
		score: number
	) => {
		const resolved = resolveNameAndNote(rawName, rawNote, prescription);
		if (!resolved) return null;
		return buildNode(
			{
				sourceRawName: resolved.sourceRawName,
				name: resolved.name,
				sets: prescription.sets,
				repsMin: prescription.repsMin,
				repsMax: prescription.repsMax,
				note: resolved.note,
				repsText: prescription.repsText,
				splitMeta: resolved.splitMeta
			},
			line,
			score
		);
	};

	for (const pattern of EXERCISE_PATTERNS) {
		const match = normalized.match(pattern);
		if (!match) continue;
		const sets = Number.parseInt(match[2] ?? '', 10);
		const repsMin = Number.parseInt(match[3] ?? '', 10);
		const repsMaxRaw = match[4] ? Number.parseInt(match[4], 10) : null;
		if (!Number.isFinite(sets) || !Number.isFinite(repsMin)) return null;
		const { rangeMin, repsMax, repsText } = toRange(repsMin, repsMaxRaw);

		return createNodeFromRaw(
			match[1] ?? '',
			sanitizeNote(match[5] ?? match[6] ?? null),
			{
				sets,
				repsMin: rangeMin,
				repsMax,
				repsText
			},
			confidenceFloor
		);
	}

	for (const pattern of SETS_FIRST_PATTERNS) {
		const match = normalized.match(pattern);
		if (!match) continue;
		const sets = Number.parseInt(match[1] ?? '', 10);
		const repsMin = Number.parseInt(match[2] ?? '', 10);
		const repsMaxRaw = match[3] ? Number.parseInt(match[3], 10) : null;
		if (!Number.isFinite(sets) || !Number.isFinite(repsMin)) return null;
		const { rangeMin, repsMax, repsText } = toRange(repsMin, repsMaxRaw);

		return createNodeFromRaw(
			match[4] ?? '',
			null,
			{
				sets,
				repsMin: rangeMin,
				repsMax,
				repsText
			},
			Math.max(0.65, confidenceFloor - 0.05)
		);
	}

	for (const pattern of REPS_ONLY_PATTERNS) {
		const match = normalized.match(pattern);
		if (!match) continue;
		const repsMin = Number.parseInt(match[2] ?? '', 10);
		const repsMaxRaw = Number.parseInt(match[3] ?? '', 10);
		if (!Number.isFinite(repsMin) || !Number.isFinite(repsMaxRaw)) return null;
		const { rangeMin, repsMax, repsText } = toRange(repsMin, repsMaxRaw);

		return createNodeFromRaw(
			match[1] ?? '',
			sanitizeNote(match[4] ?? null),
			{
				sets: null,
				repsMin: rangeMin,
				repsMax,
				repsText
			},
			Math.max(0.6, confidenceFloor - 0.1)
		);
	}

	for (const pattern of WORD_SERIES_PATTERNS) {
		const match = normalized.match(pattern);
		if (!match) continue;

		if (pattern === WORD_SERIES_PATTERNS[0]) {
			const setsWord = (match[1] ?? '').toLowerCase();
			const repsRaw = (match[2] ?? '').toLowerCase();
			const sets = WORD_NUMBER_MAP[setsWord] ?? Number.parseInt(setsWord, 10);
			const repsMin =
				WORD_NUMBER_MAP[repsRaw] ??
				(Number.isFinite(Number.parseInt(repsRaw, 10)) ? Number.parseInt(repsRaw, 10) : NaN);
			if (!Number.isFinite(sets) || !Number.isFinite(repsMin)) return null;

			return createNodeFromRaw(
				match[3] ?? '',
				null,
				{
					sets,
					repsMin,
					repsMax: null,
					repsText: `${repsMin}`
				},
				Math.max(0.55, confidenceFloor - 0.2)
			);
		}

		const setsRaw = (match[2] ?? '').toLowerCase();
		const repsMin = Number.parseInt(match[3] ?? '', 10);
		const sets = WORD_NUMBER_MAP[setsRaw] ?? Number.parseInt(setsRaw, 10);
		if (!Number.isFinite(sets) || !Number.isFinite(repsMin)) return null;

		return createNodeFromRaw(
			match[1] ?? '',
			sanitizeNote(match[4] ?? null),
			{
				sets,
				repsMin,
				repsMax: null,
				repsText: `${repsMin}`
			},
			Math.max(0.55, confidenceFloor - 0.2)
		);
	}
	return null;
};

type PrescriptionSpan = {
	start: number;
	end: number;
};

type CandidateLineSplit = {
	segments: ParsedLine[];
	linesWithPrescriptionDetected: number;
	splitAppliedCount: number;
	unresolvedMultiExerciseLine: boolean;
};

const collectPrescriptionSpans = (line: string): PrescriptionSpan[] => {
	const spans: PrescriptionSpan[] = [];
	for (const pattern of PRESCRIPTION_SPAN_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null = null;
		while ((match = regex.exec(line)) !== null) {
			const value = match[0] ?? '';
			if (!value) {
				if (regex.lastIndex === match.index) regex.lastIndex += 1;
				continue;
			}
			spans.push({ start: match.index, end: match.index + value.length });
			if (regex.lastIndex === match.index) regex.lastIndex += 1;
		}
	}

	if (spans.length === 0) return [];
	const sorted = spans
		.filter((span) => span.end > span.start)
		.sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));

	const merged: PrescriptionSpan[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (!last) {
			merged.push({ ...span });
			continue;
		}
		if (span.start <= last.end) {
			last.end = Math.max(last.end, span.end);
			continue;
		}
		merged.push({ ...span });
	}

	return merged;
};

const isPlausibleSegmentName = (segment: string): boolean => {
	const normalized = removeLineDecorators(normalizeLine(segment));
	if (!normalized) return false;
	const spans = collectPrescriptionSpans(normalized);
	if (spans.length === 0) return false;
	const prefix = sanitizeExerciseName(normalized.slice(0, spans[0].start));
	if (!prefix) return false;
	if (COMMENT_START_REGEX.test(prefix)) return false;

	const wordCount = countWords(prefix);
	if (wordCount >= 2) return true;
	if (wordCount === 1) return isSingleWordNameAccepted(prefix, true, false);
	return false;
};

const splitByPositions = (line: string, positions: number[]): string[] => {
	if (positions.length === 0) return [line];
	const uniqueSorted = Array.from(new Set(positions))
		.filter((position) => position > 0 && position < line.length)
		.sort((a, b) => a - b);
	if (uniqueSorted.length === 0) return [line];

	const chunks: string[] = [];
	let cursor = 0;
	for (const position of uniqueSorted) {
		const chunk = line.slice(cursor, position).trim();
		if (chunk) chunks.push(chunk);
		cursor = position;
	}
	const tail = line.slice(cursor).trim();
	if (tail) chunks.push(tail);
	return chunks;
};

const areValidSplitSegments = (segments: string[]): boolean => {
	if (segments.length < 2) return false;
	for (const segment of segments) {
		if (segment.length < STAGE_B_SEGMENT_MIN_LENGTH) return false;
		const spanCount = collectPrescriptionSpans(segment).length;
		if (spanCount < 1) return false;
		if (!isPlausibleSegmentName(segment)) return false;
	}
	return true;
};

const attemptStageASplit = (line: string): string[] | null => {
	const splitPositions: number[] = [];
	const regex = new RegExp(STAGE_A_LINE_SPLIT_REGEX.source, STAGE_A_LINE_SPLIT_REGEX.flags);
	let match: RegExpExecArray | null = null;
	while ((match = regex.exec(line)) !== null) {
		splitPositions.push(match.index + 1);
		if (regex.lastIndex === match.index) regex.lastIndex += 1;
	}
	if (splitPositions.length === 0) return null;

	const segments = splitByPositions(line, splitPositions);
	if (!areValidSplitSegments(segments)) return null;
	return segments;
};

const attemptStageBSplit = (line: string): string[] | null => {
	const spans = collectPrescriptionSpans(line);
	if (spans.length < 2) return null;

	const splitPositions: number[] = [];
	for (let i = 1; i < spans.length; i += 1) {
		const previous = spans[i - 1];
		const current = spans[i];
		if (current.start <= previous.end) continue;
		const between = line.slice(previous.end, current.start);
		if (!between.trim()) continue;

		const trailingNameMatch = between.match(
			/([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9]*){1,})\s*$/u
		);
		if (!trailingNameMatch || trailingNameMatch.index === undefined) continue;

		const splitPos = previous.end + trailingNameMatch.index;
		if (splitPos <= 0 || splitPos >= line.length) continue;
		splitPositions.push(splitPos);
	}

	if (splitPositions.length === 0) return null;

	const segments = splitByPositions(line, splitPositions);
	if (!areValidSplitSegments(segments)) return null;
	return segments;
};

const splitMultiExerciseLine = (sourceLine: ParsedLine): CandidateLineSplit => {
	const normalized = removeLineDecorators(normalizeLine(sourceLine.text));
	if (!normalized) {
		return {
			segments: [],
			linesWithPrescriptionDetected: 0,
			splitAppliedCount: 0,
			unresolvedMultiExerciseLine: false
		};
	}

	const spans = collectPrescriptionSpans(normalized);
	const hasPrescription = spans.length > 0;
	if (spans.length < 2) {
		return {
			segments: [{ ...sourceLine, text: normalized }],
			linesWithPrescriptionDetected: hasPrescription ? 1 : 0,
			splitAppliedCount: 0,
			unresolvedMultiExerciseLine: false
		};
	}

	const stageASegments = attemptStageASplit(normalized);
	if (stageASegments) {
		return {
			segments: stageASegments.map((segment) => ({ ...sourceLine, text: segment })),
			linesWithPrescriptionDetected: 1,
			splitAppliedCount: stageASegments.length - 1,
			unresolvedMultiExerciseLine: false
		};
	}

	const stageBSegments = attemptStageBSplit(normalized);
	if (stageBSegments) {
		return {
			segments: stageBSegments.map((segment) => ({ ...sourceLine, text: segment })),
			linesWithPrescriptionDetected: 1,
			splitAppliedCount: stageBSegments.length - 1,
			unresolvedMultiExerciseLine: false
		};
	}

	return {
		segments: [{ ...sourceLine, text: normalized }],
		linesWithPrescriptionDetected: 1,
		splitAppliedCount: 0,
		unresolvedMultiExerciseLine: true
	};
};

const createDay = (sourceLabel: string, mapped: string | null): ImportDraftDay => ({
	id: makeId(),
	source_label: sourceLabel,
	mapped_day_key: mapped,
	blocks: []
});

const ensureSingleBlock = (day: ImportDraftDay): ImportDraftBlock => {
	const existing = day.blocks[0];
	if (existing) return existing;
	const block: ImportDraftBlock = {
		id: makeId(),
		block_type: 'single',
		nodes: []
	};
	day.blocks.push(block);
	return block;
};

export const parseLinesToDraft = (lines: ParsedLine[], context: ParserContext): ImportDraft => {
	const degradeLayout = context.degradeConfidenceForLayout === true;
	const baseConfidence = degradeLayout ? 0.62 : 0.9;

	const days: ImportDraftDay[] = [];
	const fallbackDay = createDay('Día 1', 'monday');
	days.push(fallbackDay);
	let currentDay = fallbackDay;
	let lastNode: ImportDraftNode | null = null;

	let linesIn = 0;
	let candidateLines = 0;
	let parsedLines = 0;
	let requiredFieldsCompleted = 0;
	let linesWithPrescriptionDetected = 0;
	let multiExerciseSplitsApplied = 0;
	let unresolvedMultiExerciseLines = 0;

	for (const sourceLine of lines) {
		const normalized = removeLineDecorators(normalizeLine(sourceLine.text));
		if (!normalized) continue;

		const heading = normalized.match(DAY_HEADING_REGEX);
		if (heading) {
			const headingLabel = normalized;
			const headingToken = heading[1] ?? '';
			const mapped =
				mapSpanishWeekdayToKey(headingToken) ??
				mapIndexedDayLabelToKey(headingToken) ??
				(null as ImportDraftDay['mapped_day_key']);
			const nextDay = createDay(headingLabel, mapped);
			days.push(nextDay);
			currentDay = nextDay;
			lastNode = null;
			continue;
		}

		if (NOISE_LINE_REGEX.test(normalized)) {
			continue;
		}

		linesIn += 1;

		const splitResult = splitMultiExerciseLine(sourceLine);
		linesWithPrescriptionDetected += splitResult.linesWithPrescriptionDetected;
		multiExerciseSplitsApplied += splitResult.splitAppliedCount;
		if (splitResult.unresolvedMultiExerciseLine) {
			unresolvedMultiExerciseLines += 1;
		}

		for (const splitLine of splitResult.segments) {
			const splitNormalized = splitLine.text;
			candidateLines += 1;

			const parsedNode = parseExerciseLine(splitLine, baseConfidence);
			if (parsedNode) {
				const block = ensureSingleBlock(currentDay);
				block.nodes.push(parsedNode);
				lastNode = parsedNode;
				parsedLines += 1;
				if (
					parsedNode.raw_exercise_name &&
					parsedNode.sets &&
					parsedNode.reps_min &&
					parsedNode.reps_text
				) {
					requiredFieldsCompleted += 1;
				}
				continue;
			}

			if (lastNode && isLikelyNoteLine(splitNormalized)) {
				lastNode.note = mergeNotes(lastNode.note, splitNormalized);
				if (lastNode.note) {
					lastNode.field_meta.note = {
						confidence: toConfidence(Math.max(0.4, baseConfidence - 0.25)),
						provenance: makeProvenance(sourceLine.text, sourceLine.lineIndex, sourceLine.sourcePage)
					};
				}
				continue;
			}

			if (lastNode && isLikelyNoteContinuationLine(splitNormalized, Boolean(lastNode.note))) {
				lastNode.note = appendNoteContinuation(lastNode.note, splitNormalized);
				if (lastNode.note) {
					lastNode.field_meta.note = {
						confidence: toConfidence(Math.max(0.4, baseConfidence - 0.25)),
						provenance: makeProvenance(sourceLine.text, sourceLine.lineIndex, sourceLine.sourcePage)
					};
				}
			}
		}
	}

	const compactDays = days.filter((day) => day.blocks.some((block) => block.nodes.length > 0));
	const effectiveDays = compactDays.length > 0 ? compactDays : [fallbackDay];
	const exercisesParsed = effectiveDays.reduce(
		(acc, day) => acc + day.blocks.reduce((sum, block) => sum + block.nodes.length, 0),
		0
	);
	const parseableRatio = candidateLines > 0 ? parsedLines / candidateLines : 0;
	const requiredFieldsRatio = parsedLines > 0 ? requiredFieldsCompleted / parsedLines : 0;

	return {
		version: IMPORT_DRAFT_VERSION,
		source_type: context.sourceType,
		parser_version: context.parserVersion,
		ruleset_version: context.rulesetVersion,
		extractor_version: context.extractorVersion,
		coverage: {
			days_detected: effectiveDays.length,
			exercises_parsed: exercisesParsed,
			candidate_lines: candidateLines,
			parsed_lines: parsedLines,
			parseable_ratio: parseableRatio,
			required_fields_ratio: requiredFieldsRatio,
			lines_in: linesIn,
			lines_after_split: candidateLines,
			lines_with_prescription_detected: linesWithPrescriptionDetected,
			exercise_nodes_out: exercisesParsed,
			multi_exercise_splits_applied: multiExerciseSplitsApplied,
			unresolved_multi_exercise_lines: unresolvedMultiExerciseLines
		},
		days: effectiveDays
	};
};
