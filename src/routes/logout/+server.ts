import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const isSupabaseSessionCookie = (name: string) =>
	name.startsWith('sb-') &&
	(name.includes('-auth-token') || name.includes('-auth-token-code-verifier'));

export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { error } = await locals.supabase.auth.signOut({ scope: 'local' });

	// Fallback: ensure stale auth cookies are removed even if signOut fails upstream.
	cookies.getAll().forEach(({ name }) => {
		if (!isSupabaseSessionCookie(name)) return;
		cookies.delete(name, { path: '/' });
	});

	if (error) {
		console.error('Logout signOut error', {
			message: error.message,
			status: 'status' in error ? error.status : undefined
		});
	}

	throw redirect(303, '/login');
};
