import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTrainerAccessStatusByEmail } from '$lib/server/trainerAccess';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.session) {
		return json(
			{
				allowed: false,
				reason: 'unauthenticated'
			},
			{ status: 401 }
		);
	}

	const status = await getTrainerAccessStatusByEmail(locals.session.user.email);

	if (!status.allowed) {
		await locals.supabase?.auth.signOut();
		return json(status, { status: 403 });
	}

	return json(status);
};
