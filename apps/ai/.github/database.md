# Database & Pinecone — resumen

Rápido vistazo a las dependencias de datos usadas por el proyecto.

- PostgreSQL (supabase) para datos transaccionales. Cliente: `app/core/supabase_service.py`.
- Pinecone (vector DB) para búsquedas por embeddings. Cliente: `app/core/pinecone_client.py`.
- Metadatos y filtros: `app/core/vector_store.py` centraliza la construcción de filtros y top-k.

Buenas prácticas detectables en el código:

- Añadir metadata en los vectores para filtrar (p. ej. `location`, `user_id`).
- Reutilizar `vector_store`/`embedding_search` para queries en todos los servicios.

Si necesitas ejemplos SQL o shapes de tablas, pídelo y extraigo las definiciones relevantes.

# Database & Vector store (short)

- Primary infra clients live in `app/core/`:
  - `pinecone_client.py` (Pinecone index access)
  - `supabase_service.py` (Postgres/Supabase data access)
  - `vector_store.py` / `embedding_search.py` (vector query helpers)

- Pinecone usage:
  - Metadata filters are used to refine searches (see `vector_store.py`).
  - Store embeddings alongside IDs and metadata fields used in filters.

- Local testing:
  - Mock external clients in tests (see `tests/conftest.py`).

- When adding a DB operation, follow existing service patterns (service -> infra client -> model).
