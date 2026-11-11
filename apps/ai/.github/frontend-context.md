# Frontend context (very short)

- No frontend source in this repo. Frontend teams should call the HTTP APIs defined in `creative/routers/`.
- Use JSON shapes defined by Pydantic models in `creative/models/`.
- CORS configured in `app/core/cors.py` — ensure allowed origins are set in config for local dev.
- Pagination and search responses follow `top_k` / `cursor` patterns used in search endpoints.

# Frontend Context - TropicalTalent AI Microservice Integration

> Contextual documentation for AI microservice backend development. This document describes the TropicalTalent frontend application, its data flows, and the integration points with AI-powered endpoints.

---

## 📋 Table of Contents

1. [What is TropicalTalent?](#what-is-tropicaltalent)
2. [User Data Structure](#user-data-structure)
3. [AI Microservice Endpoints](#ai-microservice-endpoints)
   - [1. Search Endpoint](#1-search-endpoint)
   - [2. Vectorize Endpoint](#2-vectorize-endpoint)
   - [3. Recommendations Endpoint](#3-recommendations-endpoint)
4. [Error Handling & Fallbacks](#error-handling--fallbacks)
5. [Environment Variables](#environment-variables)
6. [Data Flow Diagrams][def]

---

## 🎯 What is TropicalTalent?

**TropicalTalent** is a specialized networking and collaboration marketplace connecting creative talent (musicians, artists, DJs, producers) with businesses (brands, venues, agencies, labels) across the United Kingdom.

### Core Features

- **User Profiles**: Rich profiles with bio, passion, location, tags (skills/genres), media (YouTube/SoundCloud)
- **Discovery Feed**: Personalized recommendations ("For You") and chronological new user listings ("New Creatives")
- **Search**: Real-time search by username, tags, bio, passion, location
- **Connections**: Send connection requests, chat in real-time via Supabase
- **Events**: Discover music events, gigs, and opportunities

### User Types

1. **Creatives** (Musicians, Artists, DJs, Producers)
   - Showcase portfolios and skills
   - Find collaboration opportunities
   - Connect with other creatives and businesses

### Technology Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript 5
- **Database**: PostgreSQL (Supabase)
- **Realtime**: Supabase Realtime (WebSocket)
- **Storage**: Supabase Storage (avatars, media)
- **Authentication**: Supabase Auth (email/password + OAuth)
- **AI Backend**: Microservice with vector search and recommendations

---

## 📊 User Data Structure

### Database Schema (PostgreSQL)

**Table: `creative_data`**

```sql
CREATE TABLE creative_data (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id),
  username TEXT NOT NULL UNIQUE,
  bio TEXT,
  avatar TEXT,
  location TEXT,
  passion TEXT,
  tags JSONB,              -- Array of strings: ["guitar", "rock", "producer"]
  video TEXT,              -- YouTube URL
  audio TEXT,              -- SoundCloud URL
  availability JSONB,      -- Array of strings: ["full-time", "freelance"]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### TypeScript Interface

```typescript
interface UserProfile {
  id: string; // UUID
  user_id: string; // UUID (same as id)
  username: string; // Display name
  bio: string; // Short description (max 500 chars)
  avatar: string; // Supabase Storage URL or external URL
  location: string; // City/Region (e.g., "London, UK")
  passion: string; // Main skill/role (e.g., "Jazz Vocalist & Composer")
  tags: string[]; // Skills, genres, instruments (e.g., ["guitar", "rock", "producer"])
  video?: string; // YouTube URL (optional)
  audio?: string; // SoundCloud URL (optional)
  availability: string[]; // Work status (e.g., ["full-time", "freelance", "part-time"])
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}
```

### Example User Data

```json
{
  "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "user_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "username": "Sarah Johnson",
  "bio": "Professional jazz vocalist with 10+ years experience. Available for studio sessions, live performances, and collaborations.",
  "avatar": "https://example.supabase.co/storage/v1/object/public/avatars/user-123.jpg",
  "location": "Manchester, UK",
  "passion": "Jazz Vocalist & Composer",
  "tags": ["jazz", "vocals", "composer", "piano", "live-performance"],
  "video": "https://youtube.com/watch?v=abc123",
  "audio": "https://soundcloud.com/user/track",
  "availability": ["freelance", "part-time"],
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-11-14T08:45:00Z"
}
```

---

## 🤖 AI Microservice Endpoints

### Base URL

```
NEXT_PUBLIC_AI_MICROSERVICE_URL=https://your-ai-backend.com
```

All endpoints use JSON for request/response bodies and require `Content-Type: application/json` header.

---

### 1. Search Endpoint

**Purpose**: Real-time semantic search across user profiles using vector similarity.

#### Endpoint

```
POST /search
```

#### When It's Called

- User types in the search bar on `/create` page
- After 500ms debounce delay (user stops typing)
- When clicking search suggestions
- Triggered by `useSearchStore.performSearch(query)` in Zustand state

#### Process Flow (Frontend)

1. **User Action**: User types in search input (`components/create/searcher.tsx`)
2. **Debounce**: Wait 500ms after last keystroke (`useDebounce` hook)
3. **State Update**: Zustand store sets `isSearching: true`
4. **API Call**: Frontend makes fetch request to AI microservice
5. **Display Results**: Results displayed in `feed-presentation.tsx` replacing default feed

#### Request Body

```json
{
  "query": "jazz vocalist london",
  "limit": 21,
  "offset": 0,
  "filters": {
    "location": "London, UK", // Optional
    "tags": ["jazz", "vocals"], // Optional
    "availability": ["freelance"] // Optional
  }
}
```

#### Expected Response (Success)

```json
{
  "results": [
    {
      "id": "uuid-1",
      "username": "Sarah Johnson",
      "avatar": "https://...",
      "bio": "Professional jazz vocalist...",
      "passion": "Jazz Vocalist & Composer",
      "location": "Manchester, UK",
      "similarity_score": 0.92
    },
    {
      "id": "uuid-2",
      "username": "Marcus Williams",
      "avatar": "https://...",
      "bio": "Jazz pianist and composer...",
      "passion": "Jazz Pianist",
      "location": "London, UK",
      "similarity_score": 0.87
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 21
}
```

#### Expected Response (Error)

```json
{
  "error": "Search service unavailable",
  "code": "SEARCH_ERROR",
  "timestamp": "2024-11-14T10:30:00Z"
}
```

#### Frontend Handling

```typescript
// store/search-store.ts
performSearch: async (query: string) => {
  set({ isSearching: true, searchError: null });

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_AI_MICROSERVICE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 21 }),
    });

    if (!response.ok) {
      throw new Error('Search failed');
    }

    const data = await response.json();
    set({ searchResults: data.results, isSearching: false });
  } catch (error) {
    set({ searchError: 'Search failed. Please try again.', isSearching: false });
  }
};
```

#### Fallback Strategy

If search endpoint fails:

1. Show error toast to user: "Search temporarily unavailable"
2. Keep displaying current feed (don't clear it)
3. Allow user to retry search

---

### 2. Vectorize Endpoint

**Purpose**: Convert user profile data into vector embeddings for semantic search and recommendations.

#### Endpoint

```
POST /user-vectorize
```

#### When It's Called

- **After user completes onboarding** (new account created)
- **When user updates profile** (edit bio, tags, passion, location)
- Called from `services/users/update-full-user-data.ts`
- **Non-blocking operation** (doesn't fail user update if vectorization fails)

#### Process Flow (Frontend)

1. **User Action**: User clicks "Save Changes" on profile edit
2. **Update Database**: Profile data saved to PostgreSQL (`creative_data` table)
3. **Update Avatar**: If new avatar uploaded, save to Supabase Storage
4. **Vectorize Call**: Send updated profile data to AI microservice (async, non-blocking)
5. **Success Response**: User sees success toast, profile updated
6. **Error Handling**: If vectorization fails, log error but don't show to user

#### Request Body

```json
{
  "user_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "username": "Sarah Johnson",
  "bio": "Professional jazz vocalist with 10+ years experience...",
  "location": "Manchester, UK",
  "passion": "Jazz Vocalist & Composer",
  "tags": ["jazz", "vocals", "composer", "piano", "live-performance"]
}
```

#### Expected Response (Success)

```json
{
  "user_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "vectorized": true,
  "embedding_dimensions": 1536,
  "timestamp": "2024-11-14T10:30:00Z"
}
```

#### Expected Response (Error)

```json
{
  "error": "Failed to generate embeddings",
  "code": "VECTORIZE_ERROR",
  "user_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "timestamp": "2024-11-14T10:30:00Z"
}
```

#### Frontend Handling

```typescript
// services/users/update-full-user-data.ts
try {
  const vectorizeResponse = await fetch(
    `${process.env.NEXT_PUBLIC_AI_MICROSERVICE_URL}/user-vectorize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        username: name,
        bio,
        location,
        passion,
        tags,
      }),
    },
  );

  if (!vectorizeResponse.ok) {
    console.error('Error vectorizing user:', await vectorizeResponse.text());
    // Don't fail the whole operation - user data is still updated
  }
} catch (vectorizeError) {
  console.error('Error calling vectorize endpoint:', vectorizeError);
  // Continue anyway - vectorization is not critical for the update
}
```

#### Fallback Strategy

If vectorize endpoint fails:

1. **Log error to console** (for monitoring)
2. **Don't show error to user** (profile update succeeded)
3. **User can still be searched** by exact text match (fallback to PostgreSQL ILIKE queries)
4. **Retry on next profile update**

---

### 3. Recommendations Endpoint

**Purpose**: Generate personalized user recommendations based on profile similarity, interests, and behavior.

#### Endpoint

```
POST /recommendations
```

#### When It's Called

- User navigates to `/create` page with `?tab=for-you` (default tab)
- When user clicks "For You" tab
- On page refresh while on "For You" tab
- Called from `components/create/create-section.tsx` Server Component

#### Process Flow (Frontend)

1. **Page Load**: User visits `/create` or clicks "For You" tab
2. **Server Component**: `create-section.tsx` runs on server (Next.js SSR)
3. **Get Current User**: Fetch authenticated user from Supabase session
4. **API Call**: Server makes request to AI microservice recommendations endpoint
5. **Render Feed**: Display recommended profiles in grid layout
6. **Fallback**: If API fails, show 7 random users from database

#### Request Body

```json
{
  "user_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "limit": 21,
  "offset": 0,
  "user_context": {
    "tags": ["jazz", "vocals", "composer"],
    "location": "Manchester, UK",
    "passion": "Jazz Vocalist & Composer",
    "connections": ["uuid-2", "uuid-3"] // IDs of users already connected with
  }
}
```

**Notes:**

- `limit`: Number of recommendations to return (default 21 for 3 rows of 7 cards)
- `offset`: For pagination (infinite scroll)
- `user_context.connections`: Array of user IDs to exclude (already connected)

#### Expected Response (Success)

```json
{
  "recommendations": [
    {
      "id": "uuid-1",
      "username": "Marcus Williams",
      "avatar": "https://...",
      "bio": "Electronic music producer...",
      "passion": "Electronic Music Producer",
      "location": "Bristol, UK",
      "similarity_score": 0.89,
      "reason": "Similar genres and collaboration interests"
    },
    {
      "id": "uuid-2",
      "username": "Emma Thompson",
      "avatar": "https://...",
      "bio": "Classical pianist...",
      "passion": "Classical Pianist",
      "location": "Edinburgh, UK",
      "similarity_score": 0.85,
      "reason": "Complementary musical styles"
    }
  ],
  "total": 120,
  "page": 1,
  "limit": 21
}
```

**Response Fields:**

- `recommendations`: Array of recommended user profiles
- `similarity_score`: Relevance score (0-1, higher is better)
- `reason`: Optional human-readable explanation for recommendation
- `total`: Total number of available recommendations (for pagination)

#### Expected Response (Error)

```json
{
  "error": "Recommendations service unavailable",
  "code": "RECOMMENDATIONS_ERROR",
  "timestamp": "2024-11-14T10:30:00Z"
}
```

#### Frontend Handling

```typescript
// components/create/create-section.tsx
export async function Feed({ activeTab }: FeedProps) {
  let initialProfiles;

  if (activeTab === 'for-you') {
    try {
      const currentUser = await getCurrentUser();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_AI_MICROSERVICE_URL}/recommendations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: currentUser.id,
            limit: 21,
            offset: 0,
            user_context: {
              tags: currentUser.tags,
              location: currentUser.location,
              passion: currentUser.passion,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Recommendations failed');
      }

      const data = await response.json();
      initialProfiles = data.recommendations;

    } catch (error) {
      console.error('Recommendations error:', error);
      // FALLBACK: Get 7 random users from database
      initialProfiles = await getRandomUsers(7);
    }
  } else {
    // "New Creatives" tab - chronological order
    initialProfiles = await getFeedUsers(21, 0);
  }

  return <FeedPresentation profiles={initialProfiles} />;
}
```

#### Fallback Strategy (CRITICAL)

**If recommendations endpoint fails, frontend MUST:**

1. **Catch error silently** (don't show error to user)
2. **Query PostgreSQL** for 7 random users:

   ```sql
   SELECT id, username, avatar, bio, passion, location
   FROM creative_data
   WHERE user_id != :current_user_id
   ORDER BY RANDOM()
   LIMIT 7;
   ```

3. **Display fallback users** in feed (user doesn't know recommendations failed)
4. **Log error** to monitoring (Sentry/PostHog) for debugging
5. **Retry on next page load**

**Why this fallback is important:**

- Prevents blank/broken feed experience
- User doesn't realize AI service is down
- Platform remains functional during outages
- Shows real users (not fake data) to maintain trust

#### Expected Fallback SQL Query

```typescript
// Fallback function in services/users/get-random-users.ts
export async function getRandomUsers(limit: number = 7, excludeUserId?: string) {
  const { data, error } = await supabase
    .from('creative_data')
    .select('id, username, avatar, bio, passion, location')
    .neq('user_id', excludeUserId || '')
    .order('created_at', { ascending: false }) // Fallback to recent users
    .limit(limit);

  if (error || !data) {
    console.error('Fallback query failed:', error);
    return [];
  }

  return data;
}
```

---

## ⚠️ Error Handling & Fallbacks

### General Principles

1. **User Experience First**: Never show errors for AI service failures
2. **Graceful Degradation**: Always provide fallback data
3. **Silent Logging**: Log errors for monitoring, don't alert users
4. **Non-Blocking Operations**: Vectorization should never block user actions

### Error Types & Responses

| Endpoint           | Error Type    | Frontend Action                     | User Impact                  |
| ------------------ | ------------- | ----------------------------------- | ---------------------------- |
| `/search`          | Network error | Show error toast, keep current feed | Temporary inconvenience      |
| `/search`          | 500 error     | Show error toast, allow retry       | Temporary inconvenience      |
| `/user-vectorize`  | Any error     | Log error, continue                 | None (invisible to user)     |
| `/recommendations` | Any error     | Use 7 random users fallback         | None (different users shown) |

### Timeout Configuration

```typescript
// Recommended timeout values
const TIMEOUTS = {
  search: 5000, // 5 seconds
  vectorize: 10000, // 10 seconds
  recommendations: 8000, // 8 seconds
};
```

### Retry Logic

- **Search**: User-initiated retry (try again button)
- **Vectorize**: Automatic retry on next profile update
- **Recommendations**: Automatic retry on page refresh

---

## 🔐 Environment Variables

### Frontend (.env.local)

```bash
# AI Microservice Base URL
NEXT_PUBLIC_AI_MICROSERVICE_URL=https://your-ai-backend.com

# Supabase (for fallback queries)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional: Enable AI features toggle
NEXT_PUBLIC_ENABLE_AI_FEATURES=true
```

### Backend Requirements

The AI microservice should have access to:

- PostgreSQL database (read-only access to `creative_data` table)
- Vector database (for embeddings storage)
- OpenAI/Cohere API keys (for embedding generation)

---

## 📊 Data Flow Diagrams

### Search Flow

```
┌──────────┐
│  User    │
│  types   │
│ "jazz"   │
└────┬─────┘
     │
     ▼
┌─────────────────┐
│ useDebounce     │ (500ms)
│ hook            │
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│ Zustand Store   │
│ performSearch() │
└────┬────────────┘
     │
     ▼
┌─────────────────────────────┐
│ POST /search                │
│ { query: "jazz", limit: 21 }│
└────┬────────────────────────┘
     │
     ▼
┌──────────────────┐
│ AI Microservice  │
│ - Vectorize query│
│ - Search vectors │
│ - Return results │
└────┬─────────────┘
     │
     ▼
┌─────────────────┐
│ Display Results │
│ in Feed Grid    │
└─────────────────┘
```

### Vectorize Flow

```
┌──────────────┐
│ User clicks  │
│ "Save"       │
└──────┬───────┘
       │
       ▼
┌───────────────────┐
│ Update PostgreSQL │
│ creative_data     │
└──────┬────────────┘
       │
       ▼
┌───────────────────┐
│ Upload Avatar     │
│ (if changed)      │
└──────┬────────────┘
       │
       ▼
┌────────────────────────────┐
│ POST /user-vectorize       │
│ { user_id, bio, tags, ... }│
└──────┬─────────────────────┘
       │
       ▼
┌──────────────────┐
│ AI Microservice  │
│ - Generate embed │
│ - Store vector   │
│ - Return success │
└──────┬───────────┘
       │
       ▼ (async, non-blocking)
┌──────────────────┐
│ Show Success     │
│ Toast to User    │
└──────────────────┘

(If vectorize fails, user still sees success)
```

### Recommendations Flow

```
┌──────────────┐
│ User visits  │
│ /create page │
└──────┬───────┘
       │
       ▼
┌────────────────────┐
│ Server Component   │
│ feed.tsx (SSR)     │
└──────┬─────────────┘
       │
       ▼
┌────────────────────────────────┐
│ Get Current User from Session  │
└──────┬─────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│ POST /recommendations            │
│ { user_id, limit: 21, context }  │
└──────┬───────────────────────────┘
       │
       ├─ Success ──────────┐
       │                    │
       │                    ▼
       │           ┌──────────────────┐
       │           │ Display AI       │
       │           │ Recommendations  │
       │           └──────────────────┘
       │
       └─ Failure ──────────┐
                            │
                            ▼
                   ┌──────────────────┐
                   │ FALLBACK:        │
                   │ Get 7 random     │
                   │ users from DB    │
                   └────┬─────────────┘
                        │
                        ▼
                   ┌──────────────────┐
                   │ Display Fallback │
                   │ Users in Feed    │
                   └──────────────────┘
```

---

## 🧪 Testing Requirements

### AI Microservice Should Handle

1. **Empty/Invalid User Context**
   - User with no tags, bio, or passion
   - Should return general popular users

2. **New Users (No Connections)**
   - User with no connection history
   - Should return diverse recommendations

3. **High-Volume Requests**
   - Multiple users searching simultaneously
   - Should handle with rate limiting

4. **Invalid User IDs**
   - Non-existent user_id in request
   - Should return 404 with clear error

5. **Large Pagination Offsets**
   - offset > total results
   - Should return empty array, not error

---

## 📝 Example Implementation Checklist

### Backend Developer Checklist

- [ ] Implement `/search` endpoint with vector similarity
- [ ] Implement `/user-vectorize` endpoint with embedding generation
- [ ] Implement `/recommendations` endpoint with collaborative filtering
- [ ] Set up PostgreSQL connection (read-only)
- [ ] Set up vector database (Pinecone/Qdrant/Weaviate)
- [ ] Configure OpenAI/Cohere API for embeddings
- [ ] Implement rate limiting (100 req/min per user)
- [ ] Add request validation (Zod/Pydantic)
- [ ] Add error logging (Sentry/Datadog)
- [ ] Write API tests (pytest/jest)
- [ ] Document API in OpenAPI/Swagger
- [ ] Deploy with health check endpoint (`/health`)

### Frontend Integration Checklist

- [ ] Update `NEXT_PUBLIC_AI_MICROSERVICE_URL` in `.env.local`
- [ ] Test search with real queries
- [ ] Test recommendations on "For You" tab
- [ ] Verify vectorize call on profile update
- [ ] Test error fallbacks (simulate API down)
- [ ] Test with slow network (throttle to 3G)
- [ ] Verify no console errors in production
- [ ] Add loading states for all API calls
- [ ] Add success/error analytics events
- [ ] Test on mobile and desktop

---

## 🚀 Deployment Notes

### Expected Load

- **Search**: ~10-50 requests/minute (peak hours)
- **Vectorize**: ~5-20 requests/minute (sporadic, on profile updates)
- **Recommendations**: ~100-200 requests/minute (page loads)

### Performance Requirements

- **Search**: < 500ms response time (p95)
- **Vectorize**: < 2s response time (async, non-critical)
- **Recommendations**: < 1s response time (p95)

### Monitoring

Track these metrics:

- Request latency (p50, p95, p99)
- Error rate (target < 1%)
- Embedding generation time
- Vector search accuracy (precision@10)
- Fallback usage rate (should be < 5%)

---

## 📞 Contact & Support

For questions about frontend integration or data structures:

- **Frontend Team**: Roger (CTO)
- **Design System**: `.github/design-system.md`
- **Database Schema**: `lib/database.sql`
- **API Services**: `services/` directory

---

**Last Updated**: November 14, 2025
**Document Version**: 1.0.0
**Maintained By**: TropicalTalent Engineering Team

[def]: #data-flow-diagrams
