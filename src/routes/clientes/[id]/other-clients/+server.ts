import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureTrainerAccess } from '$lib/server/trainerAccess';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.session) {
		return json({ message: 'No autenticado' }, { status: 401 });
	}

	const allowed = await ensureTrainerAccess(locals.session.user.email);
	if (!allowed) {
		await locals.supabase?.auth.signOut();
		return json({ message: 'Acceso deshabilitado' }, { status: 403 });
	}

	const trainerId = locals.session.user.id;
	const clientId = params.id;

	const { data: client, error: clientError } = await locals.supabase
		.from('clients')
		.select('id')
		.eq('id', clientId)
		.eq('trainer_id', trainerId)
		.maybeSingle();

	if (clientError || !client) {
		return json({ message: 'Alumno no encontrado' }, { status: 404 });
	}

	const { data: otherClients, error } = await locals.supabase
		.from('clients')
		.select('id,name')
		.eq('trainer_id', trainerId)
		.neq('id', clientId)
		.order('name', { ascending: true });

	if (error) {
		console.error(error);
		return json({ message: 'No pudimos cargar los alumnos' }, { status: 500 });
	}

	return json({ otherClients: otherClients ?? [] });
};
