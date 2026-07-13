"""RAG Chatbot Backend API

FastAPI service exposing configurable RAG pipeline:
- 3 chunking methods (Character, Recursive, Token)
- 3 retrieval methods (Similarity, Score Threshold, MMR)
- Token usage tracking per query
- All 9 combinations returned per query
"""

import gc
import os
import re
import shutil
import tiktoken
from pathlib import Path
from typing import Any

from chromadb.config import Settings
from docx import Document
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_chroma import Chroma
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import (
    CharacterTextSplitter,
    RecursiveCharacterTextSplitter,
    TokenTextSplitter,
)
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="RAG Chatbot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RAW_DIR = Path("data/raw")
DOCS_DIR = Path("docs")
PERSIST_DIR = "db/chroma_db"
DOCS_PATH = "docs"
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
TOKENIZER_MODEL = "cl100k_base"

CHUNKING_METHODS = ["character", "recursive", "token"]
RETRIEVAL_METHODS = ["similarity", "score_threshold", "mmr"]

embedding_model = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)
tokenizer = tiktoken.get_encoding(TOKENIZER_MODEL)

_vector_store_cache: dict[str, Chroma] = {}


class IngestRequest(BaseModel):
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_overlap: int = Field(default=50, ge=0, le=500)


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1)
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_overlap: int = Field(default=50, ge=0, le=500)
    k: int = Field(default=3, ge=1, le=20)
    fetch_k: int = Field(default=5, ge=1, le=50)
    lambda_mult: float = Field(default=0.5, ge=0.0, le=1.0)
    score_threshold: float = Field(default=0.3, ge=0.0, le=1.0)
    chunking_methods: list[str] = Field(default_factory=lambda: CHUNKING_METHODS)
    retrieval_methods: list[str] = Field(default_factory=lambda: RETRIEVAL_METHODS)


class ChunkInfo(BaseModel):
    source: str
    content: str
    chunk_index: int


class RetrievalResult(BaseModel):
    chunking_method: str
    retrieval_method: str
    parameters: dict[str, Any]
    chunks: list[ChunkInfo]
    answer: str
    token_usage: dict[str, int]


class QueryResponse(BaseModel):
    query: str
    results: list[RetrievalResult]
    total_combinations: int


class HealthResponse(BaseModel):
    status: str
    docs_dir_exists: bool
    persist_dir_exists: bool
    groq_configured: bool


