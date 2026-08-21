import express, { Router } from 'express';

// Substitui `authenticate` (src/middleware/auth.ts) nos testes funcionais:
// injeta req.profile/req.token/req.user a partir de headers de teste, sem
// depender de Supabase Auth real. `authorize` (checagem de role) roda de
// verdade, sem mock — é lógica pura síncrona, então testa o comportamento
// real de autorização por role.
export function buildTestApp(router: Router, basePath: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const profileHeader = req.header('x-test-profile');
    req.profile = profileHeader ? JSON.parse(profileHeader) : undefined;
    req.token = req.header('x-test-token') || 'test-jwt';
    req.user = { id: req.header('x-test-user-id') || 'user-1' };
    next();
  });
  app.use(basePath, router);
  return app;
}

export function profileHeader(access_level: string, overrides: Record<string, any> = {}) {
  return JSON.stringify({ id: 'user-1', access_level, active: true, ...overrides });
}
