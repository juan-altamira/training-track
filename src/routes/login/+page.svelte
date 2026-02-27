<script lang="ts">
import { goto, invalidateAll } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';

let authMode = $state<'login' | 'register'>('login');
let email = $state('');
let password = $state('');
let confirmPassword = $state('');
let message = $state('');
let error = $state('');
let loading = $state(false);
let showPassword = $state(false);

const setMode = (nextMode: 'login' | 'register') => {
	authMode = nextMode;
	error = '';
	message = '';
};

const togglePasswordVisibility = () => {
	showPassword = !showPassword;
};

const resolveAccessError = (reason: string | undefined) => {
	if (reason === 'expired') {
		return 'Acceso inhabilitado por suscripción vencida. Contactar al administrador para renovar la cuenta.';
	}
	if (reason === 'manual_disabled') {
		return 'Acceso inhabilitado por el administrador. Pedile al owner que vuelva a habilitar tu cuenta.';
	}
	if (reason === 'not_found') {
		return 'Cuenta sin perfil interno todavía. Reintentá en unos segundos o pedí al owner que habilite tu email en el panel.';
	}
	return 'Acceso inhabilitado. Contactar al administrador para habilitar la cuenta.';
};

const navigateToClients = async () => {
	await invalidateAll();
	if (typeof window !== 'undefined') {
		window.location.assign('/clientes');
		return;
	}
	await goto('/clientes', { invalidateAll: true });
};

const login = async () => {
	loading = true;
	error = '';
	message = '';
	const emailLower = email.trim().toLowerCase();
	const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
		email: emailLower,
		password: password
	});
	if (signInError) {
		error = 'No pudimos iniciar sesión. Revisá email y contraseña.';
		console.error(signInError);
		loading = false;
		return;
	}

	try {
		const accessResponse = await fetch('/api/auth/trainer-access');
		if (!accessResponse.ok) {
			const payload = (await accessResponse.json().catch(() => ({}))) as {
				reason?: string;
			};
			error = resolveAccessError(payload.reason);
			await supabaseClient.auth.signOut();
			loading = false;
			return;
		}
	} catch (accessError) {
		console.error('trainer access verification failed', accessError);
		error = 'No pudimos validar el estado de tu cuenta. Intentá de nuevo.';
		await supabaseClient.auth.signOut();
		loading = false;
		return;
	}

	await navigateToClients();
	loading = false;
};

const register = async () => {
	loading = true;
	error = '';
	message = '';
	
	if (email.trim().length > 100) {
		error = 'El email es demasiado largo (máximo 100 caracteres).';
		loading = false;
		return;
	}
	
	if (password !== confirmPassword) {
		error = 'Las contraseñas no coinciden.';
		loading = false;
		return;
	}
	
	if (password.length < 6) {
		error = 'La contraseña debe tener al menos 6 caracteres.';
		loading = false;
		return;
	}
	
	if (password.length > 72) {
		error = 'La contraseña es demasiado larga (máximo 72 caracteres).';
		loading = false;
		return;
	}
	
	const { data, error: signUpError } = await supabaseClient.auth.signUp({
		email: email.trim(),
		password
	});
	
	if (signUpError) {
		// Detectar si el email ya está registrado
		if (signUpError.message?.toLowerCase().includes('already registered') || 
		    signUpError.message?.toLowerCase().includes('already exists') ||
		    signUpError.status === 422) {
			error = 'Este email ya está registrado. Probá iniciar sesión o recuperar tu contraseña.';
		} else {
			error = 'No pudimos crear la cuenta. Revisá los datos e intentá de nuevo.';
		}
		console.error(signUpError);
		loading = false;
		return;
	}

	// Si devuelve sesión, ya estamos logueados; si no, intentamos login manual
	if (!data.session) {
		const { error: loginError } = await supabaseClient.auth.signInWithPassword({
			email: email.trim(),
			password
		});
		if (loginError) {
			error = 'Cuenta creada, pero no pudimos iniciar sesión automáticamente. Probá iniciar sesión.';
			console.error(loginError);
			loading = false;
			return;
		}
	}

	await navigateToClients();
	loading = false;
};

	const handleSubmit = () => {
	if (authMode === 'login') {
		login();
	} else {
		register();
	}
};
</script>

