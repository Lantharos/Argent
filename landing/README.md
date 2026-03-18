# Argent landing page

This directory contains the Svelte marketing site for Argent.

## Local development

```bash
bun install
bun run dev
```

## Checks

```bash
bun run check
bun run build
```

## Cloudflare Pages

This app is a static Vite build and can be deployed directly to Cloudflare Pages.

- Build command: `bun run build`
- Build output directory: `dist`
- Root directory: `landing`

## Notes

- The page uses the real Argent icon and the current desktop preview image from the main repository.
- Messaging is intentionally aligned with the current project status: Windows-first today, macOS and Linux untested, open source, and free forever.
