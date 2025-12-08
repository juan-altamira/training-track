<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.postcss';
	import type { Session } from '@supabase/supabase-js';

	let { children, data } = $props();
	let session = (data?.session ?? null) as Session | null;
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Training Track</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
			<div class="flex items-center gap-3">
				<div class="h-9 w-9 rounded-xl bg-slate-900 text-white grid place-items-center text-lg font-semibold">
					TT
				</div>
				<div>
					<p class="text-lg font-semibold leading-tight">Training Track</p>
					<p class="text-xs text-slate-500">Rutinas simples para entrenadores</p>
				</div>
			</div>
			{#if session}
				<div class="flex items-center gap-3 text-sm">
					<span class="text-slate-600 hidden sm:inline">{session.user.email}</span>
					<form method="POST" action="/logout" class="inline">
						<button
							type="submit"
							class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-100"
						>
							Cerrar sesión
						</button>
					</form>
				</div>
			{:else}
				<a
					class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-100 text-sm"
					href="/login"
					>Entrar</a
				>
			{/if}
		</div>
	</header>
	<main class="mx-auto max-w-6xl px-4 py-8">{@render children()}</main>
</div>
