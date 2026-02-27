import type {
	ProgressMeta,
	ProgressState,
	RoutineBlockType,
	RoutineDay,
	RoutineDayLabelMode,
	RoutineExercise,
	RoutineRepsMode,
	RoutinePlan,
	RoutineUiMeta
} from './types';

export type RoutineEditorBlock = {
	key: string;
	type: RoutineBlockType;
	id: string;
	label: string;
	order: number;
	rounds: number | null;
	exercises: RoutineExercise[];
};

export const WEEK_DAYS: RoutineDay[] = [
	{ key: 'monday', label: 'Lunes', exercises: [] },
	{ key: 'tuesday', label: 'Martes', exercises: [] },
	{ key: 'wednesday', label: 'Miércoles', exercises: [] },
	{ key: 'thursday', label: 'Jueves', exercises: [] },
	{ key: 'friday', label: 'Viernes', exercises: [] },
	{ key: 'saturday', label: 'Sábado', exercises: [] },
	{ key: 'sunday', label: 'Domingo', exercises: [] }
];

const VALID_DAY_LABEL_MODES = new Set<RoutineDayLabelMode>(['weekday', 'sequential', 'custom']);
const MAX_CUSTOM_DAY_LABEL_LENGTH = 40;
const MAX_SPECIAL_REPS_LENGTH = 80;
const MAX_BLOCK_LABEL_LENGTH = 40;

export const normalizeLabelForCompare = (value: string | null | undefined) =>
	(value ?? '')
		.trim()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ');

export const sanitizeCustomLabel = (value: string | null | undefined, fallback: string) => {
	const cleaned = (value ?? '')
		.replace(/[\u0000-\u001F\u007F]/g, '')
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, MAX_CUSTOM_DAY_LABEL_LENGTH);
	return cleaned || fallback;
};

export const sanitizeBlockLabel = (value: string | null | undefined, fallback: string) => {
	const cleaned = (value ?? '')
		.replace(/[\u0000-\u001F\u007F]/g, '')
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, MAX_BLOCK_LABEL_LENGTH);
	return cleaned || fallback;
};

export const normalizeRoutineUiMeta = (input?: RoutineUiMeta | null): Required<RoutineUiMeta> => {
	const mode = input?.day_label_mode;
	const dayLabelMode: RoutineDayLabelMode = VALID_DAY_LABEL_MODES.has(mode as RoutineDayLabelMode)
		? (mode as RoutineDayLabelMode)
		: 'weekday';
	return {
		day_label_mode: dayLabelMode,
		hide_empty_days_in_sequential:
			typeof input?.hide_empty_days_in_sequential === 'boolean'
				? input.hide_empty_days_in_sequential
				: true
	};
};

export const sanitizeSpecialRepsText = (value: string | null | undefined) =>
	(value ?? '')
		.replace(/[\u0000-\u001F\u007F]/g, '')
		.trim()
		.slice(0, MAX_SPECIAL_REPS_LENGTH);

export const formatSpecialRepsForDisplay = (value: string | null | undefined) => {
	const cleaned = sanitizeSpecialRepsText(value);
	if (!cleaned) return '';
	return cleaned.replace(/\bamrap\b/gi, 'AMRAP');
};

export type ParsedRoutineRepsInput = {
	repsMode: RoutineRepsMode;
	repsMin: number;
	repsMax: number | null;
	showRange: boolean;
	repsSpecial: string | null;
};

const parsePositiveInt = (value: string | undefined) => {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed)) return 0;
	return Math.max(0, Math.min(999, Math.floor(parsed)));
};

