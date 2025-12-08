import { createClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

const SUPABASE_URL = publicEnv.PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
const SERVICE_ROLE =
	privateEnv.SUPABASE_SERVICE_ROLE_KEY ??
	privateEnv.SUPABASE_SERVICE_ROLE ??
	'service-role-placeholder';

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);
