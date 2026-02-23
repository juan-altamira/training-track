import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importRollbackPayloadSchema } from '$lib/import/schemas';
import { requireTrainerSession } from '$lib/server/import/auth';
import { getImportJobForTrainer } from '$lib/server/import/job-repo';
import { rollbackImportJob } from '$lib/server/import/commit-service';

export const POST: RequestHandler = async (event) => {
	const session = await requireTrainerSession(event);
	const payload = await event.request.json().catch(() => ({}));
	const parsed = importRollbackPayloadSchema.safeParse(payload ?? {});
	if (!parsed.success) {
		return json(
			{ message: 'No pudimos leer los datos para deshacer los cambios.' },
			{ status: 400 }
		);
	}

	const job = await getImportJobForTrainer(event.params.jobId, session.user.id);
	if (!job) {
		return json({ message: 'No encontramos esta carga.' }, { status: 404 });
	}
	if (!job.client_id) {
		return json({ message: 'Esta carga no está vinculada a un alumno.' }, { status: 422 });
	}

	const result = await rollbackImportJob({
		jobId: job.id,
		trainerId: session.user.id,
		clientId: job.client_id,
		backupId: parsed.data.backup_id ?? null
	});

	if (!result.ok) {
		return json({ code: result.code, message: result.message }, { status: result.status });
	}

	return json({
		ok: true,
		...result.data
	});
};
