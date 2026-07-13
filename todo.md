# Comprehensive Refactoring Plan for Vercel Serverless Deployment

## Executive Summary
This plan addresses all 4 critical architectural problems identified in the critique to make the RAG chatbot deployable on Vercel's serverless platform:
1. **Unpinned Dependencies** - Lock all dependencies to exact versions
2. **Serverless Monolith & Memory Wall** - Remove heavy ML deps (sentence-transformers, torch, chromadb local)
3. **Serverless Cold Starts** - Offload embeddings to external API
4. **Ephemeral Filesystem vs ChromaDB** - Migrate to managed vector database

---

## Phase 1: Dependency Lockdown & Cleanup (Foundation)

### 1.1 Audit Current Dependencies
- [ ] Audit `requirements.txt` - identify all unpinned packages (lines 14-19: langchain-chroma, langchain-community, langchain-core, langchain-huggingface, langchain-groq, langchain-text-splitters)
- [ ] Run `pip-compile` or `pip freeze` in a clean venv to resolve exact compatible versions
- [ ] Identify transitive dependencies (especially `torch`, `sentence-transformers`, `chromadb` local deps)

### 1.2 Create Locked Requirements
- [ ] Create `requirements.lock.txt` with ALL dependencies pinned to exact versions (including transitive deps)
- [ ] Pin exact versions for:
  - `fastapi==0.115.0` ✓ (already pinned)
  - `uvicorn==0.32.0` ✓
  - `chromadb` - **REMOVE** (local chromadb pulls torch)
  - `sentence-transformers==3.3.1` - **REMOVE** (pulls torch >700MB)
  - `huggingface-hub==0.26.2` - **REMOVE** (only needed for local embeddings)
  - `tiktoken==0.8.0` ✓ (keep - lightweight tokenizer)
  - `pypdf==5.0.1` ✓
  - `python-docx==1.1.2` ✓
  - `python-dotenv==1.0.1` ✓
  - `pydantic==2.9.2` ✓
  - `pydantic-settings==2.5.2` ✓
  - **All langchain packages** - pin exact compatible versions
- [ ] Add new lightweight dependencies:
  - `langchain-openai` or `langchain-huggingface` (for API-based embeddings) - PINNED
  - `pinecone` or `qdrant-client` or `supabase` (for managed vector DB) - PINNED
  - `httpx` (for API calls if using raw HTTP) - PINNED

### 1.3 Create Clean Requirements Files
- [ ] Create `requirements.txt` - minimal, only runtime deps for Vercel (target <50MB)
- [ ] Create `requirements-dev.txt` - dev dependencies (pytest, etc.)
- [ ] Create `requirements-lock.txt` - fully resolved lockfile for reproducibility
- [ ] Remove `chromadb`, `sentence-transformers`, `huggingface-hub`, `torch` from requirements.txt

### 1.4 Update vercel.json
- [ ] Remove `"maxDuration": 60` workaround (no longer needed after refactor)
- [ ] Verify `buildCommand` and `installCommand` use locked requirements
- [ ] Ensure `functions` config uses default limits (no large function override needed)
- [ ] Verify `outputDirectory` and `routes` are correct for frontend

---

## Phase 2: Embedding Refactor - External API (Critical for Memory & Cold Start)

### 2.1 Select Embedding Provider
**Decision Required:** Choose ONE external embedding provider:
- **Option A: Hugging Face Inference API** (Free tier available, uses sentence-transformers models remotely)
  - Model: `sentence-transformers/all-MiniLM-L6-v2` (same as current local model)
  - Pros: Free tier, same embeddings, no code change to vector dims
  - Cons: Rate limits on free tier, latency variability
  
- **Option B: OpenAI Embeddings API** (`text-embedding-3-small` / `text-embedding-3-large`)
  - Pros: Reliable, fast, consistent
  - Cons: Paid, different embedding dimensions (1536 vs 384), requires re-embedding all docs
  
- **Option C: Cohere Embeddings** (`embed-english-v3.0`)
  - Pros: Good quality, generous free tier
  - Cons: Different dimensions, paid beyond free tier

