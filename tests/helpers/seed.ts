import { getSupabaseAdmin } from './supabase-admin';
import type { ClientSeed } from '../../e2e/fixtures/types';

const WEEK_DAYS: Array<{ key: string; label: string }> = [
	{ key: 'monday', label: 'Lunes' },
	{ key: 'tuesday', label: 'Martes' },
	{ key: 'wednesday', label: 'Miércoles' },
	{ key: 'thursday', label: 'Jueves' },
	{ key: 'friday', label: 'Viernes' },
	{ key: 'saturday', label: 'Sábado' },
	{ key: 'sunday', label: 'Domingo' }
];

let memoRunId: string | null = null;

const sanitizeForName = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);

export const getTestRunId = (): string => {
	if (memoRunId) {
		return memoRunId;
	}

	const envRunId = process.env.TEST_RUN_ID?.trim();
	if (envRunId) {
		memoRunId = sanitizeForName(envRunId);
		return memoRunId;
	}

	memoRunId = sanitizeForName(`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
	process.env.TEST_RUN_ID = memoRunId;
	return memoRunId;
};

export const makeSeedName = (label: string): string => {
	const runId = getTestRunId();
	const cleanLabel = sanitizeForName(label);
	return `E2E__${runId}__${cleanLabel}`;
};

export const createEmptyPlan = () =>
	WEEK_DAYS.reduce(
		(acc, day) => {
			acc[day.key] = {
				key: day.key,
				label: day.label,
				exercises: []
			};
			return acc;
		},
		{} as Record<string, { key: string; label: string; exercises: Array<Record<string, unknown>> }>
	);

export const createEmptyProgress = (isoNow = new Date().toISOString()) =>
	WEEK_DAYS.reduce(
		(acc, day) => {
			acc[day.key] = {
				completed: false,
				exercises: {}
			};
			return acc;
		},
		{
			_meta: {
				last_activity_utc: isoNow,
				last_reset_utc: isoNow,
				first_set_ts: {},
				baseline_sets: {}
			}
		} as Record<string, any>
	);

type CreateClientSeedInput = {
	trainerId: string;
	nameLabel: string;
	objective?: string | null;
	status?: 'active' | 'archived';
	createdAt?: string;
	lastSavedAt?: string | null;
	plan?: Record<string, unknown>;
	progress?: Record<string, unknown>;
};

export const createClientSeed = async (input: CreateClientSeedInput): Promise<ClientSeed> => {
	const supabase = getSupabaseAdmin();
	const nowIso = new Date().toISOString();
	const name = makeSeedName(input.nameLabel);

	const insertPayload: Record<string, unknown> = {
		trainer_id: input.trainerId,
		name,
		objective: input.objective ?? null,
		status: input.status ?? 'active'
	};

	if (input.createdAt) {
		insertPayload.created_at = input.createdAt;
	}

	const { data: client, error: clientError } = await supabase
		.from('clients')
		.insert(insertPayload)
		.select('id,name,client_code,trainer_id,status,objective,created_at')
		.single();

	if (clientError || !client) {
		throw new Error(`Failed to seed client: ${clientError?.message ?? 'unknown error'}`);
	}

	const routinePayload = {
		client_id: client.id,
		plan: input.plan ?? createEmptyPlan(),
		last_saved_at: input.lastSavedAt ?? nowIso
	};

	const { error: routineError } = await supabase.from('routines').upsert(routinePayload, {
		onConflict: 'client_id'
	});
	if (routineError) {
		throw new Error(`Failed to seed routine: ${routineError.message}`);
	}

	const progressPayload = {
		client_id: client.id,
		progress: input.progress ?? createEmptyProgress(nowIso),
		last_completed_at: null
	};

	const { error: progressError } = await supabase.from('progress').upsert(progressPayload, {
		onConflict: 'client_id'
	});
	if (progressError) {
		throw new Error(`Failed to seed progress: ${progressError.message}`);
	}

	return client as ClientSeed;
};

export const findTrainerIdByEmail = async (email: string): Promise<string> => {
	const supabase = getSupabaseAdmin();
	const normalizedEmail = email.trim().toLowerCase();
	const { data: trainer, error } = await supabase
		.from('trainers')
		.select('id,email')
		.eq('email', normalizedEmail)
		.maybeSingle();

	if (error || !trainer) {
		throw new Error(
			`Trainer not found for ${normalizedEmail}. Ensure trainer exists in staging. ${error?.message ?? ''}`
		);
	}

	return trainer.id;
};
