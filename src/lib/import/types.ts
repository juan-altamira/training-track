import type { RoutinePlan } from '$lib/types';

export const IMPORT_JOB_STATUS = [
	'queued',
	'processing',
	'ready',
	'failed',
	'committing',
	'committed',
	'rolled_back',
	'expired'
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUS)[number];

export const IMPORT_SOURCE_TYPE = ['text', 'csv', 'xlsx', 'docx', 'pdf'] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPE)[number];

export const IMPORT_JOB_SCOPE = ['client', 'template'] as const;
export type ImportJobScope = (typeof IMPORT_JOB_SCOPE)[number];

export const IMPORT_COMMIT_POLICY = ['overwrite_all', 'overwrite_days'] as const;
export type ImportCommitPolicy = (typeof IMPORT_COMMIT_POLICY)[number];

export const IMPORT_WEEK_DAY_KEYS = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
] as const;

export const IMPORT_ISSUE_SEVERITY = [
	'hard_error',
	'needs_review_blocking',
	'needs_review',
	'warning',
	'autofix_applied'
] as const;

export type ImportIssueSeverity = (typeof IMPORT_ISSUE_SEVERITY)[number];

export const IMPORT_STAGE = [
	'queued',
	'processing',
	'extracting',
	'parsing',
	'validating',
	'adapting',
	'ready',
	'failed',
	'committing',
	'committed',
	'rolled_back',
	'expired'
] as const;

export type ImportStage = (typeof IMPORT_STAGE)[number];

export type FieldConfidence = {
	score: number;
	label: 'high' | 'medium' | 'low';
};

export type FieldProvenance = {
	source_page?: number | null;
	line_index?: number | null;
	line_span?: [number, number] | null;
	bbox?: [number, number, number, number] | null;
	raw_snippet: string;
};

export type ImportNodeFieldMeta = {
	confidence: FieldConfidence;
	provenance: FieldProvenance | null;
};

export const IMPORT_NAME_SPLIT_DECISION = [
	'not_applied',
	'split_kept',
	'split_reverted',
	'split_kept_note_dropped'
] as const;

export type ImportNameSplitDecision = (typeof IMPORT_NAME_SPLIT_DECISION)[number];

export const IMPORT_NAME_SPLIT_CONFIDENCE_DELTA = ['none', 'medium', 'low'] as const;

export type ImportNameSplitConfidenceDelta = (typeof IMPORT_NAME_SPLIT_CONFIDENCE_DELTA)[number];

export type ImportNameSplitMeta = {
	decision: ImportNameSplitDecision;
	reason: string;
	confidence_delta: ImportNameSplitConfidenceDelta;
	tail_original: string | null;
};

export type ImportDraftNode = {
	id: string;
	source_raw_name: string;
	raw_exercise_name: string;
	sets: number | null;
	reps_text: string | null;
	reps_min: number | null;
	reps_max: number | null;
	note: string | null;
	split_meta: ImportNameSplitMeta | null;
	field_meta: {
		day: ImportNodeFieldMeta;
		name: ImportNodeFieldMeta;
		sets: ImportNodeFieldMeta;
		reps: ImportNodeFieldMeta;
		note: ImportNodeFieldMeta | null;
	};
};

export type ImportDraftBlock = {
	id: string;
	block_type: 'single' | 'superset' | 'circuit' | 'unknown';
	nodes: ImportDraftNode[];
};

export type ImportDraftDay = {
	id: string;
	source_label: string;
	mapped_day_key: string | null;
	blocks: ImportDraftBlock[];
};

export type ImportDraft = {
	version: number;
	source_type: ImportSourceType;
	parser_version: string;
	ruleset_version: string;
	extractor_version: string;
	coverage: {
		days_detected: number;
		exercises_parsed: number;
		candidate_lines: number;
		parsed_lines: number;
		parseable_ratio: number;
		required_fields_ratio: number;
		lines_in?: number;
		lines_after_split?: number;
		lines_with_prescription_detected?: number;
		exercise_nodes_out?: number;
		multi_exercise_splits_applied?: number;
		unresolved_multi_exercise_lines?: number;
	};
	days: ImportDraftDay[];
};

export type ImportIssue = {
	severity: ImportIssueSeverity;
	code: string;
	scope: 'job' | 'day' | 'block' | 'node' | 'field';
	path: string;
	message: string;
	provenance: FieldProvenance | null;
	suggested_fix?: string | null;
};

export type ImportStats = {
	days_detected: number;
	exercises_parsed: number;
	issues_total: number;
	blocking_issues: number;
	low_confidence_fields: number;
	parseable_ratio: number;
	required_fields_ratio: number;
};

export type ImportDraftBundle = {
	draft: ImportDraft;
	issues: ImportIssue[];
	derivedPlan: RoutinePlan;
	stats: ImportStats;
};

export type ImportJobRow = {
	id: string;
	trainer_id: string;
	client_id: string | null;
	scope: ImportJobScope;
	status: ImportJobStatus;
	source_type: ImportSourceType;
	file_hash_sha256: string;
	storage_path: string | null;
	file_meta: Record<string, unknown> | null;
	parser_version: string;
	ruleset_version: string;
	extractor_version: string;
	ocr_engine_version: string | null;
	llm_model_version: string | null;
	prompt_version: string | null;
	attempts: number;
	max_attempts: number;
	lease_owner: string | null;
	lease_expires_at: string | null;
	progress_stage: string;
	progress_percent: number;
	error_code: string | null;
	error_message: string | null;
	last_error_code: string | null;
	last_error_message: string | null;
	last_error_at: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
};

export type ImportDraftRow = {
	job_id: string;
	draft_json: ImportDraft;
	issues_json: ImportIssue[];
	derived_routineplan_json: RoutinePlan;
	stats_json: ImportStats;
	created_at: string;
	updated_at: string;
};
