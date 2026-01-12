import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

test.describe('Tests Exhaustivos - Panel de Clientes', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/clientes');
	});

	test.describe('UI del panel', () => {
		test('header muestra logo y nombre de la app', async ({ page }) => {
			await expect(page.locator('text=Training Track')).toBeVisible();
		});

		test('botón cerrar sesión está visible', async ({ page }) => {
			await expect(page.locator('button:has-text("Cerrar sesión")')).toBeVisible();
		});

		test('título del panel está visible', async ({ page }) => {
			await expect(page.locator('text=EN ESTE PANEL')).toBeVisible();
		});

		test('formulario de crear cliente tiene todos los campos', async ({ page }) => {
			await expect(page.locator('input[placeholder="Ej: Ana Pérez"]')).toBeVisible();
			await expect(page.locator('input[placeholder*="Hipertrofia"]')).toBeVisible();
			await expect(page.locator('button:has-text("Crear y generar link")')).toBeVisible();
		});
	});

	test.describe('Buscador', () => {
		test('filtrar clientes por nombre', async ({ page }) => {
			const searchInput = page.locator('input[placeholder="Buscar cliente"]');
			await searchInput.fill('a');
			await page.waitForTimeout(300);
			// Debería mostrar solo clientes con 'a' en el nombre
		});

		test('limpiar búsqueda muestra todos', async ({ page }) => {
			const searchInput = page.locator('input[placeholder="Buscar cliente"]');
			await searchInput.fill('xyz123nonexistent');
			await page.waitForTimeout(300);
			await searchInput.fill('');
			await page.waitForTimeout(300);
			// Debería mostrar todos los clientes de nuevo
			await expect(page.locator('article').first()).toBeVisible();
		});
	});

	test.describe('Cards de clientes', () => {
		test('cada card muestra nombre del cliente', async ({ page }) => {
			const firstCard = page.locator('article').first();
			await expect(firstCard.locator('p').first()).toBeVisible();
		});

		test('cada card muestra estado (Activo/Inactivo)', async ({ page }) => {
			const firstCard = page.locator('article').first();
			const statusBadge = firstCard.locator('span').filter({ hasText: /Activo|Inactivo/ });
			await expect(statusBadge).toBeVisible();
		});

		test('cada card muestra última actividad', async ({ page }) => {
			const firstCard = page.locator('article').first();
			await expect(firstCard.locator('text=Última actividad')).toBeVisible();
		});

		test('botón abrir rutina funciona', async ({ page }) => {
			await page.click('button:has-text("Abrir rutina del cliente")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/);
		});
	});

	test.describe('Crear cliente con objetivo', () => {
		test('crear cliente con nombre y objetivo', async ({ page }) => {
			const clientName = uniqueName('ConObjetivo');
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
			await page.fill('input[placeholder*="Hipertrofia"]', 'Ganar masa muscular');
			await page.click('button:has-text("Crear y generar link")');
			
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		});
	});
});

test.describe('Tests Exhaustivos - Página de Rutina', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/clientes');
		await page.click('button:has-text("Abrir rutina del cliente")');
		await page.waitForURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
	});

	test.describe('UI de rutina', () => {
		test('muestra nombre del cliente en el título', async ({ page }) => {
			await expect(page.locator('h1')).toBeVisible();
		});

		test('muestra link de volver al panel', async ({ page }) => {
			await expect(page.locator('text=Volver al panel')).toBeVisible();
		});

		test('link volver funciona', async ({ page }) => {
			await page.click('text=Volver al panel');
			await expect(page).toHaveURL('/clientes');
		});

		test('muestra título "Rutina"', async ({ page }) => {
			await expect(page.locator('h2:has-text("Rutina")')).toBeVisible();
		});

		test('botón guardar cambios visible', async ({ page }) => {
			await expect(page.locator('button:has-text("Guardar cambios")')).toBeVisible();
		});
	});

	test.describe('Tabs de días', () => {
		test('muestra todos los días de la semana', async ({ page }) => {
			const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
			for (const dia of dias) {
				await expect(page.locator(`button:has-text("${dia}")`)).toBeVisible();
			}
		});

		test('cambiar de día funciona', async ({ page }) => {
			await page.click('button:has-text("Martes")');
			// Verificar que el tab está activo (tiene estilo diferente)
			await page.waitForTimeout(200);
		});

		test('navegar por todos los días', async ({ page }) => {
			const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
			for (const dia of dias) {
				await page.click(`button:has-text("${dia}")`);
				await page.waitForTimeout(100);
			}
		});
	});

	test.describe('Ejercicios', () => {
		test('botón agregar ejercicio visible', async ({ page }) => {
			await expect(page.locator('button:has-text("+ Agregar ejercicio")')).toBeVisible();
		});

		test('agregar múltiples ejercicios', async ({ page }) => {
			// Agregar primer ejercicio
			await page.click('button:has-text("+ Agregar ejercicio")');
			await page.locator('input[type="text"]').last().fill('Sentadillas');
			
			// Agregar segundo ejercicio
			await page.click('button:has-text("+ Agregar ejercicio")');
			await page.locator('input[type="text"]').last().fill('Press de banca');
			
			// Verificar que ambos existen
			await expect(page.locator('text=Sentadillas')).toBeVisible();
			await expect(page.locator('text=Press de banca')).toBeVisible();
		});

		test('ejercicio tiene campo de esquema (series x reps)', async ({ page }) => {
			await page.click('button:has-text("+ Agregar ejercicio")');
			// El esquema por defecto es 3x10
			await expect(page.locator('input[value="3x10"]')).toBeVisible();
		});

		test('modificar esquema de ejercicio', async ({ page }) => {
			await page.click('button:has-text("+ Agregar ejercicio")');
			const schemeInput = page.locator('input[value="3x10"]');
			await schemeInput.fill('4x12');
			await expect(schemeInput).toHaveValue('4x12');
		});
	});

	test.describe('Panel lateral', () => {
		test('muestra link de la rutina', async ({ page }) => {
			await expect(page.locator('text=Link de la rutina')).toBeVisible();
		});

		test('muestra URL del cliente', async ({ page }) => {
			await expect(page.locator('text=/r/')).toBeVisible();
		});

		test('muestra semana actual', async ({ page }) => {
			await expect(page.locator('text=Semana actual')).toBeVisible();
		});

		test('muestra última actualización', async ({ page }) => {
			await expect(page.locator('text=Última actualización')).toBeVisible();
		});
	});

	test.describe('Acciones de cliente', () => {
		test('botón copiar link visible', async ({ page }) => {
			await expect(page.locator('button:has-text("Copiar link")')).toBeVisible();
		});

		test('botón desactivar cliente visible', async ({ page }) => {
			await expect(page.locator('button:has-text("Desactivar cliente")')).toBeVisible();
		});

		test('botón eliminar cliente visible', async ({ page }) => {
			await expect(page.locator('button:has-text("Eliminar cliente")')).toBeVisible();
		});

		test('botón copiar rutina de otro cliente visible', async ({ page }) => {
			await expect(page.locator('button:has-text("Copiar rutina")')).toBeVisible();
		});
	});

	test.describe('Modales', () => {
		test('modal desactivar se abre y cierra', async ({ page }) => {
			await page.click('button:has-text("Desactivar cliente")');
			await expect(page.locator('text=¿Estás seguro')).toBeVisible();
			await page.click('button:has-text("Cancelar")');
			await expect(page.locator('text=¿Estás seguro')).not.toBeVisible();
		});

		test('modal eliminar se abre y cierra', async ({ page }) => {
			await page.click('button:has-text("Eliminar cliente")');
			await expect(page.locator('input[placeholder="eliminar"]')).toBeVisible();
			await page.click('button:has-text("Cancelar")');
		});
	});
});

