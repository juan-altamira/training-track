import type { LineToken } from './tokens';

export type StructuralTokenRole =
	| 'sets'
	| 'reps'
	| 'reps_min'
	| 'reps_max'
	| 'weight'
	| 'keyword'
	| 'rounds';

export type StructuralTokenRef = {
	tokenIndex: number;
	role: StructuralTokenRole;
};

export const getStructuralEndToken = (tokens: LineToken[], refs: StructuralTokenRef[]): LineToken | null => {
	if (refs.length === 0) return null;
	let maxToken: LineToken | null = null;
	for (const ref of refs) {
		const token = tokens[ref.tokenIndex];
		if (!token) continue;
		if (!maxToken || token.endOffset > maxToken.endOffset) {
			maxToken = token;
		}
	}
	return maxToken;
};

export const dedupeStructuralRefs = (refs: StructuralTokenRef[]): StructuralTokenRef[] => {
	const seen = new Set<string>();
	const out: StructuralTokenRef[] = [];
	for (const ref of refs) {
		const key = `${ref.tokenIndex}:${ref.role}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return out;
};
