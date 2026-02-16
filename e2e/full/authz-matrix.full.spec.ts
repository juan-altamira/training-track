import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { getTestAccounts } from '../fixtures/accounts';
import { seedClientForTrainer } from '../fixtures/dataFactory';

const accounts = getTestAccounts();
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5173';

test.describe('Full AuthZ Matrix', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('[AUTHZ] unauth /clientes -> redirect /login', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();
		await page.goto('/clientes');
		await expect(page).toHaveURL(/\/login(\?.*)?$/, { timeout: 15000 });
		await context.close();
	});

	test('[AUTHZ] unauth /clientes/admin-trainers -> 401', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const response = await context.request.get(`${baseUrl}/clientes/admin-trainers`);
		expect(response.status()).toBe(401);
		await context.close();
	});

	test('[AUTHZ] trainer /clientes/admin-trainers -> 403', async ({ page }) => {
		const response = await page.request.get('/clientes/admin-trainers');
		expect(response.status()).toBe(403);
	});

	test('[AUTHZ] trainer no accede cliente de owner -> 404', async ({ page }) => {
		test.skip(!accounts.owner, 'Owner account no configurada');
		const foreignClient = await seedClientForTrainer(accounts.owner!.email, 'ForeignOwnerClient');
		const res = await page.request.get(`/clientes/${foreignClient.id}`);
		expect(res.status()).toBe(404);
	});

	test('[AUTHZ] trainer no accede endpoint other-clients de cliente ajeno -> 404', async ({ page }) => {
		test.skip(!accounts.owner, 'Owner account no configurada');
		const foreignClient = await seedClientForTrainer(accounts.owner!.email, 'ForeignOtherClients');
		const res = await page.request.get(`/clientes/${foreignClient.id}/other-clients`);
		expect(res.status()).toBe(404);
	});

	test('[AUTHZ] disabled trainer login bloqueado', async ({ browser }) => {
		test.skip(!accounts.disabled, 'Disabled account no configurada');
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();
		await page.goto('/login');
		await page.fill('input[type="email"]', accounts.disabled!.email);
		await page.fill('input[type="password"]', accounts.disabled!.password);
		await page.click('button[type="submit"]');
		await expect(page.locator('text=Acceso inhabilitado')).toBeVisible({ timeout: 15000 });
		await context.close();
	});
});
