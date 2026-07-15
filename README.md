# celigo-mock-inventory

Endpoint **mock** que simula la futura API de inventario de la Plataforma B2B, para el **trial de Celigo** (ver `../docs/13-plan-pruebas-celigo-trial.md`).

**Qué hace:** recibe por HTTP los syncs de inventario que manda Celigo, valida el payload contra el contrato y los registra en memoria para inspección.
**Qué NO hace:** no se conecta a NetSuite ni a ningún sistema — es solo un receptor. La garantía de solo-lectura sobre NetSuite vive en el rol `Celigo Trial (Read-Only)`.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Health check (sin API key — lo usa DigitalOcean) |
| `POST` | `/api/inventory/sync` | Recibe el payload de inventario (el que configura el Import de Celigo) |
| `GET` | `/api/inventory/received` | Inspección: qué se ha recibido (últimas 100 entradas) |
| `POST` | `/admin/mode` | Fuerza el modo de respuesta: `{"mode":"ok"\|"error400"\|"error500"\|"timeout"}` — para probar reintentos/alertas de Celigo |

Todos (salvo `/health`) requieren header **`x-api-key`** = valor de `MOCK_API_KEY`.

## Contrato del payload (`POST /api/inventory/sync`)

```json
{
  "brandId": "ARIAT",
  "syncedAt": "2026-07-14T18:00:00Z",
  "positions": [
    { "sku": "10011234-085", "styleCode": "10011234", "size": "8.5",
      "warehouseCode": "LERMA", "quantity": 42 }
  ]
}
```

`styleCode`/`size`/`syncedAt` opcionales. Payload inválido → `422` con el detalle. Este contrato se reutilizará como el contrato real del endpoint de inventario del B2B.

## Correr en local

```bash
npm install
MOCK_API_KEY=un-valor-secreto npm start   # PowerShell: $env:MOCK_API_KEY='un-valor-secreto'; npm start
# → http://localhost:8080
```

## Deploy en DigitalOcean App Platform

1. Subir esta carpeta a un repo de GitHub (puede ser privado).
2. DO → **Create App** → conectar el repo → detecta Node automáticamente.
3. Run command: `npm start` · HTTP port: `8080` · Health check: `/health`.
4. Variables de entorno: **`MOCK_API_KEY`** = un secreto largo (marcarla como *encrypted*). `PORT` la inyecta DO solo.
5. Instancia **Basic ($5/mes)** es suficiente. Al terminar el trial, se borra la app.

## Uso durante el trial

- La URL pública del mock + el header `x-api-key` se configuran en el **Import HTTP de Celigo**.
- Para la prueba de manejo de errores (Fase 2 del plan): `POST /admin/mode` con `error500` o `timeout`, correr el flow en Celigo y observar reintentos/dashboard, luego regresar a `ok`.
