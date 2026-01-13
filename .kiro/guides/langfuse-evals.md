# Langfuse Evaluations

## Architecture

- **Evaluators**: `backend_agent_api/evals/evaluators.py`
- **Golden datasets**: `backend_agent_api/evals/golden_dataset.yaml`
- **Production evals**: `backend_agent_api/evals/prod_rules.py`, `prod_judge.py`
- **Tracing setup**: `backend_agent_api/configure_langfuse.py`

## Custom Evaluator Pattern

```python
from dataclasses import dataclass
from pydantic_evals.evaluators import Evaluator, EvaluatorContext, EvaluationReason

@dataclass
class MyEvaluator(Evaluator[dict, str, None]):
    threshold: float = 0.5

    def evaluate(self, ctx: EvaluatorContext[dict, str, None]) -> EvaluationReason:
        output = str(ctx.output)
        passed = len(output) > 10  # Your logic
        return EvaluationReason(value=passed, reason="Explanation")
```

## Golden Dataset Format

```yaml
cases:
  - name: test_case_name
    inputs:
      query: "User question"
    metadata:
      category: general
    evaluators:
      - Contains:
          value: "expected"
      - LLMJudge:
          rubric: "Is the response helpful?"
```

## Reference Examples

- Custom evaluators: `evals/evaluators.py` (ContainsAny, NoPII, NoForbiddenWords)
- Golden dataset: `evals/golden_dataset.yaml`
- Production sync: `evals/prod_rules.py` lines 40-80

## Key Evaluator Types

- `Contains`, `ContainsAny` - Substring matching
- `HasMatchingSpan` - Verify tool was called (OpenTelemetry)
- `LLMJudge` - AI quality assessment with rubric
- `MaxDuration` - Response time limits

## Langfuse Score Sync

```python
langfuse.api.score.create(
    request=CreateScoreRequest(
        traceId=trace_id,
        name="eval_name",
        value=1.0 if passed else 0.0,
        comment=reason
    )
)
```
