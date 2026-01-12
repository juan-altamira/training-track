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

<div class="min-h-screen bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur dark:border-[#1f3554] dark:bg-[#0f1f36]/90">
		<div class="mb-6 text-center space-y-3">
			<h1 class="text-3xl font-semibold text-white">
				{mode === 'request' ? 'Recuperar contraseña' : 'Nueva contraseña'}
			</h1>
			<p class="text-sm text-neutral-200">
				{mode === 'request' 
					? 'Ingresá tu email y te enviaremos un enlace para restablecer tu clave.'
					: 'Elegí una contraseña segura y fácil de recordar.'}
			</p>
		</div>

		{#if success}
			<div class="space-y-4">
				<div class="flex justify-center">
					<div class="grid h-16 w-16 place-items-center rounded-full border border-green-400/40 bg-green-500/15 text-green-100">
						<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
							<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
						</svg>
					</div>
				</div>
				<div class="space-y-3 rounded-xl bg-green-500/15 px-4 py-3 text-sm font-semibold text-green-100">
					<p>{message}</p>
				</div>
				<a
					href="/login"
					class="inline-flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
				>
					Volver a ingresar
				</a>
			</div>
		{:else if mode === 'request'}
			<form onsubmit={(e) => { e.preventDefault(); requestReset(); }} class="space-y-6">
				<div class="space-y-3">
					<label for="email" class="text-sm font-medium text-white">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder="Introduce tu email"
						required
						bind:value={email}
						autocomplete="email"
					/>
				</div>

				{#if error}
					<p class="flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200">
						<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
						</svg>
						{error}
					</p>
				{/if}

				<button
					type="submit"
					disabled={loading || !email}
					class="flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
				>
					{loading ? 'Enviando...' : 'Enviar enlace'}
				</button>

				<div class="text-center text-sm text-neutral-300">
					<a href="/login" class="hover:underline">Volver al login</a>
				</div>
			</form>
		{:else}
			<form onsubmit={(e) => { e.preventDefault(); updatePassword(); }} class="space-y-6">
				{#if message}
					<p class="flex items-center gap-2 rounded-xl bg-green-500/15 px-4 py-3 text-sm font-semibold text-green-200">
						<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
							<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
						</svg>
						{message}
					</p>
				{/if}

				<div class="space-y-3">
					<label for="newPassword" class="text-sm font-medium text-white">Nueva contraseña</label>
					<div class="relative">
						<input
							id="newPassword"
							name="newPassword"
							type={showPassword ? 'text' : 'password'}
							class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 pr-16 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
							placeholder="Creá una contraseña segura"
							required
							bind:value={newPassword}
							autocomplete="new-password"
						/>
						<button
							type="button"
							class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-neutral-100 transition hover:bg-white/10"
							onclick={() => (showPassword = !showPassword)}
						>
							{showPassword ? 'Ocultar' : 'Ver'}
						</button>
					</div>
				</div>

				<div class="space-y-3">
					<label for="confirmPassword" class="text-sm font-medium text-white">Confirmar contraseña</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type={showPassword ? 'text' : 'password'}
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder="Repetí tu contraseña"
						required
						bind:value={confirmPassword}
						autocomplete="new-password"
					/>
				</div>

				{#if error}
					<p class="flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200">
						<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
						</svg>
						{error}
					</p>
				{/if}

				<button
					type="submit"
					disabled={loading || !newPassword || !confirmPassword}
					class="flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
				>
					{loading ? 'Guardando...' : 'Guardar nueva contraseña'}
				</button>

				<div class="text-center text-sm text-neutral-300">
					<a href="/login" class="hover:underline">Volver al login</a>
				</div>
			</form>
		{/if}
	</div>
</div>
