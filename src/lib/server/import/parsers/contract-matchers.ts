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
};

const sanitizeExerciseName = (raw: string) =>
	raw
		.replace(/^[\s•●▪◦·*+\-:/.()]+/, '')
		.replace(/[\s•●▪◦·*+\-:/.()]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();

const normalizeWord = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

const narrativePrefixes: string[][] = [
	['hoy', 'hacemos'],
	['despues'],
	['después'],
	['finalizamos', 'con'],
	['despues', 'hacemos'],
	['después', 'hacemos']
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
	if (!endToken) return null;
	const span = trimSpan(input.rawExerciseName, input.nameSpanStart, input.nameSpanEnd);
	if (span.end <= span.start) return null;
	const name = sanitizeExerciseName(input.rawExerciseName.slice(span.start, span.end));
	if (!name) return null;
	const fullLength = input.rawExerciseName.length;
	if (
		span.start < 0 ||
		span.end < 0 ||
		span.start > span.end ||
		span.end > fullLength ||
		endToken.endOffset < span.end ||
		endToken.endOffset > fullLength
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
		structureEndOffset: endToken.endOffset,
		noteStartOffset: endToken.endOffset,
		parsedShape: input.parsedShape,
		structTokensUsed
	};
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
		const sets = parseIntToken(tokens[i - 1]);
		if (!sets) continue;
		if (!isSeriesKeyword(tokens[i])) continue;
		let repsTokenIndex = i + 1;
		if (tokens[repsTokenIndex]?.type === 'word' && ['de', 'x', 'por'].includes(tokens[repsTokenIndex]?.normalized ?? '')) {
			repsTokenIndex += 1;
		}
		const reps = parseIntToken(tokens[repsTokenIndex]);
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
		if (isRangeConnector(tokens[afterRepsIndex]) && tokens[afterRepsIndex + 1]?.type === 'number') {
			const maxCandidate = parseIntToken(tokens[afterRepsIndex + 1]);
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
	const sets = parseIntToken(tokens[0]);
	if (!sets) return null;
	if (!isSeriesKeyword(tokens[1]) && !isSeparatorX(tokens[1])) return null;
	let repsIndex = 2;
	if (tokens[repsIndex]?.type === 'word' && ['de', 'x', 'por'].includes(tokens[repsIndex]?.normalized ?? '')) {
		repsIndex += 1;
	}
	const reps = parseIntToken(tokens[repsIndex]);
	if (!reps) return null;
	let nameIndex = repsIndex + 1;
	if (isRepsKeyword(tokens[nameIndex])) nameIndex += 1;
	if (tokens[nameIndex]?.type === 'word' && ['de', 'en'].includes(tokens[nameIndex]?.normalized ?? '')) {
		nameIndex += 1;
	}
	const nameStart = tokens[nameIndex]?.startOffset ?? -1;
	const nameEnd = tokens[tokens.length - 1]?.endOffset ?? -1;
	if (nameStart < 0 || nameEnd <= nameStart) return null;
	return buildCandidate({
		matcherId: 'sets_first_name_after',
		priority: 89,
		rawExerciseName: rawLine,
		nameSpanStart: nameStart,
		nameSpanEnd: nameEnd,
		structTokensUsed: [
			{ tokenIndex: 0, role: 'sets' },
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
	matchSchemeFromNumberRuns
] as const;

export type ContractParseResult = {
	candidate: ContractCandidate | null;
	tokens: LineToken[];
};

export const parseContractCandidate = (rawLine: string): ContractParseResult => {
	const raw = rawLine.trim();
	const tokens = tokenizeLine(raw);
	if (!raw || tokens.length === 0) return { candidate: null, tokens };

	const prefix = applyNarrativePrefixRemoval(raw, tokens);
	const workingLine = prefix.line.trim();
	const workingTokens = tokenizeLine(workingLine);
	if (!workingLine || workingTokens.length === 0) return { candidate: null, tokens };

	const candidates: ContractCandidate[] = [];
	for (const matcher of allMatchers) {
		const candidate = matcher(workingLine, workingTokens);
		if (!candidate) continue;
		let nextShape = candidate.parsedShape;
		nextShape = attachInferences(nextShape, prefix.inferenceReasons);
		candidates.push({
			...candidate,
			parsedShape: nextShape,
			nameSpanStart: candidate.nameSpanStart + prefix.offset,
			nameSpanEnd: candidate.nameSpanEnd + prefix.offset,
			structureEndOffset: candidate.structureEndOffset + prefix.offset,
			noteStartOffset: candidate.noteStartOffset + prefix.offset
		});
	}

	if (candidates.length === 0) {
		return { candidate: null, tokens };
	}

	candidates.sort((a, b) => {
		if (a.priority !== b.priority) return b.priority - a.priority;
		if (a.score !== b.score) return b.score - a.score;
		return b.structureEndOffset - a.structureEndOffset;
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
	const contract = parseContractCandidate(trimmed);
	if (contract.candidate) {
		const kind = contract.candidate.parsedShape.kind;
		if (kind === 'fixed' || kind === 'range' || kind === 'amrap') {
			return {
				name: contract.candidate.rawExerciseName,
				shape: contract.candidate.parsedShape
			};
		}
	}

	const implicit = trimmed.match(/^(\d{1,3})(?:\s+)(.+)$/u);
	if (!implicit) return null;
	const reps = Number.parseInt(implicit[1] ?? '', 10);
	if (!Number.isFinite(reps) || reps <= 0) return null;
	const suffix = (implicit[2] ?? '').trim();
	if (!suffix) return null;
	if (/^(?:s|seg|sec|min|mins|m)\b/i.test(suffix)) return null;
	if (/^\d{1,2}:\d{2}\b/.test(trimmed)) return null;
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
				segments.push(...pieces);
				continue;
			}
		}
		segments.push(segment);
	}
	return segments;
};
