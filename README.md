# Training Track

Panel para entrenadores y vista pública para clientes, construido con **SvelteKit**, **TailwindCSS** y **Supabase**. Todo el flujo está orientado a:

- Entrenadores: gestionar clientes, crear/editar rutinas y ver progreso básico.
- Clientes: acceder con un link único, marcar series y ver su rutina sin registrarse.

## Requisitos

- Node.js 20+
- npm (se usa en este repo)
- Cuenta y proyecto en Supabase

## Configuración local

1) Instalar dependencias:
```bash
npm install
```

2) Configurar variables en `.env` (en la raíz):
```
PUBLIC_SUPABASE_URL=TU_URL
PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
SUPABASE_SERVICE_ROLE=TU_SERVICE_ROLE  # solo para endpoints de servidor
CRON_SECRET=un_secret_largo_y_privado
FAST_PANEL_LOADS=0                     # 1 para habilitar el load optimizado
PUBLIC_SITE_URL=http://localhost:5173   # o tu dominio en Netlify
```

3) Levantar en desarrollo:
```bash
npm run dev
```
Abrí http://localhost:5173.

## Scripts útiles

- `npm run check` – tipado y chequeos de Svelte.
- `npm run build` – compila para producción.
- `npm run test:smoke` – suite bloqueante (fase 1).
- `npm run test:full` – suite exhaustiva (fase 2 nightly).
- `npm run bench:panel` – benchmark no destructivo de navegación `/clientes` ↔ `/clientes/[id]`.
- `npm run bench:panel:mobile` – benchmark mobile emulado.
- `npm run test:audit:nightly` – pipeline completo de auditoría (tests + bench + reportes).

## Despliegue

1) Deploy frontend en Netlify (se usa `@sveltejs/adapter-netlify`).
   - Base directory: (dejar vacío)
   - Build command: `npm run build`
   - Publish directory: `build`
2) En Supabase, configura:
   - Site URL: tu dominio (ej. `https://training-track.netlify.app`).
   - Redirect URLs: producción + `http://localhost:5173` para pruebas.
3) Copiá tus claves al entorno de Netlify (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`) y al entorno privado (`SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_ROLE` si usas endpoints server-side).
4) Si desplegás en Vercel con cron de mantenimiento, configurá también `CRON_SECRET`.

## Notas funcionales

- El cliente sólo ve los días con ejercicios cargados.
- El progreso se guarda en Supabase; “Reiniciar contadores” limpia días/series y actualiza las marcas de actividad/reset en UTC.
- El entrenador tiene fondo oscuro, logout y navegación para volver al panel.

## Estructura rápida

- `src/routes/r/[clientCode]`: vista pública del cliente.
- `src/routes/clientes`: listado de clientes del entrenador.
- `src/routes/clientes/[id]`: edición de rutina y estado de un cliente.
- `src/routes/login`, `/register`, `/reset`: flujos de acceso con email y contraseña.

## Autenticación

Se usa email+contraseña (Supabase Auth). Magic links se usan sólo para alta o recuperación según configuración de Supabase. Ajustá las plantillas de correo desde el panel de Supabase si querés personalizar los textos o el destino (`/login`).

## Suscripciones y acceso

- El acceso de entrenadores ahora se valida server-side con dos condiciones:
  - `trainer_access.active = true` (kill-switch manual)
  - `trainers.active_until > now()` (hora UTC de Postgres)
- Las acreditaciones se registran en `subscription_grants` (append-only) y actualizan `active_until` de forma atómica.
- El endpoint de acreditación usa idempotencia (`idempotency_key` única) para evitar duplicados por retries/doble click.
