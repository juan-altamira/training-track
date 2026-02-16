import { test, expect } from '@playwright/test';
import { getTestAccounts } from '../fixtures/accounts';
import { cleanupRunAndAssert } from '../fixtures/cleanup';

const accounts = getTestAccounts();

const logout = async (page: import('@playwright/test').Page) => {
	await page.request.post('/logout', {
		form: {}
	});
};

const ensureRegisterMode = async (page: import('@playwright/test').Page, retries = 3) => {
	const registerToggle = page.getByRole('button', { name: 'Crear cuenta', exact: true });
	const confirmPasswordInput = page.locator('input[placeholder="Repetí tu contraseña"]');

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if (await confirmPasswordInput.isVisible()) {
			return;
		}
		await registerToggle.click();
		await page.waitForTimeout(200);
	}

	await expect(confirmPasswordInput).toBeVisible({ timeout: 10000 });
};

test.describe('Full Auth', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('login/registro UI y validaciones básicas', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();

		await page.goto('/login');
		await expect(page.locator('h1')).toContainText('Ingreso de entrenadores');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();

		await ensureRegisterMode(page);
		await expect(page.locator('h1')).toContainText('Crear cuenta');

		const longEmail = `${'a'.repeat(101)}@test.com`;
		await page.fill('input[type="email"]', longEmail);
		await page.fill('input[placeholder="Creá una contraseña segura"]', '123456');
		await page.fill('input[placeholder="Repetí tu contraseña"]', '123456');
		await page.click('button[type="submit"]');
		await expect(page.locator('text=email es demasiado largo')).toBeVisible({ timeout: 10000 });

		await page.fill('input[type="email"]', 'test@example.com');
		await page.fill('input[placeholder="Creá una contraseña segura"]', '123456');
		await page.fill('input[placeholder="Repetí tu contraseña"]', '654321');
		await page.click('button[type="submit"]');
		await expect(page.locator('text=contraseñas no coinciden')).toBeVisible({ timeout: 10000 });

		await context.close();
	});

	test('reset de contraseña y volver a login', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();

		await page.goto('/reset');
		await expect(page.locator('h1')).toContainText('Recuperar contraseña');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await page.click('text=Volver a entrar');
		await expect(page).toHaveURL(/\/login/);

		await context.close();
	});

	test('[AUTHZ] no autenticado redirige a /login en /clientes', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();
		await page.goto('/clientes');
		await expect(page).toHaveURL(/\/login(\?.*)?$/, { timeout: 15000 });
		await context.close();
	});

	test('login válido y logout', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();
		await page.goto('/login');
		await page.fill('input[type="email"]', accounts.trainer.email);
		await page.fill('input[type="password"]', accounts.trainer.password);
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL(/\/clientes(\?.*)?$/, { timeout: 20000 });
		await logout(page);
		await page.goto('/clientes');
		await expect(page).toHaveURL(/\/login|\/$/, { timeout: 15000 });
		await context.close();
	});
});
