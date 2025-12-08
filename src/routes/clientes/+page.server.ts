import { createEmptyPlan, normalizeProgress, WEEK_DAYS } from '$lib/routines';
import type { ClientSummary } from '$lib/types';
import { daysBetweenUtc, getCurrentWeekStartUtc, nowIsoUtc } from '$lib/time';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/public';

const ensureTrainerExists = async (supabase: App.Locals['supabase'], userId: string, email: string) => {
	const { data, error } = await supabase.from('trainers').select('id').eq('id', userId).maybeSingle();
	if (error) {
		console.error('trainer lookup error', error);
		return;
	}
	if (!data) {
		const { error: insertError } = await supabase
			.from('trainers')
			.insert({ id: userId, email, status: 'active' });
		if (insertError) {
			console.error('trainer insert error', insertError);
		}
	}
};

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.session) {
		throw redirect(303, '/login');
	}

	await ensureTrainerExists(locals.supabase, locals.session.user.id, locals.session.user.email ?? '');

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
	const progressMap = new Map<
		string,
		{ last_completed_at: string | null; progress: any }
	>();

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
			const nowUtc = nowIsoUtc();
			const weekStart = getCurrentWeekStartUtc();
			const lastReset = progressState._meta?.last_reset_utc ?? null;
			const lastActivity = progressState._meta?.last_activity_utc ?? info?.last_completed_at ?? null;

			return {
				id: client.id,
				name: client.name,
				client_code: client.client_code,
				status: client.status as ClientSummary['status'],
				objective: client.objective,
				last_completed_at: info?.last_completed_at ?? null,
				last_day_completed: lastCompleted,
				last_activity_utc: lastActivity,
				last_reset_utc: lastReset,
				week_started: lastReset ? lastReset >= weekStart : false,
				days_since_activity: daysBetweenUtc(lastActivity, nowUtc)
			};
		}) ?? [];

	const envSite = env.PUBLIC_SITE_URL?.replace(/\/?$/, '') || '';
	const origin = url.origin?.replace(/\/?$/, '') || '';
	const siteUrl =
		(envSite && !envSite.includes('localhost') ? envSite : origin) ||
		'https://training-track.vercel.app';

	return {
		clients: list,
		siteUrl
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		await ensureTrainerExists(locals.supabase, locals.session.user.id, locals.session.user.email ?? '');

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

		const nowUtc = nowIsoUtc();
		const { error: progressError } = await supabase.from('progress').insert({
			client_id: client.id,
			progress: normalizeProgress(null, { last_reset_utc: nowUtc, last_activity_utc: nowUtc }),
			last_completed_at: null
		});

		if (routineError || progressError) {
			console.error({ routineError, progressError });
		}

		throw redirect(303, `/clientes/${client.id}`);
	}
};
