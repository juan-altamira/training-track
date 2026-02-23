import type { ImportCommitPolicy } from '$lib/import/types';
import { IMPORT_ERROR_CODES } from '$lib/import/error-codes';
import { hasBlockingIssues } from './validation';
import { getImportDraftForJob, getImportJobForTrainer, updateImportJobStatus } from './job-repo';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { logImportAudit } from './audit-service';
import { normalizeRoutineUiMeta } from '$lib/routines';
import type { RoutineUiMeta } from '$lib/types';

const parseOptimisticConflict = (message: string | null | undefined) =>
	(message ?? '').toLowerCase().includes('optimistic_lock_conflict');

const parseOptimisticConflictDetail = (detail: string | null | undefined) => {
	const value = detail ?? '';
	const expectedMatch = value.match(/expected_version=(\d+)/i);
	const currentMatch = value.match(/current_version=(\d+)/i);
	return {
		expectedVersion: expectedMatch ? Number.parseInt(expectedMatch[1], 10) : null,
		currentVersion: currentMatch ? Number.parseInt(currentMatch[1], 10) : null
	};
};

export const commitImportJob = async (params: {
	jobId: string;
	trainerId: string;
	clientId: string;
	policy: ImportCommitPolicy;
	overwriteDays?: string[] | null;
	routineVersionExpected: number;
	commitIdempotencyKey: string;
	uiMeta?: RoutineUiMeta | null;
}) => {
	const job = await getImportJobForTrainer(params.jobId, params.trainerId);
	if (!job) {
		return {
			ok: false as const,
			status: 404,
			code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
			message: 'Job de importación no encontrado.'
		};
	}

	if (job.client_id !== params.clientId) {
		return {
			ok: false as const,
			status: 403,
			code: IMPORT_ERROR_CODES.CLIENT_MISMATCH,
			message: 'El job no corresponde a este cliente.'
		};
	}

	const draftRow = await getImportDraftForJob(job.id);
	if (!draftRow) {
		return {
			ok: false as const,
			status: 409,
			code: IMPORT_ERROR_CODES.INVALID_PAYLOAD,
			message: 'El job no tiene draft listo para commit.'
		};
	}

	if (hasBlockingIssues(draftRow.issues_json)) {
		return {
			ok: false as const,
			status: 422,
			code: IMPORT_ERROR_CODES.BLOCKING_ISSUES,
			message: 'Hay errores bloqueantes en el preview. Corregí antes de confirmar.'
		};
	}

	await updateImportJobStatus({
		jobId: job.id,
		status: 'committing',
		progressStage: 'committing',
		progressPercent: 95
	});

	const draftPresentationMode =
		(draftRow.draft_json as { presentation?: { day_label_mode?: RoutineUiMeta['day_label_mode'] } })?.presentation
			?.day_label_mode ?? 'weekday';
	const resolvedUiMeta = normalizeRoutineUiMeta(
		params.uiMeta ?? {
			day_label_mode: draftPresentationMode
		}
	);

	const { data, error } = await supabaseAdmin.rpc('apply_import_commit', {
		p_job_id: job.id,
		p_trainer_id: params.trainerId,
		p_client_id: params.clientId,
		p_policy: params.policy,
		p_overwrite_days: params.policy === 'overwrite_days' ? params.overwriteDays ?? [] : null,
		p_routine_version_expected: params.routineVersionExpected,
		p_commit_idempotency_key: params.commitIdempotencyKey,
		p_next_plan: draftRow.derived_routineplan_json,
		p_next_ui_meta: resolvedUiMeta
	});

	if (error) {
		const isConflict = parseOptimisticConflict(error.message);
		const detail = parseOptimisticConflictDetail((error as any)?.details ?? error.message);
		let lastSavedAt: string | null = null;
		if (isConflict) {
			const { data: routineRow } = await supabaseAdmin
				.from('routines')
				.select('last_saved_at')
				.eq('client_id', params.clientId)
				.maybeSingle();
			lastSavedAt = (routineRow?.last_saved_at as string | null | undefined) ?? null;
		}

		await updateImportJobStatus({
			jobId: job.id,
			status: 'ready',
			progressStage: 'ready',
			progressPercent: 100,
			errorCode: isConflict ? IMPORT_ERROR_CODES.OPTIMISTIC_LOCK_CONFLICT : IMPORT_ERROR_CODES.INTERNAL_ERROR,
			errorMessage: error.message,
			clearLease: true
		});

		await logImportAudit({
			jobId: job.id,
			trainerId: params.trainerId,
			clientId: params.clientId,
			event: 'commit_failed',
			payload: {
				code: isConflict
					? IMPORT_ERROR_CODES.OPTIMISTIC_LOCK_CONFLICT
					: IMPORT_ERROR_CODES.INTERNAL_ERROR,
				error: error.message
			}
		});

		return {
			ok: false as const,
			status: isConflict ? 409 : 500,
			code: isConflict
				? IMPORT_ERROR_CODES.OPTIMISTIC_LOCK_CONFLICT
				: IMPORT_ERROR_CODES.INTERNAL_ERROR,
			message: isConflict
				? 'La rutina cambió mientras revisabas el import. Recargá y validá de nuevo.'
				: 'No pudimos confirmar el commit de importación.',
			meta: isConflict
				? {
						expected_version: detail.expectedVersion,
						current_version: detail.currentVersion,
						last_saved_at: lastSavedAt
					}
				: null
		};
	}

	const row = Array.isArray(data) ? data[0] : null;
	if (!row) {
		return {
			ok: false as const,
			status: 500,
			code: IMPORT_ERROR_CODES.INTERNAL_ERROR,
			message: 'La base de datos no devolvió un resultado válido para el commit.'
		};
	}

	await logImportAudit({
		jobId: job.id,
		trainerId: params.trainerId,
		clientId: params.clientId,
		event: 'commit_success',
		payload: {
			commit_id: row.commit_id,
			routine_version_after: row.routine_version_after,
			backup_id: row.backup_id,
			policy: params.policy,
			overwrite_days: params.overwriteDays ?? [],
			ui_meta: resolvedUiMeta
		}
	});

	return {
		ok: true as const,
		status: 200,
		data: {
			commit_id: row.commit_id as string,
			routine_version_after: row.routine_version_after as number,
			backup_id: row.backup_id as string
		}
	};
};