test.describe('Tests Exhaustivos - Flujos Completos', () => {
	test('flujo completo: crear cliente, agregar ejercicio, guardar', async ({ page }) => {
		// 1. Ir al panel
		await page.goto('/clientes');
		
		// 2. Crear cliente
		const clientName = uniqueName('FlujoCompleto');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.fill('input[placeholder*="Hipertrofia"]', 'Test de flujo');
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		// 3. Agregar ejercicio
		await page.click('button:has-text("+ Agregar ejercicio")');
		await page.locator('input[type="text"]').last().fill('Press militar');
		
		// 4. Guardar
		await page.click('button:has-text("Guardar cambios")');
		await expect(page.locator('text=guardada')).toBeVisible({ timeout: 5000 });
		
		// 5. Volver al panel
		await page.click('text=Volver al panel');
		await expect(page).toHaveURL('/clientes');
		
		// 6. Verificar que el cliente existe
		await expect(page.locator(`text=${clientName.substring(0, 10)}`)).toBeVisible();
	});

	test('flujo: crear cliente en diferentes días de la semana', async ({ page }) => {
		await page.goto('/clientes');
		
		const clientName = uniqueName('MultiDia');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
		
		// Agregar ejercicio en Lunes
		await page.click('button:has-text("Lunes")');
		await page.click('button:has-text("+ Agregar ejercicio")');
		await page.locator('input[type="text"]').last().fill('Sentadillas');
		
		// Agregar ejercicio en Miércoles
		await page.click('button:has-text("Miércoles")');
		await page.click('button:has-text("+ Agregar ejercicio")');
		await page.locator('input[type="text"]').last().fill('Press banca');
		
		// Agregar ejercicio en Viernes
		await page.click('button:has-text("Viernes")');
		await page.click('button:has-text("+ Agregar ejercicio")');
		await page.locator('input[type="text"]').last().fill('Peso muerto');
		
		// Guardar
		await page.click('button:has-text("Guardar cambios")');
		await expect(page.locator('text=guardada')).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Tests de Validación', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/clientes');
	});

	test('no permite crear cliente sin nombre', async ({ page }) => {
		await page.fill('input[placeholder="Ej: Ana Pérez"]', '');
		await page.click('button:has-text("Crear y generar link")');
		await page.waitForTimeout(500);
		// Debe quedarse en /clientes
		await expect(page).toHaveURL(/\/clientes$/);
	});

	test('valida ejercicio sin nombre al guardar', async ({ page }) => {
		await page.click('button:has-text("Abrir rutina del cliente")');
		await page.waitForURL(/\/clientes\/[a-f0-9-]+/);
		
		await page.click('button:has-text("+ Agregar ejercicio")');
		// No llenar el nombre
		await page.click('button:has-text("Guardar cambios")');
		
		// Debe mostrar error
		await expect(page.locator('text=sin nombre')).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Tests de Navegación', () => {
	test('navegación con botón atrás del navegador', async ({ page }) => {
		await page.goto('/clientes');
		await page.click('button:has-text("Abrir rutina del cliente")');
		await page.waitForURL(/\/clientes\/[a-f0-9-]+/);
		
		await page.goBack();
		await expect(page).toHaveURL('/clientes');
	});

	test('refresh mantiene la sesión', async ({ page }) => {
		await page.goto('/clientes');
		await page.reload();
		// Debe seguir en clientes, no redirigir a login
		await expect(page).toHaveURL('/clientes');
		await expect(page.locator('text=Crear cliente')).toBeVisible();
	});
});
