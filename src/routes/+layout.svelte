<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.postcss';
	import type { Session } from '@supabase/supabase-js';
	import { page } from '$app/stores';

	let { children, data } = $props();
	let session = (data?.session ?? null) as Session | null;

	const hideAuthActions = $derived(
		['/r/', '/login', '/registro', '/reset'].some((p) => $page.url.pathname.startsWith(p))
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Training Track</title>
</svelte:head>

<div class="min-h-screen bg-[#0d0f14] text-slate-100">
	<header class="border-b border-slate-800 bg-[#0f111b]/90 backdrop-blur">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
			<div class="flex items-center gap-3">
				<div class="h-9 w-9 rounded-xl bg-slate-100 text-[#0d0f14] grid place-items-center text-lg font-semibold">
					TT
				</div>
				<div>
					<p class="text-lg font-semibold leading-tight text-slate-100">Training Track</p>
				</div>
			</div>
			{#if !hideAuthActions}
				{#if session}
					<div class="flex items-center gap-3 text-sm">
						<span class="text-slate-300 hidden sm:inline">{session.user.email}</span>
						<form method="POST" action="/logout" class="inline">
							<button
								type="submit"
								class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-1.5 text-slate-100 transition hover:bg-[#1b1f30]"
							>
								Cerrar sesión
							</button>
						</form>
					</div>
				{:else}
					<a
						class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-1.5 text-slate-100 transition hover:bg-[#1b1f30] text-sm"
						href="/login"
						>Entrar</a
					>
				{/if}
			{/if}
		</div>
	</header>
	<main class="mx-auto max-w-6xl px-4 py-8">{@render children()}</main>
</div>
