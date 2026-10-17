
import { Hono } from 'hono';
import type { App } from '../types';

export const platformAuthRoutes = new Hono<App>();

// Autenticacao exclusiva do CR JORNADA.
// As rotas de login e sessao serao adicionadas
// depois da integracao com platform_admins
// e platform_sessions.
