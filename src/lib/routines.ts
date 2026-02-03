import type { ProgressMeta, ProgressState, RoutineDay, RoutineExercise, RoutinePlan } from './types';

export const WEEK_DAYS: RoutineDay[] = [
	{ key: 'monday', label: 'Lunes', exercises: [] },
	{ key: 'tuesday', label: 'Martes', exercises: [] },
	{ key: 'wednesday', label: 'Miércoles', exercises: [] },
	{ key: 'thursday', label: 'Jueves', exercises: [] },
	{ key: 'friday', label: 'Viernes', exercises: [] },
	{ key: 'saturday', label: 'Sábado', exercises: [] },
	{ key: 'sunday', label: 'Domingo', exercises: [] }
];

const uuid = () => {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return 'id-' + Math.random().toString(36).slice(2, 10);
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
				label: day.label,
				exercises: (plan[day.key]?.exercises || []).map((ex, idx) => ({
					...ex,
					id: regenerateIds ? uuid() : (ex.id || uuid()),
					order: ex.order ?? idx
				}))
			};
		}
	}
	return base;
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
	return exercise.totalSets ?? parseTotalSets(exercise.scheme) ?? 0;
};

export const formatPrescription = (exercise: RoutineExercise): string => {
	const sets = getTargetSets(exercise);
	const repsMin = exercise.repsMin;
	const repsMax = exercise.repsMax;
	
	if (!sets || sets === 0) return '';
	
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
	
	if (!sets || sets === 0) return '';
	
	const seriesWord = sets === 1 ? 'serie' : 'series';
	
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
