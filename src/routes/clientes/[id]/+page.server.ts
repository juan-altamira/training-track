import { normalizePlan, normalizeProgress, WEEK_DAYS } from '$lib/routines';
import type { RoutinePlan } from '$lib/types';
import { error, fail, redirect } from '@sveltejs/kit';
import { nowIsoUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/public';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';
const MAX_EXERCISES_PER_DAY = 50;

const ensureTrainerAccess = async (rawEmail: string | null | undefined) => {
	const email = rawEmail?.toLowerCase();
	if (!email) return false;
	if (email === OWNER_EMAIL) return true;
	const { data } = await supabaseAdmin
		.from('trainer_access')
		.select('active')
		.eq('email', email)
		.maybeSingle();
	return data?.active === true;
};

export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.session) {
		throw redirect(303, '/login');
	}

	const allowed = await ensureTrainerAccess(locals.session.user.email);
	if (!allowed) {
		await locals.supabase?.auth.signOut();
		throw redirect(303, '/login');
	}

	const supabase = locals.supabase;
	const clientId = params.id;

	const { data: client, error: clientError } = await supabase
		.from('clients')
		.select('id,name,objective,status,client_code,created_at')
		.eq('id', clientId)
		.single();

	if (clientError || !client) {
		throw error(404, { message: 'Cliente no encontrado' });
	}

	const { data: routineRow, error: routineError } = await supabase
		.from('routines')
		.select('plan,reset_progress_on_change')
		.eq('client_id', clientId)
		.maybeSingle();

	if (routineError) {
		console.error(routineError);
	}

	let plan = normalizePlan(routineRow?.plan as RoutinePlan | null);
	if (!routineRow) {
		await supabase.from('routines').insert({ client_id: clientId, plan });
	}

	const { data: progressRow, error: progressError } = await supabase
		.from('progress')
		.select('progress,last_completed_at')
		.eq('client_id', clientId)
		.maybeSingle();

	if (progressError) {
		console.error(progressError);
	}

	const progress = normalizeProgress(progressRow?.progress as any);

	if (!progressRow) {
		await supabase.from('progress').insert({ client_id: clientId, progress });
	}

	const envSite = env.PUBLIC_SITE_URL?.replace(/\/?$/, '') || '';
	const origin = url.origin?.replace(/\/?$/, '') || '';
	const siteUrl = envSite && !envSite.includes('localhost') ? envSite : origin;

	const { data: otherClients } = await supabase
		.from('clients')
		.select('id,name')
		.eq('trainer_id', locals.session.user.id)
		.neq('id', clientId)
		.order('name', { ascending: true });

	return {
		client,
		plan,
		progress,
		last_completed_at: progressRow?.last_completed_at ?? null,
		siteUrl,
		otherClients: otherClients ?? []
	};
};

export const actions: Actions = {
	saveRoutine: async ({ request, params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			await locals.supabase?.auth.signOut();
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const rawPlan = String(formData.get('plan') || '');

		let parsed: RoutinePlan;
		try {
			parsed = JSON.parse(rawPlan);
		} catch (e) {
			console.error(e);
			return fail(400, { message: 'Formato de rutina inválido' });
		}

		const plan = normalizePlan(parsed);
		for (const day of Object.values(plan)) {
			if (day.exercises.length > MAX_EXERCISES_PER_DAY) {
				return fail(400, {
					message: 'Límite de 50 ejercicios por día alcanzado para este cliente.'
				});
			}
		}

		const supabase = locals.supabase;
		const nowUtc = nowIsoUtc();

		const { error: updateError } = await supabase
			.from('routines')
			.upsert({
				client_id: params.id,
				plan,
				reset_progress_on_change: true
			})
			.eq('client_id', params.id);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos guardar la rutina' });
		}

		await supabase
			.from('progress')
			.update({
				progress: normalizeProgress(null, { last_reset_utc: nowUtc, last_activity_utc: nowUtc }),
				last_completed_at: null
			})
			.eq('client_id', params.id);

		return { success: true };
	},
	resetProgress: async ({ params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			await locals.supabase?.auth.signOut();
			throw redirect(303, '/login');
		}

		const nowUtc = nowIsoUtc();
		await locals.supabase
			.from('progress')
			.update({
				progress: normalizeProgress(null, { last_reset_utc: nowUtc, last_activity_utc: nowUtc }),
				last_completed_at: null
			})
			.eq('client_id', params.id);

		return { success: true };
	},
	setStatus: async ({ request, params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			await locals.supabase?.auth.signOut();
			throw redirect(303, '/login');
		}
		const formData = await request.formData();
		const status = String(formData.get('status') || 'active');
		await locals.supabase.from('clients').update({ status }).eq('id', params.id);
		return { success: true };
	},
	delete: async ({ request, params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			throw redirect(303, '/login?disabled=1');
		}

		const formData = await request.formData();
		const confirmText = String(formData.get('confirm_text') || '');
		if (confirmText.trim().toLowerCase() !== 'eliminar') {
			return fail(400, { message: 'Debes escribir "eliminar" para confirmar' });
		}

		const supabase = locals.supabase;
		const { data: client, error: fetchError } = await supabase
			.from('clients')
			.select('id')
			.eq('id', params.id)
			.eq('trainer_id', locals.session.user.id)
			.maybeSingle();

		if (fetchError || !client) {
			return fail(403, { message: 'No podés eliminar este cliente' });
		}

		await supabase.from('progress').delete().eq('client_id', params.id);
		await supabase.from('routines').delete().eq('client_id', params.id);
		await supabase.from('clients').delete().eq('id', params.id);

		throw redirect(303, '/clientes');
	},
	copyRoutine: async ({ request, params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			await locals.supabase?.auth.signOut();
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const sourceClientId = String(formData.get('source_client_id') || '').trim();
		const targetClientId = params.id;

		if (!sourceClientId) {
			return fail(400, { message: 'Seleccioná un cliente origen' });
		}

		if (sourceClientId === targetClientId) {
			return fail(400, { message: 'No tiene sentido copiar sobre el mismo cliente' });
		}

		const supabase = locals.supabase;
		const { data: clientsPair, error: pairError } = await supabase
			.from('clients')
			.select('id,trainer_id')
			.in('id', [sourceClientId, targetClientId]);

		if (pairError || !clientsPair || clientsPair.length !== 2) {
			return fail(403, { message: 'No autorizado' });
		}

		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const ownsAll = clientsPair.every((c) => c.trainer_id === locals.session!.user.id);
		if (!ownsAll) {
			return fail(403, { message: 'No autorizado' });
		}

		const { data: sourceRoutine, error: sourceError } = await supabase
			.from('routines')
			.select('plan')
			.eq('client_id', sourceClientId)
			.maybeSingle();

		if (sourceError || !sourceRoutine) {
			return fail(400, { message: 'No se encontró la rutina origen' });
		}

		const plan = normalizePlan(sourceRoutine.plan as RoutinePlan | null);
		const nowUtc = nowIsoUtc();

		const { error: updateError } = await supabase
			.from('routines')
			.upsert({ client_id: targetClientId, plan, reset_progress_on_change: true })
			.eq('client_id', targetClientId);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos copiar la rutina' });
		}

		await supabase
			.from('progress')
			.update({
				progress: normalizeProgress(null, { last_reset_utc: nowUtc, last_activity_utc: nowUtc }),
				last_completed_at: null
			})
			.eq('client_id', targetClientId);

		return { success: true };
	}
};
