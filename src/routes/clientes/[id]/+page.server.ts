import { normalizePlan, normalizeProgress, normalizeRoutineUiMeta, WEEK_DAYS } from '$lib/routines';
import type { RoutinePlan, RoutineUiMeta } from '$lib/types';
import { buildProgressCycleKey, toDayFeedbackByDay } from '$lib/dayFeedback';
import { error, fail, redirect } from '@sveltejs/kit';
import { nowIsoUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { ensureTrainerAccess } from '$lib/server/trainerAccess';
import { logLoadDuration } from '$lib/server/loadPerf';

const MAX_EXERCISES_PER_DAY = 50;

type RoutineRelation = {
	plan: RoutinePlan | null;
	ui_meta?: RoutineUiMeta | null;
	reset_progress_on_change?: boolean | null;
	version?: number | null;
};

type ProgressRelation = {
	progress: unknown;
	last_completed_at: string | null;
};

const firstRelation = <T>(relation: T | T[] | null | undefined): T | null => {
	if (!relation) return null;
	return Array.isArray(relation) ? (relation[0] ?? null) : relation;
};

const isMissingUiMetaColumnError = (err: unknown) => {
	const message =
		typeof err === 'object' && err && 'message' in err ? String((err as { message?: string }).message ?? '') : '';
	const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code ?? '') : '';
	return code === '42703' || /ui_meta/i.test(message);
};

const loadDayFeedback = async (clientId: string, cycleKey: string) => {
	const { data, error: feedbackError } = await supabaseAdmin
		.from('client_day_feedback')
		.select('day_key,day_local,submitted_at,mood,difficulty,pain,comment,created_at,updated_at')
		.eq('client_id', clientId)
		.eq('cycle_key', cycleKey);

	if (feedbackError) {
		console.error(feedbackError);
		return toDayFeedbackByDay([]);
	}

	return toDayFeedbackByDay(data as any[]);
};

