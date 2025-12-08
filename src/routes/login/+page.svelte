<script lang="ts">
import { goto } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';

	let email = '';
	let password = '';
	let message = '';
	let error = '';
	let loading = false;
	let showPassword = false;

const login = async () => {
	loading = true;
	error = '';
	message = '';
	const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
		email: email.trim(),
		password: password
	});
	if (signInError) {
		error = 'No pudimos iniciar sesión. Revisá email y contraseña.';
		console.error(signInError);
	} else {
		if (data.session) {
			await goto('/clientes');
		} else {
			message = 'Revisá tu correo para confirmar la cuenta.';
		}
	}
	loading = false;
};
</script>

<section class="mx-auto max-w-lg space-y-6 rounded-2xl border border-slate-800 bg-[#0f111b] p-10 shadow-lg shadow-black/30 text-slate-100">
	<div class="space-y-3 text-center">
		<h1 class="text-3xl font-extrabold text-slate-50 tracking-tight">
			<span class="bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-100 bg-clip-text text-transparent">
				Ingreso de entrenadores
			</span>
		</h1>
	</div>

	<div class="space-y-4">
		<label class="block text-base font-medium text-slate-200">
			Email
			<input
				class="mt-2 w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-lg text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
				placeholder="entrenador@tu-mail.com"
				type="email"
				required
				bind:value={email}
			/>
		</label>
		<label class="block text-base font-medium text-slate-200">
			Contraseña
			<div class="relative mt-2">
				<input
					class="w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 pr-12 text-lg text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					placeholder="••••••••"
					type={showPassword ? 'text' : 'password'}
					required
					bind:value={password}
				/>
				<button
					type="button"
					class="absolute inset-y-0 right-0 px-4 text-slate-400 hover:text-slate-200"
					on:click={() => (showPassword = !showPassword)}
					aria-label="Mostrar u ocultar contraseña"
				>
					{showPassword ? 'Ocultar' : 'Ver'}
				</button>
			</div>
		</label>

		<p class="text-sm text-slate-400">
			¿No tenés cuenta?
			<a class="text-emerald-300 hover:underline font-semibold" href="/registro">Registrate</a>
			·
			<a class="text-emerald-300 hover:underline font-semibold" href="/reset">¿Olvidaste tu contraseña?</a>
		</p>

		<button
			on:click|preventDefault={login}
			class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-lg font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
			disabled={loading || !email || !password}
		>
			{#if loading}
				Entrando...
			{:else}
				Entrar
			{/if}
		</button>

		{#if message}
			<p class="rounded-lg bg-emerald-900/40 px-4 py-3 text-sm text-emerald-200 border border-emerald-700/50">{message}</p>
		{/if}
		{#if error}
			<p class="rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-200 border border-red-700/50">{error}</p>
		{/if}
	</div>
</section>
