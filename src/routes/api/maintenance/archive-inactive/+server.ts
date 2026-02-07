import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { monthsBetweenUtc, nowIsoUtc } from '$lib/time';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const INACTIVITY_MONTHS = 6;

const isAuthorized = (authorizationHeader: string | null) => {
	const cronSecret = privateEnv.CRON_SECRET;
	if (!cronSecret) return false;
	return authorizationHeader === `Bearer ${cronSecret}`;
};

const archiveInactiveClients = async () => {
	const { data: activeClients, error } = await supabaseAdmin
		.from('clients')
		.select('id,status,routines(last_saved_at)')
		.eq('status', 'active');

	if (error) {
		throw error;
	}

	const nowUtc = nowIsoUtc();
	const clientsToArchive: string[] = [];

	for (const client of activeClients ?? []) {
		const routineRelation = Array.isArray(client.routines) ? client.routines[0] : client.routines;
		const lastSaved = routineRelation?.last_saved_at ?? null;
		if (!lastSaved) continue;

		const inactiveMonths = monthsBetweenUtc(lastSaved, nowUtc);
		if (inactiveMonths !== null && inactiveMonths >= INACTIVITY_MONTHS) {
			clientsToArchive.push(client.id);
		}
	}

	if (clientsToArchive.length > 0) {
		const { error: updateError } = await supabaseAdmin
			.from('clients')
			.update({ status: 'archived' })
			.in('id', clientsToArchive);

		if (updateError) {
			throw updateError;
		}
	}

	return {
		checked: activeClients?.length ?? 0,
		archived: clientsToArchive.length
	};
};

const handleRequest: RequestHandler = async ({ request }) => {
	if (!privateEnv.CRON_SECRET) {
		return json({ message: 'CRON_SECRET no configurado' }, { status: 500 });
	}

	if (!isAuthorized(request.headers.get('authorization'))) {
		return json({ message: 'No autorizado' }, { status: 401 });
	}

	try {
		const result = await archiveInactiveClients();
		return json({
			ok: true,
			...result,
			run_at: nowIsoUtc()
		});
	} catch (e) {
		console.error('archive-inactive error', e);
		return json({ ok: false, message: 'No se pudo completar el archivado' }, { status: 500 });
	}
};

export const GET: RequestHandler = handleRequest;
export const POST: RequestHandler = handleRequest;
