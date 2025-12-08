import type { ProgressState, RoutineDay, RoutineExercise, RoutinePlan } from './types';

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

export const normalizePlan = (plan?: RoutinePlan | null): RoutinePlan => {
	const base = createEmptyPlan();
	if (!plan) return base;
	for (const day of WEEK_DAYS) {
		if (plan[day.key]) {
			base[day.key] = {
				key: day.key,
				label: day.label,
				exercises: (plan[day.key]?.exercises || []).map((ex, idx) => ({
					...ex,
					id: ex.id || uuid(),
					order: ex.order ?? idx
				}))
			};
		}
	}
	return base;
};

export const normalizeProgress = (progress?: ProgressState | null): ProgressState => {
	return WEEK_DAYS.reduce((acc, day) => {
		const state = progress?.[day.key];
		acc[day.key] = {
			completed: state?.completed ?? false,
			exercises: state?.exercises ?? {},
			lastUpdated: state?.lastUpdated
		};
		return acc;
	}, {} as ProgressState);
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
