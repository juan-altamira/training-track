import type { ImportInferenceReason, ImportShapeV1 } from '$lib/import/types';
import { dedupeStructuralRefs, getStructuralEndToken, type StructuralTokenRef } from './structural-tokens';
import {
	isAmrapKeyword,
	isCommaConnector,
	isRangeConnector,
	isRepsKeyword,
	isSeparatorX,
	isSeriesKeyword,
	parseIntToken,
	tokenizeLine,
	type LineToken,
	trimSpan
} from './tokens';

export type ContractCandidate = {
	matcherId: string;
	priority: number;
	score: number;
	rawExerciseName: string;
	nameSpanStart: number;
	nameSpanEnd: number;
	structureEndOffset: number;
	noteStartOffset: number;
	parsedShape: ImportShapeV1;
	structTokensUsed: StructuralTokenRef[];
};

type BuildCandidateInput = {
	matcherId: string;
	priority: number;
	rawExerciseName: string;
	nameSpanStart: number;
	nameSpanEnd: number;
	structTokensUsed: StructuralTokenRef[];
	parsedShape: ImportShapeV1;
	tokens: LineToken[];
	forceStructureEndOffset?: number;
	forceNoteStartOffset?: number;
};

const sanitizeExerciseName = (raw: string) => {
	let value = raw
		.replace(/^[\s•●▪◦·*+\-:/.()]+/, '')
		.replace(/[\s•●▪◦·*+\-:/.()]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	while (/\s*(?:[-–—/]+)?\s*(?:aca|acá|ahi|ahí|hace|hacete|metele|mandale|dale|arranca|empeza)\s*$/iu.test(value)) {
		value = value
			.replace(/\s*(?:[-–—/]+)?\s*(?:aca|acá|ahi|ahí|hace|hacete|metele|mandale|dale|arranca|empeza)\s*$/iu, '')
			.trim();
	}
	return value;
};

const normalizeWord = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

const SPANISH_NUMBER_WORDS: Record<string, number> = {
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
	quince: 15
};

const narrativePrefixes: string[][] = [
	['hoy', 'arrancamos', 'con'],
	['arrancamos', 'con'],
	['hoy', 'empezamos', 'con'],
	['empezamos', 'con'],
	['hoy', 'hacemos'],
	['hacemos'],
	['hoy', 'metemos'],
	['metemos'],
	['hoy', 'le', 'damos', 'a'],
	['le', 'damos', 'a'],
	['vamos', 'con'],
	['seguimos', 'con'],
	['pasamos', 'a'],
	['cerramos', 'con'],
	['terminamos', 'con'],
	['finalizamos', 'con'],
	['arranca', 'con'],
	['arranca'],
	['empeza', 'con'],
	['empeza'],
	['metele', 'a'],
	['metele'],
	['hace'],
	['mandale', 'a'],
	['mandale'],
	['dale', 'con'],
	['dale', 'a'],
	['anda', 'con'],
	['ejecuta'],
	['ejecuta', 'con'],
	['hacete'],
	['hacete', 'con'],
	['despues'],
	['despues', 'hacemos']
];

const withHeuristic = (shape: ImportShapeV1, reason: ImportInferenceReason): ImportShapeV1 => {
	const existing = shape.inference_reasons ?? [];
	const reasons = existing.includes(reason) ? existing : [...existing, reason];
	return {
		...shape,
		evidence: 'heuristic',
		inference_reasons: reasons
	};
};

const computeScore = (name: string, refs: StructuralTokenRef[], priority: number) => {
	const words = name.split(/\s+/).filter(Boolean).length;
	return priority * 100 + refs.length * 10 + Math.min(words, 6);
};

const buildCandidate = (input: BuildCandidateInput): ContractCandidate | null => {
	const structTokensUsed = dedupeStructuralRefs(input.structTokensUsed);
	const endToken = getStructuralEndToken(input.tokens, structTokensUsed);
	if (!endToken && input.forceStructureEndOffset == null) return null;
	const span = trimSpan(input.rawExerciseName, input.nameSpanStart, input.nameSpanEnd);
	if (span.end <= span.start) return null;
	const name = sanitizeExerciseName(input.rawExerciseName.slice(span.start, span.end));
	if (!name) return null;
	const fullLength = input.rawExerciseName.length;
	const structureEndOffset = input.forceStructureEndOffset ?? endToken?.endOffset ?? 0;
	const noteStartOffset = input.forceNoteStartOffset ?? structureEndOffset;
	if (
		span.start < 0 ||
		span.end < 0 ||
		span.start > span.end ||
		span.end > fullLength ||
		structureEndOffset < span.end ||
		structureEndOffset > fullLength ||
		noteStartOffset < span.end ||
		noteStartOffset > fullLength
	) {
		return null;
	}
	return {
		matcherId: input.matcherId,
		priority: input.priority,
		score: computeScore(name, structTokensUsed, input.priority),
		rawExerciseName: name,
		nameSpanStart: span.start,
		nameSpanEnd: span.end,
		structureEndOffset,
		noteStartOffset,
		parsedShape: input.parsedShape,
		structTokensUsed
	};
};

const parseFlexibleIntToken = (token: LineToken | undefined): number | null => {
	const parsed = parseIntToken(token);
	if (parsed !== null) return parsed;
	if (!token || token.type !== 'word') return null;
	return SPANISH_NUMBER_WORDS[token.normalized] ?? null;
};

const isWrapperSymbol = (token: LineToken | undefined) =>
	token?.type === 'symbol' && ['(', ')', '[', ']', '{', '}', '/', '\\'].includes(token.normalized);

const skipWrapperTokens = (tokens: LineToken[], index: number) => {
	let next = index;
	while (isWrapperSymbol(tokens[next])) next += 1;
	return next;
};

const findFirstMeaningfulTokenIndex = (tokens: LineToken[]) => {
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token) break;
		if (token.type === 'symbol' && ['•', '●', '▪', '◦', '-', '+', '*', '.', ')', '('].includes(token.raw)) {
			index += 1;
			continue;
		}
		if (
			token.type === 'number' &&
			tokens[index + 1]?.type === 'symbol' &&
			(tokens[index + 1]?.normalized === '.' || tokens[index + 1]?.normalized === ')')
		) {
			index += 2;
			continue;
		}
		break;
	}
	return index;
};