- **Option D: Groq Cloud** (if they add embeddings support - currently chat only)

**RECOMMENDATION: Option A (Hugging Face Inference API)** - maintains 384-dim embeddings, free tier, minimal code changes.

### 2.2 Implement HuggingFace Inference API Embeddings
- [ ] Add `HF_API_KEY` to environment variables (Vercel dashboard + .env.local)
- [ ] Create new module: `api/embeddings.py` with `HFInferenceEmbeddings` class
  - Implement `embed_documents(texts: List[str]) -> List[List[float]]`
  - Implement `embed_query(text: str) -> List[float]`
  - Use `httpx` for async HTTP calls to `https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2`
  - Handle rate limits (429), retries, timeouts
  - Batch requests for efficiency (HF API supports batching)
- [ ] Add retry logic with exponential backoff for 429/5xx responses
- [ ] Add request/response logging for debugging
- [ ] Implement embedding dimension validation (expect 384 dims)

### 2.3 Replace HuggingFaceEmbeddings in api/index.py
- [ ] Remove: `from langchain_huggingface import HuggingFaceEmbeddings`
- [ ] Remove: `embedding_model = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)`
- [ ] Import and instantiate new `HFInferenceEmbeddings` class
- [ ] Update `EMBEDDING_MODEL_NAME` constant to HF model ID: `"sentence-transformers/all-MiniLM-L6-v2"`
- [ ] Update vector store initialization to use new embedding class
- [ ] Verify embedding dimensions match (384) - critical for existing vector DB compatibility

### 2.4 Update Vector Store Initialization
- [ ] Modify `create_vector_store()` to accept embedding function as parameter
- [ ] Modify `get_vector_store()` to accept embedding function as parameter
- [ ] Pass the new HFInferenceEmbeddings instance to both functions

---

## Phase 3: Vector Database Migration - Managed Cloud (Critical for Ephemeral FS)

### 3.1 Select Managed Vector Database Provider
**Decision Required:** Choose ONE managed vector DB:

| Provider | Free Tier | Dimensions | Notes |
|----------|-----------|------------|-------|
| **Pinecone** | 1 index, 100k vectors, 384-dim | 384 (starter) | Serverless, popular, good Python SDK |
| **Qdrant Cloud** | 1 cluster, 1GB | Any | Fast, good filtering, generous free tier |
| **Supabase (pgvector)** | 500MB DB | Any | Postgres-based, SQL + vector |
| **Chroma Cloud** | Coming soon | 384 | Native Chroma, but newer |
| **Weaviate Cloud** | Sandbox tier | Any | Graph + vector, complex |

**RECOMMENDATION: Pinecone (serverless, 384-dim free tier) or Qdrant Cloud** - both support 384-dim embeddings natively, generous free tiers, serverless.

### 3.2 Set Up Vector Database
- [ ] Create account on chosen provider (Pinecone/Qdrant)
- [ ] Create index/collection with:
  - Dimension: **384** (matches all-MiniLM-L6-v2)
  - Metric: **cosine** (matches current `hnsw:space": "cosine"`)
  - Name: e.g., `rag-chatbot-index`
- [ ] Get API key and host URL
- [ ] Add to Vercel Environment Variables:
  - `PINECONE_API_KEY` / `QDRANT_API_KEY`
  - `PINECONE_INDEX_NAME` / `QDRANT_COLLECTION_NAME`
  - `PINECONE_HOST` / `QDRANT_URL` (if needed)

### 3.3 Implement Vector Store Adapter
- [ ] Create new module: `api/vectorstore.py`
- [ ] Implement `RemoteVectorStore` class with unified interface:
  ```python
  class RemoteVectorStore:
      def add_documents(self, documents: List[Document], ids: List[str]) -> None
      def similarity_search(self, query: str, k: int) -> List[Document]
      def similarity_search_with_score(self, query: str, k: int) -> List[Tuple[Document, float]]
      def max_marginal_relevance_search(self, query: str, k: int, fetch_k: int, lambda_mult: float) -> List[Document]
      def delete_collection(self) -> None
  ```
