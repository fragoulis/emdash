# Review standards

Use these judgment standards when reviewing a change. Implementation steps and commands remain in [task-specific references](task-routing.md) and [canonical validation](validation.md).

## Behavior and tests

A regression test must exercise a stable behavior boundary and fail when the behavior regresses. Prefer meaningful user-visible behavior over configuration pins, tautologies, mocks of the unit under test, or tests that only exercise dependencies. Add regression coverage for deterministic bugs when practical. Do not lower test expectations to make a failure disappear.

## Scope and compatibility

Review only the requested behavior and necessary adjacent work. Report unrelated findings separately. Preserve published compatibility; migrations must preserve access to existing content and remain forward-only. Check that changed behavior has an explicit compatibility decision and migration guidance when required.

## Safety and performance

Check authorization, data boundaries, secret handling, and SQL construction in the applicable implementation reference. Review anonymous route query-count changes carefully, including first-request work. Heuristic lint checks cannot prove authorization, localization completeness, SQL safety, or test quality.

## Comments

Keep comments for code readers. A comment should clarify code that cannot be made clearer or record a non-obvious constraint. Remove reviewer-directed narration, issue references, and restatements of the code. Tool directives such as `eslint-disable`, `@ts-expect-error`, `prettier-ignore`, and coverage pragmas are machine instructions; retain them and any concise reason required to explain why a rule does not apply.
