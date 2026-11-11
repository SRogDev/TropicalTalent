# LLMs & Embeddings — notas rápidas

Dónde y cómo se usan los modelos en el proyecto:

- Generación de embeddings: `creative/services/embedding_service.py`.
- Búsqueda semántica: `app/core/embedding_search.py` y `app/core/vector_store.py`.
- Orquestación de prompts/generación (si existe) vive en `creative/services/*`.

Puntos prácticos:

- Cachea embeddings cuando sea posible (ver `app/core/user_vector_cache.py`).
- Mantén llamadas a modelos en servicios y usa DI para poder mockear en tests.

Si necesitas el listado exacto de proveedores o modelos instanciados, puedo extraerlos de `app/core/config.py`.

# LLM & embeddings (short)

- Primary LLM/embedding logic lives in `creative/services/` and `app/core/embedding_search.py`.
- Use the project embedding service: `creative/services/embedding_service.py` for generation and caching.
- LangChain / Google Generative AI patterns (if present) should follow singleton initialization and be wrapped in service classes.

Notes

- Keep prompts and model selection out of routers; put them in services or helpers.
- Cache embeddings and reuse where possible (see `app/core/user_vector_cache.py`).

# LLM Usage Guide - TropicalTalent AI Backend

## 🤖 LLM Provider: Google Gemini

This project uses **Google Gemini** as the exclusive LLM provider for all AI operations.

**Why Gemini?**

- Cost-effective for high-volume operations
- Fast response times
- Excellent multilingual support
- Integrated with Google AI ecosystem

---

## 📦 Available Gemini Models

### 1. **Gemini 2.0 Flash** (Recommended for most tasks)

**Use for:**

- Query enrichment
- Text analysis
- Tag extraction
- General text processing
- Real-time operations

**Characteristics:**

- ⚡ Fastest response time
- 💰 Most cost-effective
- 📝 Good for short-to-medium tasks
- 🎯 Best for production workloads

**Model ID**: `gemini-2.0-flash-exp`

```python
# Example usage
model = genai.GenerativeModel("gemini-2.0-flash-exp")
response = model.generate_content(prompt)
```

### 2. **Gemini 1.5 Pro** (For complex reasoning)

**Use for:**

- Complex analysis requiring deep reasoning
- Long document processing
- Multi-step reasoning tasks
- When accuracy is more important than speed

**Characteristics:**

- 🧠 Better reasoning capabilities
- 📚 Larger context window
- ⏱️ Slower than Flash
- 💰 More expensive

**Model ID**: `gemini-1.5-pro`

```python
# Example usage for complex tasks
model = genai.GenerativeModel("gemini-1.5-pro")
response = model.generate_content(long_complex_prompt)
```

### 3. **Text Embedding (embeddings-004)**

**Use for:**

- Generating embeddings for semantic search
- Vectorizing user profiles
- Query vectorization

**Characteristics:**

- 📊 1536-dimensional vectors
- 🎯 Optimized for semantic similarity
- ⚡ Fast embedding generation
- 💰 Cost-effective for bulk operations

**Model ID**: `models/text-embedding-004`

```python
# Example usage
result = genai.embed_content(
    model="models/text-embedding-004",
    content=text,
    task_type="retrieval_document"
)
embedding = result['embedding']
```

---

## 🎯 Usage Decision Tree

```
Need to process text?
├─ Generating embeddings/vectors?
│  └─ Use: text-embedding-004
│
├─ Simple task (enrichment, tagging, summaries)?
│  └─ Use: gemini-2.0-flash-exp
│
└─ Complex reasoning (multi-step, long context)?
   └─ Use: gemini-1.5-pro
```

---

## � LangChain Integration (MANDATORY)

**All AI model initialization MUST use LangChain**, not direct `google.generativeai` imports.

**Why LangChain?**

- ✅ Consistent interface across all AI operations
- ✅ Better async support with `ainvoke()` and `aembed_documents()`
- ✅ Easier testing with mocks
- ✅ Standard patterns for model management
- ✅ Built-in retry and error handling

### Required Import Pattern

```python
# ✅ CORRECT - Use LangChain wrappers
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings

# ❌ WRONG - Don't use direct SDK
import google.generativeai as genai  # Only for image/video analysis
```

### Singleton Pattern (MANDATORY)

**All services MUST use singleton pattern for model initialization to avoid repeated API calls.**

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from app.core.config import get_settings

# Global singleton instance
_gemini_chat_model = None

def get_gemini_chat_model() -> ChatGoogleGenerativeAI:
    """
    Get singleton instance of Gemini chat model.

    Returns:
        ChatGoogleGenerativeAI: Configured Gemini 2.0 Flash model
    """
    global _gemini_chat_model
    if _gemini_chat_model is None:
        settings = get_settings()
        _gemini_chat_model = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-exp",
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            max_output_tokens=200,
        )
    return _gemini_chat_model
