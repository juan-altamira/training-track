import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { getTestAccounts } from '../fixtures/accounts';
import { seedClientForTrainer } from '../fixtures/dataFactory';

const accounts = getTestAccounts();
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5173';

test.describe('Smoke AuthZ', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('endpoints lazy responden con códigos esperados', async ({ page, browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const adminUnauth = await context.request.get(`${baseUrl}/clientes/admin-trainers`);
		expect(adminUnauth.status()).toBe(401);
		const otherUnauth = await context.request.get(
			`${baseUrl}/clientes/00000000-0000-0000-0000-000000000000/other-clients`
		);
		expect(otherUnauth.status()).toBe(401);
		await context.close();

		const adminTrainer = await page.request.get('/clientes/admin-trainers');
		expect(adminTrainer.status()).toBe(403);
	});

	test('trainer A no accede a cliente de otro entrenador', async ({ page }) => {
		test.skip(!accounts.owner, 'TEST_OWNER_EMAIL / TEST_OWNER_PASSWORD no configurados');

		const ownerClient = await seedClientForTrainer(accounts.owner!.email, 'OwnerOnlyClient');
		const response = await page.request.get(`/clientes/${ownerClient.id}`);
		expect(response.status()).toBe(404);

		const otherClientsResponse = await page.request.get(
			`/clientes/${ownerClient.id}/other-clients`
		);
		expect(otherClientsResponse.status()).toBe(404);
	});

	test('cuenta deshabilitada no puede ingresar', async ({ browser }) => {
		test.skip(!accounts.disabled, 'TEST_DISABLED_EMAIL / TEST_DISABLED_PASSWORD no configurados');
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
