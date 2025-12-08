export type RoutineExercise = {
	id: string;
	name: string;
	scheme: string;
	order: number;
	note?: string;
	totalSets?: number;
};

export type RoutineDay = {
	key: string;
	label: string;
	exercises: RoutineExercise[];
};

export type RoutinePlan = Record<string, RoutineDay>;

export type ProgressDay = {
	completed: boolean;
	exercises: Record<string, number>;
	lastUpdated?: string;
};

export type ProgressState = Record<string, ProgressDay>;

export type ClientSummary = {
	id: string;
	name: string;
	client_code: string;
	status: 'active' | 'archived';
	objective?: string | null;
	last_completed_at?: string | null;
	last_day_completed?: string | null;
};