```

### Chat Model Usage (Text Generation)

```python
# app/creative/services/query_enricher.py
from langchain_google_genai import ChatGoogleGenerativeAI

_gemini_model = None

def get_gemini_chat_model() -> ChatGoogleGenerativeAI:
    global _gemini_model
    if _gemini_model is None:
        settings = get_settings()
        _gemini_model = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-exp",
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            max_output_tokens=200,
        )
    return _gemini_model

async def enrich_search_query(query: str) -> str:
    """Enrich query using LangChain."""
    model = get_gemini_chat_model()

    prompt = f"""Enrich this search query: {query}"""

    # Use ainvoke for async operations
    response = await model.ainvoke(prompt)

    # Access response content
    enriched_query = response.content.strip()
    return enriched_query
```

### Embedding Model Usage (Vector Generation)

```python
# app/creative/services/embedding_service.py
from langchain_google_genai import GoogleGenerativeAIEmbeddings

_embedding_model = None

def get_embedding_model() -> GoogleGenerativeAIEmbeddings:
    global _embedding_model
    if _embedding_model is None:
        settings = get_settings()
        _embedding_model = GoogleGenerativeAIEmbeddings(
            model="models/text-embedding-004",
            google_api_key=settings.gemini_api_key,
            task_type="retrieval_document"
        )
    return _embedding_model

async def generate_embedding(text: str) -> list[float]:
    """Generate embedding using LangChain."""
    model = get_embedding_model()

    # Use aembed_query for single text
    embedding = await model.aembed_query(text)

    return embedding

async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts."""
    model = get_embedding_model()

    # Use aembed_documents for batch
    embeddings = await model.aembed_documents(texts)

    return embeddings
```

### LangChain Method Reference

| Operation | Sync Method | Async Method | Use Case |
|-----------|-------------|--------------|----------|
| **Chat** | `invoke(prompt)` | `ainvoke(prompt)` | Single text generation |
| **Chat Stream** | `stream(prompt)` | `astream(prompt)` | Streaming response |
| **Embed Single** | `embed_query(text)` | `aembed_query(text)` | Single embedding |
| **Embed Batch** | `embed_documents(texts)` | `aembed_documents(texts)` | Multiple embeddings |

### Response Format Differences

```python
# Direct SDK (google.generativeai) - DON'T USE
response = model.generate_content(prompt)
result = response.text  # ❌ Old way

# LangChain (ChatGoogleGenerativeAI) - USE THIS
response = await model.ainvoke(prompt)
result = response.content  # ✅ Correct way
```

### When to Use LangChain (ALWAYS)

**ALWAYS use LangChain for ALL Gemini operations**, including multimodal (image/video).

| Use Case | Library | Reason |
|----------|---------|--------|
| **Text Generation** | LangChain (`ChatGoogleGenerativeAI`) | Standard, testable, async |
| **Embeddings** | LangChain (`GoogleGenerativeAIEmbeddings`) | Standard, testable, async |
| **Image Analysis** | LangChain (`ChatGoogleGenerativeAI`) | Gemini IS multimodal - supports images |
| **YouTube/Video Analysis** | LangChain (`ChatGoogleGenerativeAI`) | Gemini IS multimodal - supports video |

**Gemini is natively multimodal** - it can process text, images, and video in the same model.
Use `HumanMessage` with content array to send multimodal inputs.

### Configuration Best Practices

```python
# ✅ GOOD - Configure at initialization
model = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash-exp",
    google_api_key=settings.gemini_api_key,
    temperature=0.7,
    max_output_tokens=200,
    top_p=0.8,
)

# ❌ BAD - Don't configure per request
model = ChatGoogleGenerativeAI(model="gemini-2.0-flash-exp")
response = model.invoke(prompt, config={"temperature": 0.7})  # Wrong!
```

---

## �📋 Use Cases by Service

### Query Enrichment (`query_enricher.py`)

**Model**: `ChatGoogleGenerativeAI` with `gemini-2.0-flash-exp`
**Reason**: Fast, simple text expansion task with LangChain async support

```python
from langchain_google_genai import ChatGoogleGenerativeAI

model = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash-exp",
    google_api_key=settings.gemini_api_key,
    temperature=0.7,
)
response = await model.ainvoke(prompt)
```

### Image Analysis (`image_analyzer.py`)

**Model**: LangChain `ChatGoogleGenerativeAI` with `gemini-2.0-flash-exp`
**Reason**: Gemini IS multimodal - supports images through LangChain

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
import base64

model = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash-exp",
    google_api_key=settings.gemini_api_key,
)

# Multimodal message with image
image_base64 = base64.b64encode(image_bytes).decode('utf-8')
message = HumanMessage(
    content=[
        {"type": "text", "text": "Analyze this image"},
        {"type": "image_url", "image_url": f"data:image/jpeg;base64,{image_base64}"}
    ]
)
response = await model.ainvoke([message])
```

### YouTube Analysis (`youtube_analyzer.py`)

**Model**: LangChain `ChatGoogleGenerativeAI` with `gemini-1.5-pro`
**Reason**: Gemini IS multimodal - supports video through LangChain

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

# Use Pro for better video understanding
model = ChatGoogleGenerativeAI(
    model="gemini-1.5-pro",
    google_api_key=settings.gemini_api_key,
)

# Multimodal message with video URL
message = HumanMessage(
    content=[
        {"type": "text", "text": "Analyze this video"},
        {"type": "text", "text": f"Video URL: {youtube_url}"}
    ]
)
response = await model.ainvoke([message])
```

### Embedding Generation (`embedding_service.py`)

**Model**: `GoogleGenerativeAIEmbeddings` with `text-embedding-004`
**Reason**: LangChain provides excellent async support for embeddings

```python
from langchain_google_genai import GoogleGenerativeAIEmbeddings

model = GoogleGenerativeAIEmbeddings(
    model="models/text-embedding-004",
    google_api_key=settings.gemini_api_key,
)
embedding = await model.aembed_query(text)
```

---

## ⚙️ Configuration

### Environment Variables

```env
# Google AI/Gemini API Key
GOOGLE_API_KEY=your_google_api_key_here

# Alternative if using both
GEMINI_API_KEY=your_gemini_api_key_here
```

### Client Initialization

```python
import google.generativeai as genai
from app.core.config import get_settings

settings = get_settings()
genai.configure(api_key=settings.google_api_key)
```

---

## 🚫 What NOT to Use

### ❌ OpenAI Models (GPT-3.5, GPT-4, text-embedding-ada-002)

**Reason**: Not our LLM provider

```python
# ❌ WRONG - Don't use OpenAI
from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(...)
```

### ❌ Anthropic Claude

**Reason**: Not our LLM provider

### ❌ Other Embedding Models

**Reason**: We standardize on Gemini embeddings for consistency

---

## 💡 Best Practices

### 1. Always Use Structured Prompts

```python
# ✅ GOOD - Clear, structured prompt
prompt = """Task: Extract tags from image
Requirements:
- Return 5-10 relevant tags
- Focus on visual elements
- Use simple, clear terms

