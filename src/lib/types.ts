export type RoutineExercise = {
	id: string;
	name: string;
	scheme: string;
	order: number;
	note?: string;
	totalSets?: number;
	repsMin?: number;
	repsMax?: number | null;
	showRange?: boolean;
};

export type RoutineDay = {
	key: string;
	label: string;
	exercises: RoutineExercise[];
};

export type RoutinePlan = Record<string, RoutineDay>;

export type RoutineDayLabelMode = 'weekday' | 'sequential' | 'custom';

export type RoutineUiMeta = {
	day_label_mode?: RoutineDayLabelMode;
	hide_empty_days_in_sequential?: boolean;
};

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
	last_suspicious_day?: string | null;
	last_suspicious_at?: string | null;
	last_suspicious_reason?: string | null;
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

export type TrainerAdminRow = {
	email: string;
	active: boolean;
	trainer_id?: string;
	status?: string | null;
	created_at?: string | null;
	active_until?: string | null;
};

export type OwnerActionHistoryRow = {
	id: string;
	admin_id?: string | null;
	admin_email: string;
	action_type: 'add_trainer' | 'grant_subscription' | 'toggle_trainer' | 'force_sign_out';
	target_email?: string | null;
	target_trainer_id?: string | null;
	details?: Record<string, unknown> | null;
	created_at: string;
};

export type OtherClientRow = {
	id: string;
	name: string;
};
