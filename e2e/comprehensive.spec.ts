import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

test.describe('Panel de Clientes - UI', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/clientes');
	});

	test('header muestra logo y nombre', async ({ page }) => {
		await expect(page.locator('text=Training Track')).toBeVisible();
	});

	test('botón cerrar sesión visible', async ({ page }) => {
		await expect(page.locator('button:has-text("Cerrar sesión")')).toBeVisible();
	});

	test('título del panel visible', async ({ page }) => {
		await expect(page.locator('text=Crear alumno')).toBeVisible();
	});

	test('formulario crear cliente completo', async ({ page }) => {
		await expect(page.locator('input[placeholder="Ej: Ana Pérez"]')).toBeVisible();
		await expect(page.locator('button:has-text("Crear y generar link")')).toBeVisible();
	});

	test('buscador funciona', async ({ page }) => {
		const searchInput = page.locator('input[placeholder="Buscar alumno"]');
		await searchInput.fill('test');
		await page.waitForTimeout(300);
		await searchInput.fill('');
	});

	test('cards muestran info del cliente', async ({ page }) => {
		const firstCard = page.locator('article').first();
		await expect(firstCard).toBeVisible();
		await expect(firstCard.locator('text=Última actividad')).toBeVisible();
	});

	test('crear cliente funciona', async ({ page }) => {
		const clientName = uniqueName('Test');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
	});
});

test.describe('Navegación', () => {
	test('refresh mantiene la sesión', async ({ page }) => {
		await page.goto('/clientes');
		await page.reload();
		await expect(page).toHaveURL('/clientes');
		await expect(page.locator('text=Crear alumno')).toBeVisible();
	});

	test('validación cliente sin nombre', async ({ page }) => {
		await page.goto('/clientes');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', '');
		await page.click('button:has-text("Crear y generar link")');
		await page.waitForTimeout(500);
		await expect(page).toHaveURL(/\/clientes$/);
	});
});
