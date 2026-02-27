import { test, expect } from '@playwright/test';
import { uniqueName } from '../helpers';
import { cleanupRunAndAssert } from '../fixtures/cleanup';

test.describe('Smoke /clientes', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('lista, búsqueda, crear alumno, abrir rutina y volver', async ({ page }) => {
		await page.goto('/clientes');
		await expect(page.locator('input[placeholder="Buscar alumno"]')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('input[placeholder="Ej: Ana Pérez"]')).toBeVisible({ timeout: 15000 });

		await page.fill('input[placeholder="Buscar alumno"]', 'no-existe');
		await page.click('button:has-text("Buscar")');

		const name = uniqueName('SmokePanel');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', name);
		await page.click('button:has-text("Crear y generar link")');

		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+$/, { timeout: 20000 });
		await expect(page.locator('h1')).toContainText(name);

		await page.getByTestId('back-to-panel').click();
		await expect(page).toHaveURL(/\/clientes(\?.*)?$/, { timeout: 20000 });
		await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 10000 });
	});
});
