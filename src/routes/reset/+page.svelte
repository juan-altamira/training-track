<script lang="ts">
import { goto } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';
import { onMount } from 'svelte';

type ResetPageData = {
	recoveryHint?: boolean;
	prefillEmail?: string;
};

let { data } = $props<{ data: ResetPageData }>();

let email = $state((data?.prefillEmail ?? '').trim().toLowerCase());
let newPassword = $state('');
let confirmPassword = $state('');
let showPassword = $state(false);
let message = $state('');
let error = $state('');
let loading = $state(false);
let mode = $state<'request' | 'update' | 'checking'>(data?.recoveryHint ? 'checking' : 'request');
let success = $state(false);
let sentToEmail = $state('');
let resendCountdown = $state(0);
let resendInterval: ReturnType<typeof setInterval> | null = null;
const RESEND_COOLDOWN_SECONDS = 60;

const parseHashParams = (hash: string) => {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	return {
		access_token: params.get('access_token'),
		refresh_token: params.get('refresh_token'),
		type: params.get('type'),
		error: params.get('error'),
		error_code: params.get('error_code'),
		error_description: params.get('error_description')
	};
};

onMount(async () => {
	const url = new URL(window.location.href);
	const hashParams = parseHashParams(window.location.hash);
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const tokenType = url.searchParams.get('type');
	const emailFromQuery = url.searchParams.get('email')?.trim().toLowerCase();
	const errorCode = url.searchParams.get('error_code') ?? hashParams.error_code;
	const errorDescription = url.searchParams.get('error_description') ?? hashParams.error_description;

	if (emailFromQuery) {
		email = emailFromQuery;
	}

	if (errorCode) {
		mode = 'request';
		if (errorCode === 'otp_expired') {
			error = 'El enlace de recuperación venció o ya fue usado. Pedí uno nuevo para continuar.';
		} else {
			error = errorDescription
				? `No pudimos validar el link: ${errorDescription}`
				: 'No pudimos validar el link. Pedí uno nuevo.';
		}
		return;
	}

	// Support token_hash-based recovery links
	if (tokenHash && tokenType === 'recovery') {
		mode = 'checking';
		loading = true;
		const { error: verifyError } = await supabaseClient.auth.verifyOtp({
			type: 'recovery',
			token_hash: tokenHash
		});
		if (verifyError) {
			console.error(verifyError);
			error = 'El enlace de recuperación venció o ya fue usado. Pedí uno nuevo para continuar.';
			mode = 'request';
		} else {
			mode = 'update';
			message = 'Link verificado. Ingresá tu nueva contraseña.';
			error = '';
		}
		loading = false;
		return;
	}

	// Prefer hash tokens (Supabase recovery flow sends them)
	if (hashParams.access_token && hashParams.refresh_token) {
		mode = 'checking';
		loading = true;
		const { error: setError } = await supabaseClient.auth.setSession({
			access_token: hashParams.access_token,
			refresh_token: hashParams.refresh_token
		});
		if (setError) {
			console.error(setError);
			error = 'No pudimos validar el link. Pedí uno nuevo.';
			mode = 'request';
		} else {
			mode = 'update';
			message = 'Link verificado. Ingresá tu nueva contraseña.';
			error = ''; // Limpiar cualquier error previo
		}
		loading = false;
		return;
	}

	// Fallback: code param (older flow)
	if (code) {
		mode = 'checking';
		loading = true;
		const { error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(code);
		if (exchangeError) {
			error = 'No pudimos validar el link. Pedí uno nuevo.';
			console.error(exchangeError);
			mode = 'request';
		} else {
			mode = 'update';
			message = 'Link verificado. Ingresá tu nueva contraseña.';
			error = ''; // Limpiar cualquier error previo
		}
		loading = false;
		return;
	}

	// Si ya hay sesión (por ejemplo setSession se aplicó en otro momento), pasar a update
	const { data: sessionData } = await supabaseClient.auth.getSession();
	if (sessionData.session) {
		mode = 'update';
		if (!message) {
			message = 'Ingresá tu nueva contraseña.';
		}
		return;
	}

	if (mode === 'checking') {
		mode = 'request';
	}
});

onMount(() => {
	return () => {
		if (resendInterval !== null) {
			clearInterval(resendInterval);
		}
	};
});

const startResendCountdown = (seconds = RESEND_COOLDOWN_SECONDS) => {
	if (resendInterval !== null) {
		clearInterval(resendInterval);
	}
	resendCountdown = Math.max(1, Math.floor(seconds));
	resendInterval = setInterval(() => {
		if (resendCountdown <= 1) {
			resendCountdown = 0;
			if (resendInterval !== null) {
				clearInterval(resendInterval);
				resendInterval = null;
			}
			return;
		}
		resendCountdown -= 1;
	}, 1000);
};

const requestReset = async (options: { resend?: boolean } = {}) => {
	const targetEmail = email.trim().toLowerCase();
	if (!targetEmail) {
		error = 'Ingresá un email válido.';
		return;
	}
	if (options.resend && resendCountdown > 0) {
		return;
	}

	loading = true;
	error = '';
	if (!options.resend) {
		message = '';
		success = false;
	}
	const response = await fetch('/api/auth/reset-request', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({ email: targetEmail })
	});
	const payload = (await response.json().catch(() => ({}))) as {
		ok?: boolean;
		message?: string;
		email?: string;
		retry_after_seconds?: number;
	};

	if (!response.ok || payload.ok !== true) {
		error =
			payload.message ??
			(options.resend
				? 'No pudimos reenviar el email. Intentá nuevamente.'
				: 'No pudimos enviar el email. Revisá el email e intentá de nuevo.');
		if (response.status === 429) {
			startResendCountdown(payload.retry_after_seconds ?? RESEND_COOLDOWN_SECONDS);
		}
	} else {
		email = targetEmail;
		success = true;
		sentToEmail = payload.email ?? targetEmail;
		message =
			'Te enviamos un email para restablecer tu contraseña. Lo envía nuestro sistema Supabase Auth (así te aparecerá en tu correo).';
		startResendCountdown();
	}
	loading = false;
};

