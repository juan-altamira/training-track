import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importCommitPayloadSchema } from '$lib/import/schemas';
import { requireTrainerSession } from '$lib/server/import/auth';
import { getImportJobForTrainer } from '$lib/server/import/job-repo';
import { commitImportJob } from '$lib/server/import/commit-service';

export const POST: RequestHandler = async (event) => {
	const session = await requireTrainerSession(event);
	const payload = await event.request.json().catch(() => null);
	const parsed = importCommitPayloadSchema.safeParse(payload ?? {});
	if (!parsed.success) {
		return json(
			{ message: parsed.error.issues[0]?.message ?? 'Payload inválido para commit.' },
			{ status: 400 }
		);
	}

	const job = await getImportJobForTrainer(event.params.jobId, session.user.id);
	if (!job) {
		return json({ message: 'Job no encontrado.' }, { status: 404 });
	}
	if (!job.client_id) {
		return json({ message: 'El job no está asociado a un cliente.' }, { status: 422 });
	}
	if (job.status !== 'ready' && job.status !== 'committed') {
		return json(
			{ message: `El job debe estar en estado ready para confirmar (estado actual: ${job.status}).` },
			{ status: 409 }
		);
	}

	const overwriteDays = parsed.data.policy === 'overwrite_days' ? parsed.data.overwrite_days ?? [] : [];
	if (parsed.data.policy === 'overwrite_days' && overwriteDays.length === 0) {
		return json({ message: 'Debés seleccionar al menos un día para reemplazar.' }, { status: 422 });
	}

	const result = await commitImportJob({
		jobId: job.id,
		trainerId: session.user.id,
		clientId: job.client_id,
		policy: parsed.data.policy,
		overwriteDays,
		routineVersionExpected: parsed.data.routine_version_expected,
		commitIdempotencyKey: parsed.data.commit_idempotency_key
	});

	if (!result.ok) {
		return json(
			{
				code: result.code,
				message: result.message,
				...(result.meta ? result.meta : {})
			},
			{ status: result.status }
		);
	}

	return json({
		ok: true,
		...result.data
	});
};
