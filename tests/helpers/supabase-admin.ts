import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type SupabaseConfig = {
	url: string;
	serviceRoleKey: string;
};

let cachedClient: SupabaseClient | null = null;

const readEnv = (key: string): string | undefined => {
	const value = process.env[key]?.trim();
	return value ? value : undefined;
};

export const resolveTestSupabaseConfig = (): SupabaseConfig | null => {
	const url = readEnv('TEST_SUPABASE_URL') ?? readEnv('PUBLIC_SUPABASE_URL');
	const serviceRoleKey =
		readEnv('TEST_SUPABASE_SERVICE_ROLE_KEY') ??
		readEnv('SUPABASE_SERVICE_ROLE_KEY') ??
		readEnv('SUPABASE_SERVICE_ROLE');

	if (!url || !serviceRoleKey) {
		return null;
	}

	return { url, serviceRoleKey };
};

export const isSupabaseAdminConfigured = (): boolean => resolveTestSupabaseConfig() !== null;

export const getSupabaseAdmin = (): SupabaseClient => {
	if (cachedClient) {
		return cachedClient;
	}

	const config = resolveTestSupabaseConfig();
	if (!config) {
		throw new Error(
			'Missing Supabase admin test env. Define TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY.'
		);
	}

	cachedClient = createClient(config.url, config.serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});

	return cachedClient;
};
