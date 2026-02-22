import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export const listRoutineBackupsForClient = async (clientId: string, limit = 20) => {
	const safeLimit = Math.max(1, Math.min(limit, 50));
	const { data, error } = await supabaseAdmin
		.from('routine_backups')
		.select('id,client_id,routine_version,reason,created_by,created_at')
		.eq('client_id', clientId)
		.order('created_at', { ascending: false })
		.limit(safeLimit);

	if (error) {
		throw new Error(`list routine backups failed: ${error.message}`);
	}

	return data ?? [];
};

