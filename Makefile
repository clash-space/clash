.PHONY: install dev dev-web dev-api-cf dev-gateway dev-full dev-gateway-full build test lint clean format setup db-web-local check-tools help bundle remotion-bundle remotion-render

# Use interactive shell to load .zshrc environment

#==============================================================================
# Configuration
#==============================================================================

# Proxy settings (disabled by default; set via environment or CLI if needed)
HTTP_PROXY ?=
HTTPS_PROXY ?=
NO_PROXY ?=

# Color output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

#==============================================================================
# Help
#==============================================================================

help: ## Show this help message
	@echo "$(BLUE)Master Clash - Development Commands$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Environment Variables:$(NC)"
	@echo "  HTTP_PROXY   - Proxy for HTTP requests (default: $(HTTP_PROXY))"
	@echo "  HTTPS_PROXY  - Proxy for HTTPS requests (default: $(HTTPS_PROXY))"
	@echo "  NO_PROXY     - Comma-separated list of bypassed hosts (default: $(NO_PROXY))"

#==============================================================================
# Prerequisites
#==============================================================================

check-tools: ## Verify required tools are installed
	@echo "$(BLUE)Checking required tools...$(NC)"
	@command -v pnpm >/dev/null 2>&1 || { echo "$(RED)Error: pnpm not found.$(NC)"; echo "$(YELLOW)Install: brew install pnpm$(NC)"; exit 1; }
	@command -v turbo >/dev/null 2>&1 || { echo "$(YELLOW)Warning: turbo not found. Run 'pnpm install' first$(NC)"; }
	@echo "$(GREEN)✓ All required tools are installed$(NC)"

#==============================================================================
# Installation
#==============================================================================

install: check-tools ## Install all dependencies
	@echo "$(BLUE)Installing TypeScript dependencies...$(NC)"
	@pnpm install
	@echo "$(GREEN)✓ Installation complete$(NC)"

#==============================================================================
# Database
#==============================================================================

db-web-local: ## Setup/migrate local D1 database for web app
	@echo "$(BLUE)Setting up local D1 database for web...$(NC)"
	@cd apps/web && pnpm db:migrate:local

db-local: db-web-local ## Setup all local D1 databases

#==============================================================================
# Development Servers
#==============================================================================

dev-web: ## Start frontend development server
	@echo "$(BLUE)Starting frontend on http://localhost:3000...$(NC)"
	@cd apps/web && HTTP_PROXY=$(HTTP_PROXY) HTTPS_PROXY=$(HTTPS_PROXY) NO_PROXY=$(NO_PROXY) pnpm dev

dev-api-cf: ## Start api-cf development server (port 8789)
	@echo "$(BLUE)Starting api-cf on http://localhost:8789...$(NC)"
	@cd apps/api-cf && HTTP_PROXY=$(HTTP_PROXY) HTTPS_PROXY=$(HTTPS_PROXY) NO_PROXY=$(NO_PROXY) pnpm dev --port 8789

dev-gateway: ## Start auth gateway
	@echo "$(BLUE)Starting auth gateway on http://localhost:8788...$(NC)"
	@cd apps/auth-gateway && HTTP_PROXY=$(HTTP_PROXY) HTTPS_PROXY=$(HTTPS_PROXY) NO_PROXY=$(NO_PROXY) pnpm dev

#==============================================================================
# Combined Development
#==============================================================================

dev: ## Start frontend + api-cf in parallel
	@echo "$(BLUE)Starting development environment...$(NC)"
	@echo "$(GREEN)Frontend:$(NC) http://localhost:3000"
	@echo "$(GREEN)API CF:$(NC)   http://localhost:8789"
	@echo ""
	@$(MAKE) -j2 dev-web dev-api-cf

dev-full: dev ## Start all services (frontend + api-cf)

dev-gateway-full: ## Start all services behind auth gateway
	@echo "$(BLUE)Starting full environment with API Gateway...$(NC)"
	@echo ""
	@echo "   ┌─────────────────────────────────────────────┐"
	@echo "   │  $(GREEN)Auth Gateway:$(NC) http://localhost:8788        │"
	@echo "   │  ├─ /          → Frontend (:3000)          │"
	@echo "   │  ├─ /sync/*    → api-cf ProjectRoom        │"
	@echo "   │  ├─ /agents/*  → api-cf ProjectRoom        │"
	@echo "   │  ├─ /assets/*  → api-cf R2 Assets          │"
	@echo "   │  └─ /api/*     → api-cf REST               │"
	@echo "   └─────────────────────────────────────────────┘"
	@echo ""
	@HTTP_PROXY=$(HTTP_PROXY) HTTPS_PROXY=$(HTTPS_PROXY) NO_PROXY=$(NO_PROXY) $(MAKE) -j3 dev-web dev-api-cf dev-gateway

