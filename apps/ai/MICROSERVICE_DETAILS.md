# TropicalTalent AI Microservice - Product Overview

## 🎯 Purpose

This AI-powered microservice provides intelligent search, matching, and recommendation capabilities for the TropicalTalent creative freelance marketplace platform. It enables smart discovery of creative professionals by understanding natural language queries and analyzing user profiles to find the best matches.

## 🚀 Core Functionality

### 1. **Semantic Profile Vectorization** (`/vectorize`)

Transforms user profiles into AI-searchable vector representations by:

- Analyzing profile text content (bio, skills, experience)
- Processing YouTube portfolio videos (content analysis)
- Extracting semantic meaning from uploaded images
- Creating rich embeddings for intelligent matching
- Storing vectors in Pinecone for fast similarity search

**Business Value**: Enables AI-powered discovery beyond simple keyword matching.

### 2. **Smart Recommendations** (`/recommendations`)

Provides personalized creative talent recommendations by:

- Understanding natural language search queries
- Enriching queries with contextual information
- Performing vector similarity search against all profiles
- Ranking and filtering results by relevance
- Supporting multi-opportunity batch recommendations

**Business Value**: Helps clients find the perfect creative professionals even with vague or complex requirements.

### 3. **AI Agent Interface** (`/api/agent`)

Intelligent conversational assistant that:

- Understands client needs in natural language
- Provides context-aware responses about available talent
- Guides users through the discovery process
- Generates tailored recommendations based on conversation context

**Business Value**: Reduces friction in the hiring process with AI-assisted discovery.

### 4. **Internal Search** (`/internals/search`)

Backend search functionality for platform operations:

- Direct vector similarity search
- Batch processing capabilities
- Performance-optimized queries for system integrations

**Business Value**: Powers other platform features with reliable search infrastructure.

## 🔧 Technical Architecture

- **Framework**: FastAPI (Python) - High-performance async API
- **AI Models**: Google Gemini for content analysis and embeddings
- **Vector Database**: Pinecone for semantic search
- **Authentication**: Supabase JWT Bearer tokens
- **Data Storage**: Supabase PostgreSQL
- **Monitoring**: Sentry error tracking
- **Rate Limiting**: Built-in request throttling

## 🔒 Security

- **Authentication**: All public endpoints require valid JWT tokens from Supabase
- **Authorization**: User-specific operations validated against Supabase auth
- **Rate Limiting**: Prevents abuse and ensures fair resource usage
- **Service Key Protection**: Internal operations use service role keys

## 📊 Key Endpoints

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/vectorize` | POST | Convert profile to searchable vectors | ✅ Yes |
| `/recommendations` | POST | Get AI-powered talent matches | ✅ Yes |
| `/api/agent` | POST | Conversational AI assistant | ✅ Yes |
| `/internals/search` | POST | Internal search operations | ❌ No (Internal) |
| `/health` | GET | Service health check | ❌ No |

## 🎯 Use Cases

1. **Client Discovery**: "Find a jazz saxophonist in London with experience in live events"
2. **Profile Enhancement**: Automatically analyze and vectorize new user profiles
3. **Smart Matching**: Connect opportunities with relevant creative professionals
4. **Conversational Search**: Natural language interaction for finding talent
5. **Batch Processing**: Generate recommendations for multiple opportunities at once

## 🔄 Integration Flow

```
Client Request → Frontend (TropicalTalentWeb) → TropicalTalent AI Microservice → Pinecone/Supabase → Response
```

1. User searches for talent in the frontend
2. Request sent to AI microservice with JWT token
3. Query enriched and converted to vector embedding
4. Semantic search performed in Pinecone
5. Results enriched with profile data from Supabase
6. Ranked recommendations returned to frontend

## 📈 Performance Characteristics

- **Response Time**: ~200-500ms for typical recommendations
- **Concurrent Requests**: Handles 100+ simultaneous requests
- **Vector Search**: Sub-second similarity search across 10,000+ profiles
- **Caching**: Intelligent caching reduces API calls and improves speed

## 🛠️ Dependencies

- Python 3.12+
- FastAPI & Uvicorn
- Google Generative AI (Gemini)
- Pinecone Vector Database
- Supabase Client
- Sentry SDK
- Structlog for logging

## 🚀 Deployment

- **Environment**: Production on Railway/Heroku
- **Port**: 8000 (configurable)
- **Process Manager**: Gunicorn with Uvicorn workers
- **Health Monitoring**: Built-in health endpoint for uptime checks
- **Auto-scaling**: Configured for demand-based scaling

## 📝 Testing

The microservice includes comprehensive test coverage:

- Unit tests for individual services
- Integration tests for API endpoints
- Authentication and authorization tests
- Error handling and edge case validation

Located in: `/tests/`

---

**Last Updated**: January 2026  
**Version**: 0.1.0  
**API Documentation**: Available at `/docs` (Swagger UI) when running in development mode