export const parseRoutineRepsInput = (value: string): ParsedRoutineRepsInput => {
	const raw = sanitizeSpecialRepsText(value);
	if (!raw) {
		return {
			repsMode: 'number',
			repsMin: 0,
			repsMax: null,
			showRange: false,
			repsSpecial: null
		};
	}

	const normalizedRangeSeparators = raw.replace(/[–—]/g, '-');
	const rangeDashMatch = normalizedRangeSeparators.match(
		/^(\d{1,3})\s*-\s*(\d{1,3})(?:\s*(?:rep(?:eticion(?:es)?)?s?))?$/i
	);
	if (rangeDashMatch) {
		const min = parsePositiveInt(rangeDashMatch[1]);
		const max = Math.max(min, parsePositiveInt(rangeDashMatch[2]));
		return {
			repsMode: 'number',
			repsMin: min,
			repsMax: max,
			showRange: true,
			repsSpecial: null
		};
	}

	const rangeTextMatch = normalizedRangeSeparators.match(
		/^(?:de\s+)?(\d{1,3})\s*a\s*(\d{1,3})(?:\s*(?:rep(?:eticion(?:es)?)?s?))?$/i
	);
	if (rangeTextMatch) {
		const min = parsePositiveInt(rangeTextMatch[1]);
		const max = Math.max(min, parsePositiveInt(rangeTextMatch[2]));
		return {
			repsMode: 'number',
			repsMin: min,
			repsMax: max,
			showRange: true,
			repsSpecial: null
		};
	}

	const fixedMatch = normalizedRangeSeparators.match(
		/^(?:de\s+)?(\d{1,3})(?:\s*(?:rep(?:eticion(?:es)?)?s?))?$/i
	);
	if (fixedMatch) {
		return {
			repsMode: 'number',
			repsMin: parsePositiveInt(fixedMatch[1]),
			repsMax: null,
			showRange: false,
			repsSpecial: null
		};
	}

	return {
		repsMode: 'special',
		repsMin: 0,
		repsMax: null,
		showRange: false,
		repsSpecial: formatSpecialRepsForDisplay(raw)
	};
};

type SpecialRepsConnector = 'x' | 'de' | 'none';

const SPECIAL_FAIL_PATTERN = /^(?:de\s+)?(?:al\s+fallo|a\s+fallo|fallo)\b/i;
const SPECIAL_DURATION_PATTERN =
	/^(?:de\s+)?(?:(?:\d{1,2}:\d{2})|(?:\d+(?:[.,]\d+)?))\s*(?:s|seg|segs|segundo|segundos|sec|secs|min|mins|minuto|minutos|h|hr|hrs|hora|horas)\b/i;
const SPECIAL_CLOCK_PATTERN = /^(?:de\s+)?\d{1,2}:\d{2}$/i;

const getSpecialRepsDisplayMeta = (value: string | null | undefined): { connector: SpecialRepsConnector; text: string } => {
	const cleaned = formatSpecialRepsForDisplay(value);
	if (!cleaned) return { connector: 'x', text: '' };

	const trimmed = cleaned.trim();
	if (SPECIAL_FAIL_PATTERN.test(trimmed)) {
		return { connector: 'none', text: 'al fallo' };
	}

	const withoutLeadingPrep = trimmed.replace(/^(?:de|por)\s+/i, '').trim();
	if (SPECIAL_DURATION_PATTERN.test(trimmed) || SPECIAL_DURATION_PATTERN.test(withoutLeadingPrep) || SPECIAL_CLOCK_PATTERN.test(trimmed) || SPECIAL_CLOCK_PATTERN.test(withoutLeadingPrep)) {
		return { connector: 'de', text: withoutLeadingPrep };
	}

	const withoutLeadingX = withoutLeadingPrep.replace(/^x\s+/i, '').trim();
	return { connector: 'x', text: withoutLeadingX || trimmed };
};

const formatSeriesWithSpecial = (sets: number, value: string | null | undefined) => {
	const seriesWord = sets === 1 ? 'serie' : 'series';
	const meta = getSpecialRepsDisplayMeta(value);
	if (!meta.text) return `${sets} ${seriesWord}`;
	if (meta.connector === 'none') return `${sets} ${seriesWord} ${meta.text}`;
	if (meta.connector === 'de') return `${sets} ${seriesWord} de ${meta.text}`;
	return `${sets} ${seriesWord} x ${meta.text}`;
};

export const getRoutineExerciseRepsMode = (exercise: RoutineExercise): RoutineRepsMode => {
	if (exercise.repsMode === 'special') return 'special';
	return 'number';
};

export const getRoutineExerciseBlockType = (exercise: RoutineExercise): RoutineBlockType => {
	if (exercise.blockType === 'circuit') return 'circuit';
	return 'normal';
};

export const getRoutineExerciseBlockId = (exercise: RoutineExercise) =>
	(exercise.blockId ?? '').trim() || exercise.id;

const normalizeCircuitRounds = (exercise: RoutineExercise) => {
	const raw =
		typeof exercise.circuitRounds === 'number' && Number.isFinite(exercise.circuitRounds)
			? exercise.circuitRounds
			: typeof exercise.totalSets === 'number' && Number.isFinite(exercise.totalSets)
				? exercise.totalSets
				: null;
	if (!raw || raw <= 0) return 3;
	return Math.max(1, Math.min(99, Math.floor(raw)));
};