const applyNarrativePrefixRemoval = (rawLine: string, tokens: LineToken[]) => {
	const start = findFirstMeaningfulTokenIndex(tokens);
	let cursor = start;
	let applied = false;

	for (const prefix of narrativePrefixes) {
		let local = cursor;
		let matches = true;
		for (const expected of prefix) {
			const token = tokens[local];
			if (!token || token.type !== 'word' || normalizeWord(token.raw) !== normalizeWord(expected)) {
				matches = false;
				break;
			}
			local += 1;
		}
		if (matches) {
			const maybeSeparator = tokens[local];
			if (maybeSeparator?.type === 'symbol' && (maybeSeparator.normalized === ':' || maybeSeparator.normalized === '-')) {
				local += 1;
			}
			cursor = local;
			applied = true;
			break;
		}
	}

	const offset = tokens[cursor]?.startOffset ?? 0;
	return {
		line: rawLine.slice(offset),
		offset,
		inferenceReasons: applied ? (['narrative_prefix_removed'] as ImportInferenceReason[]) : []
	};
};

const attachInferences = (
	shape: ImportShapeV1,
	reasons: ImportInferenceReason[]
): ImportShapeV1 => {
	let next = shape;
	for (const reason of reasons) {
		next = withHeuristic(next, reason);
	}
	return next;
};

