# Technical Assessment & Architecture Critique: Vercel Deployment Issues

This document outlines critical architectural flaws, platform mismatches, and structural risks in the current project configuration. The AI agent must systematically resolve these issues to ensure a stable, scalable, and production-ready deployment on Vercel.

---

## 1. The Unpinned Dependency Ticking Time Bomb
### The Problem
To bypass immediate `pip` install version conflicts, the `requirements.txt` file was modified to leave several core AI libraries unpinned (e.g., `langchain-core`, `langchain-community`, `langchain-chroma`). While this allows `pip` to find a temporary compromise *today*, it introduces extreme instability. 
* **The Risk:** LangChain and related AI ecosystems evolve rapidly with frequent breaking changes. The next time a minor patch or update is pushed, Vercel will rebuild the project from scratch, download the absolute latest versions, and the application will likely break at runtime with `ImportError` or `AttributeError` without any changes made to the backend source code.

### Required Resolution
1. Set up a local isolated virtual environment (`venv`).
2. Install the necessary packages and let `pip` resolve a stable, working combination.
3. Generate a deterministic `requirements.txt` or use a proper package manager/lockfile system (like `pip-tools` or Poetry) to **explicitly pin every version** down to the patch number (e.g., `langchain-core==0.3.25`).

---

## 2. Serverless Monolith & The Memory Size Wall
### The Problem
The current application architecture attempts to bundle heavy machine learning libraries (`sentence-transformers`), which implicitly pull in **PyTorch (`torch`)** as a dependency. PyTorch alone exceeds 700MB uncompressed, crushing Vercel's standard 500MB function limit.
* **The Temporary Hotfix:** Activating `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` bypasses the wall, but it is an anti-pattern.
* **The Reality:** Forcing a massive heavy-compute data-science environment into an ephemeral, lightweight serverless runtime is inefficient and structurally flawed.

### Required Resolution
* **Decouple the Embedding Generation:** Eliminate the local `sentence-transformers` and `torch` dependencies entirely from the Vercel deployment. 
* **Shift to an API-Driven Approach:** Refactor the codebase to use an external managed embedding service, such as the **Hugging Face Inference API**, **OpenAI Embeddings API**, or **Groq Cloud** (if available for embeddings). This keeps the Vercel container lean (<50MB) and fast.

---

## 3. Serverless Cold Starts & High Latency
### The Problem
Serverless functions are ephemeral; they spin up on demand and spin down when idle. Loading heavy binary ML frameworks (like PyTorch and large embedding models) into memory from scratch during a "cold start" causes catastrophic user experience latency.
* **The Consequence:** The first user to hit the endpoint after a period of inactivity will experience a **5 to 15-second delay** while the underlying AWS Lambda/Vercel infrastructure provisions the massive environment and loads the models into RAM.

### Required Resolution
* By offloading embeddings and vector manipulation to external API endpoints (as detailed in Problem 2), the Vercel function only needs to handle basic HTTP requests and lightweight network I/O, dropping cold start times down to milliseconds.

---

## 4. Ephemeral Filesystem vs. Stateless Compute (The ChromaDB Bug)
### The Problem
The current implementation relies on a local instance of `chromadb` that attempts to read and write vector indices directly to the local disk/filesystem.
* **The Core Failure:** Vercel Serverless Functions are completely **stateless and read-only** outside of the temporary `/tmp` directory. Even if data is written to `/tmp`, that directory is completely wiped clean the moment the container spins down or recycles (which happens constantly).
* **The Consequence:** The vector database will constantly reset. Data saved in one request will be missing in the next request, resulting in data loss and broken context windows.

### Required Resolution
* **Migrate to a Remote Vector Database:** Do not initialize `chromadb` as a local persistent client. 
* Switch to a cloud-managed hosted instance. Options include:
  1. A hosted **Chroma Cloud / AWS/Replit managed Chroma** instance.
  2. Alternative managed serverless vector databases like **Pinecone**, **Qdrant**, or **Supabase (pgvector)**.
* Update the environment variables to connect via a secure URL and API key instead of a local path.

---

## Summary Action Items for the Agent
1. **Refactor Embeddings:** Remove `sentence-transformers` and `torch`. Re-write embedding logic to use an external API (e.g., Hugging Face or OpenAI).
2. **Refactor Vector Database:** Remove local file-based `chromadb`. Update database initialization to connect to a remote, persistent vector database cloud provider.
3. **Lock Dependencies:** Clean out `requirements.txt`. Lock down all remaining required versions cleanly without conflicts.
4. **Clean up Configuration:** Ensure `vercel.json` uses the official `@vercel/python` runtime handler correctly and remove unnecessary size-override workarounds if no longer needed.
