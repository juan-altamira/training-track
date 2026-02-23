import { getTargetSets, normalizePlan, normalizeProgress, normalizeRoutineUiMeta, WEEK_DAYS } from '$lib/routines';
import {
	DAY_FEEDBACK_COMMENT_MAX_LENGTH,
	buildProgressCycleKey,
	isFeedbackCommentTooLong,
	isValidDayKey,
	isValidMood,
	isValidPain,
	normalizeFeedbackComment,
	toDayFeedbackByDay
} from '$lib/dayFeedback';
import { env as privateEnv } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { ensureTrainerAccessByTrainerId } from '$lib/server/trainerAccess';
import type { ProgressState, RoutinePlan, RoutineUiMeta } from '$lib/types';
import { error, fail } from '@sveltejs/kit';
import { nowIsoUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

const isMissingUiMetaColumnError = (err: unknown) => {
	const message =
		typeof err === 'object' && err && 'message' in err ? String((err as { message?: string }).message ?? '') : '';
	const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code ?? '') : '';
	return code === '42703' || /ui_meta/i.test(message);
};

const fetchClient = async (clientCode: string) => {
	const { data, error: clientError } = await supabaseAdmin
		.from('clients')
		.select('id,name,objective,status,trainer_id')
		.eq('client_code', clientCode)
		.maybeSingle();
	return { data, clientError };
};

const isTrainerAllowed = async (trainerId: string) => ensureTrainerAccessByTrainerId(trainerId);

const PRODUCT_FEEDBACK_TZ =
	(privateEnv.PRIVATE_PRODUCT_TIMEZONE || '').trim() || 'America/Argentina/Buenos_Aires';

const toLocalDateInTimezone = (date: Date, timeZone: string): string => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
	const month = parts.find((part) => part.type === 'month')?.value ?? '01';
	const day = parts.find((part) => part.type === 'day')?.value ?? '01';
	return `${year}-${month}-${day}`;
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

export const load: PageServerLoad = async ({ params }) => {
	const clientCode = params.clientCode;
	const { data: client, clientError } = await fetchClient(clientCode);

	if (clientError) {
		console.error(clientError);
		throw error(500, { message: 'No pudimos cargar la rutina' });
	}

	if (!client) {
		return { status: 'invalid' as const };
	}

	const trainerAllowed = await isTrainerAllowed(client.trainer_id);
	const trainerInactive = !trainerAllowed;
	const clientInactive = client.status !== 'active';

	if (trainerInactive || clientInactive) {
		return {
			status: 'disabled' as const,
			clientName: client.name
		};
	}

	let routineQuery = await supabaseAdmin
		.from('routines')
		.select('plan,ui_meta')
		.eq('client_id', client.id)
		.maybeSingle();
	if (routineQuery.error && isMissingUiMetaColumnError(routineQuery.error)) {
		routineQuery = await supabaseAdmin
			.from('routines')
			.select('plan')
			.eq('client_id', client.id)
			.maybeSingle();
	}
	const routineRow = routineQuery.data;

	let plan = normalizePlan(routineRow?.plan as RoutinePlan | null);
	if (!routineRow) {
		await supabaseAdmin.from('routines').insert({ client_id: client.id, plan });
	}

	const { data: progressRow } = await supabaseAdmin
		.from('progress')
		.select('progress,last_completed_at')
		.eq('client_id', client.id)
		.maybeSingle();

	const progress = normalizeProgress(progressRow?.progress as ProgressState | null);
	const cycleKey = buildProgressCycleKey(progress._meta?.last_reset_utc ?? null);
	const dayFeedback = await loadDayFeedback(client.id, cycleKey);

	if (!progressRow) {
		await supabaseAdmin.from('progress').insert({ client_id: client.id, progress });
	}

	return {
		status: 'ok' as const,
		clientId: client.id,
		clientName: client.name,
		objective: client.objective,
		plan,
		uiMeta: normalizeRoutineUiMeta((routineRow?.ui_meta as RoutineUiMeta | null | undefined) ?? null),
		progress,
		dayFeedback,
		last_completed_at: progressRow?.last_completed_at ?? null
	};
};