const matchClassicSetsReps = (
	rawLine: string,
	tokens: LineToken[]
): ContractCandidate | null => {
	for (let i = 0; i < tokens.length - 2; i += 1) {
		const setToken = tokens[i];
		const sepToken = tokens[i + 1];
		const repToken = tokens[i + 2];
		if (!setToken || !sepToken || !repToken) continue;
		if (setToken.type !== 'number') continue;
		if (!isSeparatorX(sepToken)) continue;

		let sets = parseIntToken(setToken);
		if (!sets || sets <= 0) continue;

		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = setToken.startOffset;
		if (nameEnd <= nameStart) continue;

		let structRefs: StructuralTokenRef[] = [
			{ tokenIndex: i, role: 'sets' },
			{ tokenIndex: i + 1, role: 'keyword' }
		];

		if (isAmrapKeyword(repToken)) {
			structRefs.push({ tokenIndex: i + 2, role: 'keyword' });
			const shape: ImportShapeV1 = {
				version: 1,
				kind: 'amrap',
				sets,
				evidence: 'explicit'
			};
			return buildCandidate({
				matcherId: 'classic_sets_amrap',
				priority: 100,
				rawExerciseName: rawLine,
				nameSpanStart: nameStart,
				nameSpanEnd: nameEnd,
				structTokensUsed: structRefs,
				parsedShape: shape,
				tokens
			});
		}

		const reps = parseIntToken(repToken);
		if (!reps || reps <= 0) continue;

		let repsMin = reps;
		let repsMax: number | null = null;
		let matcherId = 'classic_sets_reps';
		let shape: ImportShapeV1;

		structRefs.push({ tokenIndex: i + 2, role: 'reps_min' });

		if (isRangeConnector(tokens[i + 3]) && tokens[i + 4]?.type === 'number') {
			const maxCandidate = parseIntToken(tokens[i + 4]);
			if (maxCandidate && maxCandidate >= reps) {
				repsMin = Math.min(reps, maxCandidate);
				repsMax = Math.max(reps, maxCandidate);
				structRefs.push({ tokenIndex: i + 3, role: 'keyword' });
				structRefs.push({ tokenIndex: i + 4, role: 'reps_max' });
				let trailing = i + 5;
				if (isRepsKeyword(tokens[trailing])) {
					structRefs.push({ tokenIndex: trailing, role: 'keyword' });
					trailing += 1;
				}
				while (isWrapperSymbol(tokens[trailing])) {
					structRefs.push({ tokenIndex: trailing, role: 'keyword' });
					trailing += 1;
				}
				matcherId = 'classic_sets_range';
				shape = {
					version: 1,
					kind: 'range',
					sets,
					reps_min: repsMin,
					reps_max: repsMax,
					evidence: 'explicit'
				};
				return buildCandidate({
					matcherId,
					priority: 100,
					rawExerciseName: rawLine,
					nameSpanStart: nameStart,
					nameSpanEnd: nameEnd,
					structTokensUsed: structRefs,
					parsedShape: shape,
					tokens
				});
			}
		}

		shape = {
			version: 1,
			kind: 'fixed',
			sets,
			reps_min: reps,
			reps_max: null,
			evidence: 'explicit'
		};
		if (sets > 8 && reps <= 8) {
			shape = withHeuristic(
				{
					version: 1,
					kind: 'fixed',
					sets: reps,
					reps_min: sets,
					reps_max: null,
					evidence: 'explicit'
				},
				'reps_x_series_reordered'
			);
			matcherId = 'classic_reordered_reps_x_sets';
		}

		const candidate = buildCandidate({
			matcherId,
			priority: 100,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			structTokensUsed: structRefs,
			parsedShape: shape,
			tokens
		});
		if (candidate) return candidate;
	}
	return null;
};

const matchXPrefixCompact = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	for (let i = 0; i < tokens.length - 2; i += 1) {
		if (!isSeparatorX(tokens[i])) continue;
		const sets = parseIntToken(tokens[i + 1]);
		const reps = parseIntToken(tokens[i + 2]);
		if (!sets || !reps) continue;
		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = tokens[i].startOffset;
		if (nameEnd <= nameStart) continue;
		return buildCandidate({
			matcherId: 'x_prefix_compact',
			priority: 96,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			structTokensUsed: [
				{ tokenIndex: i, role: 'keyword' },
				{ tokenIndex: i + 1, role: 'sets' },
				{ tokenIndex: i + 2, role: 'reps_min' }
			],
			parsedShape: {
				version: 1,
				kind: 'fixed',
				sets,
				reps_min: reps,
				reps_max: null,
				evidence: 'explicit'
			},
			tokens
		});
	}
	return null;
};

