# Contributing to devbar

Thank you for your interest in contributing to our project! This guide will help you get started with the development process.

## Development Setup

### Prerequisites

- Bun installed on your system

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/TimMikeladze/devbar.git`
3. Navigate to the project directory: `cd devbar`
4. Install dependencies: `bun install`
5. Start development: `bun run dev`

### Development Mode

Run `bun run dev` - This starts a Bun + React preview app at http://localhost:3847 to test components in real-time.

## Development Workflow

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Start development mode: `bun run dev`
3. Make your changes and test them live in the preview app
4. Check code style and formatting: `bun run lint` and `bun run format`
5. Build the project: `bun run build`
6. Commit your changes using the conventions below
7. Push your branch to your fork
8. Open a pull request

### Social preview image

The Open Graph image at `app/public/og-v2.png` is generated from the HTML template in `scripts/og-image.html`. After editing the template, regenerate the PNG with `bun run og` (renders at 2x via Playwright, downscaled to 1200x630) and commit both files.

Social crawlers cache the image by URL and rarely re-fetch it, so a redesign that keeps the same filename will keep showing the old preview. When the artwork changes meaningfully, bump the version suffix (`og-v2.png` → `og-v3.png`) in `scripts/generate-og.ts` and in the `og:image`, `twitter:image`, and JSON-LD `image` tags in `app/index.html`.

### README screenshots

The screenshots in `docs/images/` are generated, not hand-taken. Start the landing page (`bun run --cwd app dev --port 5178`, after a `bun run build` so it picks up the current toolbar) and run `bun run screenshots`. The script drives the real toolbar over that page with Playwright and starts its own throwaway devbar server on port 3190, so the Agent tab shows a project claiming the page rather than whatever server happens to be running on the machine. Set `PW_CHROMIUM` if Playwright's own Chromium download is missing, and commit the regenerated PNGs alongside the change that made them stale.

The README links the images by their raw.githubusercontent URL rather than a relative path, because npm renders the same file and does not resolve relative image paths — `docs/` is not in the published `files` list either way.

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/) for clear and structured commit messages:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code changes that neither fix bugs nor add features
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Maintenance tasks, dependencies, etc.

## Pull Request Guidelines

1. Update documentation if needed
2. Ensure all tests pass
3. Address any feedback from code reviews
4. Once approved, your PR will be merged

## Code of Conduct

Please be respectful and constructive in all interactions within our community.

## Questions?

If you have any questions, please [open an issue](https://github.com/TimMikeladze/devbar/issues/new) for discussion.

Thank you for contributing to devbar!