class ConfigResponse(BaseModel):
    chunking_methods: list[str]
    retrieval_methods: list[str]
    default_chunk_size: int
    default_chunk_overlap: int
    default_k: int
    default_fetch_k: int
    default_lambda_mult: float
    default_score_threshold: float


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def read_txt(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_docx(path: Path) -> str:
    doc = Document(path)
    parts = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(parts)


def read_pdf(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(page_text.strip())
    return "\n\n".join(pages)


def convert_one(source_path: Path, output_dir: Path) -> Path | None:
    suffix = source_path.suffix.lower()
    output_path = output_dir / f"{source_path.stem}.txt"

    if suffix == ".txt":
        text = read_txt(source_path)
    elif suffix == ".docx":
        text = read_docx(source_path)
    elif suffix == ".pdf":
        text = read_pdf(source_path)
    else:
        return None

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path.write_text(clean_text(text), encoding="utf-8")
    return output_path


def load_documents(docs_path: str = DOCS_PATH):
    if not os.path.exists(docs_path):
        raise FileNotFoundError(f"Folder not found: {docs_path}. Run ingestion first.")

    loader = DirectoryLoader(path=docs_path, glob="*.txt", loader_cls=TextLoader)
    documents = loader.load()

    if len(documents) == 0:
        raise FileNotFoundError(f"No .txt files in {docs_path}")

    return documents


def split_documents(documents, method: str, chunk_size: int, chunk_overlap: int):
    if method == "character":
        splitter = CharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    elif method == "recursive":
        splitter = RecursiveCharacterTextSplitter(
            separators=["\n\n", "\n", ". ", " ", ""],
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    elif method == "token":
        splitter = TokenTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    else:
        raise ValueError(f"Unknown chunking method: {method}")

    return splitter.split_documents(documents)


def create_vector_store(chunks, collection_name: str):
    persist_path = os.path.join(PERSIST_DIR, collection_name)

    if os.path.exists(persist_path):
        try:
            shutil.rmtree(persist_path)
        except PermissionError:
            gc.collect()
            import time
            time.sleep(0.5)
            shutil.rmtree(persist_path, ignore_errors=True)

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embedding_model,
        persist_directory=persist_path,
        collection_metadata={"hnsw:space": "cosine"},
    )
    return vectorstore


def get_vector_store(collection_name: str) -> Chroma:
    if collection_name in _vector_store_cache:
        return _vector_store_cache[collection_name]

    persist_path = os.path.join(PERSIST_DIR, collection_name)
    if not os.path.exists(persist_path):
        raise FileNotFoundError(f"Vector store not found: {collection_name}. Run ingestion first.")

    vector_store = Chroma(
        persist_directory=persist_path,
        embedding_function=embedding_model,
        collection_metadata={"hnsw:space": "cosine"},
    )
    _vector_store_cache[collection_name] = vector_store
    return vector_store


def retrieve_similarity(vector_store: Chroma, query: str, k: int):
    retriever = vector_store.as_retriever(search_kwargs={"k": k})
    return retriever.invoke(query)


def retrieve_score_threshold(vector_store: Chroma, query: str, k: int, score_threshold: float):
    retriever = vector_store.as_retriever(
        search_type="similarity_score_threshold",
        search_kwargs={"k": k, "score_threshold": score_threshold},
    )
    return retriever.invoke(query)


def retrieve_mmr(vector_store: Chroma, query: str, k: int, fetch_k: int, lambda_mult: float):
    retriever = vector_store.as_retriever(
        search_type="mmr",
        search_kwargs={"k": k, "fetch_k": fetch_k, "lambda_mult": lambda_mult},
    )
    return retriever.invoke(query)


def count_tokens(text: str) -> int:
    return len(tokenizer.encode(text))


def estimate_token_usage(prompt: str, answer: str) -> dict[str, int]:
    prompt_tokens = count_tokens(prompt)
    completion_tokens = count_tokens(answer)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def use_mock_llm() -> bool:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    provider = os.getenv("LLM_PROVIDER", "mock").strip().lower()
    return provider == "mock" or not api_key or api_key == "your_groq_key_here"


def generate_answer(vector_store: Chroma, query: str, retrieval_method: str, params: dict) -> tuple[str, dict[str, int]]:
    if retrieval_method == "similarity":
        docs = retrieve_similarity(vector_store, query, params["k"])
    elif retrieval_method == "score_threshold":
        docs = retrieve_score_threshold(vector_store, query, params["k"], params["score_threshold"])
    elif retrieval_method == "mmr":
        docs = retrieve_mmr(vector_store, query, params["k"], params["fetch_k"], params["lambda_mult"])
    else:
        raise ValueError(f"Unknown retrieval method: {retrieval_method}")

    context = "\n".join([f"- {doc.page_content}" for doc in docs])

    combined_input = f"""Based on the following documents, please answer this question: {query}

Documents:
{context}

Answer using ONLY the documents above. If the answer is not there, say:
"I don't have enough information in the provided documents."
"""

    messages = [
        SystemMessage(content="You are a helpful assistant for AI Season."),
        HumanMessage(content=combined_input),
    ]

    if use_mock_llm():
        snippet = docs[0].page_content[:200] if docs else ""
        answer = f"[MOCK LLM] Based on the retrieved documents about '{query}': {snippet}..."
        token_usage = estimate_token_usage(combined_input, answer)
    else:
        model = ChatGroq(
            model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            temperature=0.2,
        )
        result = model.invoke(messages)
        answer = result.content
        usage = result.usage_metadata or {}
        token_usage = {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }

    return answer, token_usage


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        docs_dir_exists=DOCS_DIR.exists(),
        persist_dir_exists=os.path.exists(PERSIST_DIR),
        groq_configured=not use_mock_llm(),
    )


@app.get("/api/config", response_model=ConfigResponse)
async def config():
    return ConfigResponse(
        chunking_methods=CHUNKING_METHODS,
        retrieval_methods=RETRIEVAL_METHODS,
        default_chunk_size=500,
        default_chunk_overlap=50,
        default_k=3,
        default_fetch_k=5,
        default_lambda_mult=0.5,
        default_score_threshold=0.3,
    )


@app.post("/api/ingest")
async def ingest(request: IngestRequest):
    documents = load_documents()

    results = {}
    for method in CHUNKING_METHODS:
        chunks = split_documents(documents, method, request.chunk_size, request.chunk_overlap)
        collection_name = f"{method}_cs{request.chunk_size}_co{request.chunk_overlap}"
        vector_store = create_vector_store(chunks, collection_name)
        results[method] = {
            "collection": collection_name,
            "chunk_count": len(chunks),
        }

    return {
        "status": "success",
        "chunk_size": request.chunk_size,
        "chunk_overlap": request.chunk_overlap,
        "collections": results,
    }


@app.post("/api/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    if not DOCS_DIR.exists():
        raise HTTPException(400, "Documents not found. Run /api/ingest first.")

    results = []
    total_combinations = 0

    for chunking_method in request.chunking_methods:
        if chunking_method not in CHUNKING_METHODS:
            continue

        collection_name = f"{chunking_method}_cs{request.chunk_size}_co{request.chunk_overlap}"
        try:
            vector_store = get_vector_store(collection_name)
        except FileNotFoundError:
            continue

        for retrieval_method in request.retrieval_methods:
            if retrieval_method not in RETRIEVAL_METHODS:
                continue

            params = {}
            if retrieval_method == "similarity":
                params = {"k": request.k}
            elif retrieval_method == "score_threshold":
                params = {"k": request.k, "score_threshold": request.score_threshold}
            elif retrieval_method == "mmr":
                params = {"k": request.k, "fetch_k": request.fetch_k, "lambda_mult": request.lambda_mult}

            answer, token_usage = generate_answer(vector_store, request.query, retrieval_method, params)

            if retrieval_method == "similarity":
                docs = retrieve_similarity(vector_store, request.query, request.k)
            elif retrieval_method == "score_threshold":
                docs = retrieve_score_threshold(vector_store, request.query, request.k, request.score_threshold)
            else:
                docs = retrieve_mmr(vector_store, request.query, request.k, request.fetch_k, request.lambda_mult)

            chunks_info = [
                ChunkInfo(source=doc.metadata.get("source", "unknown"), content=doc.page_content, chunk_index=i)
                for i, doc in enumerate(docs)
            ]

            results.append(
                RetrievalResult(
                    chunking_method=chunking_method,
                    retrieval_method=retrieval_method,
                    parameters=params,
                    chunks=chunks_info,
                    answer=answer,
                    token_usage=token_usage,
                )
            )
            total_combinations += 1

    if not results:
        raise HTTPException(404, "No vector stores found for given parameters. Run /api/ingest first.")

    return QueryResponse(query=request.query, results=results, total_combinations=total_combinations)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)