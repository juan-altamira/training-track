# Training Track - E2E Testing con Stagehand

Este directorio contiene tests end-to-end (E2E) exhaustivos para la aplicación Training Track utilizando [Stagehand](https://docs.stagehand.dev/).

## ¿Qué es Stagehand?

Stagehand es un framework de automatización web impulsado por IA que permite escribir tests usando lenguaje natural. En lugar de usar selectores CSS/XPath frágiles, Stagehand utiliza modelos de IA para entender y interactuar con las páginas web.

## Requisitos Previos

### 1. Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto (o usa el existente) con las siguientes variables:

```env
# Para usar Stagehand en modo LOCAL (navegador local)
# No se necesitan API keys adicionales si usas modo LOCAL sin AI

# Para usar funciones de AI (act, extract, observe):
OPENAI_API_KEY=tu_api_key_de_openai

# Para usar Browserbase (cloud browser):
BROWSERBASE_API_KEY=tu_api_key_de_browserbase
BROWSERBASE_PROJECT_ID=tu_project_id

# URL base de la aplicación (por defecto: http://localhost:5173)
TEST_BASE_URL=http://localhost:5173
```

### 2. Modos de Ejecución

- **LOCAL**: Usa un navegador Chrome local. Requiere Chrome instalado.
- **BROWSERBASE**: Usa navegadores en la nube de Browserbase (ideal para CI/CD).

## Instalación

Las dependencias ya están instaladas. Si necesitas reinstalar:

```bash
npm install
```

## Ejecutar los Tests

### 1. Iniciar la aplicación (en una terminal separada)

```bash
npm run dev
```

### 2. Ejecutar la suite de tests completa

```bash
npm run test:e2e
```

### 3. Ejecutar en modo visible (no headless)

```bash
HEADLESS=false npm run test:e2e
```

### 4. Ejecutar con logs detallados

```bash
VERBOSE=true npm run test:e2e
```

## Suite de Tests

Los tests cubren las siguientes funcionalidades:

### Autenticación (Tests 1-5)
- ✅ Carga correcta de página de login
- ✅ Error al usar credenciales inválidas
- ✅ Login exitoso y redirección a /clientes
- ✅ Carga correcta de página de registro
- ✅ Carga correcta de página de reset de contraseña

### Panel de Clientes (Tests 6-10)
- ✅ Visualización correcta del panel
- ✅ Validación del formulario de crear cliente
- ✅ Creación de nuevo cliente
- ✅ Funcionalidad de búsqueda
- ✅ Apertura de detalles de cliente

### Detalle de Cliente y Rutinas (Tests 11-16)
- ✅ Carga correcta de página de detalle
- ✅ Agregar ejercicio a rutina
- ✅ Completar datos de ejercicio
- ✅ Guardar cambios en rutina
- ✅ Navegación entre días de la semana
- ✅ Botón de copiar link

### Navegación y UI (Tests 17-20)
- ✅ Navegación de vuelta al panel
- ✅ Funcionalidad de logout
- ✅ Toggle de visibilidad de contraseña
- ✅ Links de navegación entre páginas

### Limpieza (Test 21)
- ✅ Eliminación de cliente de prueba

## Estructura de Archivos

```
tests/
├── README.md                 # Esta documentación
├── stagehand.config.ts       # Configuración de Stagehand
└── e2e/
    └── full-test-suite.ts    # Suite completa de tests
```

## Personalización

### Cambiar usuario de prueba

Edita `tests/stagehand.config.ts`:

```typescript
export const config = {
  testUser: {
    email: "tu_email@ejemplo.com",
    password: "tu_contraseña"
  }
};
```

### Agregar nuevos tests

Puedes agregar tests en `full-test-suite.ts` siguiendo el patrón:

```typescript
await runner.runTest("Nombre del test", async () => {
  // Navegar a una página
  await page.goto(`${CONFIG.baseUrl}/ruta`);
  
  // Ejecutar acciones con lenguaje natural
  await stagehand.act("Click en el botón de login");
  
  // Extraer información de la página
  const data = await stagehand.extract(
    "Extraer el título de la página",
    z.object({
      titulo: z.string()
    })
  );
  
  // Validar resultados
  if (!data.titulo) {
    throw new Error("No se encontró el título");
  }
});
```

## Solución de Problemas

### Error: Chrome not found
Asegúrate de tener Chrome instalado. Stagehand lo detectará automáticamente.

### Error: OPENAI_API_KEY not set
Los métodos `act()`, `extract()` y `observe()` requieren una API key de OpenAI.

### Tests muy lentos
- Usa `HEADLESS=true` para mejor rendimiento
- Considera usar Browserbase para ejecución en paralelo

### Error de timeout
Incrementa los timeouts en la configuración o en tests específicos.

## Más Información

- [Documentación de Stagehand](https://docs.stagehand.dev/)
- [API Reference](https://docs.stagehand.dev/v3/references/act)
- [Discord de Stagehand](https://stagehand.dev/discord)
