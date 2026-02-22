import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { patchImportDraftPayloadSchema } from '$lib/import/schemas';
import { requireTrainerSession } from '$lib/server/import/auth';
import { getImportJobForTrainer, saveImportDraftBundle, updateImportJobStatus } from '$lib/server/import/job-repo';
import { buildDraftBundle } from '$lib/server/import/validation';
import { logImportAudit } from '$lib/server/import/audit-service';

export const PATCH: RequestHandler = async (event) => {
	const session = await requireTrainerSession(event);
	const jobId = event.params.jobId;
	const payload = await event.request.json().catch(() => null);
	const parsed = patchImportDraftPayloadSchema.safeParse(payload ?? {});
	if (!parsed.success) {
		return json(
			{ message: parsed.error.issues[0]?.message ?? 'Payload inválido para draft.' },
			{ status: 400 }
		);
	}

	const job = await getImportJobForTrainer(jobId, session.user.id);
	if (!job) {
		return json({ message: 'Job no encontrado.' }, { status: 404 });
	}
	if (!['ready', 'failed'].includes(job.status)) {
		return json({ message: 'El draft solo puede editarse cuando el job está en ready/failed.' }, { status: 409 });
	}

	const bundle = buildDraftBundle(parsed.data.draft);
	await saveImportDraftBundle(jobId, bundle);
	await updateImportJobStatus({
		jobId,
		status: 'ready',
		progressStage: 'ready',
		progressPercent: 100,
		errorCode: null,
		errorMessage: null,
		clearLease: true
	});

	await logImportAudit({
		jobId,
		trainerId: session.user.id,
		clientId: job.client_id,
		event: 'draft_updated',
		payload: {
			issues_total: bundle.stats.issues_total,
			blocking_issues: bundle.stats.blocking_issues
		}
	});

	return json({
		draft: bundle.draft,
		issues: bundle.issues,
		stats: bundle.stats,
		derived_plan: bundle.derivedPlan
	});
};

