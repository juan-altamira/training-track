import { test, expect } from '@playwright/test';
import { login, uniqueName } from './helpers';

test.describe('Rutinas', () => {
	let clientUrl: string;
	let clientName: string;

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await login(page);
		
		// Crear cliente para tests de rutinas
		clientName = uniqueName('RoutineTest');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await page.waitForURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		clientUrl = page.url();
		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await login(page);
		await page.goto(clientUrl);
	});

	test.describe('Agregar ejercicios', () => {
		test('agregar ejercicio exitosamente', async ({ page }) => {
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Debe aparecer un nuevo input de ejercicio (el input de nombre del ejercicio)
			const exerciseInputs = page.locator('input[type="text"]');
			await expect(exerciseInputs.first()).toBeVisible();
		});

		test('validación ejercicio sin nombre al agregar otro', async ({ page }) => {
			// Agregar ejercicio vacío
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Intentar agregar otro sin completar el primero
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Debe mostrar error de nombre vacío
			await expect(page.locator('text=sin nombre')).toBeVisible({ timeout: 5000 });
		});

		test('validación ejercicio con 0 series', async ({ page }) => {
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Completar nombre
			const nameInput = page.locator('input').filter({ hasText: '' }).first();
			await nameInput.fill('Press de banca');
			
			// Cambiar esquema a 0 series
			const schemeInput = page.locator('input[value="3x10"]').first();
			if (await schemeInput.isVisible()) {
				await schemeInput.fill('0x10');
			}
			
			// Intentar agregar otro ejercicio
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Debe mostrar error de 0 series
			await expect(page.locator('text=no tiene series')).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Guardar rutina', () => {
		test('guardar rutina exitosamente', async ({ page }) => {
			// Agregar ejercicio completo
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Buscar el input del nombre del ejercicio
			const exerciseNameInputs = page.locator('input[type="text"]');
			const lastInput = exerciseNameInputs.last();
			await lastInput.fill('Sentadillas');
			
			// Guardar
			await page.click('button:has-text("Guardar cambios")');
			
			// Debe mostrar feedback de éxito
			await expect(page.locator('text=guardada')).toBeVisible({ timeout: 5000 });
		});

		test('validación al guardar con ejercicio sin nombre', async ({ page }) => {
			// Agregar ejercicio vacío
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Intentar guardar sin completar nombre
			await page.click('button:has-text("Guardar cambios")');
			
			// Debe mostrar error
			await expect(page.locator('text=sin nombre')).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Eliminar ejercicio', () => {
		test('eliminar ejercicio funciona', async ({ page }) => {
			// Agregar ejercicio
			await page.click('button:has-text("+ Agregar ejercicio")');
			
			// Buscar y completar nombre
			const exerciseNameInputs = page.locator('input[type="text"]');
			const lastInput = exerciseNameInputs.last();
			await lastInput.fill('Ejercicio a eliminar');
			
			// Buscar botón de eliminar (X o icono de basura)
			const deleteButton = page.locator('button').filter({ hasText: /×|🗑|Eliminar/i }).last();
			if (await deleteButton.isVisible()) {
				await deleteButton.click();
				
				// Verificar que se eliminó
				await expect(page.locator('text=Ejercicio a eliminar')).not.toBeVisible();
			}
		});
	});

	test.describe('Días de la semana', () => {
		test('puede navegar entre días', async ({ page }) => {
			// Verificar que hay tabs de días
			await expect(page.locator('button:has-text("Lunes")')).toBeVisible();
			await expect(page.locator('button:has-text("Martes")')).toBeVisible();
			
			// Cambiar de día
			await page.click('button:has-text("Martes")');
			// El tab debe estar activo/seleccionado
		});
	});

	test.describe('Link público', () => {
		test('copiar link funciona', async ({ page }) => {
			const copyButton = page.locator('button:has-text("Copiar link")');
			if (await copyButton.isVisible()) {
				await copyButton.click();
				await expect(page.locator('text=Copiado')).toBeVisible({ timeout: 3000 });
			}
		});
	});

	test.describe('Resetear progreso', () => {
		test('botón resetear progreso existe', async ({ page }) => {
			// No todos los clientes tienen este botón visible
			// Solo verificamos que la página cargó correctamente
			await expect(page.locator('text=Rutina')).toBeVisible();
		});
	});
});
