# Training Track Test & Audit Suite

Esta carpeta contiene herramientas de auditoría funcional y de rendimiento para staging aislado.

## Variables requeridas

Definir en `.env` (ver `e2e/.env.example`):

- `TEST_BASE_URL`
- `TEST_TRAINER_EMAIL`, `TEST_TRAINER_PASSWORD`
- `TEST_OWNER_EMAIL`, `TEST_OWNER_PASSWORD` (para owner suite)
- `TEST_DISABLED_EMAIL`, `TEST_DISABLED_PASSWORD` (para authz suite)
- `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_CRON_SECRET`
- `TEST_RUN_ID` (opcional, se autogenera)

Opcional (cron mutante):

- `TEST_ALLOW_CRON_MUTATION=1`

## Fase 1 (gate PR)

- `npm run check`
- `npm run test:smoke`

Smoke mobile (nightly):

- `npm run test:smoke:mobile`

## Fase 2 (nightly hiper exhaustiva)

- `npm run test:full`
- `npm run bench:panel`
- `npm run bench:panel:mobile`
- `npm run test:cleanup:verify`
- `npm run audit:report`

Pipeline completo nocturno:

- `npm run test:audit:nightly`

## Artefactos

- `test-results/playwright/results.json`
- `test-results/audit/<timestamp>/summary.json`
- `test-results/audit/<timestamp>/failures.md`
- `test-results/audit/<timestamp>/perf.json`
- `test-results/audit/<timestamp>/authz-matrix.csv`
