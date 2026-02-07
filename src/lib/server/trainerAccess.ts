import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { TrainerAdminRow } from '$lib/types';

export const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';

export const isOwnerEmail = (rawEmail: string | null | undefined) =>
	rawEmail?.toLowerCase() === OWNER_EMAIL;

export const ensureTrainerAccess = async (rawEmail: string | null | undefined) => {
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
		const { error: insertError } = await supabase
			.from('trainers')
			.insert({ id: userId, email, status: 'active' });
		if (insertError) {
			console.error('trainer insert error', insertError);
		}
	}
};

export const fetchTrainerAdminData = async (): Promise<TrainerAdminRow[]> => {
	const { data: accessRows } = await supabaseAdmin
		.from('trainer_access')
		.select('email,active,created_at,updated_at')
		.order('created_at', { ascending: true });

	const { data: trainerRows } = await supabaseAdmin
		.from('trainers')
		.select('id,email,status,created_at')
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
			created_at: current.created_at ?? row.created_at
		});
	});

	return Array.from(byEmail.values());
};
