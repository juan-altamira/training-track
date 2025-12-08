<script lang="ts">
	import { goto } from '$app/navigation';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { supabaseClient } from '$lib/supabaseClient';
	import { onMount } from 'svelte';

	let email = '';
	let message = '';
	let error = '';
	let loading = false;

	onMount(async () => {
		const url = new URL(window.location.href);
		const code = url.searchParams.get('code');
		if (code) {
			loading = true;
			const { error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(code);
			if (exchangeError) {
				error = 'No pudimos validar el link. Probá de nuevo.';
				console.error(exchangeError);
			} else {
				await goto('/clientes');
			}
			loading = false;
		}
	});

	const sendMagicLink = async () => {
		loading = true;
		error = '';
		message = '';
		const { error: signInError } = await supabaseClient.auth.signInWithOtp({
			email: email.trim(),
			options: {
				emailRedirectTo: `${PUBLIC_SITE_URL}/login`
			}
		});
		if (signInError) {
			error = 'No pudimos enviar el link. Revisá el email e intentá de nuevo.';
			console.error(signInError);
		} else {
			message = 'Te enviamos un link. Revisá tu correo y tocá el link para entrar.';
		}
		loading = false;
	};
</script>

<section class="mx-auto max-w-lg space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
	<div class="space-y-2">
		<p class="text-sm font-semibold uppercase tracking-wide text-slate-500">Acceso</p>
		<h1 class="text-2xl font-semibold text-slate-900">Entrar como entrenador</h1>
		<p class="text-sm text-slate-600">Ingresá tu email. Te enviamos un magic link sin contraseña.</p>
	</div>
	<div class="space-y-4">
		<label class="block text-sm font-medium text-slate-700">
			Email
			<input
				class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
				placeholder="entrenador@tu-mail.com"
				type="email"
				required
				bind:value={email}
			/>
		</label>
		<button
			on:click|preventDefault={sendMagicLink}
			class="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
			disabled={loading || !email}
		>
			{#if loading}
				Enviando...
			{:else}
				Enviar magic link
			{/if}
		</button>
		{#if message}
			<p class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
		{/if}
		{#if error}
			<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
		{/if}
	</div>
	<p class="text-xs text-slate-500">
		Asegurate de haber configurado la URL de redirect en Supabase: {PUBLIC_SITE_URL}.
	</p>
</section>
