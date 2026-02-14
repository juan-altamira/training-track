<script lang="ts">
	import '../app.postcss';
	import type { Session } from '@supabase/supabase-js';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { installSessionResumeWarmup } from '$lib/client/sessionResumeWarmup';

	let { children, data } = $props();
	const session = $derived((data?.session ?? null) as Session | null);

	const hideAuthActions = $derived(
		['/r/', '/login', '/registro', '/reset'].some((p) =>
			$page.url.pathname.startsWith(p)
		)
	);
	const hideHeader = $derived(
		['/login', '/registro', '/reset'].some((p) => $page.url.pathname.startsWith(p))
	);

	onMount(() => installSessionResumeWarmup());
</script>

<svelte:head>
	<link rel="icon" href="/favicon.png" />
	<title>Training Track</title>
</svelte:head>

<div class="min-h-screen bg-[#0d0f14] text-slate-100">
	{#if !hideHeader}
		<header class="border-b border-slate-800 bg-[#0f111b]/90 backdrop-blur">
			<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
				<div class="flex items-center gap-3">
					<img src="/favicon.png" alt="Training Track logo" class="h-10 w-10 rounded-2xl shadow-sm shadow-emerald-900/40" />
					<div>
						<p class="text-lg font-semibold leading-tight text-slate-100">Training Track</p>
					</div>
				</div>
				{#if !hideAuthActions}
					{#if session}
						<div class="flex items-center">
							<form method="POST" action="/logout" class="inline">
								<button
									type="submit"
									class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base font-semibold text-slate-100 transition hover:bg-[#1b1f30]"
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
	{/if}
	<main class="mx-auto max-w-6xl px-2 sm:px-4 py-6 sm:py-8">{@render children()}</main>
</div>
