# Contributing To OpenSmith

Thanks for taking the time to contribute.

Contributions are valued, but please read this file with the understanding that:

- the maintainer is not obligated to review, respond to, or accept every contribution
- review may take a while
- some contributions may never be reviewed
- low-quality, off-scope, or high-maintenance changes will be declined

The goal here is to keep the release branch focused and sustainable.

## Before You Start

- Check for existing issues or discussions first.
- For larger changes, open an issue before spending a lot of time on implementation.
- Keep pull requests scoped. Small, clear changes are much easier to review than broad rewrites.
- If you are changing product behavior, explain the user impact in the PR description.

## Good Contributions

Strong contributions usually do at least one of these well:

- fix a real bug
- improve reliability
- improve platform compatibility
- tighten UX without reworking the whole app
- improve release-facing docs
- reduce maintenance burden

## Contributions Likely To Be Rejected

These are common reasons a PR may be closed or ignored:

- drive-by refactors with no user benefit
- large stylistic churn
- speculative architecture changes
- dependency additions without a strong reason
- changes that make the codebase harder to maintain
- features that do not fit the current product direction
- low-effort AI-generated patches that were not reviewed by the contributor

## Local Setup

```bash
bun install
bun run dev:desktop
```

Useful commands:

```bash
bun run lint
bun run build
```

`bun run dev` only runs the renderer and is not enough to fully validate Electron functionality.

## Development Expectations

- Match the existing style of the touched files.
- Prefer focused patches over broad cleanup.
- Avoid unrelated refactors in the same PR.
- Do not edit docs or copy only; make sure your technical claims match the current code.
- If you add or change a dependency, explain why it is worth the maintenance cost.

## Testing Expectations

There is currently no formal automated test suite in this repository, so manual verification matters.

At minimum, if your change affects app behavior, verify the relevant flow locally and include what you tested in the PR. Helpful examples:

- launching with `bun run dev:desktop`
- loading an existing workspace folder
- editing and saving a file
- opening a terminal tab
- checking Git status in a repository
- using the AI tab with OpenCode installed

Because the maintainer does not currently have macOS or Linux machines available, platform testing from contributors is especially helpful. If you validate a change on either platform, say so clearly in the PR.

## Pull Request Guidelines

- Use a clear title.
- Describe what changed and why.
- Include screenshots or short recordings for UI changes when possible.
- Note any platform-specific behavior.
- Note any risks, limitations, or follow-up work.

## Review Policy

Please keep expectations realistic:

- opening a PR does not create an obligation to merge it
- a PR may sit for a while without feedback
- maintainability and product direction matter more than implementation effort alone
- polishing an idea is appreciated, but final product decisions remain with the maintainer

If a PR is not accepted, that does not necessarily mean the work was useless. It may simply be out of scope, mistimed, or not the right fit for the release.