- [ ] Implement provider-specific subclass:
  - `PineconeVectorStore` using `pinecone` SDK
  - OR `QdrantVectorStore` using `qdrant-client`
- [ ] Handle namespace/collection per chunking method (e.g., `character_cs500_co50`)

### 3.4 Migrate Ingestion Logic (api/index.py)
- [ ] Remove `chromadb` imports: `from chromadb.config import Settings`, `from langchain_chroma import Chroma`
- [ ] Remove local `PERSIST_DIR`, `shutil.rmtree` logic
- [ ] Refactor `create_vector_store(chunks, collection_name)`:
  - Generate unique IDs for each chunk (UUID or hash)
  - Extract metadata (source, chunk_index)
  - Call `vector_store.add_documents(chunks, ids=ids)`
  - No local persistence needed
- [ ] Refactor `get_vector_store(collection_name)`:
  - Return remote vector store instance connected to namespace/collection
  - Implement caching in `_vector_store_cache` dict (in-memory per cold start)

### 3.5 Migrate Retrieval Methods
- [ ] Update `retrieve_similarity()` to use `vector_store.similarity_search()`
- [ ] Update `retrieve_score_threshold()` to use `vector_store.similarity_search_with_score()` + filter
- [ ] Update `retrieve_mmr()` to use `vector_store.max_marginal_relevance_search()`
- [ ] Verify all retrieval method signatures match LangChain VectorStore interface

### 3.6 Handle Namespace/Collection Strategy
- [ ] Each `collection_name` (e.g., `character_cs500_co50`) → separate namespace in Pinecone OR separate collection in Qdrant
- [ ] Implement `delete_collection()` for re-ingestion cleanup
- [ ] Handle namespace creation/deletion in ingestion endpoint

---

## Phase 4: API Code Refactoring (api/index.py)

### 4.1 Update Imports
- [ ] Remove: `from chromadb.config import Settings`
- [ ] Remove: `from langchain_chroma import Chroma`
- [ ] Remove: `from langchain_huggingface import HuggingFaceEmbeddings`
- [ ] Remove: `import shutil`, `import gc` (no longer needed for local FS cleanup)
- [ ] Add: `from api.embeddings import HFInferenceEmbeddings`
- [ ] Add: `from api.vectorstore import RemoteVectorStore` (or provider-specific)
- [ ] Add: `import httpx` (for embedding API calls)

### 4.2 Update Global Initialization
- [ ] Replace global `embedding_model` with `HFInferenceEmbeddings()` instance
- [ ] Initialize `vector_store_client` (singleton) for remote DB connection
- [ ] Remove `_vector_store_cache` or adapt for remote client caching

### 4.3 Refactor Ingestion Endpoint (`/api/ingest`)
- [ ] Load documents (keep existing logic)
- [ ] For each chunking method:
  - Split documents
  - Generate collection_name/namespace
  - **Delete existing namespace/collection** (remote equivalent of `shutil.rmtree`)
  - Add documents to remote vector store with metadata
  - Return chunk counts
- [ ] Remove local filesystem operations

### 4.4 Refactor Query Endpoint (`/api/query`)
- [ ] Get remote vector store by namespace/collection_name
- [ ] Call retrieval methods on remote store
- [ ] Generate answer using Groq (keep existing logic)
- [ ] Return results (same response format)

### 4.5 Refactor Health/Config Endpoints
- [ ] Update `/api/health`:
  - Check remote vector DB connectivity
  - Check HF API key configured
  - Check Groq API key configured
- [ ] `/api/config` - keep unchanged

---

## Phase 5: Environment & Configuration

### 5.1 Environment Variables (Vercel Dashboard + .env.example)
- [ ] Create `.env.example` with all required variables:
  ```
  # Required
  GROQ_API_KEY=your_groq_key
  HF_API_KEY=your_huggingface_key
  PINECONE_API_KEY=your_pinecone_key
  PINECONE_INDEX_NAME=rag-chatbot-index
  
  # Optional
  PINECONE_HOST=your-host.pinecone.io  # If needed
  GROQ_MODEL=llama-3.1-8b-instant
  LLM_PROVIDER=groq
  EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
  VECTOR_DIMENSION=384
  ```
