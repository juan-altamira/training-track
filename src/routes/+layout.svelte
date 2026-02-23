<script lang="ts">
	import '../app.postcss';
	import type { Session } from '@supabase/supabase-js';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { installSessionResumeWarmup } from '$lib/client/sessionResumeWarmup';

	let { children, data } = $props();
	const session = $derived((data?.session ?? null) as Session | null);
	let navigatingBackToPanel = $state(false);
	let showLogoutConfirm = $state(false);
	let logoutFormEl = $state<HTMLFormElement | null>(null);

	const hideAuthActions = $derived(
		['/r/', '/login', '/registro', '/reset'].some((p) =>
			$page.url.pathname.startsWith(p)
		)
	);
	const isClientDetailView = $derived(/^\/clientes\/[^/]+\/?$/.test($page.url.pathname));
	const hideHeader = $derived(
		['/login', '/registro', '/reset'].some((p) => $page.url.pathname.startsWith(p))
	);
	const clientDetailName = $derived.by(() => {
		const pageData = ($page.data ?? {}) as Record<string, unknown>;
		const client = (pageData.client ?? null) as { name?: unknown } | null;
		return typeof client?.name === 'string' ? client.name : '';
	});

	$effect(() => {
		if (!isClientDetailView) {
			navigatingBackToPanel = false;
		}
	});

	onMount(() => installSessionResumeWarmup());

	const openLogoutConfirm = () => {
		showLogoutConfirm = true;
	};

	const confirmLogout = () => {
		showLogoutConfirm = false;
		logoutFormEl?.requestSubmit();
	};
</script>

<svelte:head>
	<link rel="icon" href="/favicon.png" />
	<title>Training Track</title>
</svelte:head>

	<div class="min-h-screen bg-[#0d0f14] text-slate-100">
		{#if !hideHeader}
			<header class="sticky top-0 z-40 border-b border-slate-800 bg-[#0f111b]/90 backdrop-blur">
				{#if isClientDetailView}
						<div class="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
							<a
								href="/clientes"
								class={`back-to-panel inline-flex w-[12rem] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-base font-semibold text-slate-100 transition hover:bg-[#1b1f30] ${
									navigatingBackToPanel ? 'loading pointer-events-none' : ''
								}`}
							aria-busy={navigatingBackToPanel}
							onclick={() => {
								navigatingBackToPanel = true;
							}}
						>
							<span class="btn-label flex items-center gap-2">
								<span aria-hidden="true">↩︎</span>
								<span>{navigatingBackToPanel ? 'Volviendo al panel...' : 'Volver al panel'}</span>
							</span>
						</a>
						<div class="min-w-0 px-2">
							{#if clientDetailName}
								<p class="hidden truncate text-center text-3xl font-extrabold tracking-wide text-slate-50 md:block">
									{clientDetailName}
								</p>
							{/if}
						</div>
							<div class="justify-self-end">
								{#if !hideAuthActions}
									{#if session}
										<form method="POST" action="/logout" class="inline" bind:this={logoutFormEl}>
											<button
												type="button"
												class="inline-flex w-[12rem] items-center justify-center whitespace-nowrap rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-base font-semibold text-slate-100 transition hover:bg-[#1b1f30]"
												onclick={openLogoutConfirm}
											>
												Cerrar sesión
											</button>
									</form>
								{:else}
									<a
										class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-1.5 text-sm text-slate-100 transition hover:bg-[#1b1f30]"
										href="/login"
									>
										Entrar
									</a>
								{/if}
							{/if}
						</div>
					</div>
				{:else}
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
										<form method="POST" action="/logout" class="inline" bind:this={logoutFormEl}>
											<button
												type="button"
												class="rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-base font-semibold text-slate-100 transition hover:bg-[#1b1f30]"
												onclick={openLogoutConfirm}
											>
												Cerrar sesión
											</button>
									</form>
								</div>
							{:else}
								<a
									class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-1.5 text-sm text-slate-100 transition hover:bg-[#1b1f30]"
									href="/login"
								>
									Entrar
								</a>
							{/if}
						{/if}
					</div>
				{/if}
			</header>
		{/if}
		<main class="mx-auto max-w-6xl px-2 sm:px-4 py-6 sm:py-8">{@render children()}</main>

		{#if showLogoutConfirm}
			<div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
				<div class="w-full max-w-md rounded-2xl border border-slate-700/80 bg-[#101624] p-6 shadow-2xl shadow-black/60">
					<div class="mb-5 flex items-start gap-3">
						<div class="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full border border-amber-500/40 bg-amber-900/30 text-amber-200">
							!
						</div>
						<div>
							<h2 id="logout-confirm-title" class="text-xl font-semibold text-slate-100">Confirmar cierre de sesión</h2>
							<p class="mt-2 text-sm text-slate-300">
								Vas a cerrar tu sesión actual. ¿Querés continuar?
							</p>
						</div>
					</div>
					<div class="flex items-center justify-end gap-3">
						<button
							type="button"
							class="rounded-xl border border-slate-600 bg-[#161d2d] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-[#20283b]"
							onclick={() => (showLogoutConfirm = false)}
						>
							Cancelar
						</button>
						<button
							type="button"
							class="rounded-xl border border-red-600/70 bg-gradient-to-r from-red-800 to-rose-700 px-4 py-2.5 text-sm font-semibold text-red-50 shadow-lg shadow-red-900/30 transition hover:-translate-y-0.5 hover:shadow-red-900/50 hover:brightness-110"
							onclick={confirmLogout}
						>
							Sí, cerrar sesión
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>

<style>
	.back-to-panel {
		position: relative;
		overflow: hidden;
	}
	.back-to-panel.loading::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, #10b981 0%, #34d399 100%);
		transform-origin: left;
		animation: fillbtn 2s ease-in-out infinite;
		opacity: 0.9;
	}
	.back-to-panel .btn-label {
		position: relative;
		z-index: 1;
	}
	@keyframes fillbtn {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}
</style>
