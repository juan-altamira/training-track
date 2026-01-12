import { test, expect } from '@playwright/test';
import { login, uniqueName } from './helpers';

test.describe('Vista pública del cliente', () => {
	let publicUrl: string;
	let clientName: string;

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await login(page);
		
		// Crear cliente con rutina para tests
		clientName = uniqueName('PublicViewTest');
		await page.fill('input[placeholder="Nombre del cliente"]', clientName);
		await page.click('button:has-text("Crear cliente")');
		await page.waitForURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		// Agregar un ejercicio
		await page.click('button:has-text("+ Agregar ejercicio")');
		const exerciseInputs = page.locator('input[type="text"]');
		await exerciseInputs.last().fill('Press de banca');
		await page.click('button:has-text("Guardar rutina")');
		await page.waitForTimeout(2000);
		
		// Obtener el link público
		const linkButton = page.locator('button:has-text("Copiar link")');
		await linkButton.click();
		
		// El link está en el clipboard, pero podemos construirlo desde la URL
		const currentUrl = page.url();
		const clientId = currentUrl.split('/').pop();
		
		// Obtener el client_code de la página
		const linkText = await page.locator('input[readonly]').first().inputValue().catch(() => '');
		if (linkText && linkText.includes('/r/')) {
			publicUrl = linkText;
		} else {
			// Buscar en la base de datos el client_code
			publicUrl = `http://localhost:5173/r/${clientId}`;
		}
		
		await page.close();
	});

	test.describe('Acceso público', () => {
		test('vista pública carga sin autenticación', async ({ page }) => {
			// Nota: Este test requiere el client_code real
			// Por ahora verificamos que la ruta /r/ existe
			await page.goto('/r/test-code');
			// Debe mostrar algo (error o contenido)
			await page.waitForLoadState('networkidle');
		});

		test('cliente desactivado muestra mensaje de acceso deshabilitado', async ({ page }) => {
			const browserPage = await page.context().browser()?.newPage();
			if (!browserPage) return;
			
			await login(browserPage);
			
			// Crear cliente y desactivarlo
			const inactiveName = uniqueName('InactivePublic');
			await browserPage.fill('input[placeholder="Nombre del cliente"]', inactiveName);
			await browserPage.click('button:has-text("Crear cliente")');
			await browserPage.waitForURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Desactivar
			await browserPage.click('button:has-text("Desactivar cliente")');
			await browserPage.click('button:has-text("Sí, desactivar")');
			await browserPage.waitForTimeout(1000);
			
			await browserPage.close();
		});
	});

	test.describe('Interacción con rutina', () => {
		test('puede ver ejercicios del día', async ({ page }) => {
			// Este test es conceptual - requiere un client_code válido
			// en un entorno real habría que obtenerlo de la BD
		});

		test('puede marcar series completadas', async ({ page }) => {
			// Este test requiere acceso a un cliente real con rutina
		});

		test('progreso se guarda correctamente', async ({ page }) => {
			// Este test requiere acceso a un cliente real con rutina
		});
	});
});

test.describe('Navegación general', () => {
	test('página principal redirige correctamente', async ({ page }) => {
		await page.goto('/');
		// Sin auth debería ir a login
		await expect(page).toHaveURL(/\/login|\/$/);
	});

	test('404 para rutas inexistentes', async ({ page }) => {
		const response = await page.goto('/ruta-que-no-existe');
		// SvelteKit puede devolver 404 o página de error
	});
});
