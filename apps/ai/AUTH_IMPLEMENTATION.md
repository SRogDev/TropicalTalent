# Implementación de Autenticación y Rate Limiting

## 🔐 Autenticación con Supabase

### Dependency Creada: `app/dependencies/auth.py`

```python
"""Authentication dependency for protected endpoints."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client

from app.core.config import get_settings

security = HTTPBearer()


def get_supabase_client():
    """Get Supabase client instance."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    Validate user authentication token and return user data.

    Args:
        credentials: HTTP Bearer token from request header

    Returns:
        dict: User data from Supabase auth

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        token = credentials.credentials
        supabase = get_supabase_client()
        user = supabase.auth.get_user(token)

        if not user or not user.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )
        return user.user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication error: {str(e)}",
        )
```

---

## 📊 Estado de Autenticación por Endpoint

| Endpoint | Auth Requerida | Rate Limiting | Sentry Integration |
|----------|----------------|---------------|-------------------|
| `/vectorize` | ✅ Sí | ✅ Sí | ✅ Sí |
| `/recommendations` | ✅ Sí | ✅ Sí | ✅ Sí |
| `/api/agent` | ✅ Sí | ✅ Sí | ✅ Sí |
| `/internals/search` | ❌ No (Interno) | ✅ Sí | ✅ Sí |

---

## 🔒 Endpoints con Autenticación

### 1. `/vectorize` (POST)

```python
@router.post("/vectorize", response_model=VectorizeProfileResponse)
async def vectorize(
    user_id: str = Form(...),
    profile_json: str = Form(...),
    youtube_url: Optional[str] = Form(None),
    image_file: Optional[UploadFile] = File(None),
    pdf_file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),  # ✅ Auth
    _rl: None = Depends(rate_limit),                 # ✅ Rate limiting
) -> VectorizeProfileResponse:
```

**Descripción:** Vectoriza el perfil de usuario con análisis opcional de YouTube/imagen.

**Auth:** ✅ Requerida - Solo usuarios autenticados pueden vectorizar perfiles.

**Sentry:** Captura user_id y authenticated_user en errores.

---

### 2. `/recommendations` (GET)

```python
@router.get("/recommendations", response_model=RecommendationsResponse)
async def recommendations(
    user_id: str,
    current_user: dict = Depends(get_current_user),  # ✅ Auth
    _rl: None = Depends(rate_limit),                 # ✅ Rate limiting
) -> RecommendationsResponse:
```

**Descripción:** Obtiene recomendaciones personalizadas basadas en el perfil del usuario.

**Auth:** ✅ Requerida - Solo usuarios autenticados pueden obtener recomendaciones.

**Sentry:** Captura user_id y authenticated_user en errores.

---

### 3. `/api/agent` (POST)

```python
@router.post("/agent")
async def agent_endpoint(
    payload: AgentRequest,
    current_user: dict = Depends(get_current_user),  # ✅ Auth
    _rl: None = Depends(rate_limit),                 # ✅ Rate limiting
):
```

**Descripción:** Streaming SSE para respuestas del agente AI.

**Auth:** ✅ Requerida - Solo usuarios autenticados pueden usar el agente.

**Sentry:** Captura authenticated_user y query en errores.

---

### 4. `/internals/search` (GET)

```python
@router.get("/search", response_model=SearchResponse)
async def search(
    user_id: str,
    query: str,
    _rl: None = Depends(rate_limit),  # ✅ Rate limiting
) -> SearchResponse:
```

**Descripción:** Búsqueda semántica de usuarios (endpoint interno).

**Auth:** ❌ NO requerida - Endpoint interno para servicios backend.

**Sentry:** Captura user_id en errores.

---

## 🚀 Cómo Usar la Autenticación

### Desde el Cliente (Frontend/Mobile)

**1. Obtener token de Supabase:**

```javascript
const { data: { session } } = await supabase.auth.getSession()
const token = session.access_token
```

**2. Hacer request con Authorization header:**

```javascript
fetch('https://api.tropicaltalent.com/vectorize', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ /* data */ })
})
```

### Respuestas de Error de Autenticación

```json
// 401 Unauthorized - Token inválido o expirado
{
  "detail": "Invalid or expired token"
}

// 401 Unauthorized - Error de autenticación
{
  "detail": "Authentication error: <mensaje específico>"
}
```

---

## ⚙️ Rate Limiting

Todos los endpoints tienen rate limiting configurado:

```python
from app.dependencies.rate_limiting import rate_limit

@router.post("/endpoint")
async def endpoint(_rl: None = Depends(rate_limit)):
    # El endpoint está protegido por rate limiting
    pass
```

**Configuración:** Ver `app/core/config.py`

```python
rate_limit_per_minute: int = Field(
    default=60,
    ge=1,
    description="Rate limit for API requests per minute per user"
)
```

---

## 🔧 Integración con Sentry

Todos los endpoints capturan excepciones con contexto adicional:

```python
except Exception as e:
    with sentry_sdk.push_scope() as scope:
        scope.set_extra("endpoint", "vectorize")
        scope.set_extra("user_id", user_id)
        scope.set_extra("authenticated_user", current_user.get("id"))
        sentry_sdk.capture_exception(e)
    raise HTTPException(...)
```

**Beneficios:**

- Contexto completo en Sentry
- Trazabilidad de errores por usuario
- Mejor debugging en producción

---

## 📝 Checklist de Implementación

- [x] ✅ Dependency `auth.py` creada con Supabase
- [x] ✅ Auth agregada a `/vectorize`
- [x] ✅ Auth agregada a `/recommendations`
- [x] ✅ Auth agregada a `/api/agent`
- [x] ✅ `/internals/search` sin auth (correcto para interno)
- [x] ✅ Rate limiting en todos los endpoints
- [x] ✅ Sentry integration con contexto de usuario

---

## 🧪 Testing

### Test Manual con curl

```bash
# Sin token (debería fallar con 401)
curl -X POST https://api.tropicaltalent.com/vectorize \
  -H "Content-Type: application/json" \
  -d '{"user_id": "123", "profile": {...}}'

# Con token válido (debería funcionar)
curl -X POST https://api.tropicaltalent.com/vectorize \
  -H "Authorization: Bearer <supabase_token>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "123", "profile": {...}}'
```

### Test con Python

```python
import requests

# Obtener token de Supabase primero
token = "your_supabase_jwt_token"

# Request autenticado
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

response = requests.post(
    "https://api.tropicaltalent.com/vectorize",
    headers=headers,
    json={"user_id": "123", "profile": {...}}
)

print(response.status_code)  # 200 OK
print(response.json())
```

---

## 🔐 Seguridad

### Variables de Entorno Requeridas

```bash
# .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Best Practices

1. **Nunca hardcodear tokens** - Usar variables de entorno
2. **Validar tokens en cada request** - Dependency injection asegura esto
3. **Usar HTTPS en producción** - Tokens nunca en HTTP plano
4. **Rate limiting activo** - Prevenir abuso
5. **Sentry monitoring** - Detectar intentos de acceso no autorizado

---

## 📚 Referencias

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
