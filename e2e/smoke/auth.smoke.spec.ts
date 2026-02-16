import { test, expect } from '@playwright/test';
import { getTestAccounts } from '../fixtures/accounts';

const accounts = getTestAccounts();
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5173';

const logout = async (page: import('@playwright/test').Page) => {
	await page.request.post('/logout', {
		form: {}
	});
};

test.describe('Smoke Auth', () => {
	test('login inválido muestra error y login válido redirige a /clientes', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();

		await page.goto('/login');
		await page.fill('input[type="email"]', 'invalid@test.com');
		await page.fill('input[type="password"]', 'wrong-password');
		await page.click('button[type="submit"]');
		await expect(page.locator('text=No pudimos iniciar sesión')).toBeVisible({ timeout: 15000 });

		await page.fill('input[type="email"]', accounts.trainer.email);
		await page.fill('input[type="password"]', accounts.trainer.password);
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL(/\/clientes(\?.*)?$/, { timeout: 20000 });

		await logout(page);
		await page.goto('/clientes');
		await expect(page).toHaveURL(/\/login|\/$/, { timeout: 15000 });
		await context.close();
	});

	test('no autenticado: redirect/401 en rutas protegidas', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();

		await page.goto('/clientes');
		await expect(page).toHaveURL(/\/login(\?.*)?$/, { timeout: 15000 });

		const adminRes = await context.request.get(`${baseUrl}/clientes/admin-trainers`);
		expect(adminRes.status()).toBe(401);

		const otherClientsRes = await context.request.get(
			`${baseUrl}/clientes/00000000-0000-0000-0000-000000000000/other-clients`
		);
		expect(otherClientsRes.status()).toBe(401);

		await context.close();
	});
});
