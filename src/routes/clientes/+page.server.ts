import { createEmptyPlan, normalizeProgress, WEEK_DAYS } from '$lib/routines';
import type { ClientSummary } from '$lib/types';
import { daysBetweenUtc, getCurrentWeekStartUtc, monthsBetweenUtc, nowIsoUtc } from '$lib/time';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/public';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';
const MAX_CLIENTS_PER_TRAINER = 100;
const INACTIVITY_MONTHS = 6;

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

const fetchTrainerAdminData = async () => {
	const { data: accessRows } = await supabaseAdmin
		.from('trainer_access')
		.select('email,active,created_at,updated_at')
		.order('created_at', { ascending: true });

	const { data: trainerRows } = await supabaseAdmin
		.from('trainers')
		.select('id,email,status,created_at')
		.order('created_at', { ascending: true });

	const byEmail = new Map<
		string,
		{
			email: string;
			active: boolean;
			trainer_id?: string;
			status?: string | null;
			created_at?: string | null;
		}
	>();

	accessRows?.forEach((row) => {
		if (!row.email || row.email.toLowerCase() === OWNER_EMAIL) return;
		byEmail.set(row.email.toLowerCase(), {
			email: row.email,
			active: row.active === true,
			created_at: row.created_at
		});
	});

	trainerRows?.forEach((row) => {
		if (!row.email || row.email.toLowerCase() === OWNER_EMAIL) return;
		const key = row.email.toLowerCase();
		const current = byEmail.get(key) ?? { email: row.email, active: false, created_at: row.created_at ?? null };
		byEmail.set(key, {
			...current,
			trainer_id: row.id,
			status: row.status,
			created_at: current.created_at ?? row.created_at
		});
	});

	return Array.from(byEmail.values());
};

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.session) {
		throw redirect(303, '/login');
	}

	const allowed = await ensureTrainerAccess(locals.session.user.email);
	if (!allowed) {
		await locals.supabase?.auth.signOut();
		throw redirect(303, '/login');
	}

	await ensureTrainerExists(locals.supabase, locals.session.user.id, locals.session.user.email ?? '');

	const supabase = locals.supabase;
	const { data: clients, error } = await supabase
		.from('clients')
		.select('id,name,client_code,status,objective')
		.eq('trainer_id', locals.session.user.id)
		.order('created_at', { ascending: true });

	if (error) {
		console.error(error);
		throw fail(500, { message: 'No pudimos cargar los alumnos' });
	}

	const clientIds = clients?.map((c) => c.id) ?? [];
	const progressMap = new Map<
		string,
		{ last_completed_at: string | null; progress: any }
	>();
	const routineMap = new Map<string, { last_saved_at: string | null }>();

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

		// Obtener last_saved_at de las rutinas para verificar inactividad
		const { data: routineRows } = await supabase
			.from('routines')
			.select('client_id,last_saved_at')
			.in('client_id', clientIds);

		routineRows?.forEach((row) => {
			routineMap.set(row.client_id, { last_saved_at: row.last_saved_at });
		});

		// Verificar inactividad y archivar clientes que no han tenido guardado en 6+ meses
		const nowUtc = nowIsoUtc();
		const clientsToArchive: string[] = [];

		for (const client of clients ?? []) {
			if (client.status !== 'active') continue;
			
			const routineInfo = routineMap.get(client.id);
			const lastSaved = routineInfo?.last_saved_at;
			
			// Si no tiene last_saved_at, no lo archivamos (es un cliente nuevo o anterior a esta feature)
			if (!lastSaved) continue;
			
			const monthsInactive = monthsBetweenUtc(lastSaved, nowUtc);
			if (monthsInactive !== null && monthsInactive >= INACTIVITY_MONTHS) {
				clientsToArchive.push(client.id);
			}
		}

		// Archivar clientes inactivos (si hay alguno)
		if (clientsToArchive.length > 0) {
			await supabase
				.from('clients')
				.update({ status: 'archived' })
				.in('id', clientsToArchive);
			
			// Actualizar el estado local para reflejarlo inmediatamente
			clients?.forEach((c) => {
				if (clientsToArchive.includes(c.id)) {
					c.status = 'archived';
				}
			});
		}
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
	const siteUrl = envSite && !envSite.includes('localhost') ? envSite : origin;

	const isOwner = locals.session.user.email?.toLowerCase() === OWNER_EMAIL;
	const trainerAdmin = isOwner ? await fetchTrainerAdminData() : null;

	return {
		clients: list,
		siteUrl,
		trainerAdmin,
		isOwner
	};
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
