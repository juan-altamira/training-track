import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createImportJobPayloadSchema } from '$lib/import/schemas';
import type { ImportSourceType } from '$lib/import/types';
import { requireTrainerSession, assertTrainerOwnsClient } from '$lib/server/import/auth';
import { createImportJobFromInput } from '$lib/server/import/job-service';
import { processImportJobs } from '$lib/server/import/worker';

const parseCreatePayload = async (request: Request) => {
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('multipart/form-data')) {
		const formData = await request.formData();
		const clientId = String(formData.get('client_id') || '').trim();
		const scope = String(formData.get('scope') || 'client').trim().toLowerCase();
		const sourceTypeRaw = String(formData.get('source_type') || '').trim().toLowerCase();
		const sourceType = sourceTypeRaw ? sourceTypeRaw : undefined;
		const file = formData.get('file');
		const rawText = String(formData.get('raw_text') || '').trim();

		const parsed = createImportJobPayloadSchema.safeParse({
			client_id: clientId || undefined,
			scope,
			source_type: sourceType,
			raw_text: rawText || undefined
		});
		if (!parsed.success) {
			return {
				ok: false as const,
				status: 400,
				message: 'No pudimos leer la información enviada.'
			};
		}

			if (file instanceof File) {
				const arrayBuffer = await file.arrayBuffer();
				return {
					ok: true as const,
					mode: 'file' as const,
					clientId: parsed.data.client_id ?? null,
					scope: parsed.data.scope,
					sourceType: parsed.data.source_type,
					fileName: file.name,
					mimeType: file.type || null,
					payload: new Uint8Array(arrayBuffer)
			};
		}

			if (rawText) {
				return {
					ok: true as const,
					mode: 'raw_text' as const,
					clientId: parsed.data.client_id ?? null,
					scope: parsed.data.scope,
					rawText
				};
			}

		return {
			ok: false as const,
			status: 400,
			message: 'Enviá archivo o texto.'
		};
	}

	const body = await request.json().catch(() => null);
	const parsed = createImportJobPayloadSchema.safeParse(body ?? {});
	if (!parsed.success) {
		return {
			ok: false as const,
			status: 400,
			message: 'No pudimos leer la información enviada.'
		};
	}
	if (!parsed.data.raw_text) {
		return {
			ok: false as const,
			status: 400,
			message: 'Falta el texto de la rutina.'
		};
	}
	return {
		ok: true as const,
		mode: 'raw_text' as const,
		clientId: parsed.data.client_id ?? null,
		scope: parsed.data.scope,
		rawText: parsed.data.raw_text
	};
};

export const POST: RequestHandler = async (event) => {
	const session = await requireTrainerSession(event);
	const parsed = await parseCreatePayload(event.request);
	if (!parsed.ok) {
		return json({ message: parsed.message }, { status: parsed.status });
	}

	if (parsed.scope === 'client' && parsed.clientId) {
		await assertTrainerOwnsClient(session.user.id, parsed.clientId);
	}

	const result =
		parsed.mode === 'raw_text'
			? await createImportJobFromInput({
					mode: 'raw_text',
					rawText: parsed.rawText,
					clientId: parsed.clientId,
					scope: parsed.scope,
					trainerId: session.user.id
				})
			: await createImportJobFromInput({
					mode: 'file',
					fileName: parsed.fileName,
					mimeType: parsed.mimeType,
						payload: parsed.payload,
						clientId: parsed.clientId,
						scope: parsed.scope,
						sourceType: parsed.sourceType as ImportSourceType | undefined,
						trainerId: session.user.id
					});

	if (!result.ok) {
		return json({ code: result.code, message: result.message }, { status: result.status });
	}

	// Best-effort immediate processing. Cron/tick remains the source of truth.
	void processImportJobs({
		workerId: `inline-${session.user.id.slice(0, 8)}`,
		limit: 1,
		leaseSeconds: 180
	}).catch((error) => {
		console.error('inline import worker dispatch error', error);
	});

	return json(
		{
			job_id: result.data.jobId,
			reused: result.data.reused
		},
		{ status: result.status }
	);
};