<section class="min-h-screen flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0f111b] p-8 shadow-lg shadow-black/30">
		<div class="mb-6 text-center space-y-2">
			<h1 class="text-3xl font-extrabold tracking-tight">
				<span class="bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-100 bg-clip-text text-transparent">
					{authMode === 'login' ? 'Ingreso de entrenadores' : 'Crear cuenta'}
				</span>
			</h1>
		</div>

		<div class="mb-6 flex items-center justify-center">
			<div class="flex rounded-full border border-slate-700 bg-[#151827] p-1 text-sm font-medium">
				<button
					type="button"
					class={`rounded-full px-5 py-2 transition ${authMode === 'login' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
					onclick={() => setMode('login')}
				>
					Ingresar
				</button>
				<button
					type="button"
					class={`rounded-full px-5 py-2 transition ${authMode === 'register' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
					onclick={() => setMode('register')}
				>
					Crear cuenta
				</button>
			</div>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
			<label class="block text-base font-medium text-slate-200">
				Email
				<input
					type="email"
					class="mt-2 w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-lg text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-slate-500"
					placeholder="entrenador@tu-mail.com"
					required
					bind:value={email}
					autocomplete="email"
				/>
			</label>

			<label class="block text-base font-medium text-slate-200">
				Contraseña
				<div class="relative mt-2">
					<input
						type={showPassword ? 'text' : 'password'}
						class="w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 pr-16 text-lg text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-slate-500"
						placeholder={authMode === 'register' ? 'Creá una contraseña segura' : '••••••••'}
						required
						bind:value={password}
						autocomplete={authMode === 'register' ? 'new-password' : 'current-password'}
					/>
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:text-slate-200 hover:bg-slate-700/50"
						onclick={togglePasswordVisibility}
					>
						{showPassword ? 'Ocultar' : 'Ver'}
					</button>
				</div>
			</label>

			{#if authMode === 'register'}
				<label class="block text-base font-medium text-slate-200">
					Confirmar contraseña
					<input
						type={showPassword ? 'text' : 'password'}
						class="mt-2 w-full rounded-xl border border-slate-700 bg-[#151827] px-4 py-3 text-lg text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-slate-500"
						placeholder="Repetí tu contraseña"
						required
						bind:value={confirmPassword}
						autocomplete="new-password"
					/>
				</label>
			{/if}

			{#if error}
				<p class="flex items-center gap-2 rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-200 border border-red-700/50">
					<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
					</svg>
					{error}
				</p>
			{/if}

			{#if message}
				<p class="flex items-center gap-2 rounded-lg bg-emerald-900/40 px-4 py-3 text-sm text-emerald-200 border border-emerald-700/50">
					<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
						<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
					</svg>
					{message}
				</p>
			{/if}

			<button
				type="submit"
				disabled={loading || !email || !password || (authMode === 'register' && !confirmPassword)}
				class="mt-2 w-full rounded-xl bg-emerald-600 px-4 py-3 text-lg font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if loading}
					{authMode === 'register' ? 'Creando cuenta...' : 'Ingresando...'}
				{:else}
					{authMode === 'register' ? 'Crear cuenta' : 'Ingresar'}
				{/if}
			</button>

			{#if authMode === 'login'}
				<p class="text-center text-sm text-slate-400">
					<a href="/reset" class="text-emerald-300 hover:underline font-semibold">¿Olvidaste tu contraseña?</a>
				</p>
			{:else}
				<p class="text-center text-sm text-slate-400">
					<button type="button" class="text-emerald-300 hover:underline font-semibold" onclick={() => setMode('login')}>
						¿Ya tenés cuenta? Ingresá
					</button>
				</p>
			{/if}
		</form>
	</div>
</section>
