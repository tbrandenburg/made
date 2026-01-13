# Project Structure

## Directory Layout
```
8_Agent_Evals/
├── backend_agent_api/      # AI Agent with FastAPI - The brain of the system
│   ├── agent.py            # Pydantic AI agent with tools and dependencies
│   ├── agent_api.py        # FastAPI server with streaming endpoints
│   ├── tools.py            # Agent tools (web search, RAG, image analysis, etc.)
│   ├── prompt.py           # System prompt for the agent
│   ├── clients.py          # Supabase and OpenAI client initialization
│   ├── db_utils.py         # Database operations and conversation management
│   ├── configure_langfuse.py # Langfuse observability setup
│   ├── evals/              # Evaluation framework (golden datasets, LLM judges, production evals)
│   └── tests/              # Unit and integration tests
├── backend_rag_pipeline/   # Document processing pipeline - Handles knowledge ingestion
│   ├── docker_entrypoint.py # Main pipeline orchestrator
│   ├── common/             # Shared utilities (db_handler, state_manager, text_processor)
│   ├── Local_Files/        # Local file watching and processing
│   ├── Google_Drive/       # Google Drive integration and monitoring
│   └── tests/              # Pipeline testing
├── frontend/               # React application - User interface
│   ├── src/                # React TypeScript source code
│   ├── tests/              # Playwright end-to-end tests
│   └── public/             # Static assets
├── sql/                    # Database schemas - Foundation for all components
├── ~deployment_guides~/    # Platform-specific deployment instructions
├── .kiro/                  # Kiro CLI configuration and agents
└── mock_data/              # Sample documents for testing (NeuroVerse Studios)
```

## File Naming Conventions
- **Python modules**: Snake_case (`agent_api.py`, `db_utils.py`)
- **React components**: PascalCase (`ChatInterface.tsx`, `MessageList.tsx`)
- **Configuration files**: Lowercase with extensions (`.env`, `docker-compose.yml`)
- **SQL files**: Numbered with descriptive names (`0-all-tables.sql`, `1-user_profiles_requests.sql`)
- **Test files**: Mirror source structure with `test_` prefix (`test_tools.py`, `test_db_handler.py`)

## Module Organization
**Backend Agent API**:
- **Core agent**: `agent.py` - Pydantic AI agent with tool integration
- **API server**: `agent_api.py` - FastAPI with streaming chat endpoints
- **Tools**: `tools.py` - Web search, RAG, image analysis, memory, SQL execution
- **Database**: `db_utils.py` - Conversation management and user profiles
- **Evaluation**: `evals/` - Golden datasets, rule-based checks, LLM judges

**RAG Pipeline**:
- **Orchestrator**: `docker_entrypoint.py` - Continuous or single-run processing
- **File Processing**: `Local_Files/` and `Google_Drive/` - Source-specific watchers
- **Common**: Shared database, state management, and text processing utilities

**Frontend**:
- **Pages**: Authentication, chat interface, conversation management
- **Components**: Reusable UI components with shadcn/ui
- **Hooks**: Custom React hooks for API integration and state management

## Configuration Files
- **Environment**: `.env` files for each component with LLM providers, API keys, database URLs
- **Docker**: `docker-compose.yml` for local deployment, `docker-compose.caddy.yml` for production
- **Database**: SQL schema files in `sql/` directory
- **Deployment**: Python deployment script and platform-specific guides

## Documentation Structure
- **Main README**: Complete setup and deployment instructions
- **Component READMEs**: Specific instructions for each backend/frontend component
- **Deployment Guides**: Platform-specific deployment instructions (DigitalOcean, Render, GCP)
- **Evaluation Docs**: Golden dataset structure and evaluation framework usage

## Asset Organization
- **Mock Data**: Sample documents in `mock_data/` for testing RAG functionality
- **Frontend Assets**: Static files in `frontend/public/`
- **Docker Assets**: Dockerfiles and configuration in each component directory
- **Kiro Configuration**: Agent definitions and prompts in `.kiro/`

## Build Artifacts
- **Docker Images**: Built from component-specific Dockerfiles
- **Frontend Build**: Static files generated in `frontend/dist/`
- **Python Packages**: Virtual environments in each Python component
- **Database**: Supabase tables and functions from SQL scripts

## Environment-Specific Files
- **Development**: Local `.env` files with development configuration
- **Production**: Environment variables injected by deployment platform
- **Testing**: Separate test databases and mock configurations
- **Docker**: Container-specific environment variable injection
