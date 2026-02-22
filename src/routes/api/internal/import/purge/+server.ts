import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const isAuthorized = (authHeader: string | null) => {
	const secret = (process.env.IMPORT_INTERNAL_SECRET ?? '').trim();
	if (!secret) return false;
	return authHeader === `Bearer ${secret}`;
};

export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorized(request.headers.get('authorization'))) {
		return json({ message: 'No autorizado' }, { status: 401 });
	}

	const { data, error } = await supabaseAdmin.rpc('purge_import_data');
	if (error) {
		console.error('purge_import_data rpc error', error);
		return json({ ok: false, message: 'No se pudo purgar datos de importación' }, { status: 500 });
	}

	const row = Array.isArray(data) ? data[0] : null;
	return json({
		ok: true,
		artifacts_deleted: row?.artifacts_deleted ?? 0,
		jobs_expired: row?.jobs_expired ?? 0,
		jobs_deleted: row?.jobs_deleted ?? 0,
		backups_deleted: row?.backups_deleted ?? 0,
		run_at: new Date().toISOString()
	});
};

export const GET: RequestHandler = POST;

