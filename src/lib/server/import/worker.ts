import type { ImportJobRow } from '$lib/import/types';
import { IMPORT_ERROR_CODES } from '$lib/import/error-codes';
import {
	IMPORT_EXTRACTOR_VERSION,
	IMPORT_PARSER_VERSION,
	IMPORT_RULESET_VERSION
} from './constants';
import { logImportAudit } from './audit-service';
import {
	claimImportJobs,
	getImportJobArtifactPayload,
	saveImportDraftBundle,
	updateImportJobStatus
} from './job-repo';
import { parseImportPayloadBySource } from './parsers';
import { buildDraftBundle } from './validation';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const hasCoverageHardFailure = (job: ImportJobRow, issueCodes: string[]) =>
	job.source_type === 'pdf' &&
	issueCodes.some((code) =>
		[
			'pdf_days_below_threshold',
			'pdf_exercises_below_threshold',
			'pdf_parseable_ratio_below_threshold',
			'pdf_required_fields_ratio_below_threshold'
		].includes(code)
	);

const hasNonRecoverableHardFailure = (issueCodes: string[]) =>
	issueCodes.some((code) => code === IMPORT_ERROR_CODES.NO_EXERCISES_DETECTED);

const isTenantKillSwitched = async (trainerId: string) => {
	const { data, error } = await supabaseAdmin
		.from('import_tenant_limits')
		.select('kill_switch')
		.eq('trainer_id', trainerId)
		.maybeSingle();

	if (error) {
		console.error('import tenant limit lookup error', error);
		return false;
	}

	return data?.kill_switch === true;
};

const processSingleJob = async (job: ImportJobRow) => {
	const artifactPayload = await getImportJobArtifactPayload(job.id);
	if (!artifactPayload) {
		await updateImportJobStatus({
			jobId: job.id,
			status: 'failed',
			progressStage: 'failed',
			progressPercent: 100,
			errorCode: IMPORT_ERROR_CODES.PROCESSING_FAILED,
			errorMessage: 'No encontramos el artefacto del job para procesar.',
			clearLease: true
		});
		await logImportAudit({
			jobId: job.id,
			trainerId: job.trainer_id,
			clientId: job.client_id,
			event: 'failed',
			payload: { code: IMPORT_ERROR_CODES.PROCESSING_FAILED, message: 'missing artifact payload' }
		});
		return;
	}

	await updateImportJobStatus({
		jobId: job.id,
		status: 'processing',
		progressStage: 'extracting',
		progressPercent: 20
	});

	const parsed = await parseImportPayloadBySource(job.source_type, artifactPayload, {
		sourceType: job.source_type,
		parserVersion: job.parser_version || IMPORT_PARSER_VERSION,
		rulesetVersion: job.ruleset_version || IMPORT_RULESET_VERSION,
		extractorVersion: job.extractor_version || IMPORT_EXTRACTOR_VERSION
	});

	await updateImportJobStatus({
		jobId: job.id,
		status: 'processing',
		progressStage: 'validating',
		progressPercent: 70
	});

	const bundle = buildDraftBundle(parsed.draft);
	await saveImportDraftBundle(job.id, bundle);

	const issueCodes = bundle.issues.map((issue) => issue.code);
	if (hasNonRecoverableHardFailure(issueCodes)) {
		await updateImportJobStatus({
			jobId: job.id,
			status: 'failed',
			progressStage: 'failed',
			progressPercent: 100,
			errorCode: IMPORT_ERROR_CODES.NO_EXERCISES_DETECTED,
			errorMessage:
				'No detectamos ejercicios válidos para construir la rutina. Revisá formato y volvé a intentar.',
			clearLease: true
		});
		await logImportAudit({
			jobId: job.id,
			trainerId: job.trainer_id,
			clientId: job.client_id,
			event: 'failed',
			payload: {
				code: IMPORT_ERROR_CODES.NO_EXERCISES_DETECTED,
				issue_codes: issueCodes
			}
		});
		return;
	}

	if (hasCoverageHardFailure(job, issueCodes)) {
		await updateImportJobStatus({
			jobId: job.id,
			status: 'failed',
			progressStage: 'failed',
			progressPercent: 100,
			errorCode: IMPORT_ERROR_CODES.PDF_LAYOUT_UNRESOLVED,
			errorMessage: 'No alcanzó cobertura mínima para PDF digital en V1.',
			clearLease: true
		});
		await logImportAudit({
			jobId: job.id,
			trainerId: job.trainer_id,
			clientId: job.client_id,
			event: 'failed',
			payload: {
				code: IMPORT_ERROR_CODES.PDF_LAYOUT_UNRESOLVED,
				issue_codes: issueCodes
			}
		});
		return;
	}

	await updateImportJobStatus({
		jobId: job.id,
		status: 'ready',
		progressStage: 'ready',
		progressPercent: 100,
		errorCode: null,
		errorMessage: null,
		clearLease: true
	});

	await logImportAudit({
		jobId: job.id,
		trainerId: job.trainer_id,
		clientId: job.client_id,
		event: 'ready',
		payload: {
			stats: bundle.stats
		}
	});
};

export const processImportJobs = async (params?: {
	workerId?: string;
	limit?: number;
	leaseSeconds?: number;
}) => {
	const workerId = params?.workerId ?? `worker-${Math.random().toString(36).slice(2, 8)}`;
	const limit = Math.max(1, Math.min(params?.limit ?? 3, 20));
	const leaseSeconds = Math.max(30, Math.min(params?.leaseSeconds ?? 180, 900));

	const claimedJobs = await claimImportJobs(workerId, limit, leaseSeconds);
	let processed = 0;
	let failed = 0;

	for (const job of claimedJobs) {
		try {
			if (await isTenantKillSwitched(job.trainer_id)) {
				await updateImportJobStatus({
					jobId: job.id,
					status: 'failed',
					progressStage: 'failed',
					progressPercent: 100,
					errorCode: IMPORT_ERROR_CODES.KILL_SWITCH_ENABLED,
					errorMessage: 'Importaciones desactivadas para este entrenador.',
					clearLease: true
				});
				await logImportAudit({
					jobId: job.id,
					trainerId: job.trainer_id,
					clientId: job.client_id,
					event: 'failed',
					payload: { code: IMPORT_ERROR_CODES.KILL_SWITCH_ENABLED }
				});
				failed += 1;
				continue;
			}

			await processSingleJob(job);
			processed += 1;
		} catch (e) {
			console.error('import worker job failure', e);
			await updateImportJobStatus({
				jobId: job.id,
				status: 'failed',
				progressStage: 'failed',
				progressPercent: 100,
				errorCode: IMPORT_ERROR_CODES.PROCESSING_FAILED,
				errorMessage: e instanceof Error ? e.message : 'processing failed',
				clearLease: true
			});
			await logImportAudit({
				jobId: job.id,
				trainerId: job.trainer_id,
				clientId: job.client_id,
				event: 'failed',
				payload: {
					code: IMPORT_ERROR_CODES.PROCESSING_FAILED,
					error: e instanceof Error ? e.message : 'unknown'
				}
			});
			failed += 1;
		}
	}

	return {
		claimed: claimedJobs.length,
		processed,
		failed
	};
};
