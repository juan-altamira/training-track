import { WEEK_DAYS } from './routines';

export const DAY_FEEDBACK_MOOD_VALUES = [
	'excellent',
	'good',
	'normal',
	'tired',
	'very_fatigued'
] as const;

export const DAY_FEEDBACK_PAIN_VALUES = ['none', 'mild', 'moderate', 'severe'] as const;
export const DAY_FEEDBACK_COMMENT_MAX_LENGTH = 300;

export type DayFeedbackMood = (typeof DAY_FEEDBACK_MOOD_VALUES)[number];
export type DayFeedbackPain = (typeof DAY_FEEDBACK_PAIN_VALUES)[number];

export type DayFeedbackRow = {
	day_key: string;
	day_local: string | null;
	submitted_at: string | null;
	mood: DayFeedbackMood | null;
	difficulty: number | null;
	pain: DayFeedbackPain | null;
	comment: string | null;
	created_at: string;
	updated_at: string;
};

export type DayFeedbackByDay = Record<string, DayFeedbackRow | null>;

export const DAY_FEEDBACK_MOOD_LABEL: Record<DayFeedbackMood, string> = {
	excellent: 'Excelente',
	good: 'Bien',
	normal: 'Normal',
	tired: 'Cansado',
	very_fatigued: 'Muy fatigado'
};

export const DAY_FEEDBACK_PAIN_LABEL: Record<DayFeedbackPain, string> = {
	none: 'No',
	mild: 'Leve',
	moderate: 'Moderado',
	severe: 'Fuerte'
};

export const isValidDayKey = (dayKey: string): boolean =>
	WEEK_DAYS.some((day) => day.key === dayKey);

export const isValidMood = (value: string): value is DayFeedbackMood =>
	(DAY_FEEDBACK_MOOD_VALUES as readonly string[]).includes(value);

export const isValidPain = (value: string): value is DayFeedbackPain =>
	(DAY_FEEDBACK_PAIN_VALUES as readonly string[]).includes(value);

export const normalizeFeedbackComment = (raw: string): string | null => {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	return trimmed;
};

export const isFeedbackCommentTooLong = (comment: string | null): boolean =>
	(comment?.length ?? 0) > DAY_FEEDBACK_COMMENT_MAX_LENGTH;

export const buildProgressCycleKey = (lastResetUtc: string | null | undefined): string => {
	const clean = (lastResetUtc ?? '').trim();
	if (!clean) return 'initial';
	const parsed = new Date(clean);
	if (Number.isNaN(parsed.getTime())) return 'initial';
	return `reset:${parsed.toISOString()}`;
};

export const emptyDayFeedbackByDay = (): DayFeedbackByDay =>
	WEEK_DAYS.reduce((acc, day) => {
		acc[day.key] = null;
		return acc;
	}, {} as DayFeedbackByDay);

export const toDayFeedbackByDay = (
	rows: Array<Partial<DayFeedbackRow> & { day_key?: string }> | null | undefined
): DayFeedbackByDay => {
	const base = emptyDayFeedbackByDay();
	for (const row of rows ?? []) {
		if (!row.day_key || !isValidDayKey(row.day_key)) continue;
		base[row.day_key] = {
			day_key: row.day_key,
			day_local: typeof row.day_local === 'string' ? row.day_local : null,
			submitted_at: typeof row.submitted_at === 'string' ? row.submitted_at : null,
			mood: (row.mood as DayFeedbackMood | null) ?? null,
			difficulty: typeof row.difficulty === 'number' ? row.difficulty : null,
			pain: (row.pain as DayFeedbackPain | null) ?? null,
			comment: row.comment ?? null,
			created_at: row.created_at ?? '',
			updated_at: row.updated_at ?? ''
		};
	}
	return base;
};
