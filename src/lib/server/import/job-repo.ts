import type {
	ImportDraftBundle,
	ImportDraftRow,
	ImportJobRow,
	ImportJobScope,
	ImportJobStatus,
	ImportSourceType
} from '$lib/import/types';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { addHoursIso, fromBase64, toBase64 } from './utils';
import { IMPORT_ARTIFACT_TTL_HOURS } from './constants';

type CreateImportJobInput = {
	trainerId: string;
	clientId: string | null;
	scope: ImportJobScope;
	sourceType: ImportSourceType;
	fileHash: string;
	storagePath: string | null;
	fileMeta: Record<string, unknown>;
	parserVersion: string;
	rulesetVersion: string;
	extractorVersion: string;
	expiresAt?: string | null;
};

export const createImportJob = async (input: CreateImportJobInput): Promise<ImportJobRow> => {
	const { data, error } = await supabaseAdmin
		.from('import_jobs')
		.insert({
			trainer_id: input.trainerId,
			client_id: input.clientId,
			scope: input.scope,
			status: 'queued',
			source_type: input.sourceType,
			file_hash_sha256: input.fileHash,
			storage_path: input.storagePath,
			file_meta: input.fileMeta,
			parser_version: input.parserVersion,
			ruleset_version: input.rulesetVersion,
			extractor_version: input.extractorVersion,
			progress_stage: 'queued',
			progress_percent: 0,
			expires_at: input.expiresAt ?? addHoursIso(IMPORT_ARTIFACT_TTL_HOURS)
		})
		.select('*')
		.single();

	if (error || !data) {
		throw new Error(`create import job failed: ${error?.message ?? 'unknown error'}`);
	}

	return data as ImportJobRow;
};

export const saveImportJobArtifact = async (params: {
	jobId: string;
	payload: Uint8Array;
	mimeType: string | null;
	fileName: string | null;
	expiresAt?: string | null;
}) => {
	const { error } = await supabaseAdmin.from('import_job_artifacts').upsert(
		{
			job_id: params.jobId,
			payload_base64: toBase64(params.payload),
			mime_type: params.mimeType,
			file_name: params.fileName,
			expires_at: params.expiresAt ?? addHoursIso(IMPORT_ARTIFACT_TTL_HOURS)
		},
		{ onConflict: 'job_id' }
	);

	if (error) {
		throw new Error(`save import artifact failed: ${error.message}`);
	}
};

export const findReusableImportJob = async (params: {
	trainerId: string;
	clientId: string | null;
	scope: ImportJobScope;
	fileHash: string;
	parserVersion: string;
	rulesetVersion: string;
	extractorVersion: string;
}) => {
	let query = supabaseAdmin
		.from('import_jobs')
		.select('*')
		.eq('trainer_id', params.trainerId)
		.eq('scope', params.scope)
		.eq('file_hash_sha256', params.fileHash)
		.eq('parser_version', params.parserVersion)
		.eq('ruleset_version', params.rulesetVersion)
		.eq('extractor_version', params.extractorVersion)
		.in('status', ['queued', 'processing', 'ready'])
		.order('created_at', { ascending: false })
		.limit(1);

	if (params.clientId) {
		query = query.eq('client_id', params.clientId);
	}

	const { data, error } = await query.maybeSingle();
	if (error) {
		throw new Error(`find reusable import job failed: ${error.message}`);
	}
	return (data as ImportJobRow | null) ?? null;
};

export const getImportJobById = async (jobId: string): Promise<ImportJobRow | null> => {
	const { data, error } = await supabaseAdmin
		.from('import_jobs')
		.select('*')
		.eq('id', jobId)
		.maybeSingle();
	if (error) {
		throw new Error(`get import job failed: ${error.message}`);
	}
	return (data as ImportJobRow | null) ?? null;
};

export const getImportJobForTrainer = async (
	jobId: string,
	trainerId: string
): Promise<ImportJobRow | null> => {
	const { data, error } = await supabaseAdmin
		.from('import_jobs')
		.select('*')
		.eq('id', jobId)
		.eq('trainer_id', trainerId)
		.maybeSingle();
	if (error) {
		throw new Error(`get import job for trainer failed: ${error.message}`);
	}
	return (data as ImportJobRow | null) ?? null;
};

export const getImportJobArtifactPayload = async (jobId: string): Promise<Uint8Array | null> => {
	const { data, error } = await supabaseAdmin
		.from('import_job_artifacts')
		.select('payload_base64')
		.eq('job_id', jobId)
		.maybeSingle();
	if (error) {
		throw new Error(`get import artifact failed: ${error.message}`);
	}
	if (!data?.payload_base64) return null;
	return fromBase64(data.payload_base64);
};

export const saveImportDraftBundle = async (jobId: string, bundle: ImportDraftBundle) => {
	const { error } = await supabaseAdmin.from('import_drafts').upsert(
		{
			job_id: jobId,
			draft_json: bundle.draft,
			issues_json: bundle.issues,
			derived_routineplan_json: bundle.derivedPlan,
			stats_json: bundle.stats
		},
		{ onConflict: 'job_id' }
	);
	if (error) {
		throw new Error(`save import draft bundle failed: ${error.message}`);
	}
};

export const getImportDraftForJob = async (jobId: string): Promise<ImportDraftRow | null> => {
	const { data, error } = await supabaseAdmin
		.from('import_drafts')
		.select('*')
		.eq('job_id', jobId)
		.maybeSingle();
	if (error) {
		throw new Error(`get import draft failed: ${error.message}`);
	}
	return (data as ImportDraftRow | null) ?? null;
};

export const updateImportJobStatus = async (params: {
	jobId: string;
	status: ImportJobStatus;
	progressStage: string;
	progressPercent: number;
	errorCode?: string | null;
	errorMessage?: string | null;
	clearLease?: boolean;
}) => {
	const payload: Record<string, unknown> = {
		status: params.status,
		progress_stage: params.progressStage,
		progress_percent: params.progressPercent,
		error_code: params.errorCode ?? null,
		error_message: params.errorMessage ?? null
	};
	if (params.clearLease) {
		payload.lease_owner = null;
		payload.lease_expires_at = null;
	}
	const { error } = await supabaseAdmin.from('import_jobs').update(payload).eq('id', params.jobId);
	if (error) {
		throw new Error(`update import job status failed: ${error.message}`);
	}
};

export const claimImportJobs = async (workerId: string, limit: number, leaseSeconds: number) => {
	const { data, error } = await supabaseAdmin.rpc('claim_import_jobs', {
		p_worker_id: workerId,
		p_limit: limit,
		p_lease_seconds: leaseSeconds
	});
	if (error) {
		throw new Error(`claim import jobs failed: ${error.message}`);
	}
	return (Array.isArray(data) ? data : []) as ImportJobRow[];
};