const matchSeriesWording = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	for (let i = 1; i < tokens.length - 2; i += 1) {
		const sets = parseFlexibleIntToken(tokens[i - 1]);
		if (!sets) continue;
		if (!isSeriesKeyword(tokens[i])) continue;
		let repsTokenIndex = i + 1;
		if (tokens[repsTokenIndex]?.type === 'word' && ['de', 'x', 'por'].includes(tokens[repsTokenIndex]?.normalized ?? '')) {
			repsTokenIndex += 1;
		}
		const reps = parseFlexibleIntToken(tokens[repsTokenIndex]);
		if (!reps) continue;
		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = tokens[i - 1]?.startOffset ?? 0;
		if (nameEnd <= nameStart) continue;
		const structRefs: StructuralTokenRef[] = [
			{ tokenIndex: i - 1, role: 'sets' },
			{ tokenIndex: i, role: 'keyword' },
			{ tokenIndex: repsTokenIndex, role: 'reps_min' }
		];
		let afterRepsIndex = repsTokenIndex + 1;
		if (isRepsKeyword(tokens[afterRepsIndex])) {
			structRefs.push({ tokenIndex: afterRepsIndex, role: 'keyword' });
			afterRepsIndex += 1;
		}
		if (isRangeConnector(tokens[afterRepsIndex])) {
			const maxCandidate = parseFlexibleIntToken(tokens[afterRepsIndex + 1]);
			if (maxCandidate && maxCandidate >= reps) {
				structRefs.push({ tokenIndex: afterRepsIndex, role: 'keyword' });
				structRefs.push({ tokenIndex: afterRepsIndex + 1, role: 'reps_max' });
				let trailing = afterRepsIndex + 2;
				if (isRepsKeyword(tokens[trailing])) {
					structRefs.push({ tokenIndex: trailing, role: 'keyword' });
					trailing += 1;
				}
				return buildCandidate({
					matcherId: 'series_wording_range',
					priority: 92,
					rawExerciseName: rawLine,
					nameSpanStart: nameStart,
					nameSpanEnd: nameEnd,
					structTokensUsed: structRefs,
					parsedShape: {
						version: 1,
						kind: 'range',
						sets,
						reps_min: Math.min(reps, maxCandidate),
						reps_max: Math.max(reps, maxCandidate),
						evidence: 'explicit'
					},
					tokens
				});
			}
		}
		return buildCandidate({
			matcherId: 'series_wording',
			priority: 92,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			structTokensUsed: structRefs,
			parsedShape: {
				version: 1,
				kind: 'fixed',
				sets,
				reps_min: reps,
				reps_max: null,
				evidence: 'explicit'
			},
			tokens
		});
	}
	return null;
};

const matchRepsBySetsWording = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	for (let i = 0; i < tokens.length - 4; i += 1) {
		const reps = parseIntToken(tokens[i]);
		if (!reps) continue;
		if (!isRepsKeyword(tokens[i + 1])) continue;
		if (!isSeparatorX(tokens[i + 2]) && tokens[i + 2]?.normalized !== 'por') continue;
		const sets = parseIntToken(tokens[i + 3]);
		if (!sets) continue;
		if (!isSeriesKeyword(tokens[i + 4])) continue;
		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = tokens[i]?.startOffset ?? 0;
		if (nameEnd <= nameStart) continue;
		return buildCandidate({
			matcherId: 'reps_x_sets_wording',
			priority: 90,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			structTokensUsed: [
				{ tokenIndex: i, role: 'reps_min' },
				{ tokenIndex: i + 1, role: 'keyword' },
				{ tokenIndex: i + 2, role: 'keyword' },
				{ tokenIndex: i + 3, role: 'sets' },
				{ tokenIndex: i + 4, role: 'keyword' }
			],
			parsedShape: {
				version: 1,
				kind: 'fixed',
				sets,
				reps_min: reps,
				reps_max: null,
				evidence: 'explicit'
			},
			tokens
		});
	}
	return null;
};

const matchRepsBySetsCompactWording = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	for (let i = 0; i < tokens.length - 3; i += 1) {
		const reps = parseIntToken(tokens[i]);
		if (!reps) continue;
		if (!isRepsKeyword(tokens[i + 1])) continue;
		if (!isSeparatorX(tokens[i + 2]) && tokens[i + 2]?.normalized !== 'por') continue;
		const sets = parseIntToken(tokens[i + 3]);
		if (!sets) continue;
		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = tokens[i]?.startOffset ?? 0;
		if (nameEnd <= nameStart) continue;
		return buildCandidate({
			matcherId: 'reps_x_sets_compact_wording',
			priority: 89,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			structTokensUsed: [
				{ tokenIndex: i, role: 'reps_min' },
				{ tokenIndex: i + 1, role: 'keyword' },
				{ tokenIndex: i + 2, role: 'keyword' },
				{ tokenIndex: i + 3, role: 'sets' }
			],
			parsedShape: {
				version: 1,
				kind: 'fixed',
				sets,
				reps_min: reps,
				reps_max: null,
				evidence: 'explicit'
			},
			tokens
		});
	}
	return null;
};