#==============================================================================
# Build & Test
#==============================================================================

build: check-tools ## Build all packages
	@echo "$(BLUE)Building TypeScript packages...$(NC)"
	@pnpm turbo run build

test: check-tools ## Run all tests
	@echo "$(BLUE)Running TypeScript tests...$(NC)"
	@pnpm turbo run test

test-web: ## Run frontend tests only
	@echo "$(BLUE)Running frontend tests...$(NC)"
	@cd apps/web && pnpm test

#==============================================================================
# Remotion Bundle & Render
#==============================================================================

remotion-bundle: ## Build Remotion bundle for server-side rendering
	@echo "$(BLUE)Building Remotion bundle...$(NC)"
	@cd packages/remotion-components && npx remotion bundle src/Root.tsx
	@echo "$(GREEN)✓ Bundle created at packages/remotion-components/build$(NC)"

remotion-render: ## Render video using Remotion CLI (for local testing)
	@echo "$(BLUE)Rendering video...$(NC)"
	@echo "$(YELLOW)Usage: make remotion-render PROPS='{\"tracks\":[...]}' OUTPUT=output.mp4$(NC)"
	@[ -n "$(PROPS)" ] || { echo "$(RED)Error: PROPS is required$(NC)"; exit 1; }
	@[ -n "$(OUTPUT)" ] || { echo "$(RED)Error: OUTPUT is required$(NC)"; exit 1; }
	@cd packages/remotion-components && npx remotion render src/Root.tsx VideoComposition --props='$(PROPS)' --output="$(OUTPUT)"
	@echo "$(GREEN)✓ Video rendered to $(OUTPUT)$(NC)"

bundle: remotion-bundle ## Alias for remotion-bundle

#==============================================================================
# Code Quality
#==============================================================================

lint: check-tools ## Lint all code
	@echo "$(BLUE)Linting TypeScript...$(NC)"
	@pnpm turbo run lint

lint-web: ## Lint frontend only
	@echo "$(BLUE)Linting frontend...$(NC)"
	@cd apps/web && pnpm lint

format: check-tools ## Format all code
	@echo "$(BLUE)Formatting TypeScript...$(NC)"
	@pnpm prettier --write "**/*.{ts,tsx,json,md}"

format-check: ## Check if code is formatted (CI use)
	@echo "$(BLUE)Checking TypeScript formatting...$(NC)"
	@pnpm prettier --check "**/*.{ts,tsx,json,md}"

#==============================================================================
# Cleanup
#==============================================================================

clean: ## Clean all build artifacts and dependencies
	@echo "$(BLUE)Cleaning TypeScript artifacts...$(NC)"
	@pnpm clean || true
	@rm -rf node_modules .turbo
	@rm -f apps/web/local.db*
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

clean-all: clean ## Clean everything including all .wrangler directories
	@echo "$(BLUE)Cleaning Wrangler caches...$(NC)"
	@find . -type d -name ".wrangler" -exec rm -rf {} + 2>/dev/null || true
	@echo "$(GREEN)✓ Deep cleanup complete$(NC)"

#==============================================================================
# Utilities
#==============================================================================

deps-tree: ## Show dependency tree for all packages
	@echo "$(BLUE)TypeScript dependencies:$(NC)"
	@pnpm list --depth 0

update-deps: ## Update all dependencies
	@echo "$(BLUE)Updating TypeScript dependencies...$(NC)"
	@pnpm update --latest

info: ## Show project information
	@echo "$(BLUE)Master Clash - Project Information$(NC)"
	@echo ""
	@echo "Project Root: $(shell pwd)"
	@echo "Git Branch: $$(git branch --show-current 2>/dev/null || echo 'Not a git repo')"
	@echo "Git Status: $$(git status --short 2>/dev/null | wc -l | tr -d ' ') files modified"
	@echo ""
	@echo "$(BLUE)Node Version:$(NC) $$(node --version 2>/dev/null || echo 'Not installed')"
	@echo "$(BLUE)PNPM Version:$(NC) $$(pnpm --version 2>/dev/null || echo 'Not installed')"
	@echo ""
	@echo "$(BLUE)Environment:$(NC)"
	@echo "  HTTP_PROXY=$(HTTP_PROXY)"
	@echo "  HTTPS_PROXY=$(HTTPS_PROXY)"
	@echo "  NO_PROXY=$(NO_PROXY)"
