/**
 * Mock de la futura API de inventario del B2B — para el trial de Celigo.
 *
 * Solo RECIBE datos por HTTP: valida el payload contra el contrato, lo registra
 * en memoria y responde. No se conecta a NetSuite ni a ningún otro sistema.
 *
 * Modos de fallo forzado (para probar los reintentos/alertas de Celigo):
 * POST /admin/mode { "mode": "ok" | "error400" | "error500" | "timeout" }
 */

import Fastify from 'fastify'
import { z } from 'zod'

const PORT = Number(process.env.PORT ?? 8080)
const API_KEY = process.env.MOCK_API_KEY ?? ''
const TIMEOUT_MS = 35_000 // > timeout típico de un import HTTP en Celigo

// ─── Contrato del payload (reutilizable como contrato real del B2B) ──────────

const PositionSchema = z.object({
  sku: z.string().min(1),
  styleCode: z.string().optional(),
  size: z.string().optional(),
  warehouseCode: z.string().min(1),
  quantity: z.number().int().min(0),
})

const SyncPayloadSchema = z.object({
  brandId: z.string().min(1),
  syncedAt: z.string().optional(),
  positions: z.array(PositionSchema).min(1),
})

// ─── Estado en memoria (suficiente para el trial; se pierde al reiniciar) ────

type Mode = 'ok' | 'error400' | 'error500' | 'timeout'
let mode: Mode = 'ok'

interface ReceivedEntry {
  at: string
  brandId: string
  positionsReceived: number
  invalidPayload: boolean
  sample: unknown
}
const received: ReceivedEntry[] = []
const MAX_ENTRIES = 100

// ─── Servidor ─────────────────────────────────────────────────────────────────

const app = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024, // catálogo completo ~40-50k posiciones
})

app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return // health check de DO sin API key
  if (!API_KEY) {
    return reply.code(503).send({ error: 'MOCK_API_KEY no configurada en el servidor' })
  }
  if (req.headers['x-api-key'] !== API_KEY) {
    return reply.code(401).send({ error: 'x-api-key inválida o ausente' })
  }
})

app.get('/health', async () => ({ ok: true, mode }))

app.post('/admin/mode', async (req, reply) => {
  const body = z.object({ mode: z.enum(['ok', 'error400', 'error500', 'timeout']) }).safeParse(req.body)
  if (!body.success) {
    return reply.code(422).send({ error: 'mode debe ser: ok | error400 | error500 | timeout' })
  }
  mode = body.data.mode
  app.log.info({ mode }, 'modo de respuesta cambiado')
  return { ok: true, mode }
})

app.post('/api/inventory/sync', async (req, reply) => {
  if (mode === 'timeout') {
    app.log.warn('modo timeout: reteniendo la respuesta a propósito')
    await new Promise((r) => setTimeout(r, TIMEOUT_MS))
    return reply.code(504).send({ error: 'timeout forzado (prueba del trial)' })
  }
  if (mode === 'error500') {
    return reply.code(500).send({ error: 'fallo interno forzado (prueba del trial)' })
  }
  if (mode === 'error400') {
    return reply.code(400).send({ error: 'bad request forzado (prueba del trial)' })
  }

  const parsed = SyncPayloadSchema.safeParse(req.body)
  if (!parsed.success) {
    received.push({
      at: new Date().toISOString(),
      brandId: 'INVALID',
      positionsReceived: 0,
      invalidPayload: true,
      sample: parsed.error.issues.slice(0, 5),
    })
    if (received.length > MAX_ENTRIES) received.shift()
    return reply.code(422).send({
      error: 'payload no cumple el contrato',
      issues: parsed.error.issues.slice(0, 10),
    })
  }

  const { brandId, positions } = parsed.data
  received.push({
    at: new Date().toISOString(),
    brandId,
    positionsReceived: positions.length,
    invalidPayload: false,
    sample: positions[0],
  })
  if (received.length > MAX_ENTRIES) received.shift()

  app.log.info({ brandId, positions: positions.length }, 'sync de inventario recibido')
  return { ok: true, brandId, positionsReceived: positions.length }
})

app.get('/api/inventory/received', async () => ({
  mode,
  totalEntries: received.length,
  entries: [...received].reverse(),
}))

app.listen({ port: PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
