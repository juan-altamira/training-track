<script lang="ts">
import { goto } from '$app/navigation';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { supabaseClient } from '$lib/supabaseClient';
import { onMount } from 'svelte';

let email = '';
let newPassword = '';
let confirmPassword = '';
let showPwd = false;
let showConfirm = false;
let message = '';
let error = '';
let loading = false;
let mode: 'request' | 'update' = 'request';

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
		error = '';
		const { error: setError } = await supabaseClient.auth.setSession({
			access_token: hashParams.access_token,
			refresh_token: hashParams.refresh_token
		});
		if (setError) {
			console.error(setError);
			error = 'No pudimos validar el link. Pedí uno nuevo.';
		} else {
			mode = 'update';
			message = 'Link verificado. Ingresá tu nueva contraseña.';
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
		}
		loading = false;
	}
});

	const requestReset = async () => {
		loading = true;
		error = '';
		message = '';
		const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), {
			redirectTo: `${PUBLIC_SITE_URL}/reset`
		});
		if (resetError) {
			error = 'No pudimos enviar el link. Revisá el email e intentá de nuevo.';
			console.error(resetError);
		} else {
			message = 'Te enviamos un link para restablecer tu contraseña. Revisá tu correo.';
		}
		loading = false;
	};

	const updatePassword = async () => {
		if (newPassword !== confirmPassword) {
			error = 'Las contraseñas no coinciden.';
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
			setTimeout(() => goto('/login'), 1000);
		}
		loading = false;
	};
</script>

<section class="mx-auto max-w-lg space-y-6 rounded-2xl border border-slate-800 bg-[#0f111b] p-8 shadow-lg shadow-black/30 text-slate-100">
	<div class="space-y-2 text-center">
		<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">
			{mode === 'request' ? 'Restablecer' : 'Nueva contraseña'}
		</p>
		<h1 class="text-2xl font-semibold text-slate-50">
			{mode === 'request' ? 'Recuperá tu acceso' : 'Ingresá tu nueva contraseña'}
		</h1>
		<p class="text-sm text-slate-400">
			{mode === 'request'
				? 'Te enviaremos un link seguro a tu correo.'
				: 'Elige una contraseña segura y fácil de recordar.'}
		</p>
		<p class="text-xs text-slate-500">
			<a class="text-emerald-300 hover:underline" href="/login">Volver a entrar</a>
		</p>
	</div>

	{#if mode === 'request'}
		<div class="space-y-4">
			<label class="block text-sm font-medium text-slate-200">
				Email
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					placeholder="entrenador@tu-mail.com"
					type="email"
					required
					bind:value={email}
				/>
			</label>
			<button
				on:click|preventDefault={requestReset}
				class="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
				disabled={loading || !email}
			>
				{#if loading}
					Enviando...
				{:else}
					Enviar link de recuperación
				{/if}
			</button>
		</div>
	{:else}
		<div class="space-y-4">
			<label class="block text-sm font-medium text-slate-200">
				Nueva contraseña
				<div class="relative mt-1">
					<input
						class="w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 pr-10 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
						placeholder="••••••••"
						type={showPwd ? 'text' : 'password'}
						required
						bind:value={newPassword}
					/>
					<button
						type="button"
						class="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-200"
						on:click={() => (showPwd = !showPwd)}
						aria-label="Mostrar u ocultar contraseña"
					>
						{showPwd ? 'Ocultar' : 'Ver'}
					</button>
				</div>
			</label>
			<label class="block text-sm font-medium text-slate-200">
				Confirmar contraseña
				<div class="relative mt-1">
					<input
						class="w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 pr-10 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
						placeholder="••••••••"
						type={showConfirm ? 'text' : 'password'}
						required
						bind:value={confirmPassword}
					/>
					<button
						type="button"
						class="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-200"
						on:click={() => (showConfirm = !showConfirm)}
						aria-label="Mostrar u ocultar contraseña"
					>
						{showConfirm ? 'Ocultar' : 'Ver'}
					</button>
				</div>
			</label>
			<button
				on:click|preventDefault={updatePassword}
				class="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
				disabled={loading || !newPassword || !confirmPassword}
			>
				{#if loading}
					Actualizando...
				{:else}
					Guardar nueva contraseña
				{/if}
			</button>
		</div>
	{/if}

	{#if message}
		<p class="rounded-lg bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200 border border-emerald-700/50">{message}</p>
	{/if}
	{#if error}
		<p class="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200 border border-red-700/50">{error}</p>
	{/if}
</section>
