<script lang="ts">
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import type { ClientSummary } from '$lib/types';
	import { goto } from '$app/navigation';

	let { data, form } = $props();
	let clients = (data?.clients ?? []) as ClientSummary[];

	const copyLink = async (client: ClientSummary) => {
		const link = `${PUBLIC_SITE_URL.replace(/\/?$/, '')}/r/${client.client_code}`;
		await navigator.clipboard.writeText(link);
		alert('Link copiado');
	};

	const humanDate = (iso?: string | null) => {
		if (!iso) return 'Sin registros';
		const date = new Date(iso);
		return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
	};

	const handleCreated = () => {
		if (form?.message) {
			alert(form.message as string);
		}
	};
</script>

<section class="flex flex-col gap-8">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<p class="text-sm font-semibold uppercase tracking-wide text-slate-500">Clientes</p>
			<h1 class="text-2xl font-semibold text-slate-900">Panel del entrenador</h1>
		</div>
		<button
			on:click={() => goto('/login')}
			class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
		>
			Obtener nuevo magic link
		</button>
	</div>

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-3">
			{#if clients.length === 0}
				<div class="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
					Aún no tenés clientes. Creá uno y compartí el link público.
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					{#each clients as client}
						<article class="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
							<div class="flex items-start justify-between gap-2">
								<div>
									<p class="text-base font-semibold text-slate-900">{client.name}</p>
									<p class="text-xs text-slate-500">{client.objective ?? 'Sin objetivo'}</p>
								</div>
								<span
									class={`rounded-full px-2 py-1 text-xs font-semibold ${
										client.status === 'active'
											? 'bg-emerald-50 text-emerald-700'
											: 'bg-slate-100 text-slate-500'
									}`}
								>
									{client.status === 'active' ? 'Activo' : 'Archivado'}
								</span>
							</div>
							<div class="text-sm text-slate-600">
								<p>
									Último día completado:
									<span class="font-medium">
										{client.last_day_completed ?? '—'}
									</span>
								</p>
								<p>Actualización: {humanDate(client.last_completed_at)}</p>
							</div>
							<div class="mt-auto flex flex-wrap gap-2">
								<button
									class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
									on:click={() => goto(`/clientes/${client.id}`)}
								>
									Abrir detalle
								</button>
								<button
									class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
									on:click={() => copyLink(client)}
									type="button"
								>
									Copiar link público
								</button>
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</div>

		<form
			method="post"
			action="?/create"
			on:submit={handleCreated}
			class="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
		>
			<div class="space-y-2">
				<p class="text-sm font-semibold uppercase tracking-wide text-slate-500">Nuevo cliente</p>
				<h2 class="text-xl font-semibold text-slate-900">Crear cliente</h2>
				<p class="text-sm text-slate-600">Genera el link y la rutina inicial vacía.</p>
			</div>

			<label class="block text-sm font-medium text-slate-700">
				Nombre
				<input
					class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
					name="name"
					placeholder="Ej: Ana Pérez"
					required
				/>
			</label>

			<label class="block text-sm font-medium text-slate-700">
				Objetivo (opcional)
				<input
					class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
					name="objective"
					placeholder="Hipertrofia, fuerza, recomposición..."
				/>
			</label>

			<button
				type="submit"
				class="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-500"
			>
				Crear y generar link
			</button>

			{#if form?.message}
				<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
					{form.message}
				</p>
			{/if}
		</form>
	</section>
</section>
