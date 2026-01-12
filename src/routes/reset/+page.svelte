<script lang="ts">
import { goto } from '$app/navigation';
import { env } from '$env/dynamic/public';
import { supabaseClient } from '$lib/supabaseClient';
import { onMount } from 'svelte';

let email = $state('');
let newPassword = $state('');
let confirmPassword = $state('');
let showPassword = $state(false);
let message = $state('');
let error = $state('');
let loading = $state(false);
let mode = $state<'request' | 'update'>('request');
let success = $state(false);
const SITE_URL = (env.PUBLIC_SITE_URL ?? 'http://localhost:5173').replace(/\/?$/, '');

const parseHashParams = (hash: string) => {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	return {
		access_token: params.get('access_token'),
		refresh_token: params.get('refresh_token'),
		type: params.get('type')
	};
};

onMount(async () => {
	const url = new URL(window.location.href);
	const hashParams = parseHashParams(window.location.hash);
	const code = url.searchParams.get('code');

	// Prefer hash tokens (Supabase recovery flow sends them)
	if (hashParams.access_token && hashParams.refresh_token) {
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
	}
});

const requestReset = async () => {
	loading = true;
	error = '';
	message = '';
	success = false;
	const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), {
		redirectTo: `${SITE_URL}/reset`
	});
	if (resetError) {
		error = 'No pudimos enviar el link. Revisá el email e intentá de nuevo.';
		console.error(resetError);
	} else {
		success = true;
		message = 'Te enviamos un link para restablecer tu contraseña. Revisá tu correo.';
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
	const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword });
	if (updateError) {
		error = 'No pudimos actualizar la contraseña. Probá de nuevo.';
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
		<div class="mb-6 text-center space-y-2">
			<h1 class="text-3xl font-extrabold tracking-tight">
				<span class="bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-100 bg-clip-text text-transparent">
					{mode === 'request' ? 'Recuperar contraseña' : 'Nueva contraseña'}
				</span>
			</h1>
			<p class="text-sm text-slate-400">
				{mode === 'request' 
					? 'Ingresá tu email y te enviaremos un enlace para restablecer tu clave.'
					: 'Elegí una contraseña segura y fácil de recordar.'}
			</p>
			<p class="text-xs text-slate-500">
				<a class="text-emerald-300 hover:underline" href="/login">Volver a entrar</a>
			</p>
		</div>

		{#if success}
			<div class="space-y-4">
				<div class="flex justify-center">
					<div class="grid h-16 w-16 place-items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-200">
						<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
							<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
						</svg>
					</div>
				</div>
				<div class="rounded-lg bg-emerald-900/40 px-4 py-3 text-sm text-emerald-200 border border-emerald-700/50">
					<p>{message}</p>
				</div>
				<a
					href="/login"
					class="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-lg font-semibold text-white transition hover:bg-emerald-500"
				>
					Volver a ingresar
				</a>
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