const matchSetsFirstNameAfter = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	if (tokens.length < 4) return null;
	const startIndex = findFirstMeaningfulTokenIndex(tokens);
	const sets = parseFlexibleIntToken(tokens[startIndex]);
	if (!sets) return null;
	if (!isSeriesKeyword(tokens[startIndex + 1]) && !isSeparatorX(tokens[startIndex + 1])) return null;
	let repsIndex = startIndex + 2;
	if (tokens[repsIndex]?.type === 'word' && ['de', 'x', 'por'].includes(tokens[repsIndex]?.normalized ?? '')) {
		repsIndex += 1;
	}
	if (isSeparatorX(tokens[repsIndex])) repsIndex += 1;
	const reps = parseFlexibleIntToken(tokens[repsIndex]);
	if (!reps) return null;
	let nameIndex = skipWrapperTokens(tokens, repsIndex + 1);
	if (isRepsKeyword(tokens[nameIndex])) nameIndex += 1;
	if (tokens[nameIndex]?.type === 'word' && ['de', 'en'].includes(tokens[nameIndex]?.normalized ?? '')) {
		nameIndex += 1;
	}
	nameIndex = skipWrapperTokens(tokens, nameIndex);
	const nameStart = tokens[nameIndex]?.startOffset ?? -1;
	const nameEnd = tokens[tokens.length - 1]?.endOffset ?? -1;
	if (nameStart < 0 || nameEnd <= nameStart) return null;
	return buildCandidate({
		matcherId: 'sets_first_name_after',
		priority: 89,
		rawExerciseName: rawLine,
		nameSpanStart: nameStart,
		nameSpanEnd: nameEnd,
		forceStructureEndOffset: rawLine.length,
		forceNoteStartOffset: rawLine.length,
		structTokensUsed: [
			{ tokenIndex: startIndex, role: 'sets' },
			{ tokenIndex: repsIndex, role: 'reps_min' }
		],
		parsedShape: {
			version: 1,
			kind: 'fixed',
			sets,
			reps_min: reps,
			reps_max: null,
			evidence: 'explicit'
		},
		tokens
	});
};

const matchNameThenSetsOfReps = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	for (let i = 0; i < tokens.length - 3; i += 1) {
		const sets = parseFlexibleIntToken(tokens[i]);
		if (!sets) continue;
		let repsIndex = i + 1;
		if (tokens[repsIndex]?.type === 'word' && tokens[repsIndex]?.normalized === 'de') {
			repsIndex += 1;
		}
		const reps = parseFlexibleIntToken(tokens[repsIndex]);
		if (!reps) continue;
		if (!isRepsKeyword(tokens[repsIndex + 1])) continue;
		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = tokens[i]?.startOffset ?? 0;
		if (nameEnd <= nameStart) continue;
		return buildCandidate({
			matcherId: 'name_then_sets_of_reps',
			priority: 74,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			forceStructureEndOffset: rawLine.length,
			forceNoteStartOffset: rawLine.length,
			structTokensUsed: [
				{ tokenIndex: i, role: 'sets' },
				{ tokenIndex: repsIndex, role: 'reps_min' },
				{ tokenIndex: repsIndex + 1, role: 'keyword' }
			],
			parsedShape: {
				version: 1,
				kind: 'fixed',
				sets,
				reps_min: reps,
				reps_max: null,
				evidence: 'heuristic'
			},
			tokens
		});
	}
	return null;
};

