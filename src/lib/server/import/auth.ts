import { ensureTrainerAccess } from '$lib/server/trainerAccess';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export const requireTrainerSession = async (event: RequestEvent) => {
	const session = event.locals.session;
	if (!session) {
		throw redirect(303, '/login');
	}
	const allowed = await ensureTrainerAccess(session.user.email);
	if (!allowed) {
		await event.locals.supabase?.auth.signOut();
		throw redirect(303, '/login');
	}
	return session;
};

export const assertTrainerOwnsClient = async (trainerId: string, clientId: string) => {
	const { data: client, error: clientError } = await supabaseAdmin
		.from('clients')
		.select('id,trainer_id')
		.eq('id', clientId)
		.maybeSingle();

	if (clientError) {
		console.error('import ownership check error', clientError);
		throw error(500, { message: 'No pudimos validar permisos del cliente.' });
	}

	if (!client || client.trainer_id !== trainerId) {
		throw error(403, { message: 'No autorizado para este cliente.' });
	}
};