- [ ] Document all variables in README

### 5.2 Local Development Setup
- [ ] Create `.env.local` template
- [ ] Update `vercel dev` to work with remote services
- [ ] Document local development workflow (need API keys for local dev too)

---

## Phase 6: Frontend Verification (No Code Changes Expected)

### 6.1 Verify Frontend Compatibility
- [ ] Check `frontend/` directory for API calls
- [ ] Verify API endpoints match (`/api/ingest`, `/api/query`, `/api/health`, `/api/config`)
- [ ] Verify request/response schemas match `QueryRequest`, `QueryResponse`, etc.
- [ ] Test locally with `vercel dev` against remote services

---

## Phase 7: Dependency Resolution & Lockfile Generation

### 7.1 Final Requirements Resolution
- [ ] Create clean virtual environment
- [ ] Install only the new minimal requirements:
  ```
  fastapi==0.115.0
  uvicorn==0.32.0
  tiktoken==0.8.0
  pypdf==5.0.1
  python-docx==1.1.2
  python-dotenv==1.0.1
  pydantic==2.9.2
  pydantic-settings==2.5.2
  langchain-core==0.3.25  # PIN EXACT
  langchain-community==0.3.12  # PIN EXACT
  langchain-groq==0.2.0  # PIN EXACT
  langchain-text-splitters==0.3.4  # PIN EXACT
  langchain-pinecone==0.2.0  # OR langchain-qdrant - PIN EXACT
  httpx==0.27.2  # For HF API calls
  pinecone==3.0.0  # OR qdrant-client==1.8.2 - PIN EXACT
  ```
- [ ] Run `pip install -r requirements.txt` and verify no conflicts
- [ ] Run `pip freeze > requirements-lock.txt` for complete lockfile
- [ ] Verify total install size < 100MB (should be ~30-50MB without torch)

### 7.2 Verify Vercel Build
- [ ] Run `vercel build` locally
- [ ] Verify function size < 50MB
- [ ] Deploy to Vercel preview
- [ ] Test all endpoints

---

## Phase 8: Testing & Validation

### 8.1 Unit Tests
- [ ] Test `HFInferenceEmbeddings.embed_documents()` with mock HF API
- [ ] Test `HFInferenceEmbeddings.embed_query()` with mock HF API
- [ ] Test `RemoteVectorStore` CRUD operations with mock Pinecone/Qdrant
- [ ] Test ingestion pipeline end-to-end (mocked)
- [ ] Test query pipeline end-to-end (mocked)

### 8.2 Integration Tests
- [ ] Test ingestion against real remote vector DB
- [ ] Test query against real remote vector DB
- [ ] Test embeddings against real HF Inference API
- [ ] Verify 384-dimension consistency

### 8.3 Load/Cold Start Testing
- [ ] Deploy to Vercel preview
- [ ] Measure cold start latency (target: <2s)
- [ ] Measure warm request latency (target: <500ms)
- [ ] Test concurrent requests
- [ ] Verify function size < 50MB

### 8.4 End-to-End Verification
- [ ] Ingest documents via `/api/ingest`
- [ ] Query via `/api/query` with all 9 combinations
- [ ] Verify answers are coherent
- [ ] Verify token usage tracking works
- [ ] Test frontend integration

---

## Phase 9: Documentation & Cleanup

### 9.1 Update Documentation
- [ ] Update `README.md` with:
  - Architecture overview (external embeddings + managed vector DB)
  - Required environment variables
  - Deployment steps for Vercel
  - Local development setup
  - Cost estimates (free tier limits)
- [ ] Create `ARCHITECTURE.md` documenting the serverless RAG pattern
- [ ] Document migration from local ChromaDB to managed vector DB

