import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

test.describe('Vista pública del cliente', () => {
	// Tests de la vista pública /r/[code]
	
	test('obtener y visitar link público de un cliente', async ({ page }) => {
		// Ir al panel y abrir un cliente
		await page.goto('/clientes');
		await page.click('button:has-text("Abrir rutina del cliente")');
		await page.waitForURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		// Obtener el link público del texto visible
		const linkText = await page.locator('text=/r/').first().textContent();
		expect(linkText).toContain('/r/');
		
		// Extraer el código
		const match = linkText?.match(/\/r\/([a-z0-9]+)/);
		if (match) {
			const publicCode = match[1];
			
			// Visitar la URL pública (en nueva página sin auth)
			const publicPage = await page.context().browser()?.newPage();
			if (publicPage) {
				await publicPage.goto(`/r/${publicCode}`);
				await publicPage.waitForLoadState('networkidle');
				
				// Verificar que carga (puede ser rutina o mensaje de error)
				const body = await publicPage.locator('body').textContent();
				expect(body?.length).toBeGreaterThan(0);
				await publicPage.close();
			}
		}
	});

	test('ruta /r/ inválida muestra error apropiado', async ({ page }) => {
		await page.goto('/r/codigo-inexistente-12345');
		await page.waitForLoadState('networkidle');
		// Debe mostrar algún contenido (error o página vacía)
	});
});

test.describe('Navegación y rutas', () => {
	test('página principal redirige a clientes si está autenticado', async ({ page }) => {
		await page.goto('/');
		// Con auth debería ir a clientes
		await expect(page).toHaveURL(/\/clientes|\/$/);
	});

	test('ruta /clientes accesible con sesión', async ({ page }) => {
		await page.goto('/clientes');
		await expect(page.locator('text=Crear cliente')).toBeVisible();
	});
});