export const rollbackImportJob = async (params: {
	jobId: string;
	trainerId: string;
	clientId: string;
	backupId?: string | null;
}) => {
	const job = await getImportJobForTrainer(params.jobId, params.trainerId);
	if (!job) {
		return {
			ok: false as const,
			status: 404,
			code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
			message: 'Job de importación no encontrado.'
		};
	}

	const { data, error } = await supabaseAdmin.rpc('rollback_import_commit', {
		p_job_id: params.jobId,
		p_trainer_id: params.trainerId,
		p_client_id: params.clientId,
		p_backup_id: params.backupId ?? null
	});

	if (error) {
		return {
			ok: false as const,
			status: 500,
			code: IMPORT_ERROR_CODES.INTERNAL_ERROR,
			message: 'No pudimos revertir la importación.'
		};
	}

	const row = Array.isArray(data) ? data[0] : null;
	if (!row) {
		return {
			ok: false as const,
			status: 500,
			code: IMPORT_ERROR_CODES.INTERNAL_ERROR,
			message: 'Rollback sin respuesta válida de base de datos.'
		};
	}

	await logImportAudit({
		jobId: params.jobId,
		trainerId: params.trainerId,
		clientId: params.clientId,
		event: 'rollback_success',
		payload: {
			backup_id: row.backup_id,
			routine_version_after: row.routine_version_after
		}
	});

	return {
		ok: true as const,
		status: 200,
		data: {
			backup_id: row.backup_id as string,
			routine_version_after: row.routine_version_after as number
		}
	};
};
