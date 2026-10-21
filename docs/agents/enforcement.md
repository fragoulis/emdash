# Mechanical enforcement inventory

This page records what repository tooling checks today and what still needs review. A configured rule only proves the behavior it actually checks. It does not replace review of authorization, localization, SQL, or test quality.

## Existing enforcement

| Area                             | Evidence                                                                                                                                                                                                                                                           | Current boundary                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directional admin classes        | `packages/admin/src/styles.css` defines `[dir="rtl"]` selectors; `packages/admin/tests/locales/LocaleDirectionProvider.test.tsx` tests locale direction behavior; `.github/workflows/ci.yml` selects admin/browser and RTL visual coverage for affected paths.     | No repository-wide rule rejects physical-direction utility classes or proves every component works in RTL. Existing CSS and tests cover selected surfaces only.                                                                         |
| Secret access                    | `packages/workerd/src/sandbox/runner.ts` documents the host-secret boundary; `packages/cloudflare/tests/sandbox/bridge-settings.test.ts` verifies the Worker secret binding path; `.oxlintrc.json` configures general correctness rules.                           | No configured lint rule classifies secret values or proves all secret reads use a safe runtime boundary. Review secret flow and generated/bundled output for each change.                                                               |
| Import conventions               | `docs/agents/core.md` specifies `.js` extensions for internal ESM imports, type-only imports, and package-import extensions. `.oxlintrc.json` enables `import/no-unassigned-import` with explicit exceptions; TypeScript compiler settings are in `tsconfig.json`. | These tools cover selected import correctness, not every repository import convention. No blanket custom enforcement of all documented import patterns exists.                                                                          |
| Nested controls                  | `.oxlintrc.json` lists the configured Oxlint plugins and rules. CI runs repository lint and selected browser tests in `.github/workflows/ci.yml`.                                                                                                                  | There is no configured nested-interactive-control rule or repository-wide markup validator. Browser tests cover behavior in selected fixtures, not all markup. Parser-aware JSX/HTML analysis is needed before adding a reliable check. |
| Published migration immutability | `.github/scripts/check-migrations.mjs` and real Git fixture tests in `.github/scripts/check-migrations.test.mjs`, invoked by the `migration-immutability` job in `.github/workflows/ci.yml`.                                                                       | The guard protects numbered `.ts` migration modules present in the explicit base commit. It does not discover release history or protect migrations absent from that base.                                                              |

## Migration guard

The CI job provides the event base commit in `PROTECTED_BASE_SHA` and checks it against `HEAD`. It requires a valid full commit hash and a common ancestor with `HEAD`; an unavailable base or unrelated history fails closed. The guard protects modules present at `git merge-base "$PROTECTED_BASE_SHA" HEAD`, so commits unique to either side are not treated as shared published state. Checkout fetches full Git history. Pull requests use the base SHA, pushes use the event's before SHA, and merge groups use their base SHA.

The guard compares changed paths without rename detection against the numbered migration modules present in the base tree. It rejects content changes, deletion, rename, and file-mode changes to those paths. New migration modules, `runner.ts`, and unrelated paths remain allowed. Locally, it also checks staged and unstaged changes. It does not infer that a migration is published if it is not present in the supplied base.

Run the focused guard tests and local guard from the repository root:

```sh
node --test .github/scripts/check-migrations.test.mjs
PROTECTED_BASE_SHA="$(git merge-base origin/main HEAD)" node .github/scripts/check-migrations.mjs
```

The local guard includes committed changes since the base and staged or unstaged changes. A missing, invalid, or unrelated-history base is an error. Use the explicit target-branch commit as the base. The guard uses its merge base with `HEAD`, so the target branch can be ahead or divergent without protecting migrations introduced only on that branch.

## Why no other checks were added

The inspected configurations do not provide a reliable existing rule for directional classes, secret dataflow, nested interactive elements, or complete import conventions. Adding grep-based checks would flag valid contexts and miss syntax or dataflow cases. New checks need parser-aware scope and behavioral fixtures that show both accepted and rejected cases. Keep authorization, localization completeness, SQL safety, and test quality as human review responsibilities unless a narrowly defined semantic rule can be validated against real code behavior.
