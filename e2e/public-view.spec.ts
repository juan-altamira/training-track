import { test, expect } from '@playwright/test';

test.describe('Rutas y navegación', () => {
	test('ruta /clientes accesible con sesión', async ({ page }) => {
		await page.goto('/clientes');
		await expect(page.locator('text=Crear alumno')).toBeVisible();
	});

	test('ruta /r/ inválida carga sin error', async ({ page }) => {
		await page.goto('/r/codigo-inexistente');
		await page.waitForLoadState('networkidle');
	});
});
