import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const code = url.searchParams.get('code');
	const errorCode = url.searchParams.get('error_code');
	const sbMarker = url.searchParams.get('sb');
	const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';

	const hasRecoveryHint =
		Boolean(code) ||
		Boolean(errorCode) ||
		Boolean(sbMarker) ||
		(tokenHash !== null && type === 'recovery');

	return {
		recoveryHint: hasRecoveryHint,
		prefillEmail: email
	};
};
