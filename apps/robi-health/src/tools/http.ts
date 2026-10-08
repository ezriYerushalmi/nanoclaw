import type { SQL } from 'bun';
import { HealthError, record, type Operation } from '../domain.js';
import type { HealthService, TrustedInteraction } from '../services/health.js';
import { resolveInteraction } from '../runtime/authority.js';
const operations: Operation[] = ['log_weight', 'log_water', 'get_today_status'];
export function handler(db: SQL, service: HealthService, resolve = resolveInteraction) {
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') {
        await db`SELECT 1`;
        return Response.json({ healthy: true });
      }
      if (request.method !== 'POST' || path !== '/tools')
        return Response.json({ reason: 'not_found' }, { status: 404 });
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
        throw new HealthError('json_content_type_required');
      if (Number(request.headers.get('content-length') ?? 0) > 16384) throw new HealthError('request_too_large');
      const text = await request.text();
      if (text.length > 16384) throw new HealthError('request_too_large');
      const body = record(JSON.parse(text) as unknown);
      if (Object.keys(body).some((key) => !['operation', 'input', 'sessionId', 'messageId'].includes(key)))
        throw new HealthError('unexpected_argument');
      if (
        typeof body.operation !== 'string' ||
        !operations.includes(body.operation as Operation) ||
        typeof body.sessionId !== 'string' ||
        typeof body.messageId !== 'string'
      )
        throw new HealthError('invalid_request');
      const operation = body.operation as Operation;
      const input = record(body.input);
      const context: TrustedInteraction = resolve(
        body.sessionId,
        body.messageId,
        operation,
        undefined,
        undefined,
        input.sourceMessageIndex,
      );
      return Response.json(await service.execute(operation, body.input, context));
    } catch (error: unknown) {
      const reason = error instanceof HealthError ? error.reason : 'health_service_error';
      console.error(JSON.stringify({ event: 'robi_health_tool_error', reason }));
      return Response.json(
        { success: false, reason },
        { status: reason === 'unauthorized_sender' ? 403 : error instanceof HealthError ? 400 : 503 },
      );
    }
  };
}
