import { test, expect } from '@playwright/test';
import { uniqueName } from '../helpers';

const IMPORT_TEXT = `Día Push:
Press banca 3x8 82,5kg
Press inclinado 8,8,8
Fondos 3xAMRAP descanso 90s

Día Pull:
Remo con barra 4x6
Dominadas 3xAMRAP
Face pull 3 x 12

Día Piernas:
Sentadilla 5por5
Prensa 12-10-8-6
Peso muerto rumano 3x8-10`;

const readExerciseNames = async (page: import('@playwright/test').Page) =>
	page.getByLabel('Nombre del ejercicio').evaluateAll((inputs) =>
		inputs.map((input) => (input as HTMLInputElement).value)
	);

test.describe('Full import -> editor', () => {
	test('importar texto carga todos los ejercicios en el editor editable, día por día', async ({ page }) => {
		await page.goto('/clientes');

		const clientName = uniqueName('ImportFlow');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });

		await page.waitForLoadState('networkidle');
		await page.getByTestId('import-panel-toggle').click();
		await expect(page.getByText('Paso 1 · Elegí cómo cargar')).toBeVisible();
		await page.getByRole('button', { name: 'Desde texto pegado', exact: true }).click();
		await expect(page.getByTestId('import-textarea')).toBeVisible();
		await page.getByTestId('import-textarea').fill(IMPORT_TEXT);
		await page.getByTestId('import-submit').click();

		await expect(page.locator('text=Rutina generada automáticamente. Revisá los puntos marcados antes de publicar.')).toBeVisible({
			timeout: 20000
		});

		await expect(page.getByTestId('routine-day-tab-monday')).toBeVisible();
		await expect(page.getByTestId('routine-day-tab-tuesday')).toBeVisible();
		await expect(page.getByTestId('routine-day-tab-wednesday')).toBeVisible();

		await expect
			.poll(() => readExerciseNames(page), { timeout: 10000 })
			.toEqual(['Press banca', 'Press inclinado', 'Fondos']);

		await page.getByTestId('routine-day-tab-tuesday').click({ force: true });
		await expect
			.poll(() => readExerciseNames(page), { timeout: 10000 })
			.toEqual(['Remo con barra', 'Dominadas', 'Face pull']);

		await page.getByTestId('routine-day-tab-wednesday').click({ force: true });
		await expect
			.poll(() => readExerciseNames(page), { timeout: 10000 })
			.toEqual(['Sentadilla', 'Prensa', 'Peso muerto rumano']);
	});
});

