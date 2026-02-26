export type LineTokenType = 'word' | 'number' | 'time' | 'symbol';

export type LineToken = {
	type: LineTokenType;
	raw: string;
	normalized: string;
	startOffset: number;
	endOffset: number;
};

export const normalizeWord = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

const normalizeSymbol = (value: string) => {
	if (value === '×') return 'x';
	if (value === '–' || value === '—') return '-';
	return value;
};

const TOKEN_REGEX = /(\d{1,2}:\d{2})|(\d+(?:[.,]\d+)?)|([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)|([^\s])/gu;

export const tokenizeLine = (rawLine: string): LineToken[] => {
	const tokens: LineToken[] = [];
	for (const match of rawLine.matchAll(TOKEN_REGEX)) {
		const full = match[0] ?? '';
		if (!full) continue;
		const startOffset = match.index ?? 0;
		const endOffset = startOffset + full.length;
		if (match[1]) {
			tokens.push({
				type: 'time',
				raw: full,
				normalized: full,
				startOffset,
				endOffset
			});
			continue;
		}
		if (match[2]) {
			const hasDecimalComma = full.includes(',');
			const previousChar = startOffset > 0 ? rawLine[startOffset - 1] ?? '' : '';
			const nextChar = rawLine[endOffset] ?? '';
			const shouldSplitCommaList =
				hasDecimalComma && (previousChar === ',' || nextChar === ',') && full.split(',').length === 2;
			if (shouldSplitCommaList) {
				const commaIndex = full.indexOf(',');
				const leftRaw = full.slice(0, commaIndex);
				const rightRaw = full.slice(commaIndex + 1);
				const commaOffset = startOffset + commaIndex;
				if (leftRaw) {
					tokens.push({
						type: 'number',
						raw: leftRaw,
						normalized: leftRaw,
						startOffset,
						endOffset: commaOffset
					});
				}
				tokens.push({
					type: 'symbol',
					raw: ',',
					normalized: ',',
					startOffset: commaOffset,
					endOffset: commaOffset + 1
				});
				if (rightRaw) {
					tokens.push({
						type: 'number',
						raw: rightRaw,
						normalized: rightRaw,
						startOffset: commaOffset + 1,
						endOffset
					});
				}
				continue;
			}
			tokens.push({
				type: 'number',
				raw: full,
				normalized: full.replace(',', '.'),
				startOffset,
				endOffset
			});
			continue;
		}
		if (match[3]) {
			const normalizedWord = normalizeWord(full);
			const previous = tokens[tokens.length - 1];
			if (
				previous?.type === 'number' &&
				normalizedWord.startsWith('x') &&
				normalizedWord.length > 1 &&
				(normalizedWord.slice(1) === 'amrap' || normalizedWord.slice(1) === 'fallo')
			) {
				tokens.push({
					type: 'word',
					raw: full.slice(0, 1),
					normalized: 'x',
					startOffset,
					endOffset: startOffset + 1
				});
				tokens.push({
					type: 'word',
					raw: full.slice(1),
					normalized: normalizedWord.slice(1),
					startOffset: startOffset + 1,
					endOffset
				});
				continue;
			}
			tokens.push({
				type: 'word',
				raw: full,
				normalized: normalizedWord,
				startOffset,
				endOffset
			});
			continue;
		}
		tokens.push({
			type: 'symbol',
			raw: full,
			normalized: normalizeSymbol(full),
			startOffset,
			endOffset
		});
	}
	return tokens;
};

export const isSeparatorX = (token: LineToken | undefined) => {
	if (!token) return false;
	if (token.type === 'symbol') return token.normalized === 'x' || token.normalized === '*';
	if (token.type === 'word') return token.normalized === 'x' || token.normalized === 'por';
	return false;
};

export const isRangeConnector = (token: LineToken | undefined) => {
	if (!token) return false;
	if (token.type === 'symbol') return token.normalized === '-' || token.normalized === '/';
	if (token.type === 'word') {
		return token.normalized === 'a' || token.normalized === 'to' || token.normalized === 'hasta';
	}
	return false;
};

export const isCommaConnector = (token: LineToken | undefined) =>
	token?.type === 'symbol' && token.normalized === ',';

export const isSeriesKeyword = (token: LineToken | undefined) =>
	token?.type === 'word' &&
	(token.normalized === 'serie' || token.normalized === 'series' || token.normalized === 'set' || token.normalized === 'sets');

export const isRepsKeyword = (token: LineToken | undefined) =>
	token?.type === 'word' &&
	(token.normalized === 'rep' ||
		token.normalized === 'reps' ||
		token.normalized === 'repeticion' ||
		token.normalized === 'repeticiones');

export const isAmrapKeyword = (token: LineToken | undefined) =>
	token?.type === 'word' &&
	(token.normalized === 'amrap' || token.normalized === 'fallo' || token.normalized === 'afallo');

export const parseIntToken = (token: LineToken | undefined): number | null => {
	if (!token || token.type !== 'number') return null;
	const parsed = Number.parseInt(token.normalized, 10);
	if (!Number.isFinite(parsed)) return null;
	return parsed;
};

export const parseFloatToken = (token: LineToken | undefined): number | null => {
	if (!token || token.type !== 'number') return null;
	const parsed = Number.parseFloat(token.normalized);
	if (!Number.isFinite(parsed)) return null;
	return parsed;
};

export const isTimeUnitWord = (token: LineToken | undefined) => {
	if (!token || token.type !== 'word') return false;
	return (
		token.normalized === 's' ||
		token.normalized === 'seg' ||
		token.normalized === 'sec' ||
		token.normalized === 'min' ||
		token.normalized === 'mins' ||
		token.normalized === 'm'
	);
};

export const trimSpan = (raw: string, start: number, end: number) => {
	let left = Math.max(0, start);
	let right = Math.min(raw.length, end);
	while (left < right && /\s/.test(raw[left] ?? '')) left += 1;
	while (right > left && /\s/.test(raw[right - 1] ?? '')) right -= 1;
	return { start: left, end: right };
};
