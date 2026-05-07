# Smart School System - Detailed Architecture

## 1) System Overview

This project is a full school management platform split into:

- `client`: Next.js 14 + React 18 + TypeScript frontend
- `server`: Node.js + Express backend API
- PostgreSQL database accessed through the `pg` driver

Primary runtime shape:

- Frontend renders pages, captures user actions, and calls API endpoints.
- Backend handles business logic, SQL queries, data aggregation, and persistence.
- Authentication and authorization are role/permission based.

---

## 2) Technology Stack

### Frontend (`client`)

- Next.js 14 App Router
- React 18
- TypeScript
- Bootstrap 5 + Bootstrap Icons
- Recharts
- React Toastify
- XLSX (import/export support)

### Backend (`server`)

- Express 4
- `pg` PostgreSQL client
- `bcryptjs` for password hashing
- `multer` for upload/restore endpoints
- `node-cron` for scheduled tasks
- `dotenv` for environment variables
- `cors`

### Data Layer

- PostgreSQL schema includes modules for:
  - academics
  - students/families/siblings
  - fees/admission fees/opening balances
  - attendance
  - HRM
  - exams
  - expenses
  - settings/system/backup metadata
  - users/roles/permissions

---

## 3) High-Level Runtime Architecture

## Frontend lifecycle

1. `client/app/layout.tsx` loads global CSS and wraps app with:
   - `AuthProvider`
   - `ClientLayout`
2. `AuthProvider` restores session user from browser storage.
3. `ClientLayout`:
   - performs redirect behavior for unauthenticated users
   - renders sidebar and app shell for authenticated users
   - applies menu visibility based on permissions
4. feature pages fetch and mutate data using backend API endpoints.

## Backend lifecycle

1. `server/index.js` creates Express app.
2. Middleware initialization:
   - `cors()`
   - `express.json()`
   - static uploads path
3. Route mounting for all modules under specific prefixes.
4. Server boot logic:
   - essential migrations function
   - root user seed function
   - scheduler initialization

---

## 4) Functional Module Architecture

Project is organized in functional slices:

- Dashboard and analytics
- Students and admissions
- Family and sibling relations
- Academics (classes/sections/subjects/teachers/promotion)
- Attendance (students/staff + history)
- Fees (heads/plans/generation/collection/printing/opening balance/admission/exam)
- Exams and results
- HRM (departments/employees)
- Expenses and categories
- Reports
- Settings and system administration
- Authentication and RBAC

Each module has corresponding frontend route pages and backend route handlers.

---

## 5) Authentication and Authorization Model

## Authentication

- Login endpoint validates username/password against hashed password.
- User payload returned with role and permission list.

## Authorization

- Client enforces module/page visibility with:
  - `PermissionGuard`
  - sidebar permission filtering
  - role-level checks for dashboard and privileged UX
- Backend stores role/permission tables and serves role-aware user payloads.

## Role hierarchy

- Role-level numeric hierarchy is implemented (`role_level`), used for broad capability groups.

---

## 6) Data Flow Patterns

Common page-level flow:

1. Load initial reference data (`GET`).
2. Render filters/forms/tables/charts.
3. Perform create/update/delete actions.
4. Refresh list or patch local UI state.
5. Show success/error toasts.

Complex flows include:

- fee generation and slip-line-item creation
- multi-payment and status updates
- family merge/link logic
- opening balance reconciliation
- attendance and dashboard aggregates

---

## 7) Integration Boundaries

- Frontend and backend communicate via HTTP fetch calls.
- Backend communicates with Postgres through direct SQL.
- Upload/backup/restore logic interacts with filesystem and OS commands.
- Scheduled backup system reads config from DB and triggers cron behavior.

---

## 8) Operational Notes

- Repo includes helper scripts/docs for setup and local run.
- Existing docs in `doc/` cover targeted modules, while this file documents full architecture.
- There are both current and legacy scripts under server for schema/update/maintenance utilities.

---

## 9) Source Map (Primary)

### Frontend core files

- `client/app/layout.tsx`
- `client/app/page.tsx`
- `client/app/login/page.tsx`
- `client/components/ClientLayout.tsx`
- `client/components/PermissionGuard.tsx`
- `client/contexts/AuthContext.tsx`

### Backend core files

- `server/index.js`
- `server/db.js`
- `server/routes/*.js`
- `server/master-seeder.js`
- `server/migrations/001_add_role_level.sql`

---

## 10) Deep-Dive Companion Documents

For implementation-level understanding (not just overview), read:

- `doc/FAMILY_FEE_SYSTEM_IMPLEMENTATION.md`
  - complete family fee engine internals
  - previous-balance waterfall logic
  - OPB/payment reversal consistency model
- `doc/MULTIUSER_SHARED_PORTAL_SYSTEM.md`
  - shared portal behavior by role
  - auth/session/permission flow
  - route-guard and dashboard resolution model

---

## 11) Important Implementation Characteristics

- System is mostly route-driven with direct SQL in backend route handlers.
- Financial modules use transaction-aware updates due to cross-table effects.
- Family, fees, opening balance, and admission ledgers are tightly coupled.
- Multi-user behavior is implemented through one shared portal and role/permission matrix.