### 9.2 Clean Up Legacy Code
- [ ] Delete `RAGChatbotcopy.py` (duplicate/legacy)
- [ ] Remove any local `db/`, `data/`, `docs/` directories from git (add to .gitignore)
- [ ] Remove `VERCEL_SUPPORT_LARGE_FUNCTIONS` references if any
- [ ] Clean up unused imports in all files

### 9.3 Final Vercel Configuration
- [ ] Verify `vercel.json` is minimal and correct
- [ ] Remove `maxDuration` override
- [ ] Ensure proper Python runtime version (3.10+)

---

## Critical Decision Points (Require Human Input)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Embedding Provider | HF Inference API / OpenAI / Cohere | **HF Inference API** (free, 384-dim compatible) |
| 2 | Vector DB Provider | Pinecone / Qdrant Cloud / Supabase / Chroma Cloud | **Pinecone Serverless** (free tier, 384-dim, serverless) |
| 3 | Namespace Strategy | Per-collection namespace vs separate index | **Per-collection namespace in single index** (cost-effective) |
| 4 | Embedding Dimension | Keep 384 (MiniLM) or migrate to 1536 (OpenAI) | **Keep 384** (avoids re-embedding all docs) |

---

## File Changes Summary

### Files to MODIFY:
1. `requirements.txt` - Complete rewrite (minimal, pinned)
2. `requirements-lock.txt` - New (full lockfile)
3. `vercel.json` - Simplify (remove maxDuration)
4. `api/index.py` - Major refactor (remove Chroma/HF local, add remote adapters)
5. `.env.example` - New (document all env vars)
6. `README.md` - Update architecture & deployment docs

### Files to CREATE:
1. `api/embeddings.py` - HF Inference API embeddings client
2. `api/vectorstore.py` - Remote vector store adapter (Pinecone/Qdrant)
3. `.env.example` - Environment variable template

### Files to DELETE:
1. `RAGChatbotcopy.py` - Legacy duplicate
2. Local `db/`, `data/`, `docs/` dirs (add to .gitignore)

### Files UNCHANGED:
1. `frontend/` - Should work without changes (verify API contracts)

---

## Success Criteria

- [ ] Vercel deployment succeeds with function size < 50MB
- [ ] Cold start < 2 seconds
- [ ] Warm request < 500ms
- [ ] Ingestion works (creates vectors in remote DB)
- [ ] Query returns all 9 combinations with valid answers
- [ ] Token usage tracking works
- [ ] No local filesystem dependencies
- [ ] All dependencies pinned to exact versions
- [ ] No torch/sentence-transformers/chromadb-local in dependencies
- [ ] Frontend works end-to-end

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| HF Inference API rate limits | Implement exponential backoff, batch requests, consider paid tier |
| Pinecone free tier limits | Monitor usage, design namespace cleanup on re-ingest |
| Embedding dimension mismatch | Hardcode 384 dims, validate on startup |
| Cold start latency | Keep function warm with cron (optional), minimize imports |
| Vector DB connection failures | Implement retry logic, graceful degradation |
| Data migration from local Chroma | Re-ingest all documents (one-time cost) |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Dependencies | 1-2 hours |
| Phase 2: Embeddings Refactor | 2-3 hours |
| Phase 3: Vector DB Migration | 3-4 hours |
| Phase 4: API Refactor | 2-3 hours |
| Phase 5: Config & Env | 1 hour |
| Phase 6: Frontend Verify | 1 hour |
| Phase 7: Lockfile & Build | 1 hour |
| Phase 8: Testing | 2-3 hours |
| Phase 9: Docs & Cleanup | 1-2 hours |
| **Total** | **~14-22 hours** |

---

## Execution Order

1. **Start with Phase 1** - Foundation (lock deps, clean requirements)
2. **Phase 2 & 3 in parallel** - Embeddings + Vector DB (core architecture)
3. **Phase 4** - Wire it all together in api/index.py
4. **Phase 5** - Configuration
5. **Phase 6-7** - Verify & lock
6. **Phase 8** - Test thoroughly
7. **Phase 9** - Document & clean

**Critical Path:** Phases 1→2→3→4→7 (deployment blocking)