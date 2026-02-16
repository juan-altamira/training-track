import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { OwnerActionHistoryRow, TrainerAdminRow } from '$lib/types';

export const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';
const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const OWNER_HISTORY_WINDOW_HOURS = 24;
const OWNER_HISTORY_MAX_ROWS = 200;

export const isOwnerEmail = (rawEmail: string | null | undefined) =>
	rawEmail?.toLowerCase() === OWNER_EMAIL;

type TrainerAccessRpcRow = {
	trainer_id: string;
	email: string;
	manual_active: boolean;
	active_until: string | null;
	subscription_active: boolean;
	allowed: boolean;
	now_utc: string;
};

type SubscriptionWarningRpcRow = {
	should_show: boolean;
	reason: string;
	active_until: string | null;
	days_remaining: number | null;
	warned_at: string | null;
	now_utc: string;
};

type TrainerRecord = {
	id: string;
	email: string;
	status: string | null;
	active_until: string | null;
};

export type TrainerAccessStatus = {
	allowed: boolean;
	reason: 'owner' | 'active' | 'missing_email' | 'not_found' | 'manual_disabled' | 'expired' | 'error';
	trainer_id?: string | null;
	email?: string | null;
	manual_active?: boolean;
	subscription_active?: boolean;
	active_until?: string | null;
	now_utc?: string | null;
};

export type AccountSubscriptionSummary = {
	is_owner: boolean;
	state: 'owner' | 'active' | 'expiring' | 'expired' | 'missing';
	active_until: string | null;
	now_utc: string;
	days_remaining: number | null;
};

export type SubscriptionWarning = {
	should_show: boolean;
	reason: string;
	active_until: string | null;
	days_remaining: number | null;
	warned_at: string | null;
	now_utc: string;
};

const normalizeEmail = (rawEmail: string | null | undefined) => rawEmail?.trim().toLowerCase();

const computeDaysRemaining = (activeUntil: string | null | undefined, nowUtc: string) => {
	if (!activeUntil) return null;
	const untilTs = Date.parse(activeUntil);
	const nowTs = Date.parse(nowUtc);
	if (!Number.isFinite(untilTs) || !Number.isFinite(nowTs)) return null;
	const diffMs = untilTs - nowTs;
	if (diffMs <= 0) return 0;
	return Math.ceil(diffMs / ONE_DAY_MS);
};

const getTrainerRecordByEmail = async (email: string): Promise<TrainerRecord | null> => {
	const { data, error } = await supabaseAdmin
		.from('trainers')
		.select('id,email,status,active_until')
		.eq('email', email)
		.maybeSingle();

	if (error) {
		console.error('trainer record lookup error', error);
		return null;
	}

	return (data as TrainerRecord | null) ?? null;
};

const getAuthUserIdByEmail = async (email: string): Promise<string | null> => {
	const perPage = 200;
	let page = 1;

	while (true) {
		const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
		if (error) {
			console.error('listUsers error while resolving trainer by email', error);
			return null;
		}

		const users = data?.users ?? [];
		const match = users.find((user) => user.email?.trim().toLowerCase() === email);
		if (match?.id) {
			return match.id;
		}

		if (users.length < perPage) {
			break;
		}
		page += 1;
	}

	return null;
};

export const ensureTrainerRecordByEmail = async (
	rawEmail: string | null | undefined
): Promise<TrainerRecord | null> => {
	const email = normalizeEmail(rawEmail);
	if (!email) {
		return null;
	}

	const existing = await getTrainerRecordByEmail(email);
	if (existing) {
		return existing;
	}

	const authUserId = await getAuthUserIdByEmail(email);
	if (!authUserId) {
		return null;
	}

	const { error: upsertError } = await supabaseAdmin.from('trainers').upsert(
		{
			id: authUserId,
			email,
			status: 'active'
		},
		{ onConflict: 'id' }
	);

	if (upsertError) {
		console.error('trainer upsert from auth user failed', upsertError);
	}

	return await getTrainerRecordByEmail(email);
};

const fetchAccessRpcRow = async (email: string): Promise<TrainerAccessRpcRow | null> => {
	const { data, error } = await supabaseAdmin.rpc('get_trainer_access_status', {
		p_email: email
	});

	if (error) {
		console.error('trainer access rpc error', error);
		return null;
	}

	return (Array.isArray(data) ? data[0] : null) as TrainerAccessRpcRow | null;
};

const parseAccessStatus = (row: TrainerAccessRpcRow): TrainerAccessStatus => {
	if (row.allowed) {
		return {
			allowed: true,
			reason: 'active',
			trainer_id: row.trainer_id,
			email: row.email,
			manual_active: row.manual_active,
			subscription_active: row.subscription_active,
			active_until: row.active_until,
			now_utc: row.now_utc
		};
	}

	return {
		allowed: false,
		reason: row.manual_active ? 'expired' : 'manual_disabled',
		trainer_id: row.trainer_id,
		email: row.email,
		manual_active: row.manual_active,
		subscription_active: row.subscription_active,
		active_until: row.active_until,
		now_utc: row.now_utc
	};
};

export const getTrainerAccessStatusByEmail = async (
	rawEmail: string | null | undefined
): Promise<TrainerAccessStatus> => {
	const email = normalizeEmail(rawEmail);

	if (!email) {
		return { allowed: false, reason: 'missing_email' };
	}

	if (email === OWNER_EMAIL) {
		return { allowed: true, reason: 'owner', email };
	}

	let row = await fetchAccessRpcRow(email);

	if (!row) {
		const provisioned = await ensureTrainerRecordByEmail(email);
		if (provisioned) {
			row = await fetchAccessRpcRow(email);
		}
	}

	if (!row) {
		return { allowed: false, reason: 'not_found', email };
	}

	return parseAccessStatus(row);
};

