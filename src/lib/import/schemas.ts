import { z } from 'zod';
import {
	IMPORT_COMMIT_POLICY,
	IMPORT_INFERENCE_REASON,
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

const parsedBlockContextSchema = z.union([
	z.object({
		kind: z.literal('circuit'),
		rounds: z.number().int().positive().optional(),
		header_text: z.string().min(1),
		header_unit_id: z.string().min(1)
	}),
	z.object({
		kind: z.literal('superset'),
		group_id: z.string().optional(),
		index: z.number().int().positive().optional(),
		header_text: z.string().min(1),
		header_unit_id: z.string().min(1)
	})
]);

const parsedShapeBaseSchema = z.object({
	version: z.literal(1),
	evidence: z.enum(['explicit', 'heuristic']),
	inference_reasons: z.array(z.enum(IMPORT_INFERENCE_REASON)).optional(),
	block: parsedBlockContextSchema.optional()
});

const fixedShapeSchema = parsedShapeBaseSchema.extend({
	kind: z.literal('fixed'),
	sets: z.number().int().min(1).max(50),
	reps_min: z.number().int().min(1),
	reps_max: z.null().optional()
});

const rangeShapeSchema = parsedShapeBaseSchema
	.extend({
		kind: z.literal('range'),
		sets: z.number().int().min(1).max(50),
		reps_min: z.number().int().min(1),
		reps_max: z.number().int().min(1)
	})
	.refine((shape) => shape.reps_max >= shape.reps_min, {
		message: 'reps_max must be >= reps_min',
		path: ['reps_max']
	});

const schemeShapeSchema = parsedShapeBaseSchema
	.extend({
		kind: z.literal('scheme'),
		sets: z.number().int().min(1).max(50),
		reps_list: z.array(z.number().int().min(1)).min(1)
	})
	.refine((shape) => shape.reps_list.length === shape.sets, {
		message: 'reps_list length must equal sets',
		path: ['reps_list']
	});

const amrapShapeSchema = parsedShapeBaseSchema.extend({
	kind: z.literal('amrap'),
	sets: z.number().int().min(1).max(50)
});

const loadLadderEntrySchema = z.object({
	weight: z.number().positive(),
	reps: z.number().int().min(1),
	unit: z.enum(['kg', 'lb']).nullable()
});

const loadLadderShapeSchema = parsedShapeBaseSchema.extend({
	kind: z.literal('load_ladder'),
	load_entries: z.array(loadLadderEntrySchema).min(2)
});

const parsedShapeSchema = z.union([
	fixedShapeSchema,
	rangeShapeSchema,
	schemeShapeSchema,
	amrapShapeSchema,
	loadLadderShapeSchema
]);

const draftNodeSchema = z.object({
	id: z.string().min(1),
	source_raw_name: z.string().min(1),
	raw_exercise_name: z.string().min(1),
	sets: z.number().int().positive().nullable(),
	reps_mode: z.enum(['number', 'special']).default('number'),
	reps_text: z.string().nullable(),
	reps_min: z.number().int().positive().nullable(),
	reps_max: z.number().int().positive().nullable(),
	reps_special: z.string().max(80).nullable(),
	note: z.string().nullable(),
	parsed_shape: parsedShapeSchema.nullable().optional(),
	split_meta: splitMetaSchema.nullable(),
	field_meta: z.object({
		day: nodeFieldMetaSchema,
		name: nodeFieldMetaSchema,
		sets: nodeFieldMetaSchema,
		reps: nodeFieldMetaSchema,
		note: nodeFieldMetaSchema.nullable()
	}),
	debug: z
		.object({
			path: z.enum(['contract', 'legacy']),
			struct_tokens_used_count: z.number().int().nonnegative()
		})
		.optional()
});

const draftBlockSchema = z.object({
	id: z.string().min(1),
	block_type: z.enum(['single', 'superset', 'circuit', 'unknown']),
	nodes: z.array(draftNodeSchema)
});

const draftDaySchema = z.object({
	id: z.string().min(1),
	source_label: z.string().min(1),
	display_label: z.string().max(40).nullable().optional().default(null),
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
			unresolved_multi_exercise_lines: z.number().int().nonnegative().optional(),
			contract_lines_total: z.number().int().nonnegative().optional(),
			contract_lines_parsed: z.number().int().nonnegative().optional(),
			contract_lines_failed_invariants: z.number().int().nonnegative().optional(),
			legacy_fallback_hits: z.number().int().nonnegative().optional()
		}),
	presentation: z
		.object({
			day_label_mode: z.enum(['weekday', 'sequential', 'custom'])
		})
		.optional()
		.default({ day_label_mode: 'weekday' }),
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
				message: 'Falta seleccionar el alumno.',
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
	ui_meta: z
		.object({
			day_label_mode: z.enum(['weekday', 'sequential', 'custom']),
			hide_empty_days_in_sequential: z.boolean().optional()
		})
		.optional(),
	routine_version_expected: z.number().int().positive(),
	commit_idempotency_key: z.string().min(1).max(128)
});

export const importRollbackPayloadSchema = z.object({
	backup_id: z.string().uuid().optional()
});

export const importJobStatusSchema = z.enum(IMPORT_JOB_STATUS);
