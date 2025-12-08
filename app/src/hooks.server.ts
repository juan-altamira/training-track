import { createServerClient } from '@supabase/auth-helpers-sveltekit';
import type { Handle } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			get: (key) => event.cookies.get(key),
			set: (key, value, options) =>
				event.cookies.set(key, value, { path: '/', ...options }),
			remove: (key, options) => event.cookies.delete(key, { path: '/', ...options })
		}
	});

	const {
		data: { session }
	} = await event.locals.supabase.auth.getSession();
	event.locals.session = session;

	return resolve(event, {
		filterSerializedResponseHeaders: (name) => name === 'content-range'
	});
};
