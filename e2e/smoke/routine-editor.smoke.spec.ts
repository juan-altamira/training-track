import { test, expect } from '@playwright/test';
import { uniqueName } from '../helpers';
import { cleanupRunAndAssert } from '../fixtures/cleanup';

const ensureExerciseInputVisible = async (page: import('@playwright/test').Page, retries = 3) => {
	const addExerciseButton = page.getByRole('button', { name: /Agregar ejercicio/i }).first();
	const exerciseNameInput = page.locator('input[placeholder="Nuevo ejercicio"]').first();

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if (await exerciseNameInput.isVisible()) {
			return;
		}
		await addExerciseButton.click({ force: true });
		await page.waitForTimeout(200);
	}

	await expect(exerciseNameInput).toBeVisible({ timeout: 10000 });
};

test.describe('Smoke /clientes/[id]', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('guardar rutina mínima, resetear progreso y archivar/reactivar', async ({ page }) => {
		await page.goto('/clientes');
		const clientName = uniqueName('SmokeRoutine');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+$/, { timeout: 20000 });

		await ensureExerciseInputVisible(page);
		await page.locator('input[placeholder="Nuevo ejercicio"]').first().fill('Sentadilla trasera');
		await page.locator('input[placeholder="Ej: 4"]').first().fill('3');

		await page.click('button:has-text("Guardar cambios")');
		await expect(page.locator('text=Rutina guardada')).toBeVisible({ timeout: 10000 });

		const openResetButton = page.getByRole('button', { name: 'Resetear progreso' }).first();
		await openResetButton.scrollIntoViewIfNeeded();
		await openResetButton.click({ force: true });
		await page
			.locator('div.fixed.inset-0')
			.getByRole('button', { name: 'Resetear progreso' })
			.click({ force: true });
		await expect(page.locator('text=Progreso reiniciado')).toBeVisible({ timeout: 10000 });

		const deactivateButton = page.getByRole('button', { name: 'Desactivar alumno' }).first();
		await deactivateButton.scrollIntoViewIfNeeded();
		await deactivateButton.click({ force: true });
		const archiveModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Desactivar alumno' }).first();
		await archiveModal.getByRole('button', { name: 'Confirmar' }).click({ force: true });
		await expect(page.getByRole('button', { name: 'Reactivar alumno' }).first()).toBeVisible({
			timeout: 10000
		});

		const reactivateButton = page.getByRole('button', { name: 'Reactivar alumno' }).first();
		await reactivateButton.scrollIntoViewIfNeeded();
		await reactivateButton.click({ force: true });
		await expect(page.getByRole('button', { name: 'Desactivar alumno' }).first()).toBeVisible({
			timeout: 10000
		});
	});
});
