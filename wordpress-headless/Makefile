# Thin wrapper around docker compose. Every command here is the same command that appears
# in ../.lessons/appendix/07-command-reference.md — this file adds no new behaviour, it
# just stops you from typing two -f flags four hundred times.
#
# Usage:  make up          make wp ARGS="plugin list"        make help

# Both -f flags even though .env sets COMPOSE_FILE: this file must work in a
# fresh clone that has no .env yet, and an explicit -f always wins anyway.
COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml
WP      := $(COMPOSE) run --rm wpcli wp

.DEFAULT_GOAL := help
.PHONY: help up up-wait down nuke ps logs logs-db sh wp reset-db debug-log mail adminer uploads-own

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start the stack, detached
	$(COMPOSE) up -d

up-wait: ## Start and block until every healthcheck passes (what CI uses)
	$(COMPOSE) up -d --wait

uploads-own: ## Give the btt-uploads volume to uid 33. Once per fresh volume.
	$(COMPOSE) exec wordpress chown 33:33 /var/www/html/wp-content/uploads

down: ## Stop and remove containers. Volumes and your code are untouched.
	$(COMPOSE) down

nuke: ## DESTRUCTIVE: down -v — deletes btt-db-data and btt-uploads
	@printf 'This deletes the database AND uploads. Type YES to continue: ' \
		&& read ans && [ "$$ans" = "YES" ] || (echo "Aborted."; exit 1)
	$(COMPOSE) down -v
	@echo 'Next up needs `make uploads-own` again — the volume is new.'

ps: ## What is running, and is it healthy?
	$(COMPOSE) ps

logs: ## Follow the WordPress container log
	$(COMPOSE) logs -f wordpress

logs-db: ## Follow the MySQL container log
	$(COMPOSE) logs -f db

sh: ## A shell inside the wordpress container
	$(COMPOSE) exec wordpress bash

wp: ## Run WP-CLI:  make wp ARGS="plugin list"
	$(WP) $(ARGS)

reset-db: ## Drop and recreate the schema. Keeps plugins, themes and uploads.
	$(WP) db reset --yes
	@echo 'Schema dropped. Re-run wp core install'

debug-log: ## Follow wp-content/debug.log (inside the container)
	$(COMPOSE) exec wordpress tail -f /var/www/html/wp-content/debug.log

mail: ## Open Mailpit
	@echo "http://localhost:8025"

adminer: ## Open Adminer
	@echo "http://localhost:8081"
