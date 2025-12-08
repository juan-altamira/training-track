import { createEmptyPlan, normalizeProgress, WEEK_DAYS } from '$lib/routines';
import type { ClientSummary } from '$lib/types';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.session) {
		throw redirect(303, '/login');
	}

	const supabase = locals.supabase;
	const { data: clients, error } = await supabase
		.from('clients')
		.select('id,name,client_code,status,objective')
		.order('created_at', { ascending: true });

	if (error) {
		console.error(error);
		throw fail(500, { message: 'No pudimos cargar los clientes' });
	}

	const clientIds = clients?.map((c) => c.id) ?? [];
	const progressMap = new Map<string, { last_completed_at: string | null; progress: unknown }>();

	if (clientIds.length > 0) {
		const { data: progressRows, error: progressError } = await supabase
			.from('progress')
			.select('client_id,last_completed_at,progress')
			.in('client_id', clientIds);

		if (progressError) {
			console.error(progressError);
			throw fail(500, { message: 'No pudimos cargar el progreso' });
		}

		progressRows?.forEach((row) => {
			progressMap.set(row.client_id, {
				last_completed_at: row.last_completed_at,
				progress: row.progress
			});
		});
	}

	const list: ClientSummary[] =
		clients?.map((client) => {
			const info = progressMap.get(client.id);
			const progressState = normalizeProgress(info?.progress as any);
			const lastCompleted =
				WEEK_DAYS.filter((day) => progressState[day.key]?.completed).at(-1)?.label ?? null;

			return {
				id: client.id,
				name: client.name,
				client_code: client.client_code,
				status: client.status as ClientSummary['status'],
				objective: client.objective,
				last_completed_at: info?.last_completed_at ?? null,
				last_day_completed: lastCompleted
			};
		}) ?? [];

	return {
		clients: list
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}
		const formData = await request.formData();
		const name = String(formData.get('name') || '').trim();
		const objective = String(formData.get('objective') || '').trim() || null;

		if (!name) {
			return fail(400, { message: 'El nombre es obligatorio' });
		}

		const supabase = locals.supabase;
		const { data: client, error } = await supabase
			.from('clients')
			.insert({
				name,
				objective,
				trainer_id: locals.session.user.id
			})
			.select()
			.single();

		if (error || !client) {
			console.error(error);
			return fail(500, { message: 'No pudimos crear el cliente' });
		}

		const defaultPlan = createEmptyPlan();
		const { error: routineError } = await supabase
			.from('routines')
			.insert({ client_id: client.id, plan: defaultPlan });

		const { error: progressError } = await supabase
			.from('progress')
			.insert({ client_id: client.id, progress: normalizeProgress() });

		if (routineError || progressError) {
			console.error({ routineError, progressError });
		}

		throw redirect(303, `/clientes/${client.id}`);
	}
};
