import type { ImportShapeV1 } from '$lib/import/types';

export type LegacyMatch = {
	name: string;
	shape: ImportShapeV1;
	structureEndOffset: number;
};

const sanitizeExerciseName = (raw: string) =>
	raw
		.replace(/^[\s•●▪◦·*+\-:/.()]+/, '')
		.replace(/[\s•●▪◦·*+\-:/.()]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();

export const parseLegacyLine = (rawLine: string): LegacyMatch | null => {
	const raw = rawLine.trim();
	if (!raw) return null;
	const classic = raw.match(/^(.+?)\s+(\d{1,2})\s*(?:x|X|\*|por)\s*(\d{1,3})(?:\s*(?:-|–|a)\s*(\d{1,3}))?/u);
	if (classic?.index !== undefined) {
		const name = sanitizeExerciseName(classic[1] ?? '');
		const sets = Number.parseInt(classic[2] ?? '', 10);
		const repsMin = Number.parseInt(classic[3] ?? '', 10);
		const repsMax = classic[4] ? Number.parseInt(classic[4], 10) : null;
		if (!name || !Number.isFinite(sets) || !Number.isFinite(repsMin) || sets <= 0 || repsMin <= 0) return null;
		const endOffset = (classic.index ?? 0) + (classic[0]?.length ?? 0);
		if (repsMax && repsMax > repsMin) {
			return {
				name,
				structureEndOffset: endOffset,
				shape: {
					version: 1,
					kind: 'range',
					sets,
					reps_min: repsMin,
					reps_max: repsMax,
					evidence: 'heuristic',
					inference_reasons: ['reps_x_series_reordered']
				}
			};
		}
		return {
			name,
			structureEndOffset: endOffset,
			shape: {
				version: 1,
				kind: 'fixed',
				sets,
				reps_min: repsMin,
				reps_max: null,
				evidence: 'heuristic',
				inference_reasons: ['reps_x_series_reordered']
			}
		};
	}

	const scheme = raw.match(/^(.+?)\s+(\d{1,3}(?:\s*[,-]\s*\d{1,3}|\s+\d{1,3}){1,6})$/u);
	if (scheme?.index !== undefined) {
		const name = sanitizeExerciseName(scheme[1] ?? '');
		if (!name) return null;
		const values = (scheme[2] ?? '')
			.split(/[\s,\-]+/)
			.map((item) => Number.parseInt(item, 10))
			.filter((value) => Number.isFinite(value) && value > 0);
		if (values.length < 2) return null;
		return {
			name,
			structureEndOffset: (scheme.index ?? 0) + (scheme[0]?.length ?? 0),
			shape: {
				version: 1,
				kind: 'scheme',
				sets: values.length,
				reps_list: values,
				evidence: 'heuristic',
				inference_reasons: ['dash_series_assumed']
			}
		};
	}

	return null;
};