const updatePassword = async () => {
	if (newPassword !== confirmPassword) {
		error = 'Las contraseñas no coinciden.';
		return;
	}
	if (newPassword.length < 6) {
		error = 'La contraseña debe tener al menos 6 caracteres.';
		return;
	}
	loading = true;
	error = '';
	message = '';

	const isSamePasswordError = (rawMessage: string | undefined) => {
		const text = (rawMessage ?? '').toLowerCase();
		return (
			text.includes('same as the old password') ||
			text.includes('different from the old password') ||
			text.includes('must be different') ||
			text.includes('misma contraseña') ||
			text.includes('misma clave')
		);
	};

	const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword });
	if (updateError) {
		if (isSamePasswordError(updateError.message)) {
			message = 'La contraseña ya era la misma. Se mantiene sin cambios y te redirigimos al login.';
			setTimeout(() => goto('/login'), 1500);
		} else {
			error = 'No pudimos actualizar la contraseña. Probá de nuevo.';
		}
		console.error(updateError);
	} else {
		message = 'Contraseña actualizada. Te redirigimos al login.';
		setTimeout(() => goto('/login'), 1500);
	}
	loading = false;
};
</script>

<section class="min-h-screen flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0f111b] p-8 shadow-lg shadow-black/30">
		{#if !success}
			<div class="mb-6 text-center space-y-2">
				<h1 class="text-3xl font-extrabold tracking-tight">
					<span class="bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-100 bg-clip-text text-transparent">
						{mode === 'request'
							? 'Recuperar contraseña'
							: mode === 'checking'
								? 'Validando enlace'
								: 'Nueva contraseña'}
					</span>
				</h1>
				<p class="text-sm text-slate-400">
					{mode === 'request'
						? 'Ingresá tu email y te enviaremos un enlace para restablecer tu clave.'
						: mode === 'checking'
							? 'Estamos verificando tu enlace de recuperación.'
							: 'Elegí una contraseña segura y fácil de recordar.'}
				</p>
				<p class="text-xs text-slate-500">
					<a class="text-emerald-300 hover:underline" href="/login">Volver a entrar</a>
				</p>
			</div>
		{/if}

		{#if success}
			<div class="relative overflow-hidden rounded-2xl bg-[#0c111d] px-5 py-6 shadow-[0_0_45px_rgba(34,211,238,0.08)] sm:px-6">
				<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(45,212,191,0.18),transparent_58%)]"></div>
				<div class="relative space-y-5">
					<div class="flex justify-center">
						<div class="grid h-14 w-14 place-items-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 shadow-lg shadow-cyan-950/25">
							<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16v12H4z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="m4 7 8 6 8-6" />
							</svg>
						</div>
					</div>

					<div class="space-y-3 text-center">
						<p class="text-3xl font-semibold leading-tight text-slate-100">
							Te enviamos un email para restablecer tu contraseña.
						</p>
						<p class="mx-auto max-w-[30rem] pt-1 text-base leading-relaxed text-slate-400">
							Lo envía nuestro sistema Supabase Auth (así te aparecerá en tu correo).
						</p>
					</div>

					{#if sentToEmail}
						<div class="rounded-xl bg-[#0f1626]/90 p-3">
							<div class="flex items-center gap-2 text-sm text-slate-200">
								<span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/25 text-emerald-200">
									<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
										<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
									</svg>
								</span>
								<p>
									Lo enviamos a:
									<span class="font-semibold">{sentToEmail}</span>
								</p>
							</div>
						</div>
					{/if}
					<div class="grid grid-cols-3 items-center gap-2">
						<a
							href="mailto:"
							class="inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-700 bg-[#1a2234] px-2.5 py-2 text-[13px] font-medium text-slate-200 transition hover:bg-[#212c45]"
						>
							<img src="/icons/mail-generic.svg" alt="" class="h-4 w-4 shrink-0" />
							Abrir correo
						</a>
						<a
							href="https://mail.google.com/mail/u/0/#inbox"
							target="_blank"
							rel="noreferrer noopener"
							class="inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-700 bg-[#1a2234] px-2.5 py-2 text-[13px] font-medium text-slate-200 transition hover:bg-[#212c45]"
						>
								<img src="/icons/google-logo.svg" alt="" class="h-4 w-4 shrink-0" />
							Abrir Gmail
						</a>
						<a
							href="https://outlook.live.com/mail/0/inbox"
							target="_blank"
							rel="noreferrer noopener"
							class="inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-700 bg-[#1a2234] px-2.5 py-2 text-[13px] font-medium text-slate-200 transition hover:bg-[#212c45]"
						>
							<img src="/icons/outlook-original.svg" alt="" class="h-4 w-4 shrink-0" />
							Abrir Outlook
						</a>
					</div>

					<p class="text-center text-sm text-slate-500">Si no llega en 2 minutos, revisá Spam o Promociones.</p>

					{#if error}
						<p class="rounded-lg border border-red-700/60 bg-red-900/40 px-4 py-3 text-sm text-red-200">
							{error}
						</p>
					{/if}

					<button
						type="button"
						onclick={() => requestReset({ resend: true })}
						disabled={loading || resendCountdown > 0}
						class="mx-auto block w-full max-w-xs rounded-xl border border-cyan-700/60 bg-cyan-950/40 px-4 py-2.5 text-base font-medium text-cyan-200 transition hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
					>
							{loading ? 'Enviando...' : resendCountdown > 0 ? `Reenviar email en ${resendCountdown}s` : 'Reenviar email'}
					</button>

					<a
						href="/login"
						class="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500/80 to-teal-300/80 px-4 py-3 text-xl font-medium text-slate-100 transition hover:brightness-110"
					>
						Volver a ingresar
					</a>
				</div>
			</div>
		{:else if mode === 'request'}
			<form onsubmit={(e) => { e.preventDefault(); requestReset(); }} class="space-y-6">
				<label class="block text-base font-medium text-slate-200">
					Email
					<input
						type="email"
						class="mt-2 w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-lg text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-slate-500"
						placeholder="entrenador@tu-mail.com"
						required
						bind:value={email}
						autocomplete="email"
					/>
				</label>

				{#if error}
					<p class="flex items-center gap-2 rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-200 border border-red-700/50">
						<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
						</svg>
						{error}
					</p>
				{/if}

				<button
					type="submit"
					disabled={loading || !email}
					class="mt-2 w-full rounded-xl bg-emerald-600 px-4 py-3 text-lg font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
				</button>
			</form>
		{:else if mode === 'checking'}
			<div class="space-y-4 rounded-xl border border-cyan-900/55 bg-[#0f1626]/90 px-5 py-6 text-center">
				<div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300"></div>
				<p class="text-sm text-slate-300">Validando enlace de recuperación...</p>
			</div>
		{:else}
			<form onsubmit={(e) => { e.preventDefault(); updatePassword(); }} class="space-y-6">
				{#if message}
					<p class="flex items-center gap-2 rounded-lg bg-emerald-900/40 px-4 py-3 text-sm text-emerald-200 border border-emerald-700/50">
						<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
							<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
						</svg>
						{message}
					</p>
				{/if}

				<label class="block text-base font-medium text-slate-200">
					Nueva contraseña
					<div class="relative mt-2">
						<input
							type={showPassword ? 'text' : 'password'}
							class="w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 pr-16 text-lg text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-slate-500"
							placeholder="Creá una contraseña segura"
							required
							bind:value={newPassword}
							autocomplete="new-password"
						/>
						<button
							type="button"
							class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:text-slate-200 hover:bg-slate-700/50"
							onclick={() => (showPassword = !showPassword)}
						>
							{showPassword ? 'Ocultar' : 'Ver'}
						</button>
					</div>
				</label>

				<label class="block text-base font-medium text-slate-200">
					Confirmar contraseña
					<input
						type={showPassword ? 'text' : 'password'}
						class="mt-2 w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-lg text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-slate-500"
						placeholder="Repetí tu contraseña"
						required
						bind:value={confirmPassword}
						autocomplete="new-password"
					/>
				</label>

				{#if error}
					<p class="flex items-center gap-2 rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-200 border border-red-700/50">
						<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
						</svg>
						{error}
					</p>
				{/if}

				<button
					type="submit"
					disabled={loading || !newPassword || !confirmPassword}
					class="mt-2 w-full rounded-xl bg-emerald-600 px-4 py-3 text-lg font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{loading ? 'Guardando...' : 'Guardar nueva contraseña'}
				</button>
			</form>
		{/if}
	</div>
</section>
