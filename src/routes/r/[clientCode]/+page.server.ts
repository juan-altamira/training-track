import { getTargetSets, normalizePlan, normalizeProgress, WEEK_DAYS } from '$lib/routines';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { ProgressState, RoutinePlan } from '$lib/types';
import { error, fail } from '@sveltejs/kit';
import { nowIsoUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';

const fetchClient = async (clientCode: string) => {
	const { data, error: clientError } = await supabaseAdmin
		.from('clients')
		.select('id,name,objective,status,trainer_id')
		.eq('client_code', clientCode)
		.maybeSingle();
	return { data, clientError };
};

const isTrainerAllowed = async (trainerId: string) => {
	const { data: trainer } = await supabaseAdmin
		.from('trainers')
		.select('status,email')
		.eq('id', trainerId)
		.maybeSingle();

	if (!trainer) return false;

	const emailLower = trainer.email?.toLowerCase();
	
	// Owner always has access
	if (emailLower === OWNER_EMAIL) return true;

	const { data: accessRow } = await supabaseAdmin
		.from('trainer_access')
		.select('active')
		.eq('email', emailLower)
		.maybeSingle();

	const accessActive = accessRow?.active === true;
	const statusActive = trainer.status === 'active';
	return accessActive && statusActive;
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

	const { data: routineRow } = await supabaseAdmin
		.from('routines')
		.select('plan')
		.eq('client_id', client.id)
		.maybeSingle();

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

	if (!progressRow) {
		await supabaseAdmin.from('progress').insert({ client_id: client.id, progress });
	}

	return {
		status: 'ok' as const,
		clientId: client.id,
		clientName: client.name,
		objective: client.objective,
		plan,
		progress,
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
				const totalTargetSets =
					routinePlan[sessionDay]?.exercises.reduce(
						(acc, ex) => acc + Math.max(1, getTargetSets(ex) || 0),
						0
					) ?? 0;
				const existingSets = Object.values(existingDay?.exercises ?? {}).reduce(
					(acc, val) => acc + (val ?? 0),
					0
				);
				const newSets = Object.values(parsed[sessionDay]?.exercises ?? {}).reduce(
					(acc, val) => acc + (val ?? 0),
					0
				);

				// Registrar snapshot al primer set tras el reset
				if (!firstSetMap[sessionDay] && newSets > existingSets) {
					firstSetMap[sessionDay] = tsFirst || sessionStart || nowUtc;
					baselineSets[sessionDay] = existingSets;
				}

				const baselineForDay = baselineSets[sessionDay] ?? existingSets;
				const hadProgressBefore =
					hadProgressFlag
						? hadProgressFlag === '1'
						: (existingDay?.completed ?? false) || baselineForDay > 0;

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
			.update({
				progress,
				last_completed_at: anyCompleted ? nowUtc : null
			})
			.eq('client_id', client.id);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos guardar el progreso' });
		}

		return { success: true };
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
			.update({ progress: cleared, last_completed_at: null })
			.eq('client_id', client.id);

		if (updateError) {
			console.error(updateError);
			return fail(500, { message: 'No pudimos reiniciar' });
		}

		return { success: true, progress: cleared };
	}
};
