COMPOSE := docker compose
SCALE_API := 3
SCALE_WORKER := 3

.PHONY: up down seed loadtest build test

up:
	$(COMPOSE) up -d --build --scale api=$(SCALE_API) --scale worker=$(SCALE_WORKER)

down:
	$(COMPOSE) down -v

build:
	npm install
	npm run build

test:
	npm test

seed:
	npx tsx scripts/seed.ts

loadtest:
	k6 run loadtest/k6.js
