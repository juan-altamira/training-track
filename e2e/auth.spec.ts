import { test, expect } from '@playwright/test';
import { TEST_USER, login, uniqueName } from './helpers';

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
			await page.click('button:has-text("Crear cuenta")');
			await expect(page.locator('h1')).toContainText('Crear cuenta');
			await expect(page.locator('input[placeholder="Repetí tu contraseña"]')).toBeVisible();
			
			// Volver a login
			await page.click('button:has-text("Ingresar")');
			await expect(page.locator('h1')).toContainText('Ingreso de entrenadores');
		});

		test('login exitoso redirige a /clientes', async ({ page }) => {
			await login(page);
			await expect(page).toHaveURL(/\/clientes/);
			await expect(page.locator('text=Crear cliente')).toBeVisible();
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
			const passwordInput = page.locator('input[type="password"]');
			await passwordInput.fill('mipassword');
			
			// Click en "Ver"
			await page.click('button:has-text("Ver")');
			await expect(page.locator('input[type="text"]')).toHaveValue('mipassword');
			
			// Click en "Ocultar"
			await page.click('button:has-text("Ocultar")');
			await expect(page.locator('input[type="password"]')).toHaveValue('mipassword');
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
			await page.click('button:has-text("Crear cuenta")');
			
			const longEmail = 'a'.repeat(101) + '@test.com';
			await page.fill('input[type="email"]', longEmail);
			await page.fill('input[placeholder="Creá una contraseña segura"]', 'password123');
			await page.fill('input[placeholder="Repetí tu contraseña"]', 'password123');
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=email es demasiado largo')).toBeVisible({ timeout: 5000 });
		});

		test('validación de contraseña muy corta', async ({ page }) => {
			await page.goto('/login');
			await page.click('button:has-text("Crear cuenta")');
			
			await page.fill('input[type="email"]', 'test@test.com');
			await page.fill('input[placeholder="Creá una contraseña segura"]', '12345');
			await page.fill('input[placeholder="Repetí tu contraseña"]', '12345');
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=al menos 6 caracteres')).toBeVisible({ timeout: 5000 });
		});

		test('validación de contraseña muy larga', async ({ page }) => {
			await page.goto('/login');
			await page.click('button:has-text("Crear cuenta")');
			
			const longPassword = 'a'.repeat(73);
			await page.fill('input[type="email"]', 'test@test.com');
			await page.fill('input[placeholder="Creá una contraseña segura"]', longPassword);
			await page.fill('input[placeholder="Repetí tu contraseña"]', longPassword);
			await page.click('button[type="submit"]');
			
			await expect(page.locator('text=contraseña es demasiado larga')).toBeVisible({ timeout: 5000 });
		});

		test('validación de contraseñas no coinciden', async ({ page }) => {
			await page.goto('/login');
			await page.click('button:has-text("Crear cuenta")');
			
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
			await page.click('button:has-text("Cerrar sesión")');
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
