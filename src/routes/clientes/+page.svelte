<script lang="ts">
	import type { ClientSummary, TrainerAdminRow } from '$lib/types';
	import { goto, preloadData } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { rememberLastClientRoute } from '$lib/client/sessionResumeWarmup';

	let { data, form } = $props();
	const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';
	let clients = (data?.clients ?? []) as ClientSummary[];
	let trainerAdmin = $state((data?.trainerAdmin ?? null) as TrainerAdminRow[] | null);
	let isOwner = data?.isOwner ?? false;
	const lazyAdmin = data?.lazyAdmin === true;
	const SITE_URL = (data?.siteUrl ?? '').replace(/\/?$/, '');
	let deleteTarget = $state<ClientSummary | null>(null);
	let deleteConfirm = $state('');
	let openingId = $state<string | null>(null);
	let copiedId = $state<string | null>(null);
	let searchTerm = $state('');
	let creating = $state(false);
	let formMessage = $state<string | null>(null);
	let showOwnerPanel = $state(isOwner && !lazyAdmin);
	let loadingOwnerPanel = $state(false);
	let ownerPanelError = $state<string | null>(null);

	const copyLink = async (client: ClientSummary) => {
		const link = `${SITE_URL}/r/${client.client_code}`;
		await navigator.clipboard.writeText(link);
		copiedId = client.id;
		setTimeout(() => {
			if (copiedId === client.id) copiedId = null;
		}, 2000);
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


	const warmClientRoute = (clientId: string) => {
		void preloadData(`/clientes/${clientId}`);
	};

	const openClient = async (client: ClientSummary) => {
		openingId = client.id;
		rememberLastClientRoute(client.id);
		await goto(`/clientes/${client.id}`);
		openingId = null;
	};

	const loadTrainerAdmin = async () => {
		if (!isOwner || trainerAdmin || loadingOwnerPanel) return;

		loadingOwnerPanel = true;
		ownerPanelError = null;
		try {
			const response = await fetch('/clientes/admin-trainers');
			if (!response.ok) {
				throw new Error('No se pudo cargar el panel administrador');
			}
			const payload = (await response.json()) as { trainers?: TrainerAdminRow[] };
			trainerAdmin = payload.trainers ?? [];
		} catch (e) {
			console.error(e);
			ownerPanelError = 'No pudimos cargar el panel administrador. Intentá de nuevo.';
		} finally {
			loadingOwnerPanel = false;
		}
	};

	const toggleOwnerPanel = async () => {
		showOwnerPanel = !showOwnerPanel;
		if (showOwnerPanel && lazyAdmin) {
			await loadTrainerAdmin();
		}
	};

	const normalizeText = (value: string | undefined | null) =>
		(value ?? '')
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase();

	const filteredClients = () => {
		const term = normalizeText(searchTerm).trim();
		if (!term) return clients;
		return clients.filter((client) => normalizeText(client.name).includes(term));
	};
</script>

<section class="flex flex-col gap-8 text-slate-100">
	<div class="flex flex-wrap items-center justify-between gap-4 mb-2">
		<div>
			<h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">
				<span class="bg-gradient-to-r from-emerald-200 via-slate-100 to-slate-50 bg-clip-text text-transparent">
					Gestioná rutinas, links y actividad.
				</span>
			</h1>
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

	<div class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-[#0f111b] px-4 py-3 shadow-md shadow-black/30">
		<form
			class="flex w-full flex-col gap-3 sm:flex-row sm:items-center"
			on:submit|preventDefault={() => (searchTerm = searchTerm.trim())}
		>
			<label class="w-full text-base text-slate-200">
				<span class="sr-only">Buscar alumno</span>
				<input
					class="w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
					type="text"
					placeholder="Buscar alumno"
					bind:value={searchTerm}
				/>
			</label>
			<button
				type="submit"
				class="rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-500"
			>
				Buscar
			</button>
		</form>
	</div>

	{#if isOwner}
		<section class="rounded-xl border border-emerald-900/40 bg-[#0f111b] p-6 shadow-lg shadow-black/30 text-slate-100 space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="text-sm uppercase tracking-wider text-emerald-400">Panel de administrador</p>
					<h3 class="text-xl font-bold text-slate-50">Gestión de entrenadores</h3>
				</div>
				<button
					type="button"
					class="rounded-lg border border-emerald-700/60 bg-emerald-700/20 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-700/30"
					on:click={toggleOwnerPanel}
					aria-expanded={showOwnerPanel}
					aria-controls="owner-admin-content"
				>
					{showOwnerPanel ? 'Ocultar panel' : 'Abrir panel'}
				</button>
			</div>
			{#if showOwnerPanel}
				<div id="owner-admin-content" class="space-y-4">
					{#if loadingOwnerPanel}
						<p class="text-sm text-slate-300">Cargando panel administrador...</p>
					{:else if ownerPanelError}
						<div class="flex flex-wrap items-center gap-3">
							<p class="text-sm text-red-200">{ownerPanelError}</p>
							<button
								type="button"
								class="rounded-lg border border-red-600 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/40"
								on:click={loadTrainerAdmin}
							>
								Reintentar
							</button>
						</div>
					{:else}
						<form method="post" action="?/addTrainer" class="flex flex-wrap items-center gap-3">
							<input
								name="email"
								type="email"
								placeholder="email@entrenador.com"
								class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-base text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
								required
							/>
							<button
								type="submit"
								class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
							>
								Habilitar entrenador
							</button>
						</form>

						<div class="overflow-x-auto">
							<table class="min-w-full text-left text-sm text-slate-200">
								<thead class="border-b border-slate-800 text-slate-400">
									<tr>
										<th class="px-3 py-2">Email</th>
										<th class="px-3 py-2">Estado</th>
										<th class="px-3 py-2">Acceso</th>
										<th class="px-3 py-2 text-right">Acciones</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-800">
									{#if trainerAdmin && trainerAdmin.length > 0}
										{#each trainerAdmin as trainer}
											{#if trainer.email?.toLowerCase() !== OWNER_EMAIL}
												<tr>
													<td class="px-3 py-2">{trainer.email}</td>
													<td class="px-3 py-2">
														<span
															class={`rounded-full px-2.5 py-1 text-xs font-semibold ${
																trainer.status === 'active'
																	? 'bg-emerald-900/50 text-emerald-300 border border-emerald-600/40'
																	: 'bg-slate-800 text-slate-300 border border-slate-700'
															}`}
														>
															{trainer.status ?? 'sin sesión'}
														</span>
													</td>
													<td class="px-3 py-2">
														<span
															class={`rounded-full px-2.5 py-1 text-xs font-semibold ${
																trainer.active
																	? 'bg-emerald-900/50 text-emerald-300 border border-emerald-600/40'
																	: 'bg-red-900/40 text-red-200 border border-red-700/50'
															}`}
														>
															{trainer.active ? 'Habilitado' : 'Deshabilitado'}
														</span>
													</td>
													<td class="px-3 py-2">
														<div class="flex justify-end gap-2">
															<form method="post" action="?/toggleTrainer">
																<input type="hidden" name="email" value={trainer.email} />
																<input type="hidden" name="next_active" value={!trainer.active} />
																<button
																	class={`rounded-lg px-3 py-2 text-xs font-semibold ${
																		trainer.active
																			? 'border border-red-600 text-red-200 hover:bg-red-900/50'
																			: 'border border-emerald-600 text-emerald-200 hover:bg-emerald-900/40'
																	}`}
																	type="submit"
																>
																	{trainer.active ? 'Deshabilitar' : 'Habilitar'}
																</button>
															</form>
															<form method="post" action="?/forceSignOut">
																<input type="hidden" name="email" value={trainer.email} />
																<button
																	type="submit"
																	class="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-[#151827]"
																>
																	Cerrar sesiones
																</button>
															</form>
														</div>
													</td>
												</tr>
											{/if}
										{/each}
									{:else}
										<tr>
											<td colspan="4" class="px-3 py-3 text-slate-400">
												No hay entrenadores registrados.
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-3">
			{#if clients.length === 0}
				<div class="rounded-xl border border-dashed border-slate-700 bg-[#0f111b] p-7 text-base text-slate-300">
					Aún no tenés alumnos. Creá uno y compartí el link público.
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					{#each filteredClients() as client (client.id)}
						<article class="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#0f111b] p-5 shadow-lg shadow-black/30">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<p class="text-lg font-semibold text-slate-50 truncate" title={client.name}>{client.name}</p>
									<p class="text-sm text-slate-400 truncate">{client.objective ?? 'Sin objetivo'}</p>
								</div>
								<span
									class={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
										client.status === 'active'
											? 'bg-emerald-900/50 text-emerald-300 border border-emerald-600/50'
											: 'bg-slate-800 text-slate-400 border border-slate-700'
									}`}
								>
									{client.status === 'active' ? 'Activo' : 'Inactivo'}
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
										class={`open-btn relative w-full overflow-hidden rounded-xl border border-emerald-700/50 bg-[#111827] px-3.5 py-3 text-base font-semibold text-white shadow-sm transition hover:border-emerald-500 hover:bg-[#0f1625] disabled:cursor-wait ${
											openingId === client.id ? 'loading' : ''
										}`}
										on:pointerenter={() => warmClientRoute(client.id)}
										on:focus={() => warmClientRoute(client.id)}
										on:pointerdown={() => warmClientRoute(client.id)}
										on:click={() => openClient(client)}
										disabled={openingId === client.id}
										aria-busy={openingId === client.id}
									>
									<span class="btn-label">
										{openingId === client.id ? 'Abriendo rutina...' : 'Abrir rutina del alumno'}
									</span>
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
										Eliminar alumno
									</button>
									<button
										class="rounded-xl border border-slate-700 px-3.5 py-3 text-sm font-medium text-slate-100 hover:bg-[#151827]"
										on:click={() => copyLink(client)}
										type="button"
									>
										{copiedId === client.id ? '✓ Copiado' : 'Copiar link público'}
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
			class="space-y-5 rounded-xl border border-slate-800 bg-[#0f111b] p-7 shadow-lg shadow-black/30"
			use:enhance={() => {
				creating = true;
				formMessage = null;
				return async ({ result, update }) => {
					creating = false;
					if (result.type === 'failure' && result.data?.message) {
						formMessage = result.data.message as string;
					} else if (result.type === 'redirect') {
						formMessage = null;
					}
					await update({ reset: result.type === 'redirect' });
				};
			}}
		>
			<div class="space-y-2">
				<h2 class="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-50">
					Crear alumno
				</h2>
			</div>

			<label class="block text-base font-medium text-slate-200">
				Nombre
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					name="name"
					placeholder="Ej: Ana Pérez"
					required
					disabled={creating}
				/>
			</label>

			<label class="block text-base font-medium text-slate-200">
				Objetivo (opcional)
				<input
					class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
					name="objective"
					placeholder="Hipertrofia, fuerza, recomposición..."
					disabled={creating}
				/>
			</label>

			<button
				type="submit"
				class="relative w-full overflow-hidden rounded-xl bg-emerald-600 px-5 py-3 text-lg text-white transition hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
				disabled={creating}
			>
				<span class="absolute inset-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 opacity-0 animate-pulse blur-sm"></span>
				<span class="relative">{creating ? 'Creando...' : 'Crear y generar link'}</span>
			</button>
			<p class="text-sm text-slate-400">
				Al hacer click crearás un alumno y un link para que pueda acceder a su rutina.
			</p>

			{#if formMessage}
				<p class="flex items-center gap-2 rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">
					<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
					</svg>
					{formMessage}
				</p>
			{/if}
		</form>
	</section>

	{#if deleteTarget}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-2">
					<h2 class="text-xl font-semibold text-red-200">Eliminar alumno</h2>
					<p class="text-sm text-slate-300">
						Para eliminar al alumno <span class="font-semibold">{deleteTarget.name}</span> definitivamente, escribí la palabra
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

<style>
	.open-btn.loading::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, #10b981 0%, #34d399 100%);
		transform-origin: left;
		animation: fillbtn 2s ease-in-out infinite;
		opacity: 0.9;
	}
	.open-btn .btn-label {
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
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
