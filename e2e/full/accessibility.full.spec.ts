import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { seedClientForTrainer } from '../fixtures/dataFactory';
import { getTestAccounts } from '../fixtures/accounts';

const accounts = getTestAccounts();

const expectNoCriticalViolations = async (page: import('@playwright/test').Page) => {
	const analysis = await new AxeBuilder({ page }).analyze();
	const criticalViolations = analysis.violations.filter((violation) => violation.impact === 'critical');
	expect(criticalViolations, 'Critical accessibility violations were detected').toHaveLength(0);
};

test.describe('Full accessibility (critical only)', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('critical violations: /login', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();
		await page.goto('/login');
		await expectNoCriticalViolations(page);
		await context.close();
	});

	test('critical violations: /clientes', async ({ page }) => {
		await page.goto('/clientes');
		await expectNoCriticalViolations(page);
	});

	test('critical violations: /clientes/[id] y /r/[clientCode]', async ({ page, browser }) => {
		const seeded = await seedClientForTrainer(accounts.trainer.email, 'A11yClient');
		await page.goto(`/clientes/${seeded.id}`);
		await expectNoCriticalViolations(page);

		const publicContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const publicPage = await publicContext.newPage();
		await publicPage.goto(`/r/${seeded.client_code}`);
		await expectNoCriticalViolations(publicPage);
		await publicContext.close();
	});
});
