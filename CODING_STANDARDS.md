# Coding standards

These standards cover decisions that require reviewer judgment. See [AGENTS.md](AGENTS.md) for implementation patterns and [MAINTAINING.md](MAINTAINING.md#review-responsibilities) for review responsibilities.

## Review UI against the existing product

Compare the rendered screen with the closest existing admin screen. Check shared-shell reuse, navigation, the account menu, theme behavior, and form interactions. Exercise the interactions; screenshots alone cannot verify behavior.

Kumo components alone do not establish product consistency. Reviewers must identify unexplained differences and request corrections before approval. Accept differences only when the product need or accepted design supports them.
