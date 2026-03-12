# POS App MVP

Dark-style Point of Sale monorepo with a React + Vite frontend, Express API backend, PostgreSQL persistence, local development flow, and Docker Compose support.

## Stack

- Frontend: React, Vite, TypeScript, React Router
- Backend: Node.js, Express, `pg`, JWT auth, bcrypt password hashing
- Database: PostgreSQL
- Infra: Docker, Docker Compose, SQL init/seed scripts

## Folder Structure

```text
pos-app/
  frontend/   React + Vite + TypeScript client
  backend/    Express API, auth, RBAC, business logic
  infra/      Dockerfiles, Compose, Postgres init/seed scripts
  .gitignore
  README.md
```

## Implemented MVP Features

- Login with username or email plus password
- JWT-based authentication
- Role-based access control for `superadmin` and `user`
- Product catalog and product creation
- User management for superadmin
- POS sales screen with cart, quantity controls, payment method, sale type, and sale confirmation
- Product search by name, SKU, or barcode
- Sales history and recent sales
- Automatic stock discount after sale
- Low-stock warning without blocking the sale
- Daily cut summary and history
- Reminders module with completion flow
- Dashboard summary cards for admin
- Future-ready import/sync tables and service placeholders

## Default Local Users

These are for local development only:

- Superadmin
  - username: `admin`
  - email: `admin@pos.local`
  - password: `Admin123*`
- User
  - username: `cajero`
  - email: `cajero@pos.local`
  - password: `Cajero123*`

## PostgreSQL Setup

Create a PostgreSQL database named `pos_app`, then run the SQL files in this order:

1. [infra/postgres/01-schema.sql](/C:/Users/tatue/Documents/POS_SaaS/pos-app/infra/postgres/01-schema.sql)
2. [infra/postgres/02-seed.sql](/C:/Users/tatue/Documents/POS_SaaS/pos-app/infra/postgres/02-seed.sql)

Example with `psql`:

```powershell
psql -U postgres -d pos_app -f infra/postgres/01-schema.sql
psql -U postgres -d pos_app -f infra/postgres/02-seed.sql
```

## Local Run

### 1. Backend

```powershell
cd backend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Default backend URL: `http://localhost:4000`

### 2. Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Default frontend URL: `http://localhost:5173`

The Vite dev server proxies `/api` to `http://localhost:4000`, so the browser does not need a hardcoded container host.

## Environment Variables

### Backend

See [backend/.env.example](/C:/Users/tatue/Documents/POS_SaaS/pos-app/backend/.env.example).

- `PORT`
- `NODE_ENV`
- `FRONTEND_URL`
- `JWT_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

### Frontend

See [frontend/.env.example](/C:/Users/tatue/Documents/POS_SaaS/pos-app/frontend/.env.example).

- `VITE_API_URL`
- `VITE_PROXY_TARGET`

## Docker Compose Run

From [infra/docker-compose.yml](/C:/Users/tatue/Documents/POS_SaaS/pos-app/infra/docker-compose.yml):

```powershell
cd infra
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- PostgreSQL: `localhost:5432`

Notes:

- PostgreSQL auto-runs the schema and seed scripts from `infra/postgres/`.
- Backend connects to PostgreSQL with the container hostname `postgres`.
- Frontend dev server proxies `/api` to `http://backend:4000` inside the container network.
- Source folders are mounted as volumes for stable iterative development.

## API Overview

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `PATCH /api/users/:id/status`
- `GET /api/products`
- `POST /api/products`
- `PUT /api/products/:id`
- `PATCH /api/products/:id/status`
- `GET /api/sales`
- `GET /api/sales/recent`
- `POST /api/sales`
- `GET /api/daily-cuts`
- `GET /api/daily-cuts/today`
- `GET /api/reminders`
- `POST /api/reminders`
- `PUT /api/reminders/:id`
- `PATCH /api/reminders/:id/complete`
- `GET /api/dashboard/summary`

## Future Integration Hooks

Prepared but intentionally not fully implemented in v1:

- `import_jobs` table for Google Sheets, Excel, and n8n-triggered jobs
- `sync_logs` table for future outbound/inbound integration traceability
- [backend/src/services/integrationService.js](/C:/Users/tatue/Documents/POS_SaaS/pos-app/backend/src/services/integrationService.js) placeholder methods
- `clients`, `suppliers`, and `reports` tables for future operational expansion

## Verification Notes

- Backend source files were syntax-checked with `node --check`.
- Dependency installation and a full frontend build were not completed in this environment because `npm install` timed out during sandboxed execution.