const matchSchemeFromNumberRuns = (rawLine: string, tokens: LineToken[]): ContractCandidate | null => {
	const hasSeparatorXInLine = tokens.some((token, index) => token.type === 'number' && isSeparatorX(tokens[index + 1]));
	if (hasSeparatorXInLine) return null;

	for (let start = 0; start < tokens.length; start += 1) {
		const startToken = tokens[start];
		if (!startToken || startToken.type !== 'number') continue;
		const nameStart = tokens[0]?.startOffset ?? 0;
		const nameEnd = startToken.startOffset;
		if (nameEnd <= nameStart) continue;

		const preface = rawLine.slice(nameStart, nameEnd).toLowerCase();
		if (preface.includes('tempo')) continue;

		let index = start;
		const numberIndexes: number[] = [];
		let sawDelimitedConnector = false;
		while (index < tokens.length) {
			const token = tokens[index];
			if (!token) break;
			if (token.type === 'number') {
				numberIndexes.push(index);
				index += 1;
				continue;
			}
			if (token.type === 'symbol' && (token.normalized === ',' || token.normalized === '-')) {
				sawDelimitedConnector = true;
				index += 1;
				continue;
			}
			break;
		}

		if (numberIndexes.length < 2) continue;
		const repsList = numberIndexes
			.map((idx) => parseIntToken(tokens[idx]))
			.filter((value): value is number => value !== null && value > 0);
		if (repsList.length < 2) continue;

		let shape: ImportShapeV1 = {
			version: 1,
			kind: 'scheme',
			sets: repsList.length,
			reps_list: repsList,
			evidence: 'explicit'
		};
		if (repsList.length === 2 && sawDelimitedConnector) {
			shape = withHeuristic(shape, 'dash_series_assumed');
		}

		return buildCandidate({
			matcherId: 'scheme_number_run',
			priority: 75,
			rawExerciseName: rawLine,
			nameSpanStart: nameStart,
			nameSpanEnd: nameEnd,
			structTokensUsed: numberIndexes.map((idx) => ({ tokenIndex: idx, role: 'reps' })),
			parsedShape: shape,
			tokens
		});
	}
	return null;
};

const allMatchers = [
	matchClassicSetsReps,
	matchXPrefixCompact,
	matchSeriesWording,
	matchRepsBySetsWording,
	matchRepsBySetsCompactWording,
	matchSetsFirstNameAfter,
	matchNameThenSetsOfReps,
	matchSchemeFromNumberRuns
] as const;

const collectCandidates = (
	rawLine: string,
	tokens: LineToken[],
	offset = 0,
	inferenceReasons: ImportInferenceReason[] = []
) => {
	const candidates: ContractCandidate[] = [];
	for (const matcher of allMatchers) {
		const candidate = matcher(rawLine, tokens);
		if (!candidate) continue;
		const parsedShape = attachInferences(candidate.parsedShape, inferenceReasons);
		candidates.push({
			...candidate,
			parsedShape,
			nameSpanStart: candidate.nameSpanStart + offset,
			nameSpanEnd: candidate.nameSpanEnd + offset,
			structureEndOffset: candidate.structureEndOffset + offset,
			noteStartOffset: candidate.noteStartOffset + offset
		});
	}
	return candidates;
};

export type ContractParseResult = {
	candidate: ContractCandidate | null;
	tokens: LineToken[];
};

export const parseContractCandidate = (rawLine: string): ContractParseResult => {
	const raw = rawLine.trim();
	const tokens = tokenizeLine(raw);
	if (!raw || tokens.length === 0) return { candidate: null, tokens };

	const candidates: ContractCandidate[] = collectCandidates(raw, tokens);
	const prefix = applyNarrativePrefixRemoval(raw, tokens);
	const workingLine = prefix.line.trim();
	if (prefix.offset > 0 && workingLine.length > 0) {
		const workingTokens = tokenizeLine(workingLine);
		if (workingTokens.length > 0) {
			candidates.push(
				...collectCandidates(workingLine, workingTokens, prefix.offset, prefix.inferenceReasons)
			);
		}
	}

	if (candidates.length === 0) {
		return { candidate: null, tokens };
	}

	candidates.sort((a, b) => {
		if (a.priority !== b.priority) return b.priority - a.priority;
		if (a.structureEndOffset !== b.structureEndOffset) return b.structureEndOffset - a.structureEndOffset;
		if (a.rawExerciseName.length !== b.rawExerciseName.length) {
			return a.rawExerciseName.length - b.rawExerciseName.length;
		}
		if (a.score !== b.score) return b.score - a.score;
		return 0;
	});

	return {
		candidate: candidates[0] ?? null,
		tokens
	};
};

export type LadderEntry = {
	weight: number;
	reps: number;
	unit: 'kg' | 'lb' | null;
};

