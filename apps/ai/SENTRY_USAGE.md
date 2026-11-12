# Uso de Sentry en la Aplicación

## Configuración

Sentry se inicializa llamando a `init_sentry()` desde `create_application()` en `app/main.py`, leyendo la configuración de `app/core/config.py` (`Settings`):

- `SENTRY_DSN` — DSN del proyecto Sentry. **Si está vacío o no se define, Sentry queda desactivado**: el SDK nunca se inicializa y ningún evento sale del proceso. Es el comportamiento por defecto en local/desarrollo.
- `SENTRY_ENVIRONMENT` — entorno reportado (`development` por defecto; nunca `production` salvo que se configure explícitamente).
- `SENTRY_TRACES_SAMPLE_RATE` — sample rate de performance (0.1 por defecto).

Importar `app.core.sentry` no tiene efectos secundarios: la inicialización solo ocurre en `init_sentry()`. Nunca pongas un DSN real en el código ni en `.env.example` (solo placeholders vacíos).

## Uso en cualquier parte del código

### Opción 1: Importar sentry_sdk directamente (Recomendado)

```python
import sentry_sdk

# Capturar una excepción
try:
    risky_operation()
except Exception as e:
    sentry_sdk.capture_exception(e)
    # Continuar o re-raise según necesidad
```

### Opción 2: Importar desde app.core

```python
from app.core import sentry

# Capturar una excepción
try:
    risky_operation()
except Exception as e:
    sentry.sentry_sdk.capture_exception(e)
```

## Ejemplos de Uso

### 1. En un servicio

```python
"""Example service with Sentry integration."""
import sentry_sdk
from app.core import LoggerMixin

class MyService(LoggerMixin):
    async def process_data(self, data):
        try:
            result = await self._risky_operation(data)
            return result
        except Exception as e:
            self.logger.error("Operation failed", error=str(e))
            sentry_sdk.capture_exception(e)
            raise
```

### 2. Con contexto adicional

```python
import sentry_sdk

try:
    result = await process_user(user_id)
except Exception as e:
    # Agregar contexto antes de capturar
    with sentry_sdk.push_scope() as scope:
        scope.set_extra("user_id", user_id)
        scope.set_tag("operation", "process_user")
        sentry_sdk.capture_exception(e)
    raise
```

### 3. Capturar mensajes (no solo excepciones)

```python
import sentry_sdk

# Para eventos importantes que no son errores
sentry_sdk.capture_message("Usuario realizó acción crítica", level="warning")
```

### 4. En un router

```python
"""Example router with Sentry integration."""
import sentry_sdk
from fastapi import APIRouter, HTTPException

router = APIRouter()

@router.post("/process")
async def process_endpoint(data: dict):
    try:
        result = await process_data(data)
        return result
    except ValueError as e:
        # Error esperado - no enviar a Sentry
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Error inesperado - enviar a Sentry
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=500, detail="Internal error")
```

## Funciones Disponibles

### `sentry_sdk.capture_exception(exception)`

Captura una excepción y la envía a Sentry.

### `sentry_sdk.capture_message(message, level="info")`

Captura un mensaje con nivel de severidad (debug, info, warning, error, fatal).

### `sentry_sdk.push_scope()`

Crea un contexto temporal para agregar información adicional:

- `scope.set_extra(key, value)` - Datos adicionales
- `scope.set_tag(key, value)` - Tags para filtrado
- `scope.set_user({"id": user_id})` - Información de usuario

## Integración con FastAPI

Sentry está integrado con FastAPI automáticamente:

- ✅ Captura excepciones no manejadas
- ✅ Incluye información de la petición HTTP
- ✅ Rastreo de performance (traces)
- ✅ Breadcrumbs automáticos

## Buenas Prácticas

1. **Captura solo errores inesperados**: No captures `ValueError` o excepciones de validación esperadas
2. **Agrega contexto**: Usa `push_scope()` para incluir información útil (user_id, operation, etc.)
3. **Log antes de capturar**: Usa el logger para tener trazabilidad local también
4. **No captures en loops**: Evita llamar `capture_exception()` en loops de alto volumen

```python
# ✅ Bueno: Log + Sentry + Re-raise
try:
    result = await operation()
except Exception as e:
    self.logger.error("Operation failed", error=str(e), user_id=user_id)
    sentry_sdk.capture_exception(e)
    raise

# ❌ Malo: Sentry sin contexto ni log
try:
    result = await operation()
except:
    sentry_sdk.capture_exception(Exception())
```
