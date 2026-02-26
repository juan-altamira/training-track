import type { ImportSourceType } from '$lib/import/types';

export const IMPORT_PARSER_VERSION = '2.0.0';
export const IMPORT_RULESET_VERSION = '2.0.0';
export const IMPORT_EXTRACTOR_VERSION = '1.1.0';
export const IMPORT_DRAFT_VERSION = 1;

export const IMPORT_MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024;
export const IMPORT_MAX_PAGE_COUNT = 25;
export const IMPORT_ARTIFACT_TTL_HOURS = 24;
export const IMPORT_BACKUP_MAX_PER_CLIENT = 20;
export const IMPORT_BACKUP_MAX_AGE_DAYS = 30;

export const PDF_COVERAGE_THRESHOLDS = {
	minDaysDetected: 1,
	minExercisesParsed: 5,
	minParseableRatio: 0.6,
	minRequiredFieldsRatio: 0.7
} as const;

export const IMPORT_SOURCE_MIME_BY_TYPE: Record<ImportSourceType, string[]> = {
	text: ['text/plain'],
	csv: ['text/csv', 'application/csv', 'text/plain'],
	xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
	docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
	pdf: ['application/pdf']
};

export const IMPORT_VALID_WEEK_DAYS = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
] as const;
