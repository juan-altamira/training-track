import { test, expect } from '@playwright/test';
import { TEST_USER, login, uniqueName } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const openRegisterMode = async (page: import('@playwright/test').Page, retries = 8) => {
	const registerTab = page.locator('button[type="button"]').filter({ hasText: 'Crear cuenta' }).first();
	const registerConfirmInput = page.locator('input[placeholder="Repetí tu contraseña"]');

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if (await registerConfirmInput.isVisible()) {
			return;
		}
		await registerTab.click({ force: true });
		await page.waitForTimeout(400);
	}

	await expect(registerConfirmInput).toBeVisible({ timeout: 10000 });
};

const togglePasswordVisibility = async (
	page: import('@playwright/test').Page,
	expectedType: 'text' | 'password',
	retries = 8
) => {
	const toggleButton = page.locator('button[type="button"]').filter({ hasText: expectedType === 'text' ? 'Ver' : 'Ocultar' }).first();
	const passwordInput = page.locator('input[autocomplete="current-password"]');

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if ((await passwordInput.getAttribute('type')) === expectedType) {
			return;
		}
		await toggleButton.click({ force: true });
		await page.waitForTimeout(250);
	}

	await expect(passwordInput).toHaveAttribute('type', expectedType, { timeout: 10000 });
};

const openLogoutConfirm = async (page: import('@playwright/test').Page, retries = 8) => {
	const logoutButton = page.locator('button:has-text("Cerrar sesión")').first();
	const confirmTitle = page.locator('#logout-confirm-title');

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if (await confirmTitle.isVisible().catch(() => false)) {
			return;
		}
		await logoutButton.click({ force: true });
		await page.waitForTimeout(400);
	}

	await expect(confirmTitle).toContainText('Confirmar cierre de sesión', { timeout: 10000 });
};

test.describe('Autenticación', () => {
	test.describe('Login', () => {
		test('muestra página de login correctamente', async ({ page }) => {
			await page.goto('/login');
			await expect(page.locator('h1')).toContainText('Ingreso de entrenadores');
			await expect(page.locator('input[type="email"]')).toBeVisible();
			await expect(page.locator('input[type="password"]')).toBeVisible();
			await expect(page.locator('button[type="submit"]')).toContainText('Ingresar');
		});

		test('tabs de login/registro funcionan', async ({ page }) => {
			await page.goto('/login');
			
			// Por defecto está en login
			await expect(page.locator('h1')).toContainText('Ingreso de entrenadores');
			
			// Cambiar a registro
			await openRegisterMode(page);
			await expect(page.locator('h1')).toContainText('Crear cuenta');
			await expect(page.locator('input[placeholder="Repetí tu contraseña"]')).toBeVisible();
			
			// Volver a login
			await page.locator('button[type="button"]').filter({ hasText: 'Ingresar' }).first().click({ force: true });
			await expect(page.locator('h1')).toContainText('Ingreso de entrenadores');
		});

		test('login exitoso redirige a /clientes', async ({ page }) => {
			await login(page);
			await expect(page).toHaveURL(/\/clientes/);
			await expect(page.locator('text=Crear alumno')).toBeVisible();
		});

		test('login fallido muestra error', async ({ page }) => {
			await page.goto('/login');
			await page.fill('input[type="email"]', 'email_invalido@test.com');
			await page.fill('input[type="password"]', 'password_incorrecta');
			await page.click('button[type="submit"]');
			await expect(page.locator('text=No pudimos iniciar sesión')).toBeVisible({ timeout: 10000 });
		});

		test('botón ver/ocultar contraseña funciona', async ({ page }) => {
			await page.goto('/login');
			const passwordInput = page.locator('input[autocomplete="current-password"]');
			await passwordInput.fill('mipassword');
			
			// Click en "Ver"
			await togglePasswordVisibility(page, 'text');
			await expect(passwordInput).toHaveValue('mipassword');
			
			// Click en "Ocultar"
			await togglePasswordVisibility(page, 'password');
			await expect(passwordInput).toHaveValue('mipassword');
		});

		test('link a recuperar contraseña funciona', async ({ page }) => {
			await page.goto('/login');
			await page.click('text=¿Olvidaste tu contraseña?');
			await expect(page).toHaveURL(/\/reset/);
		});
	});

	test.describe('Registro', () => {
		test('validación de email muy largo', async ({ page }) => {
			await page.goto('/login');
			await openRegisterMode(page);
			
			const longEmail = 'a'.repeat(101) + '@test.com';
			await page.fill('input[type="email"]', longEmail);
			await page.fill('input[placeholder="Creá una contraseña segura"]', 'password123');
			await page.fill('input[placeholder="Repetí tu contraseña"]', 'password123');
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=email es demasiado largo')).toBeVisible({ timeout: 5000 });
		});

		test('validación de contraseña muy corta', async ({ page }) => {
			await page.goto('/login');
			await openRegisterMode(page);
			
			await page.fill('input[type="email"]', 'test@test.com');
			await page.fill('input[placeholder="Creá una contraseña segura"]', '12345');
			await page.fill('input[placeholder="Repetí tu contraseña"]', '12345');
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=al menos 6 caracteres')).toBeVisible({ timeout: 5000 });
		});

		test('validación de contraseña muy larga', async ({ page }) => {
			await page.goto('/login');
			await openRegisterMode(page);
			
			const longPassword = 'a'.repeat(73);
			await page.fill('input[type="email"]', 'test@test.com');
			await page.fill('input[placeholder="Creá una contraseña segura"]', longPassword);
			await page.fill('input[placeholder="Repetí tu contraseña"]', longPassword);
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=contraseña es demasiado larga')).toBeVisible({ timeout: 5000 });
		});

		test('validación de contraseñas no coinciden', async ({ page }) => {
			await page.goto('/login');
			await openRegisterMode(page);
			
			await page.fill('input[type="email"]', 'test@test.com');
			await page.fill('input[placeholder="Creá una contraseña segura"]', 'password123');
			await page.fill('input[placeholder="Repetí tu contraseña"]', 'password456');
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=contraseñas no coinciden')).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Reset de contraseña', () => {
		test('muestra página de reset correctamente', async ({ page }) => {
			await page.goto('/reset');
			await expect(page.locator('h1')).toContainText('Recuperar contraseña');
			await expect(page.locator('input[type="email"]')).toBeVisible();
			await expect(page.locator('button[type="submit"]')).toContainText('Enviar enlace');
		});

		test('link volver a login funciona', async ({ page }) => {
			await page.goto('/reset');
			await page.click('text=Volver a entrar');
			await expect(page).toHaveURL(/\/login/);
		});
	});

	test.describe('Logout', () => {
		test('logout funciona correctamente', async ({ page }) => {
			await login(page);
			await openLogoutConfirm(page);
			await page.click('button:has-text("Sí, cerrar sesión")');
			await expect(page).toHaveURL(/\/login|\/$/);
		});
	});

	test.describe('Redirecciones', () => {
		test('/registro redirige a /login', async ({ page }) => {
			await page.goto('/registro');
			await expect(page).toHaveURL(/\/login/);
		});

		test('/clientes sin auth redirige a login', async ({ page }) => {
			await page.goto('/clientes');
			await expect(page).toHaveURL(/\/login/);
		});
	});
});
