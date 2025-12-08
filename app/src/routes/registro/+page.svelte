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

	const sendSignUpLink = async () => {
		loading = true;
		error = '';
		message = '';
		const { error: signUpError } = await supabaseClient.auth.signUp({
			email: email.trim(),
			options: {
				emailRedirectTo: `${PUBLIC_SITE_URL}/registro`
			}
		});
		if (signUpError) {
			error = 'No pudimos enviar el link. Revisá el email e intentá de nuevo.';
			console.error(signUpError);
		} else {
			message = 'Revisá tu correo y tocá el link para confirmar tu cuenta.';
		}
		loading = false;
	};
</script>

<section class="mx-auto max-w-lg space-y-6 rounded-2xl border border-slate-800 bg-[#0f111b] p-8 shadow-lg shadow-black/30 text-slate-100">
	<div class="space-y-2 text-center">
		<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Registro</p>
		<h1 class="text-2xl font-semibold text-slate-50">Crear cuenta de entrenador</h1>
		<p class="text-sm text-slate-400">Ingresá tu email. Te enviamos un link para confirmar.</p>
		<p class="text-xs text-slate-500">¿Ya tenés cuenta? <a class="text-emerald-300 hover:underline" href="/login">Entrá aquí</a></p>
	</div>
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
			on:click|preventDefault={sendSignUpLink}
			class="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
			disabled={loading || !email}
		>
			{#if loading}
				Enviando...
			{:else}
				Enviar link de registro
			{/if}
		</button>
		{#if message}
			<p class="rounded-lg bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200 border border-emerald-700/50">{message}</p>
		{/if}
		{#if error}
			<p class="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200 border border-red-700/50">{error}</p>
		{/if}
	</div>
	<p class="text-xs text-slate-500 text-center">
		Redirect configurado en Supabase: {PUBLIC_SITE_URL}/registro
	</p>
</section>
