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
	suspicious?: boolean;
};

export type ProgressMeta = {
	last_reset_utc?: string | null;
	last_activity_utc?: string | null;
	suspicious_day?: string | null;
	suspicious_at?: string | null;
	suspicious_reason?: string | null;
	first_set_ts?: Record<string, string | null>;
	baseline_sets?: Record<string, number>;
};

export type ProgressState = Record<string, ProgressDay> & {
	_meta?: ProgressMeta;
};

export type ClientSummary = {
	id: string;
	name: string;
	client_code: string;
	status: 'active' | 'archived';
	objective?: string | null;
	last_completed_at?: string | null;
	last_day_completed?: string | null;
	last_activity_utc?: string | null;
	last_reset_utc?: string | null;
	week_started?: boolean;
	days_since_activity?: number | null;
};
