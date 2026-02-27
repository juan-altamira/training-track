import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

test.describe('Rutinas - Crear y ver', () => {
	test('crear cliente y ver página de rutina', async ({ page }) => {
		await page.goto('/clientes');
		
		// Crear cliente nuevo
		const clientName = uniqueName('Rutina');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		// Verificar elementos de la página de rutina
		await expect(page.getByRole('heading', { name: 'RUTINA', exact: true })).toBeVisible();
		await expect(page.getByTestId('add-exercise-button')).toBeVisible();
		await expect(page.locator('button:has-text("Lunes")')).toBeVisible();
	});

	test('navegación de días funciona', async ({ page }) => {
		await page.goto('/clientes');
		const clientName = uniqueName('Dias');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		// Navegar entre días
		await page.locator('button:has-text("Martes")').click({ force: true });
		await page.locator('button:has-text("Viernes")').click({ force: true });
		await page.locator('button:has-text("Domingo")').click({ force: true });
	});

	test('volver al panel funciona', async ({ page }) => {
		await page.goto('/clientes');
		const clientName = uniqueName('Volver');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		await page.getByTestId('back-to-panel').click();
		await expect(page).toHaveURL('/clientes');
	});
});
