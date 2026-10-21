# Admin implementation guidance

Read this reference before changing `packages/admin`, admin-facing API integration, localization, accessibility, or RTL behavior. Follow [repository-wide safety guidance](../../AGENTS.md), [review standards](review-standards.md), and [canonical validation](validation.md).

## UI components and styling

The admin is a React SPA mounted at `/_emdash/admin/*`. Use Cloudflare Kumo components for buttons, inputs, dialogs, and other controls. Look up component APIs with `npx @cloudflare/kumo doc Button` or list components with `npx @cloudflare/kumo ls`.

Use `Button` for in-place actions, `LinkButton href="..." external` for external links, and `RouterLinkButton to="..."` for internal router-aware links. Use `buttonVariants()` only for non-button elements that need button classes. Never nest a button inside a link or hand-roll button styling.

Use semantic Kumo tokens, not raw Tailwind colors or `dark:` variants. Do not duplicate component styles. Use logical spacing, borders, positioning, text alignment, and corner classes for RTL. For example, use `ms-*`/`me-*`, `start-*`/`end-*`, and `text-start`/`text-end`, not physical left/right classes. Flip directional icons with `rtl:-scale-x-100` or use bidi-aware icons. `LocaleDirectionProvider` syncs document direction and language.

Use `ConfirmDialog` for confirmation. Use `DialogError` and `getMutationError()` for inline errors in form dialogs. Pass `mutation.error` directly; do not manage duplicate error state. API clients use `throwResponseError()` to retain server messages, not a generic replacement error.

## Localization

All user-facing strings, aria labels, titles, placeholders, alt text, and toast messages use Lingui. Catalogs are in `packages/admin/src/locales/{locale}/messages.po`; enabled locales are in `locales.ts`. Do not include generated PO changes in non-translation work. Set `EMDASH_PSEUDO_LOCALE=1` in development to find untranslated strings.

Use `useLingui` and `Trans` in components:

```tsx
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@cloudflare/kumo";

function DeleteButton() {
	const { t } = useLingui();
	return <Button aria-label={t`Delete post`}>{t`Delete`}</Button>;
}

<Trans>
	Published by <strong>{authorName}</strong>
</Trans>;
```

Use `plural` for count-dependent text. Use `msg` descriptors for module-scope labels, then resolve them with `t(descriptor)` inside the component. Do not call `t()` at module scope. Do not concatenate translated fragments; use interpolation or `Trans` so translators can reorder text.

Server errors remain English with stable `SCREAMING_SNAKE_CASE` codes; map them client-side. Do not wrap developer logs, URLs, or brand names. Use `aria-hidden="true"` for decorative elements instead of translated labels.

## Accessibility, direction, and verification

Test new admin UI in Arabic. Check visual direction, spacing, and directional icons, not only translated strings. New interface changes need rendered screenshots; include before-and-after images when the result alone does not show the difference. Follow [validation](validation.md) for focused tests and selected visual/RTL CI checks. Never run the full test suite locally.

## Review judgment

Use [review standards](review-standards.md) for test quality, scope, compatibility, performance, and comment judgment. This reference contains implementation requirements, not a substitute for those reviews.
