import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTrainerSession } from '$lib/server/import/auth';
import {
	getImportDraftForJob,
	getImportJobForTrainer,
	saveImportDraftBundle
} from '$lib/server/import/job-repo';
import { buildDraftBundle } from '$lib/server/import/validation';
import type { ImportDraftBundle, ImportDraft } from '$lib/import/types';

const serializeBundle = (bundle: ImportDraftBundle) =>
	JSON.stringify({
		draft: bundle.draft,
		issues: bundle.issues,
		derivedPlan: bundle.derivedPlan,
		stats: bundle.stats
	});

export const GET: RequestHandler = async (event) => {
	const session = await requireTrainerSession(event);
	const jobId = event.params.jobId;
	const job = await getImportJobForTrainer(jobId, session.user.id);
	if (!job) {
		return json({ message: 'No encontramos esta carga.' }, { status: 404 });
	}

	const draftRow = await getImportDraftForJob(job.id);
	let currentBundle: ImportDraftBundle | null = null;
	if (draftRow?.draft_json) {
		const rebuiltBundle = buildDraftBundle(draftRow.draft_json as ImportDraft);
		currentBundle = rebuiltBundle;
		const persistedBundle: ImportDraftBundle = {
			draft: (draftRow.draft_json as ImportDraft) ?? rebuiltBundle.draft,
			issues: draftRow.issues_json ?? [],
			derivedPlan: draftRow.derived_routineplan_json ?? rebuiltBundle.derivedPlan,
			stats: draftRow.stats_json ?? rebuiltBundle.stats
		};
		if (serializeBundle(rebuiltBundle) !== serializeBundle(persistedBundle)) {
			await saveImportDraftBundle(job.id, rebuiltBundle);
		}
	}

	return json({
		job: {
			id: job.id,
			status: job.status,
			source_type: job.source_type,
			scope: job.scope,
			client_id: job.client_id,
			attempts: job.attempts,
			max_attempts: job.max_attempts,
			progress_stage: job.progress_stage,
			progress_percent: job.progress_percent,
			error_code: job.error_code,
			error_message: job.error_message,
			last_error_code: job.last_error_code,
			last_error_message: job.last_error_message,
			last_error_at: job.last_error_at,
			created_at: job.created_at,
			updated_at: job.updated_at,
			expires_at: job.expires_at
		},
		draft: currentBundle?.draft ?? draftRow?.draft_json ?? null,
		issues: currentBundle?.issues ?? draftRow?.issues_json ?? [],
		stats: currentBundle?.stats ?? draftRow?.stats_json ?? null,
		derived_plan: currentBundle?.derivedPlan ?? draftRow?.derived_routineplan_json ?? null
	});
};
