<script lang="ts">
	import { env } from '$env/dynamic/public';
	import type { ClientSummary } from '$lib/types';
	import { goto } from '$app/navigation';

	let { data, form } = $props();
	let clients = (data?.clients ?? []) as ClientSummary[];
	const SITE_URL = (data?.siteUrl ?? 'https://training-track.vercel.app').replace(/\/?$/, '');
	let deleteTarget = $state<ClientSummary | null>(null);
	let deleteConfirm = $state('');

	const copyLink = async (client: ClientSummary) => {
		const link = `${SITE_URL}/r/${client.client_code}`;
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
			<p class="text-2xl font-extrabold tracking-wide text-emerald-80">
				EN ESTE PANEL VERAS A TUS CLIENTES
			</p>
		</div>
		<form method="POST" action="/logout">
			<button
				type="submit"
				class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2.5 text-base text-slate-100 hover:bg-[#1b1f30]"
			>
				Cerrar sesión
			</button>
		</form>
	</div>

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-3">
			{#if clients.length === 0}
				<div class="rounded-xl border border-dashed border-slate-700 bg-[#0f111b] p-7 text-base text-slate-300">
					Aún no tenés clientes. Creá uno y compartí el link público.
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					{#each clients as client}
						<article class="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#0f111b] p-5 shadow-lg shadow-black/30">
							<div class="flex items-start justify-between gap-2">
								<div>
									<p class="text-lg font-semibold text-slate-50">{client.name}</p>
									<p class="text-sm text-slate-400">{client.objective ?? 'Sin objetivo'}</p>
								</div>
								<span
									class={`rounded-full px-3 py-1 text-sm font-semibold ${
										client.status === 'active'
											? 'bg-emerald-900/50 text-emerald-300 border border-emerald-600/50'
											: 'bg-slate-800 text-slate-400 border border-slate-700'
									}`}
								>
									{client.status === 'active' ? 'Activo' : 'Archivado'}
								</span>
							</div>
							<div class="text-base text-slate-300 mb-3">
								<p>
									Última actividad:
									<span class={`font-semibold ${activityColor(client.days_since_activity)}`}>
										{activityLabel(client.days_since_activity)}
									</span>
								</p>
							</div>
							<div class="mt-auto space-y-4">
								<button
									class="w-full rounded-xl bg-emerald-600 px-3.5 py-3 text-base font-semibold text-white hover:bg-emerald-500 shadow-sm"
									on:click={() => goto(`/clientes/${client.id}`)}
								>
									Abrir rutina del cliente
								</button>
								<div class="grid grid-cols-2 gap-4">
									<button
										class="rounded-xl border border-red-600 bg-red-900/40 px-3.5 py-3 text-sm font-medium text-red-100 hover:bg-red-900/60"
										type="button"
										on:click={() => {
											deleteTarget = client;
											deleteConfirm = '';
										}}
									>
										Eliminar cliente
									</button>
									<button
										class="rounded-xl border border-slate-700 px-3.5 py-3 text-sm font-medium text-slate-100 hover:bg-[#151827]"
										on:click={() => copyLink(client)}
										type="button"
									>
										Copiar link público
									</button>
								</div>
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
			class="space-y-5 rounded-xl border border-slate-800 bg-[#0f111b] p-7 shadow-lg shadow-black/30"
		>
			<div class="space-y-2">
				<h2 class="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-50">
					Crear cliente
				</h2>
			</div>

			<label class="block text-base font-medium text-slate-200">
				Nombre
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					name="name"
					placeholder="Ej: Ana Pérez"
					required
				/>
			</label>

			<label class="block text-base font-medium text-slate-200">
				Objetivo (opcional)
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					name="objective"
					placeholder="Hipertrofia, fuerza, recomposición..."
				/>
			</label>

			<button
				type="submit"
				class="relative w-full overflow-hidden rounded-xl bg-emerald-600 px-5 py-3 text-lg text-white transition hover:bg-emerald-500"
			>
				<span class="absolute inset-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 opacity-0 animate-pulse blur-sm"></span>
				<span class="relative">Crear y generar link</span>
			</button>
			<p class="text-sm text-slate-400">
				Al hacer click crearás un cliente y un link para que él pueda acceder a su rutina.
			</p>

			{#if form?.message}
				<p class="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">
					{form.message}
				</p>
			{/if}
		</form>
	</section>

	{#if deleteTarget}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-2">
					<h2 class="text-xl font-semibold text-red-200">Eliminar cliente</h2>
					<p class="text-sm text-slate-300">
						Para eliminar al cliente <span class="font-semibold">{deleteTarget.name}</span> definitivamente, escribí la palabra
						<span class="font-semibold text-red-300">eliminar</span>.
					</p>
				</div>
				<form method="post" action="?/delete" class="mt-4 space-y-3">
					<input type="hidden" name="client_id" value={deleteTarget.id} />
					<label class="block text-sm font-medium text-slate-200">
						Confirmación
						<input
							class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-base text-slate-100 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
							placeholder="eliminar"
							bind:value={deleteConfirm}
							name="confirm_text"
						/>
					</label>
					<div class="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
							on:click={() => {
								deleteTarget = null;
								deleteConfirm = '';
							}}
						>
							Cancelar
						</button>
						<button
							type="submit"
							class="rounded-lg bg-red-600 px-4 py-2 text-white transition hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
							disabled={deleteConfirm.trim().toLowerCase() !== 'eliminar'}
						>
							Eliminar definitivamente
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</section>
