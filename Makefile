.PHONY: help changelog cut-release

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

setup: ## Install locked dependencies
	npm ci

build: ## Compile TypeScript to dist/
	npm run build

lint: ## Lint with ESLint
	npm run lint

typecheck: ## Type-check
	npm run typecheck

test: ## Run the test suite
	npm run test

test-coverage: ## Tests with the coverage gate used in CI
	npm run test:coverage

benchmark: ## Run the benchmark
	npm run benchmark

all: lint typecheck test-coverage build ## Full local gate (mirror of continuous integration)

changelog: ## Regenerate CHANGELOG.md from Conventional Commits (git-cliff)
	git cliff --output CHANGELOG.md && perl -0pi -e 's/\n+\z/\n/' CHANGELOG.md

cut-release: ## Cut a release locally: version bump, changelog, tag, GitHub release (RELEASE_VERSION=vX.Y.Z optional)
	scripts/release.sh $(RELEASE_VERSION)