export const getTrainerAccessStatusByTrainerId = async (
	trainerId: string
): Promise<TrainerAccessStatus> => {
	const { data: trainer, error } = await supabaseAdmin
		.from('trainers')
		.select('id,email')
		.eq('id', trainerId)
		.maybeSingle();

	if (error || !trainer?.email) {
		if (error) {
			console.error('trainer access trainer lookup error', error);
		}
		return { allowed: false, reason: 'not_found', trainer_id: trainerId };
	}

	const status = await getTrainerAccessStatusByEmail(trainer.email);
	return {
		...status,
		trainer_id: status.trainer_id ?? trainer.id
	};
};

export const ensureTrainerAccess = async (rawEmail: string | null | undefined) =>
	(await getTrainerAccessStatusByEmail(rawEmail)).allowed;

export const ensureTrainerAccessByTrainerId = async (trainerId: string) =>
	(await getTrainerAccessStatusByTrainerId(trainerId)).allowed;

export const ensureTrainerExists = async (
	supabase: App.Locals['supabase'],
	userId: string,
	email: string
) => {
	const { data, error } = await supabase.from('trainers').select('id').eq('id', userId).maybeSingle();
	if (error) {
		console.error('trainer lookup error', error);
		return;
	}
	if (!data) {
		const normalizedEmail = email.trim().toLowerCase();
		const { error: insertError } = await supabase
			.from('trainers')
			.insert({ id: userId, email: normalizedEmail, status: 'active' });
		if (insertError) {
			console.error('trainer insert error', insertError);
		}
	}
};

export const getAccountSubscriptionSummary = async (
	rawEmail: string | null | undefined
): Promise<AccountSubscriptionSummary> => {
	const email = normalizeEmail(rawEmail);
	const nowUtc = new Date().toISOString();

	if (!email) {
		return {
			is_owner: false,
			state: 'missing',
			active_until: null,
			now_utc: nowUtc,
			days_remaining: null
		};
	}

	if (email === OWNER_EMAIL) {
		return {
			is_owner: true,
			state: 'owner',
			active_until: null,
			now_utc: nowUtc,
			days_remaining: null
		};
	}

	const accessStatus = await getTrainerAccessStatusByEmail(email);
	if (!accessStatus.active_until) {
		return {
			is_owner: false,
			state: 'missing',
			active_until: null,
			now_utc: accessStatus.now_utc ?? nowUtc,
			days_remaining: null
		};
	}

	const now = accessStatus.now_utc ?? nowUtc;
	const daysRemaining = computeDaysRemaining(accessStatus.active_until, now);
	const state = daysRemaining === 0 ? 'expired' : (daysRemaining ?? 999) <= 5 ? 'expiring' : 'active';

	return {
		is_owner: false,
		state,
		active_until: accessStatus.active_until,
		now_utc: now,
		days_remaining: daysRemaining
	};
};

export const getAndMarkSubscriptionWarning = async (
	rawEmail: string | null | undefined,
	thresholdDays = 5
): Promise<SubscriptionWarning | null> => {
	const email = normalizeEmail(rawEmail);
	if (!email || email === OWNER_EMAIL) {
		return null;
	}

	const { data, error } = await supabaseAdmin.rpc('get_and_mark_subscription_warning', {
		p_email: email,
		p_threshold_days: thresholdDays
	});

	if (error) {
		// No romper el panel si la migración todavía no corrió.
		console.error('subscription warning rpc error', error);
		return null;
	}

	const row = (Array.isArray(data) ? data[0] : null) as SubscriptionWarningRpcRow | null;
	if (!row) return null;

	return {
		should_show: row.should_show === true,
		reason: row.reason,
		active_until: row.active_until,
		days_remaining: row.days_remaining,
		warned_at: row.warned_at,
		now_utc: row.now_utc
	};
};

export const fetchTrainerAdminData = async (): Promise<TrainerAdminRow[]> => {
	const { data: accessRows } = await supabaseAdmin
		.from('trainer_access')
		.select('email,active,created_at,updated_at')
		.order('created_at', { ascending: true });

	const { data: trainerRows } = await supabaseAdmin
		.from('trainers')
		.select('id,email,status,created_at,active_until')
		.order('created_at', { ascending: true });

	const byEmail = new Map<string, TrainerAdminRow>();

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
			created_at: current.created_at ?? row.created_at,
			active_until: row.active_until
		});
	});

	return Array.from(byEmail.values());
};

export const fetchOwnerActionHistory = async (
	rawAdminEmail: string | null | undefined,
	windowHours = OWNER_HISTORY_WINDOW_HOURS,
	maxRows = OWNER_HISTORY_MAX_ROWS
): Promise<OwnerActionHistoryRow[]> => {
	const adminEmail = normalizeEmail(rawAdminEmail);
	if (!adminEmail) return [];

	const safeWindowHours = Math.max(1, Math.min(24 * 30, windowHours));
	const safeMaxRows = Math.max(1, Math.min(500, maxRows));
	const cutoffIso = new Date(Date.now() - safeWindowHours * 60 * 60 * 1000).toISOString();

	const { data, error } = await supabaseAdmin
		.from('owner_action_history')
		.select('id,admin_id,admin_email,action_type,target_email,target_trainer_id,details,created_at')
		.eq('admin_email', adminEmail)
		.gte('created_at', cutoffIso)
		.order('created_at', { ascending: false })
		.limit(safeMaxRows);

	if (error) {
		// No romper el panel si la migración todavía no se ejecutó.
		console.error('owner action history fetch error', error);
		return [];
	}

	return (data ?? []) as OwnerActionHistoryRow[];
};
