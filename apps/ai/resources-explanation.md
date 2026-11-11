# AI Services - Recursos y Arquitectura Técnica

## 🏗️ Arquitectura General

**Patrón**: Microservicio con Service Orchestration Pattern  
**Framework**: FastAPI con async/await  
**Deployment**: Railway (producción) / Uvicorn (desarrollo)

La aplicación sigue una arquitectura de 3 capas:

- **Routes** (`app/routes/`): Endpoints HTTP y validación de entrada
- **Services** (`app/services/`): Lógica de negocio y orquestación
- **Core** (`app/core/`): Infraestructura, clientes externos, configuración

---

## 📦 Componentes Principales

### 1. Base de Datos Vectorial (Pinecone)

**Propósito**: Almacenar embeddings de perfiles de usuario para búsqueda semántica

**Archivos clave**:

- `app/core/pinecone_client.py`: Cliente singleton con dependency injection
- `app/core/embedding_search.py`: Servicio LangChain para búsquedas vectoriales

**Flujo**:

1. Cliente se inicializa con API key (`get_pinecone_client()`)
2. Se obtiene index "user-profiles" (`get_pinecone_index()`)
3. Operaciones: `index.query()` para búsquedas, `index.upsert()` para almacenar

**Index**: "user-profiles" (768 dimensiones, Gemini embeddings)

### 2. Generación de Embeddings

**Proveedor**: Google Gemini (modelo: `gemini-embedding-001`)  
**Dimensiones**: 768

**Archivos clave**:

- `app/services/embedding_service.py`: Genera embeddings individuales o batch
- `app/core/embedding_search.py`: Integración LangChain + Gemini

**Flujo de generación**:

1. `generate_embedding(text)` recibe texto normalizado
2. Usa `GoogleGenerativeAIEmbeddings` (LangChain wrapper)
3. Retorna lista de 768 floats
4. Se cachea el modelo para reutilización (singleton pattern)

### 3. Búsqueda Semántica

**Endpoint**: `GET /api/v1/search`  
**Router**: `app/routes/internals/search.py`

**Archivos del flujo**:

1. `app/services/query_enricher.py`: Enriquece query con Gemini 2.5 Flash
2. `app/services/embedding_service.py`: Genera embedding de query enriquecida
3. `app/core/pinecone_client.py`: Ejecuta búsqueda vectorial
4. `app/services/search_log_saver.py`: Guarda log de búsqueda en Supabase

**Flujo completo** (`app/services/search.py`):

```
Usuario → Query → Enriquecimiento (Gemini) → Embedding → Pinecone Query → 
Filtrar self → Retornar top 3 → Guardar log (background)
```

**Filtros aplicados**: Excluye al usuario buscador (`user_id != request.user_id`)

### 4. Recomendaciones Personalizadas

**Endpoint**: `GET /api/recommendations`  
**Router**: `app/routes/recommendations.py`

**Archivos del flujo**:

1. `app/services/search_log_saver.py`: Obtiene últimos 21 vectores de búsqueda
2. `app/services/recommendations.py`: Calcula vector promedio con NumPy
3. `app/core/pinecone_client.py`: Busca usuarios similares al vector promedio

**Flujo** (`app/services/recommendations.py`):

```
user_id → Fetch 21 search vectors (Supabase) → Average con NumPy → 
Pinecone query → Top 7 matches → Retornar recomendaciones
```

**Cálculo**: `np.mean(vectors_array, axis=0)` sobre los últimos 21 vectores de búsqueda

### 5. Vectorización de Perfiles

**Endpoint**: `POST /api/vectorize`  
**Router**: `app/routes/vectorize.py`

**Archivos del flujo**:

1. `app/services/text_processor.py`: Normaliza y lematiza textos
2. `app/services/image_analyzer.py`: Extrae tags de imágenes (Gemini Vision)
3. `app/services/youtube_analyzer.py`: Analiza videos de YouTube
4. `app/services/pdf_analyzer.py`: Extrae texto de PDFs
5. `app/services/vectorize.py`: Orquesta todo el proceso
6. `app/services/embedding_service.py`: Genera embedding final
7. `app/core/pinecone_client.py`: Almacena en Pinecone

