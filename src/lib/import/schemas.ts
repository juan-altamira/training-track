import { z } from 'zod';
import {
	IMPORT_COMMIT_POLICY,
	IMPORT_ISSUE_SEVERITY,
	IMPORT_JOB_SCOPE,
	IMPORT_JOB_STATUS,
	IMPORT_NAME_SPLIT_CONFIDENCE_DELTA,
	IMPORT_NAME_SPLIT_DECISION,
	IMPORT_SOURCE_TYPE
} from './types';

const fieldConfidenceSchema = z.object({
	score: z.number().min(0).max(1),
	label: z.enum(['high', 'medium', 'low'])
});

const fieldProvenanceSchema = z.object({
	source_page: z.number().int().nonnegative().nullable().optional(),
	line_index: z.number().int().nonnegative().nullable().optional(),
	line_span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable().optional(),
	bbox: z
		.tuple([z.number(), z.number(), z.number(), z.number()])
		.nullable()
		.optional(),
	raw_snippet: z.string().default('')
});

const nodeFieldMetaSchema = z.object({
	confidence: fieldConfidenceSchema,
	provenance: fieldProvenanceSchema.nullable()
});

const splitMetaSchema = z.object({
	decision: z.enum(IMPORT_NAME_SPLIT_DECISION),
	reason: z.string().min(1),
	confidence_delta: z.enum(IMPORT_NAME_SPLIT_CONFIDENCE_DELTA),
	tail_original: z.string().nullable()
});

const draftNodeSchema = z.object({
	id: z.string().min(1),
	source_raw_name: z.string().min(1),
	raw_exercise_name: z.string().min(1),
	sets: z.number().int().positive().nullable(),
	reps_text: z.string().nullable(),
	reps_min: z.number().int().positive().nullable(),
	reps_max: z.number().int().positive().nullable(),
	note: z.string().nullable(),
	split_meta: splitMetaSchema.nullable(),
	field_meta: z.object({
		day: nodeFieldMetaSchema,
		name: nodeFieldMetaSchema,
		sets: nodeFieldMetaSchema,
		reps: nodeFieldMetaSchema,
		note: nodeFieldMetaSchema.nullable()
	})
});

const draftBlockSchema = z.object({
	id: z.string().min(1),
	block_type: z.enum(['single', 'superset', 'circuit', 'unknown']),
	nodes: z.array(draftNodeSchema)
});

const draftDaySchema = z.object({
	id: z.string().min(1),
	source_label: z.string().min(1),
	mapped_day_key: z
		.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
		.nullable(),
	blocks: z.array(draftBlockSchema)
});

export const importDraftSchema = z.object({
	version: z.number().int().positive(),
	source_type: z.enum(IMPORT_SOURCE_TYPE),
	parser_version: z.string().min(1),
	ruleset_version: z.string().min(1),
	extractor_version: z.string().min(1),
	coverage: z.object({
		days_detected: z.number().int().nonnegative(),
		exercises_parsed: z.number().int().nonnegative(),
		candidate_lines: z.number().int().nonnegative(),
		parsed_lines: z.number().int().nonnegative(),
		parseable_ratio: z.number().min(0).max(1),
		required_fields_ratio: z.number().min(0).max(1),
		lines_in: z.number().int().nonnegative().optional(),
		lines_after_split: z.number().int().nonnegative().optional(),
		lines_with_prescription_detected: z.number().int().nonnegative().optional(),
		exercise_nodes_out: z.number().int().nonnegative().optional(),
		multi_exercise_splits_applied: z.number().int().nonnegative().optional(),
		unresolved_multi_exercise_lines: z.number().int().nonnegative().optional()
	}),
	days: z.array(draftDaySchema)
});

export const importIssueSchema = z.object({
	severity: z.enum(IMPORT_ISSUE_SEVERITY),
	code: z.string().min(1),
	scope: z.enum(['job', 'day', 'block', 'node', 'field']),
	path: z.string().min(1),
	message: z.string().min(1),
	provenance: fieldProvenanceSchema.nullable(),
	suggested_fix: z.string().nullable().optional()
});

export const importStatsSchema = z.object({
	days_detected: z.number().int().nonnegative(),
	exercises_parsed: z.number().int().nonnegative(),
	issues_total: z.number().int().nonnegative(),
	blocking_issues: z.number().int().nonnegative(),
	low_confidence_fields: z.number().int().nonnegative(),
	parseable_ratio: z.number().min(0).max(1),
	required_fields_ratio: z.number().min(0).max(1)
});

export const createImportJobPayloadSchema = z
	.object({
		client_id: z.string().uuid().optional(),
		scope: z.enum(IMPORT_JOB_SCOPE).default('client'),
		source_type: z.enum(IMPORT_SOURCE_TYPE).optional(),
		raw_text: z.string().min(1).max(200000).optional()
	})
	.superRefine((value, ctx) => {
		if (value.scope === 'client' && !value.client_id) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'client_id is required for client scope',
				path: ['client_id']
			});
		}
	});

export const patchImportDraftPayloadSchema = z.object({
	draft: importDraftSchema
});

export const importCommitPayloadSchema = z.object({
	policy: z.enum(IMPORT_COMMIT_POLICY),
	overwrite_days: z
		.array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']))
		.optional(),
	routine_version_expected: z.number().int().positive(),
	commit_idempotency_key: z.string().min(1).max(128)
});

export const importRollbackPayloadSchema = z.object({
	backup_id: z.string().uuid().optional()
});

export const importJobStatusSchema = z.enum(IMPORT_JOB_STATUS);
