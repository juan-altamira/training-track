import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchTrainerAdminData, isOwnerEmail } from '$lib/server/trainerAccess';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.session) {
		return json({ message: 'No autenticado' }, { status: 401 });
	}

	if (!isOwnerEmail(locals.session.user.email)) {
		return json({ message: 'No autorizado' }, { status: 403 });
	}

	const trainers = await fetchTrainerAdminData();
	return json({ trainers });
};
