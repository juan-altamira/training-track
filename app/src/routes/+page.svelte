<section class="grid gap-8 md:grid-cols-[2fr,1.2fr] items-center">
	<div class="space-y-6">
		<p class="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
			MVP listo para entrenadores y clientes
		</p>
		<h1 class="text-3xl font-semibold leading-tight md:text-4xl">
			Rutinas rápidas, sin contraseñas y listas para compartir
		</h1>
		<p class="text-lg text-slate-600">
			Panel para entrenadores, link único para cada cliente y progreso sincronizado con Supabase.
			Desplegable en Vercel con RLS activo.
		</p>
		<div class="flex flex-wrap gap-3">
			<a
				href="/login"
				class="rounded-lg bg-slate-900 px-4 py-2.5 text-white shadow-sm transition hover:bg-slate-800"
				>Entrar como entrenador</a
			>
			<a
				href="/r/demo-code"
				class="rounded-lg border border-slate-200 px-4 py-2.5 text-slate-800 transition hover:bg-slate-100"
				>Ver vista de cliente</a
			>
		</div>
		<div class="grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-2">
			<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
				<p class="font-semibold">Entrenador</p>
				<p>Gestioná clientes, editá rutina por día y obtené el link único.</p>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
				<p class="font-semibold">Cliente</p>
				<p>Accede sin login, marca series y días completados desde su link.</p>
			</div>
		</div>
	</div>
	<div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/70">
		<div class="flex items-center justify-between">
			<p class="text-sm font-semibold text-slate-600">Checklist MVP</p>
			<span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
				>Supabase + SvelteKit</span
			>
		</div>
		<ul class="mt-4 space-y-3 text-sm text-slate-700">
			<li class="flex items-start gap-2">
				<span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
				RLS por entrenador y service role para la vista pública de cliente.
			</li>
			<li class="flex items-start gap-2">
				<span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
				Magic link sin password para entrenadores.
			</li>
			<li class="flex items-start gap-2">
				<span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
				Edición rápida de rutina por día y reseteo automático de progreso.
			</li>
			<li class="flex items-start gap-2">
				<span class="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
				Link público `/r/[clientCode]` con mensaje de acceso desactivado.
			</li>
		</ul>
	</div>
</section>
