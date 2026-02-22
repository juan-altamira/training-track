export const IMPORT_ERROR_CODES = {
	INVALID_FILE_TYPE: 'invalid_file_type',
	FILE_TOO_LARGE: 'file_too_large',
	INVALID_SCOPE: 'invalid_scope',
	UNSUPPORTED_SOURCE: 'unsupported_source',
	INVALID_PAYLOAD: 'invalid_payload',
	JOB_NOT_FOUND: 'job_not_found',
	NOT_AUTHORIZED: 'not_authorized',
	CLIENT_NOT_FOUND: 'client_not_found',
	CLIENT_MISMATCH: 'client_mismatch',
	KILL_SWITCH_ENABLED: 'kill_switch_enabled',
	PROCESSING_FAILED: 'processing_failed',
	NO_EXERCISES_DETECTED: 'no_exercises_detected',
	PDF_LAYOUT_UNRESOLVED: 'pdf_layout_unresolved',
	OPTIMISTIC_LOCK_CONFLICT: 'optimistic_lock_conflict',
	BLOCKING_ISSUES: 'blocking_issues',
	INVALID_COMMIT_POLICY: 'invalid_commit_policy',
	INTERNAL_ERROR: 'internal_error'
} as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[keyof typeof IMPORT_ERROR_CODES];
