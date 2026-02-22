import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processImportJobs } from '$lib/server/import/worker';

const isAuthorized = (authHeader: string | null) => {
	const secret = (process.env.IMPORT_INTERNAL_SECRET ?? '').trim();
	if (!secret) return false;
	return authHeader === `Bearer ${secret}`;
};

export const POST: RequestHandler = async ({ request, url }) => {
	if (!isAuthorized(request.headers.get('authorization'))) {
		return json({ message: 'No autorizado' }, { status: 401 });
	}

	const limit = Number.parseInt(url.searchParams.get('limit') ?? '3', 10);
	const leaseSeconds = Number.parseInt(url.searchParams.get('lease_seconds') ?? '180', 10);
	const result = await processImportJobs({
		workerId: `cron-${Math.random().toString(36).slice(2, 8)}`,
		limit: Number.isFinite(limit) ? limit : 3,
		leaseSeconds: Number.isFinite(leaseSeconds) ? leaseSeconds : 180
	});

	return json({
		ok: true,
		...result,
		run_at: new Date().toISOString()
	});
};

export const GET: RequestHandler = POST;

