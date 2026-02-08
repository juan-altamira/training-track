import { preloadData } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';

const MIN_HIDDEN_MS_TO_WARM = 10 * 60 * 1000;
const MIN_GAP_BETWEEN_WARMS_MS = 45 * 1000;
const WARM_DELAY_MS = 160;
const SESSION_REFRESH_INTERVAL_MS = 50 * 60 * 1000;
const LAST_CLIENT_ROUTE_KEY = 'tt:last-client-route';

const isClientesPath = (pathname: string) => pathname === '/clientes' || pathname.startsWith('/clientes/');
const isClientDetailPath = (pathname: string) => /^\/clientes\/[^/]+$/.test(pathname);

const sanitizeClientRoute = (value: string | null): string | null => {
	if (!value) return null;
	return isClientDetailPath(value) ? value : null;
};

const getRememberedClientRoute = (): string | null => {
	try {
		return sanitizeClientRoute(sessionStorage.getItem(LAST_CLIENT_ROUTE_KEY));
	} catch {
		return null;
	}
};

export const rememberLastClientRoute = (clientId: string) => {
	if (!clientId || typeof window === 'undefined') return;
	const path = `/clientes/${clientId}`;
	try {
		sessionStorage.setItem(LAST_CLIENT_ROUTE_KEY, path);
	} catch {
		// Ignore storage errors (private mode/quota).
	}
};

export const installSessionResumeWarmup = () => {
	if (typeof window === 'undefined') return () => {};

	let hiddenAt: number | null = document.hidden ? Date.now() : null;
	let lastWarmAt = 0;
	let lastSessionRefreshAt = 0;
	let warmTimer: ReturnType<typeof setTimeout> | null = null;
	let warming = false;

	const clearWarmTimer = () => {
		if (!warmTimer) return;
		clearTimeout(warmTimer);
		warmTimer = null;
	};

	const warm = async () => {
		warmTimer = null;
		if (document.hidden || warming) return;

		const pathname = window.location.pathname;
		if (!isClientesPath(pathname)) return;

		const now = Date.now();
		if (now - lastWarmAt < MIN_GAP_BETWEEN_WARMS_MS) return;

		warming = true;
		lastWarmAt = now;
		try {
			if (now - lastSessionRefreshAt >= SESSION_REFRESH_INTERVAL_MS) {
				const { data } = await supabaseClient.auth.getSession();
				if (data.session) {
					await supabaseClient.auth.refreshSession();
				}
				lastSessionRefreshAt = Date.now();
			}

			const preloadTargets = new Set<string>(['/clientes']);
			if (isClientDetailPath(pathname)) {
				preloadTargets.add(pathname);
			}
			const remembered = getRememberedClientRoute();
			if (remembered && remembered !== pathname) {
				preloadTargets.add(remembered);
			}

			await Promise.allSettled(Array.from(preloadTargets).map((target) => preloadData(target)));
		} catch {
			// Warm-up must never break user interaction.
		} finally {
			warming = false;
		}
	};

	const scheduleWarm = () => {
		if (document.hidden) return;
		clearWarmTimer();
		warmTimer = setTimeout(() => {
			void warm();
		}, WARM_DELAY_MS);
	};

	const onVisibilityChange = () => {
		if (document.hidden) {
			hiddenAt = Date.now();
			clearWarmTimer();
			return;
		}

		const now = Date.now();
		const hiddenMs = hiddenAt ? now - hiddenAt : 0;
		hiddenAt = null;

		if (hiddenMs >= MIN_HIDDEN_MS_TO_WARM) {
			scheduleWarm();
		}
	};

	const onFocus = () => {
		if (document.hidden) return;
		if (!hiddenAt) return;
		const hiddenMs = Date.now() - hiddenAt;
		if (hiddenMs >= MIN_HIDDEN_MS_TO_WARM) {
			scheduleWarm();
		}
	};

	window.addEventListener('focus', onFocus);
	window.addEventListener('pageshow', onFocus);
	document.addEventListener('visibilitychange', onVisibilityChange);

	return () => {
		clearWarmTimer();
		window.removeEventListener('focus', onFocus);
		window.removeEventListener('pageshow', onFocus);
		document.removeEventListener('visibilitychange', onVisibilityChange);
	};
};
