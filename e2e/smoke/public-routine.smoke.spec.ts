import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { seedClientForTrainer } from '../fixtures/dataFactory';
import { getTestAccounts } from '../fixtures/accounts';
import { createEmptyPlan } from '../../tests/helpers/seed';

const accounts = getTestAccounts();

const openDayUntilExpanded = async (
	page: import('@playwright/test').Page,
	label: string,
	retries = 3
) => {
	const dayButton = page.locator(`button.day-header:has-text("${label}")`).first();
	const exerciseCard = page.locator('.exercise-card').first();

	for (let attempt = 0; attempt < retries; attempt += 1) {
		await dayButton.click();
		if (await exerciseCard.isVisible()) {
			return;
		}
		await page.waitForTimeout(200);
	}

	await expect(exerciseCard).toBeVisible({ timeout: 10000 });
};

test.describe('Smoke /r/[clientCode]', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('sumar/restar series, persistencia y reset', async ({ browser }) => {
		const plan = createEmptyPlan();
		plan.monday.exercises.push({
			id: 'smoke-ex-1',
			name: 'Press banca',
			scheme: '',
			order: 0,
			totalSets: 3,
			repsMin: 8,
			repsMax: null,
			showRange: false
		});

		const seeded = await seedClientForTrainer(accounts.trainer.email, 'SmokePublic', { plan });
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();

		await page.goto(`/r/${seeded.client_code}`);
		await openDayUntilExpanded(page, 'Lunes');

		const exerciseCard = page.locator('.exercise-card').first();
		const waitForSave = page.waitForResponse(
			(res) =>
				res.request().method() === 'POST' &&
				res.url().includes('/r/') &&
				res.url().includes('?/saveProgress') &&
				res.status() === 200,
			{ timeout: 15000 }
		);
		await exerciseCard.locator('button.pill-btn:has-text("+")').click();
		await exerciseCard.locator('button.pill-btn:has-text("+")').click();
		await waitForSave;

		await expect(exerciseCard.locator('.sets-done')).toHaveText('2', { timeout: 10000 });
		await page.reload();
		await openDayUntilExpanded(page, 'Lunes');
		await expect(page.locator('.exercise-card').first().locator('.sets-done')).toHaveText('2', {
			timeout: 10000
		});

		await page.click('button.reset-btn:has-text("Reiniciar contadores")');
		await page.click('button.btn.danger:has-text("Confirmar")');
		await page.reload();
		await openDayUntilExpanded(page, 'Lunes');
		await expect(page.locator('.exercise-card').first().locator('.sets-done')).toHaveText('0', {
			timeout: 10000
		});

		await context.close();
	});
});
