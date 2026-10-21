# Operator instruction corrections

These changes apply to operator-owned files outside this repository. Keep those files unchanged in this worktree. Apply the corrections at their source so they do not conflict with repository policy.

## Shared implementation skill

In `/home/frag/.agents/skills/implement/SKILL.md`, replace the instruction to run the full test suite once at the end with:

> Run typechecking and relevant single test files regularly. Follow the repository's canonical validation procedure for final checks; do not run the full test suite unless that procedure explicitly requires it.

The repository procedure is [Validation](validation.md). It prohibits the full suite locally.

## Global agent instructions

In `/home/frag/AGENTS.md`, remove the mandate to fix unrelated lint, test, or UI issues. Replace it with:

> Keep work within the requested scope and report unrelated issues separately. Do not change unrelated files unless the operator authorizes the work.

This matches the repository's [contribution scope policy](../../CONTRIBUTING.md#contribution-policy).