export const parseLadderEntries = (rawLine: string): LadderEntry[] => {
	const tokens = tokenizeLine(rawLine);
	const entries: LadderEntry[] = [];
	let i = 0;
	while (i < tokens.length - 2) {
		const weight = Number.parseFloat(tokens[i]?.normalized ?? '');
		if (!Number.isFinite(weight) || weight <= 0) {
			i += 1;
			continue;
		}
		let unit: 'kg' | 'lb' | null = null;
		let separatorIndex = i + 1;
		const maybeUnit = tokens[separatorIndex];
		if (maybeUnit?.type === 'word') {
			if (maybeUnit.normalized === 'kg') {
				unit = 'kg';
				separatorIndex += 1;
			} else if (maybeUnit.normalized === 'lb' || maybeUnit.normalized === 'lbs') {
				unit = 'lb';
				separatorIndex += 1;
			}
		}
		if (!isSeparatorX(tokens[separatorIndex])) {
			i += 1;
			continue;
		}
		const reps = parseIntToken(tokens[separatorIndex + 1]);
		if (!reps || reps <= 0) {
			i += 1;
			continue;
		}
		entries.push({ weight, reps, unit });
		i = separatorIndex + 2;
		if (isCommaConnector(tokens[i])) i += 1;
	}
	return entries;
};

export type CircuitParsedEntry = {
	name: string;
	shape: ImportShapeV1;
};

export const parseCircuitEntry = (rawSegment: string): CircuitParsedEntry | null => {
	const trimmed = rawSegment.trim();
	if (!trimmed) return null;
	const cleaned = trimmed.replace(/^(?:[-–—*•·‣▪︎]+|\d{1,2}[.)])\s*/u, '').trim();
	if (!cleaned) return null;
	const contract = parseContractCandidate(cleaned);
	if (contract.candidate) {
		const kind = contract.candidate.parsedShape.kind;
		if (kind === 'fixed' || kind === 'range' || kind === 'amrap') {
			return {
				name: contract.candidate.rawExerciseName,
				shape: contract.candidate.parsedShape
			};
		}
	}

	const nameFirst = cleaned.match(/^(.+?)\s+(\d{1,3})$/u);
	if (nameFirst) {
		const reps = Number.parseInt(nameFirst[2] ?? '', 10);
		if (Number.isFinite(reps) && reps > 0) {
			const name = sanitizeExerciseName(nameFirst[1] ?? '');
			if (name) {
				return {
					name,
					shape: {
						version: 1,
						kind: 'fixed',
						sets: 1,
						reps_min: reps,
						reps_max: null,
						evidence: 'heuristic',
						inference_reasons: ['circuit_grouped']
					}
				};
			}
		}
	}

	const implicit = cleaned.match(/^(\d{1,3})(?:\s+)(.+)$/u);
	if (!implicit) return null;
	const reps = Number.parseInt(implicit[1] ?? '', 10);
	if (!Number.isFinite(reps) || reps <= 0) return null;
	const suffix = (implicit[2] ?? '').trim();
	if (!suffix) return null;
	if (/^(?:s|seg|sec|min|mins|m)\b/i.test(suffix)) return null;
	if (/^\d{1,2}:\d{2}\b/.test(cleaned)) return null;
	const name = sanitizeExerciseName(suffix);
	if (!name) return null;
	return {
		name,
		shape: {
			version: 1,
			kind: 'fixed',
			sets: 1,
			reps_min: reps,
			reps_max: null,
			evidence: 'heuristic',
			inference_reasons: ['circuit_grouped']
		}
	};
};

export const splitCircuitSegments = (rawLine: string): string[] => {
	const byComma = rawLine
		.split(',')
		.map((segment) => segment.trim())
		.filter(Boolean);
	const segments: string[] = [];
	for (const segment of byComma) {
		if (/\b y \b/i.test(segment)) {
			const pieces = segment
				.split(/\b y \b/i)
				.map((piece) => piece.trim())
				.filter(Boolean);
			if (pieces.length > 1) {
				segments.push(
					...pieces.map((piece) => piece.replace(/^(?:[-–—*•·‣▪︎]+|\d{1,2}[.)])\s*/u, '').trim())
				);
				continue;
			}
		}
		segments.push(segment.replace(/^(?:[-–—*•·‣▪︎]+|\d{1,2}[.)])\s*/u, '').trim());
	}
	return segments.filter(Boolean);
};