export const resolveEffectiveDayLabelMode = (
	plan: RoutinePlan,
	uiMeta?: RoutineUiMeta | null
): RoutineDayLabelMode => {
	const explicitMode = uiMeta?.day_label_mode;
	if (VALID_DAY_LABEL_MODES.has(explicitMode as RoutineDayLabelMode)) {
		return explicitMode as RoutineDayLabelMode;
	}

	let hasCustomEvidence = false;
	for (const day of WEEK_DAYS) {
		const planDay = plan?.[day.key];
		const exercisesCount = planDay?.exercises?.length ?? 0;
		const rawLabel = (planDay?.label ?? '').trim();
		const normalizedLabel = normalizeLabelForCompare(rawLabel);
		const normalizedDefault = normalizeLabelForCompare(day.label);
		const labelIsEmpty = normalizedLabel.length === 0;
		const labelIsDefault = !labelIsEmpty && normalizedLabel === normalizedDefault;
		const isRelevant = exercisesCount > 0 || (!labelIsEmpty && !labelIsDefault);
		if (!isRelevant) continue;
		if (!labelIsEmpty && !labelIsDefault) {
			hasCustomEvidence = true;
			break;
		}
	}

	return hasCustomEvidence ? 'custom' : 'weekday';
};

export type DisplayRoutineDay = {
	dayKey: string;
	displayLabel: string;
	slotIndex: number;
	hasExercises: boolean;
	exercisesCount: number;
	isEmpty: boolean;
};

export const getDisplayDays = (
	plan: RoutinePlan,
	uiMeta?: RoutineUiMeta | null,
	options?: {
		activeDayKey?: string | null;
		includeEmptyOverride?: boolean;
	}
): DisplayRoutineDay[] => {
	const activeDayKey = options?.activeDayKey ?? null;
	const includeEmptyOverride = options?.includeEmptyOverride === true;
	const normalizedMeta = normalizeRoutineUiMeta(uiMeta);
	const effectiveMode = resolveEffectiveDayLabelMode(plan, normalizedMeta);

	const base = WEEK_DAYS.map((day, index) => {
		const planDay = plan?.[day.key];
		const exercisesCount = planDay?.exercises?.length ?? 0;
		const hasExercises = exercisesCount > 0;
		return {
			dayKey: day.key,
			displayLabel:
				effectiveMode === 'custom'
					? sanitizeCustomLabel(planDay?.label, day.label)
					: day.label,
			slotIndex: index,
			hasExercises,
			exercisesCount,
			isEmpty: !hasExercises
		};
	});

	let visible = base;
	if (effectiveMode === 'sequential' && normalizedMeta.hide_empty_days_in_sequential && !includeEmptyOverride) {
		visible = base.filter((day) => day.hasExercises || day.dayKey === activeDayKey);
	}

	if (visible.length === 0) {
		const fallback =
			base.find((day) => day.dayKey === activeDayKey) ??
			base[0] ?? {
				dayKey: 'monday',
				displayLabel: 'Lunes',
				slotIndex: 0,
				hasExercises: false,
				exercisesCount: 0,
				isEmpty: true
			};
		visible = [fallback];
	}

	if (effectiveMode === 'sequential') {
		return visible.map((day, index) => ({
			...day,
			displayLabel: `Día ${index + 1}`,
			slotIndex: index
		}));
	}

	return visible.map((day, index) => ({
		...day,
		slotIndex: index
	}));
};

const uuid = () => {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return 'id-' + Math.random().toString(36).slice(2, 10);
};

