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

	const activityLabel = (days?: number | null) => {
		if (days == null) return 'Sin actividad registrada';
		if (days === 0) return 'Hoy';
		if (days === 1) return 'Hace 1 día';
		return `Hace ${days} días`;
	};

	const activityColor = (days?: number | null) => {
		if (days == null) return 'text-slate-500';
		if (days < 3) return 'text-emerald-600';
		if (days <= 7) return 'text-amber-600';
		return 'text-red-600';
	};

	const handleCreated = () => {
		if (form?.message) {
			alert(form.message as string);
		}
	};
</script>

<section class="flex flex-col gap-8 text-slate-100">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Clientes</p>
			<h1 class="text-2xl font-semibold text-slate-50">Panel del entrenador</h1>
		</div>
		<button
			on:click={() => goto('/login')}
			class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm text-slate-100 hover:bg-[#1b1f30]"
		>
			Obtener nuevo magic link
		</button>
	</div>

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-3">
			{#if clients.length === 0}
				<div class="rounded-xl border border-dashed border-slate-700 bg-[#0f111b] p-6 text-sm text-slate-300">
					Aún no tenés clientes. Creá uno y compartí el link público.
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					{#each clients as client}
						<article class="flex flex-col gap-2 rounded-xl border border-slate-800 bg-[#0f111b] p-4 shadow-lg shadow-black/30">
							<div class="flex items-start justify-between gap-2">
								<div>
									<p class="text-base font-semibold text-slate-50">{client.name}</p>
									<p class="text-xs text-slate-400">{client.objective ?? 'Sin objetivo'}</p>
								</div>
								<span
									class={`rounded-full px-2 py-1 text-xs font-semibold ${
										client.status === 'active'
											? 'bg-emerald-900/50 text-emerald-300 border border-emerald-600/50'
											: 'bg-slate-800 text-slate-400 border border-slate-700'
									}`}
								>
									{client.status === 'active' ? 'Activo' : 'Archivado'}
								</span>
							</div>
							<div class="text-sm text-slate-300">
								<p>
									Semana actual:
									<span class="font-medium">
										{client.week_started ? 'Iniciada' : 'No iniciada'}
									</span>
								</p>
								<p>
									Última actividad:
									<span class={`font-semibold ${activityColor(client.days_since_activity)}`}>
										{activityLabel(client.days_since_activity)}
									</span>
								</p>
								<p class="text-xs text-slate-500">
									Último día completado: {client.last_day_completed ?? '—'} · {humanDate(client.last_completed_at)}
								</p>
							</div>
							<div class="mt-auto flex flex-wrap gap-2">
								<button
									class="rounded-lg bg-[#1c2338] px-3 py-2 text-sm font-medium text-slate-100 hover:bg-[#222b43]"
									on:click={() => goto(`/clientes/${client.id}`)}
								>
									Abrir detalle
								</button>
								<button
									class="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-[#151827]"
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
			class="space-y-4 rounded-xl border border-slate-800 bg-[#0f111b] p-6 shadow-lg shadow-black/30"
		>
			<div class="space-y-2">
				<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Nuevo cliente</p>
				<h2 class="text-xl font-semibold text-slate-50">Crear cliente</h2>
				<p class="text-sm text-slate-400">Genera el link y la rutina inicial vacía.</p>
			</div>

			<label class="block text-sm font-medium text-slate-200">
				Nombre
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					name="name"
					placeholder="Ej: Ana Pérez"
					required
				/>
			</label>

			<label class="block text-sm font-medium text-slate-200">
				Objetivo (opcional)
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
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
				<p class="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">
					{form.message}
				</p>
			{/if}
		</form>
	</section>
</section>