export const load: PageServerLoad = async ({ params, locals, url }) => {
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
		const clientId = params.id;
		const trainerId = locals.session.user.id;
		const envSite = publicEnv.PUBLIC_SITE_URL?.replace(/\/?$/, '') || '';
		const origin = url.origin?.replace(/\/?$/, '') || '';
		const siteUrl = envSite && !envSite.includes('localhost') ? envSite : origin;

		if (fastPanelLoads) {
			let fastQuery = await supabase
				.from('clients')
				.select(
					'id,name,objective,status,client_code,created_at,routines(plan,ui_meta,reset_progress_on_change,version),progress(progress,last_completed_at)'
				)
				.eq('id', clientId)
				.eq('trainer_id', trainerId)
				.single();

			if (fastQuery.error && isMissingUiMetaColumnError(fastQuery.error)) {
				fastQuery = await supabase
					.from('clients')
					.select(
						'id,name,objective,status,client_code,created_at,routines(plan,reset_progress_on_change,version),progress(progress,last_completed_at)'
					)
					.eq('id', clientId)
					.eq('trainer_id', trainerId)
					.single();
			}

			const clientRow = fastQuery.data;
			const clientError = fastQuery.error;

			if (clientError || !clientRow) {
				throw error(404, { message: 'Alumno no encontrado' });
			}

			const routineRow = firstRelation<RoutineRelation>(clientRow.routines as any);
			const progressRow = firstRelation<ProgressRelation>(clientRow.progress as any);
			const normalizedProgress = normalizeProgress(progressRow?.progress as any);
			const cycleKey = buildProgressCycleKey(normalizedProgress._meta?.last_reset_utc ?? null);
			const dayFeedback = await loadDayFeedback(clientId, cycleKey);

			return {
				client: {
					id: clientRow.id,
					name: clientRow.name,
					objective: clientRow.objective,
					status: clientRow.status,
					client_code: clientRow.client_code,
					created_at: clientRow.created_at
				},
				plan: normalizePlan(routineRow?.plan as RoutinePlan | null),
				uiMeta: normalizeRoutineUiMeta(routineRow?.ui_meta ?? null),
				routineVersion: routineRow?.version ?? 1,
				progress: normalizedProgress,
				dayFeedback,
				last_completed_at: progressRow?.last_completed_at ?? null,
				siteUrl,
				otherClients: [],
				lazyOtherClients: true
			};
		}

		const { data: client, error: clientError } = await supabase
			.from('clients')
			.select('id,name,objective,status,client_code,created_at')
			.eq('id', clientId)
			.eq('trainer_id', trainerId)
			.single();

		if (clientError || !client) {
			throw error(404, { message: 'Alumno no encontrado' });
		}

		let routineQuery = await supabase
			.from('routines')
			.select('plan,ui_meta,reset_progress_on_change,version')
			.eq('client_id', clientId)
			.maybeSingle();
		if (routineQuery.error && isMissingUiMetaColumnError(routineQuery.error)) {
			routineQuery = await supabase
				.from('routines')
				.select('plan,reset_progress_on_change,version')
				.eq('client_id', clientId)
				.maybeSingle();
		}
		const routineRow = routineQuery.data;
		const routineError = routineQuery.error;
		if (routineError) {
			console.error(routineError);
		}

		const { data: progressRow, error: progressError } = await supabase
			.from('progress')
			.select('progress,last_completed_at')
			.eq('client_id', clientId)
			.maybeSingle();
		if (progressError) {
			console.error(progressError);
		}

		const normalizedProgress = normalizeProgress(progressRow?.progress as any);
		const cycleKey = buildProgressCycleKey(normalizedProgress._meta?.last_reset_utc ?? null);
		const dayFeedback = await loadDayFeedback(clientId, cycleKey);

		const { data: otherClients } = await supabase
			.from('clients')
			.select('id,name')
			.eq('trainer_id', trainerId)
			.neq('id', clientId)
			.order('name', { ascending: true });

		return {
			client,
			plan: normalizePlan(routineRow?.plan as RoutinePlan | null),
			uiMeta: normalizeRoutineUiMeta(routineRow?.ui_meta ?? null),
			routineVersion: routineRow?.version ?? 1,
			progress: normalizedProgress,
			dayFeedback,
			last_completed_at: progressRow?.last_completed_at ?? null,
			siteUrl,
			otherClients: otherClients ?? [],
			lazyOtherClients: false
		};
	} finally {
		logLoadDuration('/clientes/[id]', startedAt, {
			fast: fastPanelLoads,
			user_id: locals.session?.user.id ?? null,
			client_id: params.id
		});
	}
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
		const rawUiMeta = formData.get('ui_meta');

		let parsed: RoutinePlan;
		try {
			parsed = JSON.parse(rawPlan);
		} catch (e) {
			console.error(e);
			return fail(400, { message: 'Formato de rutina inválido' });
		}

		const plan = normalizePlan(parsed);
		let normalizedUiMeta: ReturnType<typeof normalizeRoutineUiMeta> | null = null;
		let hasUiMetaPatch = false;
		if (typeof rawUiMeta === 'string' && rawUiMeta.trim()) {
			try {
				const parsedUiMeta = JSON.parse(rawUiMeta) as RoutineUiMeta;
				normalizedUiMeta = normalizeRoutineUiMeta(parsedUiMeta);
				hasUiMetaPatch = true;
			} catch (e) {
				console.error(e);
				return fail(400, { message: 'Formato de modo visual inválido' });
			}
		}

		for (const day of Object.values(plan)) {
			if (day.exercises.length > MAX_EXERCISES_PER_DAY) {
				return fail(400, {
					message: 'Límite de 50 ejercicios por día alcanzado para este alumno.'
				});
			}
		}

		const supabase = locals.supabase;

		// Verificar que el cliente pertenece a este entrenador
		const { data: client } = await supabase
			.from('clients')
			.select('id')
			.eq('id', params.id)
			.eq('trainer_id', locals.session.user.id)
			.maybeSingle();

		if (!client) {
			return fail(403, { message: 'No autorizado' });
		}

		const nowUtc = nowIsoUtc();
		const routinePayload: Record<string, unknown> = {
			client_id: params.id,
			plan,
			last_saved_at: nowUtc
		};
		if (hasUiMetaPatch && normalizedUiMeta) {
			routinePayload.ui_meta = normalizedUiMeta;
		}

		let upsertQuery = await supabase
			.from('routines')
			.upsert(routinePayload, { onConflict: 'client_id' })
			.select('version')
			.single();

		if (upsertQuery.error && hasUiMetaPatch && isMissingUiMetaColumnError(upsertQuery.error)) {
			const fallbackPayload = {
				client_id: params.id,
				plan,
				last_saved_at: nowUtc
			};
			upsertQuery = await supabase
				.from('routines')
				.upsert(fallbackPayload, { onConflict: 'client_id' })
				.select('version')
				.single();
		}

		const savedRoutine = upsertQuery.data;
		const updateError = upsertQuery.error;

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos guardar la rutina' });
		}

		return { success: true, routineVersion: savedRoutine?.version ?? null };
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

		// Verificar que el cliente pertenece a este entrenador
		const { data: client } = await locals.supabase
			.from('clients')
			.select('id')
			.eq('id', params.id)
			.eq('trainer_id', locals.session.user.id)
			.maybeSingle();

		if (!client) {
			return fail(403, { message: 'No autorizado' });
		}

		const nowUtc = nowIsoUtc();
		const cleared = normalizeProgress(null, {
			last_activity_utc: nowUtc,
			last_reset_utc: nowUtc
		});

		const { error: updateError } = await supabaseAdmin
			.from('progress')
			.upsert(
				{
					client_id: params.id,
					progress: cleared,
					last_completed_at: null
				},
				{ onConflict: 'client_id' }
			);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos reiniciar el progreso' });
		}

		return { success: true, progress: cleared };
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
		await locals.supabase
			.from('clients')
			.update({ status })
			.eq('id', params.id)
			.eq('trainer_id', locals.session.user.id);
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
			return fail(403, { message: 'No podés eliminar este alumno' });
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
			return fail(400, { message: 'Seleccioná un alumno origen' });
		}

		if (sourceClientId === targetClientId) {
			return fail(400, { message: 'No tiene sentido copiar sobre el mismo alumno' });
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

		let sourceRoutineQuery = await supabase
			.from('routines')
			.select('plan,ui_meta')
			.eq('client_id', sourceClientId)
			.maybeSingle();
		if (sourceRoutineQuery.error && isMissingUiMetaColumnError(sourceRoutineQuery.error)) {
			sourceRoutineQuery = await supabase
				.from('routines')
				.select('plan')
				.eq('client_id', sourceClientId)
				.maybeSingle();
		}
		const sourceRoutine = sourceRoutineQuery.data;
		const sourceError = sourceRoutineQuery.error;

		if (sourceError || !sourceRoutine) {
			return fail(400, { message: 'No se encontró la rutina origen' });
		}

		const plan = normalizePlan(sourceRoutine.plan as RoutinePlan | null, true);
		const uiMeta = normalizeRoutineUiMeta((sourceRoutine.ui_meta as RoutineUiMeta | null | undefined) ?? null);
		const nowUtc = nowIsoUtc();

		const { error: updateError } = await supabase.from('routines').upsert(
			{
				client_id: targetClientId,
				plan,
				ui_meta: uiMeta,
				reset_progress_on_change: true,
				last_saved_at: nowUtc
			},
			{ onConflict: 'client_id' }
		);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos copiar la rutina' });
		}

		await supabase.from('progress').upsert(
			{
				client_id: targetClientId,
				progress: normalizeProgress(null, { last_reset_utc: nowUtc, last_activity_utc: nowUtc }),
				last_completed_at: null
			},
			{ onConflict: 'client_id' }
		);

		return { success: true };
	}
};