Image description: {description}
"""

# ❌ BAD - Vague prompt
prompt = "tell me about this image"
```

### 2. Set Appropriate Generation Config

```python
# For deterministic results
generation_config = {
    "temperature": 0.3,
    "top_p": 0.8,
    "top_k": 40,
    "max_output_tokens": 200,
}

# For creative results
generation_config = {
    "temperature": 0.9,
    "top_p": 0.95,
    "max_output_tokens": 500,
}
```

### 3. Handle Errors Gracefully

```python
try:
    model = genai.GenerativeModel("gemini-2.0-flash-exp")
    response = model.generate_content(prompt)
    result = response.text
except Exception as e:
    logger.error(f"Gemini API error: {str(e)}")
    # Fallback or return error
    result = None
```

### 4. Use Safety Settings When Needed

```python
from google.generativeai.types import HarmCategory, HarmBlockThreshold

safety_settings = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
}

model = genai.GenerativeModel(
    "gemini-2.0-flash-exp",
    safety_settings=safety_settings
)
```

---

## 📊 Performance Considerations

### Embedding Generation

- **Batch operations**: Process multiple texts in parallel
- **Caching**: Cache embeddings for frequently accessed content
- **Rate limiting**: Respect API rate limits

### Text Generation

- **Token limits**: Monitor token usage to avoid cutoffs
- **Streaming**: Use streaming for long responses
- **Timeout**: Set reasonable timeouts (10-30 seconds)

---

## 🔧 Migration Checklist

If you find OpenAI/GPT code:

- [ ] Replace `openai` imports with `google.generativeai`
- [ ] Change model from `gpt-4o-mini` → `gemini-2.0-flash-exp`
- [ ] Change model from `gpt-4` → `gemini-1.5-pro`
- [ ] Update API calls to Gemini format
- [ ] Update error handling for Gemini exceptions
- [ ] Test thoroughly

---

## 📚 Additional Resources

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Python SDK Reference](https://ai.google.dev/tutorials/python_quickstart)
- [Model Comparison](https://ai.google.dev/models/gemini)

---

**Last Updated**: November 2025
**Maintained by**: TropicalTalent AI Team
