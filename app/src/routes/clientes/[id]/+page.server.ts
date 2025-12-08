import { normalizePlan, normalizeProgress } from '$lib/routines';
import type { RoutinePlan } from '$lib/types';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.session) {
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

	return {
		client,
		plan,
		progress,
		last_completed_at: progressRow?.last_completed_at ?? null
	};
};

export const actions: Actions = {
	saveRoutine: async ({ request, params, locals }) => {
		if (!locals.session) {
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
		const supabase = locals.supabase;

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
			.update({ progress: normalizeProgress(), last_completed_at: null })
			.eq('client_id', params.id);

		return { success: true };
	},
	resetProgress: async ({ params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		await locals.supabase
			.from('progress')
			.update({ progress: normalizeProgress(), last_completed_at: null })
			.eq('client_id', params.id);

		return { success: true };
	},
	setStatus: async ({ request, params, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}
		const formData = await request.formData();
		const status = String(formData.get('status') || 'active');
		await locals.supabase.from('clients').update({ status }).eq('id', params.id);
		return { success: true };
	}
};
