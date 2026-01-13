# Technical Architecture

## Technology Stack
**Backend Agent API**:
- **AI Framework**: Pydantic AI with OpenAI/OpenRouter/Ollama provider support
- **API Framework**: FastAPI with streaming response support
- **Database**: Supabase (PostgreSQL) with vector embeddings and RLS
- **Memory**: Mem0 for persistent user memory and personalization
- **Observability**: Langfuse for conversation tracking and evaluation scoring
- **Language**: Python 3.11+ with full type annotations

**RAG Pipeline**:
- **Document Processing**: Text chunking, embedding generation, vector storage
- **File Sources**: Local file watching and Google Drive integration
- **Orchestration**: Continuous monitoring or single-run processing modes
- **State Management**: Database-backed pipeline state and document tracking

**Frontend**:
- **Framework**: React 18 with TypeScript and Vite
- **UI Library**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS with responsive design
- **Testing**: Playwright for end-to-end testing with mocked APIs
- **Authentication**: Supabase Auth with JWT tokens

## Architecture Overview
**Modular Microservices Design**:
- **Agent API**: FastAPI server handling chat requests with streaming responses
- **RAG Pipeline**: Independent document processing service with configurable sources
- **Frontend**: Static React application with real-time chat interface
- **Database**: Centralized Supabase instance with vector search capabilities

**Agent Tool System**:
- **Memory Tool**: Personalized user memory retrieval (always used first)
- **RAG Tool**: Document retrieval from processed knowledge base
- **Web Search**: Brave API or SearXNG for real-time information
- **Image Analysis**: Vision model integration for image understanding
- **SQL Execution**: Direct database queries for structured data analysis

**Evaluation Framework**:
- **Golden Datasets**: Curated test cases in YAML format
- **Rule-Based Evaluators**: Automated checks for tool usage and response quality
- **LLM Judges**: AI-powered evaluation of response quality and accuracy
- **Production Monitoring**: Real-time evaluation scoring via Langfuse

## Development Environment
**Prerequisites**:
- Docker/Docker Desktop (recommended) OR Python 3.11+ and Node.js 18+
- Supabase account for database and authentication
- LLM provider account (OpenAI, OpenRouter, or local Ollama)
- Optional: Brave API key, Google Drive credentials, Langfuse account

**Local Development Setup**:
```bash
# Backend Agent API
cd backend_agent_api
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn agent_api:app --reload --port 8001

# RAG Pipeline
cd backend_rag_pipeline
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python docker_entrypoint.py --pipeline local --mode continuous

# Frontend
cd frontend
npm install && npm run dev
```

## Code Standards
**Python Standards**:
- **Type Safety**: Full type annotations using typing module and Pydantic models
- **Async/Await**: Async functions throughout for non-blocking operations
- **Error Handling**: Comprehensive exception handling with proper HTTP status codes
- **Documentation**: Docstrings for all functions with clear parameter descriptions

**React/TypeScript Standards**:
- **Component Structure**: Functional components with TypeScript interfaces
- **State Management**: React hooks with proper dependency arrays
- **API Integration**: Custom hooks for Supabase and agent API calls
- **Testing**: Playwright tests with comprehensive mocking

**Database Standards**:
- **Vector Embeddings**: 1536 dimensions for OpenAI, 768 for local models
- **Row Level Security**: Proper RLS policies for user data isolation
- **Migrations**: Numbered SQL files for schema management

## Testing Strategy
**Backend Testing**:
- **Unit Tests**: pytest for individual function testing
- **Integration Tests**: Full agent workflow testing with mocked dependencies
- **Evaluation Tests**: Golden dataset validation with >80% pass rate requirement

**Frontend Testing**:
- **E2E Tests**: Playwright with mocked Supabase and agent API calls
- **Component Tests**: React component testing with user interaction simulation
- **Authentication Flow**: Complete login/signup/logout testing

**Evaluation Framework**:
- **Golden Datasets**: Curated test cases for general and RAG-specific scenarios
- **Automated Scoring**: Rule-based and LLM judge evaluation
- **Production Monitoring**: Real-time quality assessment via Langfuse

## Deployment Process
**Development Mode**: Individual component startup for local development
**Docker Compose**: Single-command deployment with all services
**Cloud Deployment**: Platform-specific guides for DigitalOcean, Render, and GCP
**Production Monitoring**: Langfuse integration for conversation tracking and evaluation

## Performance Requirements
**Response Times**:
- **Agent API**: <2s for simple queries, <10s for complex research tasks
- **RAG Pipeline**: Real-time document processing with configurable batch sizes
- **Frontend**: <100ms UI interactions with streaming response display

**Scalability**:
- **Independent Scaling**: Each component can scale separately based on load
- **Database**: Vector search optimization with proper indexing
- **Memory Management**: Efficient embedding storage and retrieval

## Security Considerations
**Authentication**: Supabase Auth with JWT tokens and row-level security
**API Security**: Bearer token validation for all agent API endpoints
**Data Privacy**: User conversation isolation and secure memory storage
**Environment Variables**: Secure configuration management for API keys and secrets
**CORS**: Proper cross-origin resource sharing configuration for frontend-backend communication
