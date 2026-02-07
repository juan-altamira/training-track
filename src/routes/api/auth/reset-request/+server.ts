import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { OWNER_EMAIL } from '$lib/server/trainerAccess';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value: unknown) =>
	typeof value === 'string' ? value.trim().toLowerCase() : '';

const existsInDatabase = async (email: string) => {
	if (email === OWNER_EMAIL) {
		return true;
	}
	const { data, error } = await supabaseAdmin
		.from('trainers')
		.select('id')
		.eq('email', email)
		.maybeSingle();

	if (error) {
		throw error;
	}

	return Boolean(data?.id);
};

const parseRetrySeconds = (message: string | undefined) => {
	if (!message) return null;
	const match = message.match(/after\s+(\d+)\s+seconds?/i);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value > 0 ? value : null;
};

export const POST: RequestHandler = async ({ request, url }) => {
	let body: { email?: unknown } | null = null;
	try {
		body = (await request.json()) as { email?: unknown };
	} catch {
		return json({ ok: false, message: 'Payload inválido.' }, { status: 400 });
	}

	const email = normalizeEmail(body?.email);
	if (!email || !EMAIL_REGEX.test(email)) {
		return json({ ok: false, message: 'Ingresá un email válido.' }, { status: 400 });
	}

	try {
		const exists = await existsInDatabase(email);
		if (!exists) {
			return json(
				{
					ok: false,
					message: 'No encontramos una cuenta con ese email en la base de datos.'
				},
				{ status: 404 }
			);
		}
	} catch (error) {
		console.error('reset-request lookup error', error);
		return json({ ok: false, message: 'No pudimos validar la cuenta.' }, { status: 500 });
	}

	const baseUrl = (publicEnv.PUBLIC_SITE_URL ?? `${url.protocol}//${url.host}`).replace(/\/?$/, '');
	const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
		redirectTo: `${baseUrl}/reset?email=${encodeURIComponent(email)}`
	});

	if (resetError) {
		console.error('reset-request send error', resetError);
		const retryAfterSeconds = parseRetrySeconds(resetError.message);
		const isRateLimit =
			resetError.status === 429 ||
			resetError.code === 'over_email_send_rate_limit' ||
			(resetError.message ?? '').toLowerCase().includes('only request this after');

		if (isRateLimit) {
			return json(
				{
					ok: false,
					message: `Reenvío bloqueado temporalmente. Esperá ${retryAfterSeconds ?? 60}s para volver a intentar.`,
					retry_after_seconds: retryAfterSeconds ?? 60
				},
				{ status: 429 }
			);
		}

		return json(
			{
				ok: false,
				message:
					'No pudimos enviar el email ahora. Revisá Spam/Promociones o intentá nuevamente en unos minutos.'
			},
			{ status: 500 }
		);
	}

	return json({
		ok: true,
		email
	});
};
