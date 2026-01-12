export const nowIsoUtc = () => new Date().toISOString();

export const getCurrentWeekStartUtc = () => {
	const now = new Date();
	const day = now.getUTCDay(); // 0 Sunday, 1 Monday...
	const diffToMonday = (day + 6) % 7; // days since Monday
	const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	monday.setUTCDate(monday.getUTCDate() - diffToMonday);
	monday.setUTCHours(0, 0, 0, 0);
	return monday.toISOString();
};

export const daysBetweenUtc = (fromIso?: string | null, toIso?: string | null) => {
	if (!fromIso || !toIso) return null;
	const from = new Date(fromIso).getTime();
	const to = new Date(toIso).getTime();
	if (Number.isNaN(from) || Number.isNaN(to)) return null;
	return Math.floor((to - from) / (1000 * 60 * 60 * 24));
};

export const monthsBetweenUtc = (fromIso?: string | null, toIso?: string | null) => {
	if (!fromIso || !toIso) return null;
	const from = new Date(fromIso);
	const to = new Date(toIso);
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
	const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
	return months;
};
