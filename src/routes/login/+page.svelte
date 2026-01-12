<script lang="ts">
import { goto } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';

let mode = $state<'login' | 'register'>('login');
let email = $state('');
let password = $state('');
let confirmPassword = $state('');
let message = $state('');
let error = $state('');
let loading = $state(false);
let showPassword = $state(false);
const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';

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
	
	// Chequeo rápido de habilitación: owner siempre habilitado, resto depende de trainer_access
	if (emailLower !== OWNER_EMAIL) {
		const { data: accessRow } = await supabaseClient
			.from('trainer_access')
			.select('active')
			.eq('email', emailLower)
			.maybeSingle();

		if (!accessRow?.active) {
			error = 'Acceso inhabilitado por falta de pago. Contactar al administrador para habilitar la cuenta.';
			await supabaseClient.auth.signOut();
			loading = false;
			return;
		}
	}

	await goto('/clientes');
	loading = false;
};

const register = async () => {
	loading = true;
	error = '';
	message = '';
	
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

	await goto('/clientes');
	loading = false;
};

const handleSubmit = () => {
	if (mode === 'login') {
		login();
	} else {
		register();
	}
};
</script>

<div class="min-h-screen bg-gradient-to-br from-[#0b1626] via-[#0f1f36] to-[#0a1222] flex items-center justify-center px-4 py-10">
	<div class="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur dark:border-[#1f3554] dark:bg-[#0f1f36]/90">
		<div class="mb-8 text-center space-y-2">
			<h1 class="text-3xl font-semibold text-white">Acceso a la App</h1>
		</div>

		<div class="mb-6 flex items-center justify-center">
			<div class="flex rounded-full border border-white/10 bg-white/10 p-1 text-xs font-semibold text-white/70">
				<button
					type="button"
					class={`rounded-full px-4 py-2 transition ${mode === 'login' ? 'bg-[#7c3aed] text-white shadow-sm' : 'hover:text-white'}`}
					onclick={() => { mode = 'login'; error = ''; message = ''; }}
				>
					Ingresar
				</button>
				<button
					type="button"
					class={`rounded-full px-4 py-2 transition ${mode === 'register' ? 'bg-[#7c3aed] text-white shadow-sm' : 'hover:text-white'}`}
					onclick={() => { mode = 'register'; error = ''; message = ''; }}
				>
					Crear cuenta
				</button>
			</div>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
			<div class="space-y-3">
				<label for="email" class="text-sm font-medium text-white">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
					placeholder="Introduce tu email"
					required
					bind:value={email}
					autocomplete="email"
				/>
			</div>

			<div class="space-y-3">
				<label for="password" class="text-sm font-medium text-white">Contraseña</label>
				<div class="relative">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 pr-16 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder={mode === 'register' ? 'Creá una contraseña segura' : 'Introduce tu contraseña'}
						required
						bind:value={password}
						autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
					/>
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-semibold text-neutral-100 transition hover:bg-white/10"
						onclick={() => (showPassword = !showPassword)}
					>
						{showPassword ? 'Ocultar' : 'Ver'}
					</button>
				</div>
			</div>

			{#if mode === 'register'}
				<div class="space-y-3">
					<label for="confirmPassword" class="text-sm font-medium text-white">Confirmar contraseña</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type={showPassword ? 'text' : 'password'}
						class="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/40 placeholder:text-neutral-400"
						placeholder="Repetí tu contraseña"
						required
						bind:value={confirmPassword}
						autocomplete="new-password"
					/>
				</div>
			{/if}

			{#if error}
				<p class="flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200">
					<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
					</svg>
					{error}
				</p>
			{/if}

			{#if message}
				<p class="flex items-center gap-2 rounded-xl bg-green-500/15 px-4 py-3 text-sm font-semibold text-green-200">
					<svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
						<path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7" />
					</svg>
					{message}
				</p>
			{/if}

			<button
				type="submit"
				disabled={loading || !email || !password || (mode === 'register' && !confirmPassword)}
				class="flex w-full items-center justify-center rounded-2xl bg-[#7c3aed] px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
			>
				{#if loading}
					{mode === 'register' ? 'Creando cuenta...' : 'Ingresando...'}
				{:else}
					{mode === 'register' ? 'Crear cuenta' : 'Ingresar'}
				{/if}
			</button>

			{#if mode === 'login'}
				<div class="text-right text-sm text-neutral-200">
					<a href="/reset" class="font-semibold hover:underline">¿Olvidaste tu contraseña?</a>
				</div>
			{:else}
				<div class="text-right text-sm text-neutral-200">
					<button type="button" class="font-semibold hover:underline" onclick={() => (mode = 'login')}>
						¿Ya tenés cuenta? Ingresá
					</button>
				</div>
			{/if}
		</form>
	</div>
</div>
