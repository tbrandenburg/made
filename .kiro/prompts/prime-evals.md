---
description: Prime context for Langfuse evaluation development
---

# Prime: Evaluations Context

## Objective

Load context specifically for building Langfuse evaluations.

## Process

### 1. Read the Guide

Read the evaluations guide:
- `.kiro/guides/langfuse-evals.md`

### 2. Read Evaluator Files

```bash
# Custom evaluator implementations
cat backend_agent_api/evals/evaluators.py

# Production rule-based evals
cat backend_agent_api/evals/prod_rules.py

# Production LLM judge
cat backend_agent_api/evals/prod_judge.py
```

### 3. Study Golden Datasets

```bash
# Main golden dataset
cat backend_agent_api/evals/golden_dataset.yaml

# RAG-specific dataset
cat backend_agent_api/evals/golden_dataset_rag.yaml
```

### 4. Understand Langfuse Integration

```bash
# Tracing configuration
cat backend_agent_api/configure_langfuse.py

# How evals are triggered in API
grep -A 20 "run_production_evals" backend_agent_api/agent_api.py
```

### 5. Check Local Runner

```bash
cat backend_agent_api/evals/run_evals.py
```

### 6. Review Recent Eval Changes (Git Memory)

Check recent commits affecting evals for patterns and decisions:
```bash
git log --oneline -10 -- backend_agent_api/evals/
```

For commits with useful context, read the full message:
```bash
git log -3 --format="%h %s%n%b" -- backend_agent_api/evals/
```

Look for:
- `Pattern:` - Established patterns to follow
- `Decision:` - Architecture choices made
- `Gotcha:` - Known issues to avoid

## Skip

- Frontend code
- API endpoint code (except eval integration points)
- Tool implementations

## Output

Summarize:
- Evaluator patterns (pydantic-evals)
- Golden dataset structure
- Production eval flow
- Ready to implement new evaluator or test case
