type LoadPerfMeta = Record<string, string | number | boolean | null | undefined>;

export const logLoadDuration = (route: string, startedAtMs: number, meta: LoadPerfMeta = {}) => {
	const durationMs = Date.now() - startedAtMs;
	console.info('[load-perf]', {
		route,
		duration_ms: durationMs,
		...meta
	});
};
