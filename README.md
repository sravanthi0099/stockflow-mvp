# StockFlow MVP

A minimal multi-tenant SaaS inventory app (6-hour MVP). Each organization only ever sees its own data.

**Live demo:** https://stockflow-mvp-ff1v.onrender.com

## Features
- Sign up (email, password, confirm password, organization name) / log in / log out
- Organization created on signup; every query is scoped by the organization of the logged-in user
- Product CRUD (name, SKU unique per org, description, quantity, cost price, selling price, low stock threshold)
- Product list with search by name or SKU, low-stock indicator, inline "+/- N" stock adjust, confirm-before-delete
- Dashboard: total products, total units, low-stock table
- Settings: default low-stock threshold (used when a product has none; default 5)
- `last_updated_by` and `updated_at` recorded on each product

## Tech
Node.js, Express, EJS (server-rendered), SQLite (better-sqlite3), bcrypt password hashing, JWT in an httpOnly cookie, Tailwind via CDN.

## Run locally
```bash
npm install
npm start            # http://localhost:3000
npm test             # end-to-end tests incl. tenant isolation
```
Environment variables: `PORT`, `JWT_SECRET` (set a long random value in production), `DB_PATH` (SQLite file path, default `./stockflow.db`), `NODE_ENV=production`.

## Deploy (Render)
1. Push this repo to GitHub.
2. Render > New > Web Service > connect the repo (or use `render.yaml`).
3. Build: `npm install`, Start: `npm start`, set `JWT_SECRET`.
4. For data to persist across deploys, attach a persistent disk and set `DB_PATH` to a path on it (e.g. `/var/data/stockflow.db`). Without one, SQLite resets on redeploy, which is fine for a demo.

## Design notes
- Multi-tenancy: `org_id` is taken from the authenticated session, never from request input; all product queries filter on it, including update, delete and adjust.
- Password reset, roles, multi-user orgs and stock history are out of scope per the PRD.