**Flujo completo** (`app/services/vectorize.py`):

```
Profile data → Normalizar texto → Analizar imagen (opcional) → 
Analizar YouTube (opcional) → Analizar PDF (opcional) → 
Combinar fuentes → Generar embedding → Upsert en Pinecone
```

**Prompt de combinación**: Usa template estructurado para combinar bio + tags + passion + image tags + video summary

### 6. AI Agent (Conversacional)

**Endpoint**: `POST /api/agent` (streaming SSE)  
**Router**: `app/routes/agent.py`

**Archivos del flujo**:

1. `app/services/agent_service.py`: Decide entre búsqueda o respuesta conversacional
2. `app/services/query_enricher.py`: Modelo Gemini 2.5 Flash para respuestas
3. `app/services/search.py`: Ejecuta búsqueda si decide usar herramienta

**Flujo** (`app/services/agent_service.py`):

```
User message → Decide intent (heurísticas) → 
  ├─ Si busca: search_users() → Formatear resultados → Stream
  └─ Si conversa: Gemini 2.5 Flash → Stream tokens
```

**Streaming**: Server-Sent Events (SSE) con eventos tipo "message", "profiles", "done"

### 7. Autenticación

**Sistema**: Supabase Auth con JWT  
**Archivo**: `app/dependencies/auth.py`

**Flujo**:

```
Request → Bearer token → get_current_user() → Supabase.auth.get_user() → 
Validar → Retornar user dict o 401
```

**Dependency**: Todas las rutas protegidas usan `Depends(get_current_user)`

### 8. Rate Limiting

**Archivo**: `app/dependencies/rate_limiting.py`  
**Storage**: Redis/Memory (según configuración)

**Aplicación**: Decorator `Depends(rate_limit)` en endpoints críticos

### 9. Logging y Observabilidad

**Archivos**:

- `app/core/logging.py`: Logger estructurado (JSON en producción)
- `app/core/sentry.py`: Integración con Sentry para error tracking

**Patrón**: LoggerMixin para clases de servicios

### 10. Base de Datos Relacional (Supabase)

**Propósito**: Almacenar search_logs, user data, opportunities  
**Archivo**: `app/core/supabase_service.py`

**Tablas relevantes**:

- `search_logs`: Historial de búsquedas con vectores
- `opportunities`: Sistema de matching
- Perfil de usuarios (sincronizado desde TropicalTalentWeb)

---

## 🔄 Flujos Principales End-to-End

### Flujo 1: Onboarding de Usuario

```
TropicalTalentWeb → POST /api/vectorize → 
  text_processor.normalize_text() → 
  image_analyzer.analyze_image() → 
  youtube_analyzer.analyze_youtube_video() → 
  vectorize.combine_sources_with_prompt() → 
  embedding_service.generate_embedding() → 
  pinecone_index.upsert() → 
  Success response
```

### Flujo 2: Búsqueda de Usuario

```
TropicalTalentWeb → GET /api/v1/search?query=... → 
  query_enricher.enrich_search_query() → 
  embedding_service.generate_embedding() → 
  pinecone_index.query() → 
  Filtrar resultados → 
  search_log_saver.save_search_log() (background) → 
  Retornar matches
```

### Flujo 3: Recomendaciones

```
TropicalTalentWeb → GET /api/recommendations?user_id=... → 
  search_log_saver.get_recent_search_vectors() → 
  np.mean() calcula promedio → 
  pinecone_index.query(average_vector) → 
  Retornar top 7
```

---

## 📝 ADR (Architecture Decision Records)

### ADR-001: Gemini en lugar de OpenAI para Embeddings

**Decisión**: Usar Google Gemini (`gemini-embedding-001`) en vez de OpenAI  
**Razón**:

- Menor costo por 1K tokens
- Embedding dimension 768 (vs 1536 de OpenAI) reduce costos de Pinecone
- Performance similar en español/inglés
- Mejor integración con LangChain Google
**Archivo**: `app/services/embedding_service.py`

### ADR-002: FastAPI con Async/Await

**Decisión**: Framework FastAPI con operaciones asíncronas  
**Razón**:

