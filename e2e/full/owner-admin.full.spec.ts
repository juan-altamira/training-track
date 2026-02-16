import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { getTestAccounts } from '../fixtures/accounts';
import { getRunContext } from '../fixtures/dataFactory';
import { getSupabaseAdmin } from '../../tests/helpers/supabase-admin';
import type { AdminTrainersResponse } from '../../tests/contracts/http-types';

const accounts = getTestAccounts();
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5173';
const actionHeaders = { origin: new URL(baseUrl).origin };

const login = async (page: import('@playwright/test').Page, email: string, password: string) => {
	await page.goto('/login');
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await expect(page).toHaveURL(/\/clientes(\?.*)?$/, { timeout: 20000 });
};

test.describe('Full owner admin', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('admin-trainers endpoint: 401 no-auth, 403 trainer, 200 owner', async ({ page, browser }) => {
		test.skip(!accounts.owner, 'Owner account no configurada');

		const unauth = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const unauthRes = await unauth.request.get(`${baseUrl}/clientes/admin-trainers`);
		expect(unauthRes.status()).toBe(401);
		await unauth.close();

		const trainerRes = await page.request.get('/clientes/admin-trainers');
		expect(trainerRes.status()).toBe(403);

		const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const ownerPage = await ownerContext.newPage();
		await login(ownerPage, accounts.owner!.email, accounts.owner!.password);
		const ownerRes = await ownerContext.request.get(`${baseUrl}/clientes/admin-trainers`);
		expect(ownerRes.status()).toBe(200);
		const payload = (await ownerRes.json()) as AdminTrainersResponse;
		expect(Array.isArray(payload.trainers)).toBe(true);
		await ownerContext.close();
	});

	test('owner actions addTrainer/toggleTrainer/forceSignOut', async ({ browser }) => {
		test.skip(!accounts.owner, 'Owner account no configurada');

		const runId = getRunContext().runId;
		const disposableEmail = `e2e+${runId}@example.com`;

		const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const ownerPage = await ownerContext.newPage();
		await login(ownerPage, accounts.owner!.email, accounts.owner!.password);

		const addRes = await ownerContext.request.post(`${baseUrl}/clientes?/addTrainer`, {
			form: { email: disposableEmail },
			headers: actionHeaders
		});
		expect(addRes.status()).toBe(200);

		const supabase = getSupabaseAdmin();
		const { data: addedAccess } = await supabase
			.from('trainer_access')
			.select('active,email')
			.eq('email', disposableEmail)
			.maybeSingle();
		expect(addedAccess?.active).toBe(true);

		const disableRes = await ownerContext.request.post(`${baseUrl}/clientes?/toggleTrainer`, {
			form: { email: disposableEmail, next_active: 'false' },
			headers: actionHeaders
		});
		expect(disableRes.status()).toBe(200);

		const { data: disabledAccess } = await supabase
			.from('trainer_access')
			.select('active')
			.eq('email', disposableEmail)
			.maybeSingle();
		expect(disabledAccess?.active).toBe(false);

		const enableRes = await ownerContext.request.post(`${baseUrl}/clientes?/toggleTrainer`, {
			form: { email: disposableEmail, next_active: 'true' },
			headers: actionHeaders
		});
		expect(enableRes.status()).toBe(200);

		const forceRes = await ownerContext.request.post(`${baseUrl}/clientes?/forceSignOut`, {
			form: { email: disposableEmail },
			headers: actionHeaders
		});
		expect(forceRes.status()).toBe(200);

		await ownerContext.close();
	});
});