const normalizeDayExercises = (
	dayKey: string,
	exercises: RoutineExercise[],
	regenerateIds: boolean
): RoutineExercise[] => {
	const blockOrderByKey = new Map<string, number>();
	const seenNormalBlockIds = new Map<string, number>();
	const normalized: RoutineExercise[] = [];

	for (let idx = 0; idx < exercises.length; idx += 1) {
		const ex = exercises[idx];
		const id = regenerateIds ? uuid() : ex.id || uuid();
		const repsSpecial = sanitizeSpecialRepsText(ex.repsSpecial);
		const repsMode: RoutineRepsMode =
			ex.repsMode === 'special' && repsSpecial ? 'special' : 'number';
		const blockType = getRoutineExerciseBlockType(ex);
		const rawBlockId = (ex.blockId ?? '').trim() || `block-${dayKey}-${id}`;
		const repeatedNormalBlockCount = seenNormalBlockIds.get(rawBlockId) ?? 0;
		const baseBlockId =
			blockType === 'normal' && repeatedNormalBlockCount > 0 ? `${rawBlockId}-${id}` : rawBlockId;
		if (blockType === 'normal') {
			seenNormalBlockIds.set(rawBlockId, repeatedNormalBlockCount + 1);
		}
		const blockKey = `${blockType}:${baseBlockId}`;
		const blockOrder = blockOrderByKey.has(blockKey) ? (blockOrderByKey.get(blockKey) ?? 0) : blockOrderByKey.size;
		if (!blockOrderByKey.has(blockKey)) {
			blockOrderByKey.set(blockKey, blockOrder);
		}
		const blockLabel = sanitizeBlockLabel(ex.blockLabel, `Bloque ${blockOrder + 1}`);
		const circuitRounds = blockType === 'circuit' ? normalizeCircuitRounds(ex) : null;

		normalized.push({
			...ex,
			id,
			order: idx,
			repsMode,
			repsSpecial: repsSpecial || null,
			blockType,
			blockId: baseBlockId,
			blockOrder,
			blockLabel,
			circuitRounds
		});
	}

	return normalized;
};

export const createEmptyPlan = (): RoutinePlan =>
	WEEK_DAYS.reduce((acc, day) => {
		acc[day.key] = { ...day, exercises: [] };
		return acc;
	}, {} as RoutinePlan);

export const normalizePlan = (plan?: RoutinePlan | null, regenerateIds = false): RoutinePlan => {
	const base = createEmptyPlan();
	if (!plan) return base;
	for (const day of WEEK_DAYS) {
		if (plan[day.key]) {
			base[day.key] = {
				key: day.key,
				label: sanitizeCustomLabel(plan[day.key]?.label, day.label),
				exercises: normalizeDayExercises(day.key, plan[day.key]?.exercises || [], regenerateIds)
			};
		}
	}
	return base;
};

export const buildRoutineEditorBlocks = (
	dayKey: string,
	exercises: RoutineExercise[]
): RoutineEditorBlock[] => {
	const blocks: RoutineEditorBlock[] = [];
	const byKey = new Map<string, RoutineEditorBlock>();

	for (const exercise of exercises) {
		const type = getRoutineExerciseBlockType(exercise);
		const id = getRoutineExerciseBlockId(exercise);
		const key = `${type}:${id}`;

		if (!byKey.has(key)) {
			const order = blocks.length;
			const label = sanitizeBlockLabel(exercise.blockLabel, `Bloque ${order + 1}`);
			const rounds =
				type === 'circuit'
					? Math.max(
							1,
							Math.min(
								99,
								Math.floor(
									Number(
										typeof exercise.circuitRounds === 'number' &&
										Number.isFinite(exercise.circuitRounds)
											? exercise.circuitRounds
											: getTargetSets(exercise) || 3
									) || 3
								)
							)
						)
					: null;

			const block: RoutineEditorBlock = { key, type, id, label, order, rounds, exercises: [] };
			byKey.set(key, block);
			blocks.push(block);
		}

		byKey.get(key)?.exercises.push(exercise);
	}

	return blocks;
};

export const normalizeProgress = (
	progress?: ProgressState | null,
	meta?: ProgressMeta
): ProgressState => {
	const base = WEEK_DAYS.reduce((acc, day) => {
		const state = progress?.[day.key];
		acc[day.key] = {
			completed: state?.completed ?? false,
			exercises: state?.exercises ?? {},
			lastUpdated: state?.lastUpdated,
			suspicious: state?.suspicious ?? false
		};
		return acc;
	}, {} as ProgressState);

	base._meta = {
		last_activity_utc: meta?.last_activity_utc ?? progress?._meta?.last_activity_utc ?? null,
		last_reset_utc: meta?.last_reset_utc ?? progress?._meta?.last_reset_utc ?? null,
		suspicious_day: meta?.suspicious_day ?? progress?._meta?.suspicious_day ?? null,
		suspicious_at: meta?.suspicious_at ?? progress?._meta?.suspicious_at ?? null,
		suspicious_reason: meta?.suspicious_reason ?? progress?._meta?.suspicious_reason ?? null,
		first_set_ts: meta?.first_set_ts ?? progress?._meta?.first_set_ts ?? {},
		baseline_sets: meta?.baseline_sets ?? progress?._meta?.baseline_sets ?? {}
	};

	return base;
};

