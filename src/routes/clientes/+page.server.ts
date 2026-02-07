import { createEmptyPlan, normalizeProgress, WEEK_DAYS } from '$lib/routines';
import type { ClientSummary } from '$lib/types';
import { daysBetweenUtc, getCurrentWeekStartUtc, nowIsoUtc } from '$lib/time';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import {
	OWNER_EMAIL,
	ensureTrainerAccess,
	ensureTrainerExists,
	fetchTrainerAdminData,
	isOwnerEmail
} from '$lib/server/trainerAccess';
import { logLoadDuration } from '$lib/server/loadPerf';

const MAX_CLIENTS_PER_TRAINER = 100;

type ProgressRelation = {
	last_completed_at: string | null;
	progress: unknown;
};

type ClientWithProgress = {
	id: string;
	name: string;
	client_code: string;
	status: string;
	objective: string | null;
	progress?: ProgressRelation | ProgressRelation[] | null;
};

const toProgressRow = (value: ClientWithProgress['progress']): ProgressRelation | null => {
	if (!value) return null;
	return Array.isArray(value) ? (value[0] ?? null) : value;
};

const toClientSummaries = (clients: ClientWithProgress[]) => {
	const nowUtc = nowIsoUtc();
	const weekStart = getCurrentWeekStartUtc();

	return clients.map((client) => {
		const progressRow = toProgressRow(client.progress);
		const progressState = normalizeProgress(progressRow?.progress as any);
		const lastCompleted = WEEK_DAYS.filter((day) => progressState[day.key]?.completed).at(-1)?.label ?? null;
		const lastReset = progressState._meta?.last_reset_utc ?? null;
		const lastActivity = progressState._meta?.last_activity_utc ?? progressRow?.last_completed_at ?? null;

		return {
			id: client.id,
			name: client.name,
			client_code: client.client_code,
			status: client.status as ClientSummary['status'],
			objective: client.objective,
			last_completed_at: progressRow?.last_completed_at ?? null,
			last_day_completed: lastCompleted,
			last_activity_utc: lastActivity,
			last_reset_utc: lastReset,
			week_started: lastReset ? lastReset >= weekStart : false,
			days_since_activity: daysBetweenUtc(lastActivity, nowUtc)
		} satisfies ClientSummary;
	});
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const startedAt = Date.now();
	const fastPanelLoads = privateEnv.FAST_PANEL_LOADS === '1';

	try {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			await locals.supabase?.auth.signOut();
			throw redirect(303, '/login');
		}

		const supabase = locals.supabase;
		const trainerId = locals.session.user.id;
		const isOwner = isOwnerEmail(locals.session.user.email);
		let clients: ClientWithProgress[] = [];

		if (fastPanelLoads) {
			const { data, error } = await supabase
				.from('clients')
				.select('id,name,client_code,status,objective,progress(last_completed_at,progress)')
				.eq('trainer_id', trainerId)
				.order('created_at', { ascending: true });

			if (error) {
				console.error(error);
				throw fail(500, { message: 'No pudimos cargar los alumnos' });
			}

			clients = (data ?? []) as unknown as ClientWithProgress[];
		} else {
			const { data: baseClients, error } = await supabase
				.from('clients')
				.select('id,name,client_code,status,objective')
				.eq('trainer_id', trainerId)
				.order('created_at', { ascending: true });

			if (error) {
				console.error(error);
				throw fail(500, { message: 'No pudimos cargar los alumnos' });
			}

			const clientIds = baseClients?.map((client) => client.id) ?? [];
			const progressMap = new Map<string, ProgressRelation>();

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

			clients =
				baseClients?.map((client) => ({
					...client,
					progress: progressMap.get(client.id) ?? null
				})) ?? [];
		}

		const envSite = publicEnv.PUBLIC_SITE_URL?.replace(/\/?$/, '') || '';
		const origin = url.origin?.replace(/\/?$/, '') || '';
		const siteUrl = envSite && !envSite.includes('localhost') ? envSite : origin;
		const shouldLazyAdmin = fastPanelLoads && isOwner;
		const trainerAdmin = isOwner && !shouldLazyAdmin ? await fetchTrainerAdminData() : null;

		return {
			clients: toClientSummaries(clients),
			siteUrl,
			trainerAdmin,
			isOwner,
			lazyAdmin: shouldLazyAdmin
		};
	} finally {
		logLoadDuration('/clientes', startedAt, {
			fast: fastPanelLoads,
			user_id: locals.session?.user.id ?? null
		});
	}
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const allowed = await ensureTrainerAccess(locals.session.user.email);
		if (!allowed) {
			await locals.supabase?.auth.signOut();
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

		// Verificar si ya existe un cliente con el mismo nombre exacto para este entrenador
		const { data: existingClient } = await supabase
			.from('clients')
			.select('id,name')
			.eq('trainer_id', locals.session.user.id)
			.ilike('name', name)
			.maybeSingle();

		if (existingClient) {
			return fail(400, {
				message: 'Ya existe un alumno con ese nombre. Te sugiero agregar también el apellido para diferenciarlo mejor.'
			});
		}

		const { count: activeCount, error: countError } = await supabase
			.from('clients')
			.select('id', { count: 'exact', head: true })
			.eq('trainer_id', locals.session.user.id)
			.eq('status', 'active');

		if (countError) {
			console.error(countError);
			return fail(500, { message: 'No pudimos validar el límite de alumnos' });
		}

		if ((activeCount ?? 0) >= MAX_CLIENTS_PER_TRAINER) {
			return fail(400, {
				message: 'Límite de 100 alumnos alcanzado. Eliminá o archivá uno para crear otro.'
			});
		}

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
			return fail(500, { message: 'No pudimos crear el alumno' });
		}

		const defaultPlan = createEmptyPlan();
		const nowUtc = nowIsoUtc();
		const { error: routineError } = await supabase
			.from('routines')
			.insert({ client_id: client.id, plan: defaultPlan, last_saved_at: nowUtc });
		const { error: progressError } = await supabase.from('progress').insert({
			client_id: client.id,
			progress: normalizeProgress(null, { last_reset_utc: nowUtc, last_activity_utc: nowUtc }),
			last_completed_at: null
		});

		if (routineError || progressError) {
			console.error({ routineError, progressError });
		}

		throw redirect(303, `/clientes/${client.id}`);
	},
	addTrainer: async ({ request, locals }) => {
		if (locals.session?.user.email?.toLowerCase() !== OWNER_EMAIL) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const email = String(formData.get('email') || '').trim().toLowerCase();
		if (!email) {
			return fail(400, { message: 'Email requerido' });
		}

		if (email === OWNER_EMAIL) {
			return { success: true };
		}

		await supabaseAdmin.from('trainer_access').upsert({ email, active: true });
		await supabaseAdmin.from('trainers').update({ status: 'active' }).eq('email', email);

		return { success: true };
	},
	toggleTrainer: async ({ request, locals }) => {
		if (locals.session?.user.email?.toLowerCase() !== OWNER_EMAIL) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const email = String(formData.get('email') || '').trim().toLowerCase();
		const nextActive = String(formData.get('next_active') || 'false') === 'true';

		if (!email) {
			return fail(400, { message: 'Email requerido' });
		}

		if (email === OWNER_EMAIL) {
			return { success: true };
		}

		await supabaseAdmin.from('trainer_access').upsert({ email, active: nextActive });
		await supabaseAdmin.from('trainers').update({ status: nextActive ? 'active' : 'inactive' }).eq('email', email);

		if (!nextActive) {
			const { data: trainer } = await supabaseAdmin.from('trainers').select('id').eq('email', email).maybeSingle();
			if (trainer?.id) {
				await supabaseAdmin.auth.admin.signOut(trainer.id);
			}
		}

		return { success: true };
	},
	forceSignOut: async ({ request, locals }) => {
		if (locals.session?.user.email?.toLowerCase() !== OWNER_EMAIL) {
			throw redirect(303, '/login');
		}
		const formData = await request.formData();
		const email = String(formData.get('email') || '').trim().toLowerCase();
		if (!email) {
			return fail(400, { message: 'Email requerido' });
		}
		if (email === OWNER_EMAIL) {
			return { success: true };
		}
		const { data: trainer } = await supabaseAdmin.from('trainers').select('id').eq('email', email).maybeSingle();
		if (trainer?.id) {
			await supabaseAdmin.auth.admin.signOut(trainer.id);
		}
		return { success: true };
	},
	delete: async ({ request, locals }) => {
		if (!locals.session) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const clientId = String(formData.get('client_id') || '');
		const confirm = String(formData.get('confirm_text') || '').trim().toLowerCase();
		const userEmail = locals.session.user.email?.toLowerCase();

		if (!clientId) {
			return fail(400, { message: 'Alumno inválido' });
		}

		if (confirm !== 'eliminar') {
			return fail(400, { message: 'Debes escribir "eliminar" para confirmar' });
		}

		// Owner puede eliminar cualquier cliente, trainers solo los suyos
		let query = supabaseAdmin.from('clients').select('id').eq('id', clientId);
		if (userEmail !== OWNER_EMAIL) {
			query = query.eq('trainer_id', locals.session.user.id);
		}
		
		const { data: client, error: fetchError } = await query.maybeSingle();

		if (fetchError || !client) {
			console.error('Delete client error:', { fetchError, clientId, userId: locals.session.user.id });
			return fail(403, { message: 'No podés eliminar este alumno' });
		}

		// Usar supabaseAdmin para eliminar (bypass RLS)
		const { error: progressErr } = await supabaseAdmin.from('progress').delete().eq('client_id', clientId);
		const { error: routineErr } = await supabaseAdmin.from('routines').delete().eq('client_id', clientId);
		const { error: clientErr } = await supabaseAdmin.from('clients').delete().eq('id', clientId);

		if (progressErr || routineErr || clientErr) {
			console.error('Delete errors:', { progressErr, routineErr, clientErr });
			return fail(500, { message: 'Error al eliminar el alumno. Intentá de nuevo.' });
		}

		throw redirect(303, '/clientes');
	}
};