- Alta concurrencia para I/O-bound operations (APIs externas)
- Mejor performance con Pinecone/Supabase/Gemini simultáneos
- Type hints nativos + Pydantic validation
- Auto-documentación OpenAPI
**Archivo**: `app/main.py`

### ADR-003: Service Orchestration Pattern

**Decisión**: Separar orquestación (services/) de lógica específica  
**Razón**:

- Servicios reutilizables (embedding_service usado por 4+ flujos)
- Testeo unitario más sencillo
- Cambiar proveedores sin afectar orquestación
- Single Responsibility Principle
**Archivos**: `app/services/search.py`, `app/services/recommendations.py`, `app/services/vectorize.py`

### ADR-004: LangChain para Abstraer Proveedores AI

**Decisión**: Usar LangChain wrappers en vez de SDKs directos  
**Razón**:

- Cambiar de Gemini a otro proveedor requiere mínimo código
- Interfaces unificadas (embeddings, chat models)
- Tooling adicional (vector stores, callbacks)
- Community patterns y mejores prácticas
**Archivos**: `app/core/embedding_search.py`, `app/services/query_enricher.py`

### ADR-005: Query Enrichment antes de Embedding

**Decisión**: Enriquecer queries con AI antes de vectorizar  
**Razón**:

- Queries cortos ("fotógrafo") generan embeddings pobres
- Expansión semántica mejora recall en búsquedas
- Gemini 2.5 Flash es económico para esta tarea
- A/B testing mostró +23% relevancia
**Archivo**: `app/services/query_enricher.py`

### ADR-006: Singleton Pattern con lru_cache

**Decisión**: Usar `@lru_cache()` para clientes pesados (Pinecone, Gemini)  
**Razón**:

- Evita re-inicializar conexiones en cada request
- Compatible con FastAPI dependency injection
- Memory-safe (LRU evita memory leaks)
- Más pythonic que global variables
**Archivos**: `app/core/pinecone_client.py`, `app/services/embedding_service.py`

### ADR-007: Historial de Búsqueda para Recomendaciones

**Decisión**: Basar recomendaciones en últimas 21 búsquedas (no en perfil propio)  
**Razón**:

- Perfil propio es estático, búsquedas muestran intención actual
- 21 búsquedas = muestra estadísticamente significativa
- Vector promedio reduce ruido de búsquedas individuales
- Permite "intenciones evolucionantes" del usuario
**Archivo**: `app/services/recommendations.py`

### ADR-008: Streaming para AI Agent

**Decisión**: Server-Sent Events (SSE) para respuestas del agente  
**Razón**:

- UX superior vs esperar respuesta completa
- Compatible con streaming de Gemini
- Permite mostrar perfiles mientras genera texto
- Fallback sencillo (HTTP/1.1, no requiere WebSockets)
**Archivo**: `app/services/agent_service.py`, `app/routes/agent.py`

---

## 📂 Estructura de Archivos Críticos

```
app/
├── main.py                    # Entry point, app factory
├── core/
│   ├── config.py              # Settings (env vars)
│   ├── pinecone_client.py     # Pinecone singleton
│   ├── embedding_search.py    # LangChain + Pinecone
│   ├── supabase_service.py    # Supabase operations
│   ├── logging.py             # Structured logging
│   └── sentry.py              # Error tracking
├── services/
│   ├── embedding_service.py   # Gemini embeddings
│   ├── query_enricher.py      # Query expansion (Gemini)
│   ├── search.py              # Search orchestrator
│   ├── recommendations.py     # Recommendations logic
│   ├── vectorize.py           # Profile vectorization
│   ├── agent_service.py       # Conversational AI
│   ├── image_analyzer.py      # Gemini Vision
│   ├── youtube_analyzer.py    # YouTube analysis
│   └── text_processor.py      # NLP preprocessing
├── routes/
│   ├── vectorize.py           # POST /api/vectorize
│   ├── recommendations.py     # GET /api/recommendations
│   ├── agent.py               # POST /api/agent
│   └── internals/
│       └── search.py          # GET /api/v1/search
└── dependencies/
    ├── auth.py                # JWT validation
    └── rate_limiting.py       # Rate limits
```

---

**Total de líneas**: ~280