export const parseTotalSets = (scheme: string): number | undefined => {
	const match = scheme.match(/(\\d+)\\s*[xX]/);
	if (match?.[1]) {
		return Number(match[1]);
	}
	return undefined;
};

export const getTargetSets = (exercise: RoutineExercise): number => {
	if (getRoutineExerciseBlockType(exercise) === 'circuit') {
		const rounds = normalizeCircuitRounds(exercise);
		return rounds > 0 ? rounds : 0;
	}
	return exercise.totalSets ?? parseTotalSets(exercise.scheme) ?? 0;
};

export const formatPrescription = (exercise: RoutineExercise): string => {
	const sets = getTargetSets(exercise);
	const repsMin = exercise.repsMin;
	const repsMax = exercise.repsMax;
	const repsMode = getRoutineExerciseRepsMode(exercise);
	const blockType = getRoutineExerciseBlockType(exercise);
	const repsSpecial = formatSpecialRepsForDisplay(exercise.repsSpecial);
	
	if (!sets || sets === 0) return '';
	if (blockType === 'circuit') {
		if (repsMode === 'special' && repsSpecial) return getSpecialRepsDisplayMeta(repsSpecial).text;
		if (repsMin != null && repsMin > 0) {
			if (repsMax != null && repsMax > repsMin) return `${repsMin}-${repsMax} reps`;
			return `${repsMin} reps`;
		}
		return '';
	}
	if (repsMode === 'special' && repsSpecial) {
		return formatSeriesWithSpecial(sets, repsSpecial);
	}
	
	let repsText = '';
	if (repsMin != null && repsMin > 0) {
		if (repsMax != null && repsMax > repsMin) {
			repsText = `${repsMin}–${repsMax} reps`;
		} else {
			repsText = `${repsMin} reps`;
		}
	}
	
	if (repsText) {
		return `${sets} series · ${repsText}`;
	}
	return `${sets} series`;
};

export const formatPrescriptionLong = (exercise: RoutineExercise): string => {
	const sets = getTargetSets(exercise);
	const repsMin = exercise.repsMin;
	const repsMax = exercise.repsMax;
	const repsMode = getRoutineExerciseRepsMode(exercise);
	const blockType = getRoutineExerciseBlockType(exercise);
	const repsSpecial = formatSpecialRepsForDisplay(exercise.repsSpecial);
	
	if (!sets || sets === 0) return '';
	if (blockType === 'circuit') {
		if (repsMode === 'special' && repsSpecial) return getSpecialRepsDisplayMeta(repsSpecial).text;
		if (repsMin != null && repsMin > 0) {
			if (repsMax != null && repsMax > repsMin) {
				return `${repsMin} a ${repsMax} repeticiones`;
			}
			const repWord = repsMin === 1 ? 'repetición' : 'repeticiones';
			return `${repsMin} ${repWord}`;
		}
		return '';
	}
	
	const seriesWord = sets === 1 ? 'serie' : 'series';
	if (repsMode === 'special' && repsSpecial) {
		return formatSeriesWithSpecial(sets, repsSpecial);
	}
	
	if (repsMin != null && repsMin > 0) {
		if (repsMax != null && repsMax > repsMin) {
			return `${sets} ${seriesWord} de ${repsMin} a ${repsMax} repeticiones`;
		}
		const repWord = repsMin === 1 ? 'repetición' : 'repeticiones';
		return `${sets} ${seriesWord} de ${repsMin} ${repWord}`;
	}
	return `${sets} ${seriesWord}`;
};

export const computeDayCompletion = (dayKey: string, plan: RoutinePlan, progress: ProgressState) => {
	const dayPlan = plan[dayKey];
	const dayProgress = progress[dayKey] ?? { completed: false, exercises: {} };
	let allSetsDone = true;
	for (const ex of dayPlan.exercises) {
		const target = getTargetSets(ex);
		const done = dayProgress.exercises?.[ex.id] ?? 0;
		if (target > 0 && done < target) {
			allSetsDone = false;
		}
	}
	return {
		completed: dayProgress.completed || (dayPlan.exercises.length > 0 && allSetsDone),
		doneSets: dayProgress.exercises ?? {}
	};
};

export const deriveProgressSummary = (plan: RoutinePlan, progress: ProgressState) => {
	const completedDays: string[] = [];
	for (const day of WEEK_DAYS) {
		const status = computeDayCompletion(day.key, plan, progress);
		if (status.completed) {
			completedDays.push(day.label);
		}
	}
	const lastDay = completedDays.at(-1);
	return {
		completedDays,
		lastDay
	};
};