export const actions: Actions = {
	saveProgress: async ({ request, params }) => {
		const clientCode = params.clientCode;
		const { data: client } = await fetchClient(clientCode);

		const trainerAllowed = client?.trainer_id ? await isTrainerAllowed(client.trainer_id) : false;

		if (!client || client.status !== 'active' || !trainerAllowed) {
			return fail(403, { message: 'Acceso desactivado' });
		}

		const formData = await request.formData();
		const rawProgress = String(formData.get('progress') || '');
		const sessionDay = String(formData.get('session_day') || '');
		const sessionStart = String(formData.get('session_start') || '');
		const sessionEnd = String(formData.get('session_end') || '');
		const tsFirst = String(formData.get('ts_primera_serie') || '');
		const tsLast = String(formData.get('ts_ultima_serie') || '');
		const hadProgressFlag = String(formData.get('had_progress_before') || '');
		console.log('suspicion-debug-incoming', {
			clientCode,
			sessionDay,
			tsFirst,
			tsLast,
			sessionStart,
			sessionEnd,
			hadProgressFlag
		});

		let parsed: ProgressState;
		try {
			parsed = JSON.parse(rawProgress);
		} catch (e) {
			console.error(e);
			return fail(400, { message: 'Formato inválido' });
		}

		// Traer progreso existente para conservar flags y snapshots previos
		const { data: existingRow, error: existingError } = await supabaseAdmin
			.from('progress')
			.select('progress')
			.eq('client_id', client.id)
			.maybeSingle();

		const { data: routineRow } = await supabaseAdmin
			.from('routines')
			.select('plan')
			.eq('client_id', client.id)
			.maybeSingle();

		if (existingError) {
			console.error(existingError);
			return fail(500, { message: 'No pudimos guardar el progreso' });
		}

		const existing = normalizeProgress(existingRow?.progress as ProgressState | null);
		const routinePlan = normalizePlan(routineRow?.plan as RoutinePlan | null);

		// Merge: para cada día y ejercicio, tomar el valor máximo entre existente y nuevo
		// Esto previene pérdida de datos por race conditions
		for (const day of WEEK_DAYS) {
			const existingDay = existing[day.key];
			const parsedDay = parsed[day.key];
			if (existingDay && parsedDay) {
				const mergedExercises = { ...(parsedDay.exercises ?? {}) };
				for (const exId of Object.keys(existingDay.exercises ?? {})) {
					const existingVal = existingDay.exercises?.[exId] ?? 0;
					const parsedVal = parsedDay.exercises?.[exId] ?? 0;
					// Tomar el máximo para no perder progreso
					mergedExercises[exId] = Math.max(existingVal, parsedVal);
				}
				parsed[day.key] = {
					...parsedDay,
					exercises: mergedExercises
				};
				// Recalcular completed después del merge
				const dayPlan = routinePlan[day.key];
				if (dayPlan) {
					parsed[day.key].completed = dayPlan.exercises.every((ex) => {
						const target = Math.max(1, getTargetSets(ex) || 0);
						const done = mergedExercises[ex.id] ?? 0;
						return done >= target;
					});
				}
			}
		}

		// Snapshots
		const firstSetMap: Record<string, string | null> = existing._meta?.first_set_ts ?? {};
		const baselineSets: Record<string, number> = existing._meta?.baseline_sets ?? {};

		const nowUtc = nowIsoUtc();

		if (sessionDay && parsed[sessionDay]?.completed && sessionStart && sessionEnd) {
			const start = tsFirst ? Date.parse(tsFirst) : Date.parse(sessionStart);
			const end = tsLast ? Date.parse(tsLast) : Date.parse(sessionEnd);
			if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
				const durationSec = (end - start) / 1000;
				const existingDay = existing[sessionDay];
				const dayExercises = routinePlan[sessionDay]?.exercises ?? [];
				const currentExerciseIds = new Set(dayExercises.map(ex => ex.id));
				
				// Calcular totales solo con ejercicios que ACTUALMENTE existen en la rutina
				const totalTargetSets = dayExercises.reduce(
					(acc, ex) => acc + Math.max(1, getTargetSets(ex) || 0),
					0
				);
				const existingSets = Object.entries(existingDay?.exercises ?? {})
					.filter(([id]) => currentExerciseIds.has(id))
					.reduce((acc, [, val]) => acc + (val ?? 0), 0);
				const newSets = Object.entries(parsed[sessionDay]?.exercises ?? {})
					.filter(([id]) => currentExerciseIds.has(id))
					.reduce((acc, [, val]) => acc + (val ?? 0), 0);

				// Registrar snapshot al primer set tras el reset
				if (!firstSetMap[sessionDay] && newSets > existingSets) {
					firstSetMap[sessionDay] = tsFirst || sessionStart || nowUtc;
					baselineSets[sessionDay] = existingSets;
				}
				
				// existingSets ya está filtrado por ejercicios actuales
				const baselineForDay = baselineSets[sessionDay] ?? existingSets;
				const hadProgressBefore =
					hadProgressFlag
						? hadProgressFlag === '1'
						: baselineForDay > 0;

				const startRef = firstSetMap[sessionDay] ? Date.parse(firstSetMap[sessionDay] as string) : start;
				const durationFromFirst =
					startRef && !Number.isNaN(startRef) ? (end - startRef) / 1000 : durationSec;

				// Regla: venía de cero y se completó en <60s desde el primer set
				const alreadySuspicious = existingDay?.suspicious ?? false;
				if (!alreadySuspicious && !hadProgressBefore && durationFromFirst < 60 && newSets >= totalTargetSets && totalTargetSets > 0) {
					parsed[sessionDay] = {
						...(parsed[sessionDay] ?? { completed: true, exercises: {} }),
						suspicious: true
					};
					parsed._meta = {
						...(parsed._meta ?? {}),
						last_suspicious_day: sessionDay,
						last_suspicious_at: nowUtc,
						last_suspicious_reason: 'completed_all_under_60s',
						first_set_ts: { ...(parsed._meta?.first_set_ts ?? {}), ...firstSetMap },
						baseline_sets: { ...(parsed._meta?.baseline_sets ?? {}), ...baselineSets }
					};
				}
			}
		}

		const progress = normalizeProgress(parsed, {
			last_activity_utc: nowUtc,
			last_reset_utc: parsed?._meta?.last_reset_utc ?? null,
			first_set_ts: { ...(parsed._meta?.first_set_ts ?? {}), ...firstSetMap },
			baseline_sets: { ...(parsed._meta?.baseline_sets ?? {}), ...baselineSets }
		});
		const anyCompleted = WEEK_DAYS.some((day) => progress[day.key]?.completed);

		// Conservar flags sospechosos previos y no permitir que se borren al guardar otro día
		for (const day of WEEK_DAYS) {
			if (existing[day.key]?.suspicious) {
				progress[day.key].suspicious = true;
			}
		}

		const { error: updateError } = await supabaseAdmin
			.from('progress')
			.upsert(
				{
					client_id: client.id,
					progress,
					last_completed_at: anyCompleted ? nowUtc : null
				},
				{ onConflict: 'client_id' }
			);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos guardar el progreso' });
		}

		return { success: true };
	},
	saveDayFeedback: async ({ request, params }) => {
		const clientCode = params.clientCode;
		const { data: client } = await fetchClient(clientCode);

		const trainerAllowed = client?.trainer_id ? await isTrainerAllowed(client.trainer_id) : false;

		if (!client || client.status !== 'active' || !trainerAllowed) {
			return fail(403, { message: 'Acceso desactivado' });
		}

		const formData = await request.formData();
		const dayKey = String(formData.get('day_key') || '').trim().toLowerCase();
		const moodRaw = String(formData.get('mood') || '').trim().toLowerCase();
		const difficultyRaw = String(formData.get('difficulty') || '').trim();
		const painRaw = String(formData.get('pain') || '').trim().toLowerCase();
		const comment = normalizeFeedbackComment(String(formData.get('comment') || ''));

		if (!isValidDayKey(dayKey)) {
			return fail(400, { message: 'Día inválido' });
		}

		const mood = moodRaw ? (isValidMood(moodRaw) ? moodRaw : null) : null;
		if (moodRaw && !mood) {
			return fail(400, { message: 'Sensación inválida' });
		}

		let difficulty: number | null = null;
		if (difficultyRaw) {
			const parsedDifficulty = Number(difficultyRaw);
			if (!Number.isInteger(parsedDifficulty) || parsedDifficulty < 1 || parsedDifficulty > 10) {
				return fail(400, { message: 'Dificultad inválida' });
			}
			difficulty = parsedDifficulty;
		}

		const pain = painRaw ? (isValidPain(painRaw) ? painRaw : null) : null;
		if (painRaw && !pain) {
			return fail(400, { message: 'Nivel de dolor inválido' });
		}

		if (!mood && !difficulty && !pain && !comment) {
			return fail(400, { message: 'Completá al menos una respuesta antes de guardar.' });
		}

		if (isFeedbackCommentTooLong(comment)) {
			return fail(400, {
				message: `El comentario no puede superar ${DAY_FEEDBACK_COMMENT_MAX_LENGTH} caracteres.`
			});
		}

		const { data: progressRow, error: progressError } = await supabaseAdmin
			.from('progress')
			.select('progress')
			.eq('client_id', client.id)
			.maybeSingle();

		if (progressError) {
			console.error(progressError);
			return fail(500, { message: 'No pudimos guardar tus sensaciones.' });
		}

		const progress = normalizeProgress(progressRow?.progress as ProgressState | null);
		const cycleStartedAt = progress._meta?.last_reset_utc ?? null;
		const cycleKey = buildProgressCycleKey(cycleStartedAt);

		const submittedAt = nowIsoUtc();
		const dayLocal = toLocalDateInTimezone(new Date(submittedAt), PRODUCT_FEEDBACK_TZ);

		const payload = {
			client_id: client.id,
			day_key: dayKey,
			day_local: dayLocal,
			submitted_at: submittedAt,
			cycle_key: cycleKey,
			cycle_started_at: cycleStartedAt,
			mood,
			difficulty,
			pain,
			comment
		};

		const { data: savedRow, error: saveError } = await supabaseAdmin
			.from('client_day_feedback')
			.upsert(payload, { onConflict: 'client_id,day_key,cycle_key' })
			.select('day_key,day_local,submitted_at,mood,difficulty,pain,comment,created_at,updated_at')
			.single();

		if (saveError) {
			console.error(saveError);
			return fail(500, { message: 'No pudimos guardar tus sensaciones.' });
		}

		return {
			success: true,
			dayFeedback: {
				day_key: savedRow.day_key,
				day_local: savedRow.day_local,
				submitted_at: savedRow.submitted_at,
				mood: savedRow.mood,
				difficulty: savedRow.difficulty,
				pain: savedRow.pain,
				comment: savedRow.comment,
				created_at: savedRow.created_at,
				updated_at: savedRow.updated_at
			}
		};
	},
	resetProgress: async ({ params }) => {
		const clientCode = params.clientCode;
		const { data: client } = await fetchClient(clientCode);

		const trainerAllowed = client?.trainer_id ? await isTrainerAllowed(client.trainer_id) : false;

		if (!client || client.status !== 'active' || !trainerAllowed) {
			return fail(403, { message: 'Acceso desactivado' });
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
					client_id: client.id,
					progress: cleared,
					last_completed_at: null
				},
				{ onConflict: 'client_id' }
			);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos reiniciar' });
		}

		return { success: true, progress: cleared };
	}
};
