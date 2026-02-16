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
	ensureTrainerRecordByEmail,
	getAccountSubscriptionSummary,
	getAndMarkSubscriptionWarning,
	getTrainerAccessStatusByEmail,
	ensureTrainerAccess,
	ensureTrainerExists,
	fetchTrainerAdminData,
	fetchOwnerActionHistory,
	isOwnerEmail
} from '$lib/server/trainerAccess';
import { logLoadDuration } from '$lib/server/loadPerf';

const MAX_CLIENTS_PER_TRAINER = 100;
const MIN_SUBSCRIPTION_MONTHS = 1;
const MAX_SUBSCRIPTION_MONTHS = 12;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const OWNER_HISTORY_WINDOW_HOURS = 24;
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type OwnerActionType = 'add_trainer' | 'grant_subscription' | 'toggle_trainer' | 'force_sign_out';

const logOwnerAction = async ({
	adminId,
	adminEmail,
	actionType,
	targetEmail,
	targetTrainerId,
	details
}: {
	adminId?: string | null;
	adminEmail?: string | null;
	actionType: OwnerActionType;
	targetEmail?: string | null;
	targetTrainerId?: string | null;
	details?: Record<string, unknown> | null;
}) => {
	const normalizedAdminEmail = adminEmail?.trim().toLowerCase();
	if (!normalizedAdminEmail) return;

	const { error } = await supabaseAdmin.from('owner_action_history').insert({
		admin_id: adminId ?? null,
		admin_email: normalizedAdminEmail,
		action_type: actionType,
		target_email: targetEmail ?? null,
		target_trainer_id: targetTrainerId ?? null,
		details: details ?? {}
	});

	if (error) {
		// No romper acciones críticas por problemas de auditoría.
		console.error('owner action history insert error', error);
	}
};

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

		const accessStatus = await getTrainerAccessStatusByEmail(locals.session.user.email);
		if (!accessStatus.allowed) {
			await locals.supabase?.auth.signOut();
			throw redirect(303, '/login');
		}

		const supabase = locals.supabase;
		const trainerId = locals.session.user.id;
		const isOwner = accessStatus.reason === 'owner' || isOwnerEmail(locals.session.user.email);
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
		const ownerActionHistory =
			isOwner && !shouldLazyAdmin
				? await fetchOwnerActionHistory(locals.session.user.email, OWNER_HISTORY_WINDOW_HOURS)
				: null;
		const accountSubscription = await getAccountSubscriptionSummary(locals.session.user.email);
		const subscriptionWarningRaw = await getAndMarkSubscriptionWarning(locals.session.user.email, 5);
		const subscriptionWarning = subscriptionWarningRaw?.should_show ? subscriptionWarningRaw : null;

		return {
			clients: toClientSummaries(clients),
			siteUrl,
			trainerAdmin,
			ownerActionHistory,
			isOwner,
			lazyAdmin: shouldLazyAdmin,
			accountSubscription,
			subscriptionWarning
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

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { message: 'Ingresá un email válido.' });
		}

		if (email === OWNER_EMAIL) {
			return { success: true };
		}

		const [{ data: existingTrainer, error: existingTrainerError }, { data: existingAccess, error: existingAccessError }] = await Promise.all([
			supabaseAdmin.from('trainers').select('id').eq('email', email).maybeSingle(),
			supabaseAdmin.from('trainer_access').select('email').eq('email', email).maybeSingle()
		]);

		if (existingTrainerError || existingAccessError) {
			console.error('addTrainer existence check error', { existingTrainerError, existingAccessError });
			return fail(500, { message: 'No pudimos validar el email del entrenador.' });
		}

		if (existingTrainer || existingAccess) {
			return fail(409, {
				message: 'Ese email ya existe. Usá su fila para habilitar/deshabilitar o ajustar días.'
			});
		}

		const { error: accessUpsertError } = await supabaseAdmin
			.from('trainer_access')
			.upsert({ email, active: true });
		if (accessUpsertError) {
			console.error('addTrainer trainer_access upsert error', accessUpsertError);
			return fail(500, { message: 'No pudimos habilitar el acceso del entrenador' });
		}

		const provisionedTrainer = await ensureTrainerRecordByEmail(email);
		if (provisionedTrainer?.id) {
			const { error: trainerUpdateError } = await supabaseAdmin
				.from('trainers')
				.update({ status: 'active' })
				.eq('id', provisionedTrainer.id);
			if (trainerUpdateError) {
				console.error('addTrainer trainers status update by id error', trainerUpdateError);
				return fail(500, { message: 'No pudimos actualizar el estado del entrenador' });
			}
		} else {
			const { error: trainerUpdateError } = await supabaseAdmin
				.from('trainers')
				.update({ status: 'active' })
				.eq('email', email);
			if (trainerUpdateError) {
				console.error('addTrainer trainers status update by email error', trainerUpdateError);
				return fail(500, { message: 'No pudimos actualizar el estado del entrenador' });
			}
		}

		await logOwnerAction({
			adminId: locals.session.user.id,
			adminEmail: locals.session.user.email,
			actionType: 'add_trainer',
			targetEmail: email,
			targetTrainerId: provisionedTrainer?.id ?? null,
			details: {
				manual_active: true
			}
		});

		return { success: true };
	},
	grantSubscription: async ({ request, locals }) => {
		if (locals.session?.user.email?.toLowerCase() !== OWNER_EMAIL) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const trainerId = String(formData.get('trainer_id') || '').trim();
		const trainerEmailInput = String(formData.get('trainer_email') || '')
			.trim()
			.toLowerCase();
		const months = Number.parseInt(String(formData.get('months') || ''), 10);
		const operation = String(formData.get('operation') || 'add').trim().toLowerCase();
		const idempotencyKey = String(formData.get('idempotency_key') || '').trim();
		const reasonRaw = String(formData.get('reason') || '').trim();
		const reason = reasonRaw.length > 0 ? reasonRaw.slice(0, 500) : null;

		if (!trainerId && !trainerEmailInput) {
			return fail(400, { message: 'Entrenador inválido.' });
		}

		const validOperation = operation === 'add' || operation === 'remove';
		if (!validOperation) {
			return fail(400, { message: 'Operación inválida. Usá sumar o quitar.' });
		}

		if (
			!Number.isFinite(months) ||
			months < MIN_SUBSCRIPTION_MONTHS ||
			months > MAX_SUBSCRIPTION_MONTHS
		) {
			return fail(400, { message: 'Meses inválidos. Elegí entre 1 y 12.' });
		}

		if (!idempotencyKey || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
			return fail(400, { message: 'Idempotency key inválida' });
		}

		const signedMonths = operation === 'remove' ? -months : months;
		const rawDays = signedMonths * 30;

		let trainerQuery = supabaseAdmin.from('trainers').select('id,email').limit(1);
		if (trainerId) {
			trainerQuery = trainerQuery.eq('id', trainerId);
		} else {
			trainerQuery = trainerQuery.eq('email', trainerEmailInput);
		}
		let { data: trainer, error: trainerError } = await trainerQuery.maybeSingle();

		if (trainerError || !trainer?.email) {
			const fallbackEmail = trainerEmailInput || (trainer?.email ?? null);
			const provisionedTrainer = await ensureTrainerRecordByEmail(fallbackEmail);
			if (provisionedTrainer) {
				trainer = { id: provisionedTrainer.id, email: provisionedTrainer.email };
			} else {
				return fail(404, {
					message:
						'No encontramos al entrenador en la tabla interna ni en Auth. Verificá que el email sea correcto y que la cuenta exista.'
				});
			}
		}

		const trainerEmail = trainer.email.trim().toLowerCase();
		if (trainerEmail === OWNER_EMAIL) {
			return fail(400, { message: 'No se puede acreditar suscripción al owner' });
		}

		const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('grant_trainer_subscription', {
			p_trainer_id: trainer.id,
			p_days: rawDays,
			p_admin_id: locals.session.user.id,
			p_reason: reason,
			p_idempotency_key: idempotencyKey
		});

		if (rpcError) {
			const message = (rpcError.message ?? '').toLowerCase();
			if (message.includes('idempotency key reused with different payload')) {
				return fail(409, {
					message:
						'La operación ya existe con la misma idempotency key pero con datos distintos. Generá una nueva y reintentá.'
				});
			}
			if (
				message.includes('idempotency_key is required') ||
				message.includes('days must be non-zero') ||
				message.includes('days must be a multiple of 30') ||
				message.includes('days per operation must be <= 360')
			) {
				return fail(400, { message: 'Solicitud inválida para acreditar suscripción' });
			}
			console.error('grant subscription rpc error', rpcError);
			return fail(500, { message: 'No pudimos acreditar la suscripción' });
		}

		const result = (Array.isArray(rpcData) ? rpcData[0] : null) as
			| {
					applied: boolean;
					active_until_before: string;
					active_until_after: string;
			  }
			| null;

		if (!result) {
			return fail(500, { message: 'No pudimos confirmar la acreditación' });
		}

		if (signedMonths > 0) {
			const { error: accessUpsertError } = await supabaseAdmin
				.from('trainer_access')
				.upsert({ email: trainerEmail, active: true });
			if (accessUpsertError) {
				console.error('grantSubscription trainer_access upsert error', accessUpsertError);
				return fail(500, { message: 'No pudimos sincronizar el acceso manual del entrenador' });
			}
		}

		await logOwnerAction({
			adminId: locals.session.user.id,
			adminEmail: locals.session.user.email,
			actionType: 'grant_subscription',
			targetEmail: trainerEmail,
			targetTrainerId: trainer.id,
			details: {
				operation: operation === 'remove' ? 'remove' : 'add',
				months: Math.abs(signedMonths),
				days: rawDays,
				applied: result.applied,
				active_until_before: result.active_until_before,
				active_until_after: result.active_until_after
			}
		});

		return {
			success: true,
			message: result.applied
				? `${signedMonths > 0 ? 'Suscripción acreditada' : 'Suscripción ajustada'} (${signedMonths > 0 ? '+' : ''}${signedMonths} mes${Math.abs(signedMonths) === 1 ? '' : 'es'} = ${rawDays > 0 ? '+' : ''}${rawDays} días). Vence: ${result.active_until_after}`
				: `Operación ya procesada. Vence: ${result.active_until_after}`
		};
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

		const { error: accessUpsertError } = await supabaseAdmin
			.from('trainer_access')
			.upsert({ email, active: nextActive });
		if (accessUpsertError) {
			console.error('toggleTrainer trainer_access upsert error', accessUpsertError);
			return fail(500, { message: 'No pudimos actualizar el acceso del entrenador' });
		}

		const provisionedTrainer = await ensureTrainerRecordByEmail(email);
		if (provisionedTrainer?.id) {
			const { error: trainerUpdateError } = await supabaseAdmin
				.from('trainers')
				.update({ status: nextActive ? 'active' : 'inactive' })
				.eq('id', provisionedTrainer.id);
			if (trainerUpdateError) {
				console.error('toggleTrainer trainers status update by id error', trainerUpdateError);
				return fail(500, { message: 'No pudimos actualizar el estado del entrenador' });
			}
		} else {
			const { error: trainerUpdateError } = await supabaseAdmin
				.from('trainers')
				.update({ status: nextActive ? 'active' : 'inactive' })
				.eq('email', email);
			if (trainerUpdateError) {
				console.error('toggleTrainer trainers status update by email error', trainerUpdateError);
				return fail(500, { message: 'No pudimos actualizar el estado del entrenador' });
			}
		}

		if (!nextActive) {
			const { data: trainer, error: trainerLookupError } = await supabaseAdmin
				.from('trainers')
				.select('id')
				.eq('email', email)
				.maybeSingle();
			if (trainerLookupError) {
				console.error('toggleTrainer trainer lookup error', trainerLookupError);
				return fail(500, { message: 'No pudimos cerrar las sesiones del entrenador' });
			}
			if (trainer?.id) {
				const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(trainer.id);
				if (signOutError) {
					console.error('toggleTrainer signOut error', signOutError);
					return fail(500, { message: 'No pudimos cerrar las sesiones del entrenador' });
				}
			}
		}

		await logOwnerAction({
			adminId: locals.session.user.id,
			adminEmail: locals.session.user.email,
			actionType: 'toggle_trainer',
			targetEmail: email,
			targetTrainerId: provisionedTrainer?.id ?? null,
			details: {
				next_active: nextActive
			}
		});

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
		const { data: trainer, error: trainerLookupError } = await supabaseAdmin
			.from('trainers')
			.select('id')
			.eq('email', email)
			.maybeSingle();
		if (trainerLookupError) {
			console.error('forceSignOut trainer lookup error', trainerLookupError);
			return fail(500, { message: 'No pudimos ubicar al entrenador para cerrar sesión' });
		}
		if (trainer?.id) {
			const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(trainer.id);
			if (signOutError) {
				console.error('forceSignOut signOut error', signOutError);
				return fail(500, { message: 'No pudimos cerrar las sesiones del entrenador' });
			}
		}

		await logOwnerAction({
			adminId: locals.session.user.id,
			adminEmail: locals.session.user.email,
			actionType: 'force_sign_out',
			targetEmail: email,
			targetTrainerId: trainer?.id ?? null
		});

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
