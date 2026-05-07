# Server Documentation - API, Modules, and Backend Functionality

This document explains backend structure and module behavior for `server/`.

## 1) Backend Core

### Entrypoint and app wiring

- `server/index.js`
  - creates Express app
  - initializes middleware
  - mounts all route modules
  - starts server
  - triggers migration/seed/scheduler initialization

### Database connection

- `server/db.js`
  - PostgreSQL pool via `pg`
  - supports either `DATABASE_URL` or individual `DB_*` env vars

### Runtime config

- `server/package.json`
- `server/nodemon.json`
- `server/.env` (environment values)

---

## 2) Middleware and Infrastructure

- `cors()` for cross-origin requests
- `express.json()` for JSON request bodies
- static file serving for uploads (`/uploads`)
- file upload handling through `multer` in relevant routes
- backup/restore uses filesystem + child process execution in system routes

---

## 3) Complete Route Module Inventory

Mounted route modules under `server/routes`:

- `auth.js`
- `dashboard.js`
- `students.js`
- `hrm.js`
- `classes.js`
- `subjects.js`
- `teachers.js`
- `settings.js`
- `academic.js`
- `promotion.js`
- `roles.js`
- `users.js`
- `system.js`
- `expense-categories.js`
- `expenses.js`
- `fee-heads.js`
- `fee-plans.js`
- `fee-slips.js`
- `exam-fees.js`
- `attendance.js`
- `exams.js`
- `reports.js`
- `fix_sql.js`
- `exam-fees-temp.js`

---

## 4) Module-by-Module Functionality

## Authentication (`/auth`)

Primary role:

- login endpoint validates credentials with bcrypt
- returns user profile with role info and permission list

Typical functionality:

- username/password verification
- active/inactive account checks
- permission payload aggregation for frontend consumption

---

## Roles and Permissions (`/roles`)

Primary role:

- role CRUD and cloning with permission mappings

Typical functionality:

- list all roles
- get role details + assigned user count
- create role with permission matrix
- update role (including safe apply-to-assigned behavior)
- clone existing roles
- delete non-protected roles

---

## Users (`/users`)

Primary role:

- system user account management

Typical functionality:

- list users with role mapping
- create users and hash passwords
- update user metadata, activation, role assignment
- update password
- delete user records

---

## Students and Family/Sibling Management (`/students`)

Primary role:

- student lifecycle and family relationship workflows

Typical functionality:

- student admission creation
- bulk import and mapped normalization
- student listing with advanced filters
- student detail fetch and updates
- status toggling and user-link updates
- student credential generation and password reset
- family lookup and family fee/opening balance operations
- sibling search/link/merge workflows
- duplicate family detection and merge tools

---

## Dashboard Aggregations (`/dashboard`)

Primary role:

- analytics endpoints for role-based dashboards

Typical functionality:

- admin summary stats and trend charts
- teacher dashboard (assigned classes/subjects/attendance)
- accountant dashboard (collection/pending/payment trends)
- daily attendance detail popups
- daily fee receipts stats/lists

---

## Academic Settings and Terms (`/academic`)

Primary role:

- academic calendar and term management

Typical functionality:

- academic year create/list/update/activation
- term create/list/update/activation
- active year/term retrieval
- term-based exam-related context support

---

## Classes and Sections (`/academic` via `classes.js`)

Primary role:

- class/section configuration APIs

Typical functionality:

- class CRUD
- section CRUD and mapping to classes
- active class/section retrieval for forms and filtering

---

## Subjects (`/academic/subjects`)

Primary role:

- subject management and class/section association

Typical functionality:

- subject create/list/update/delete
- subject retrieval by academic context

---

## Teachers (`/academic/teachers`)

Primary role:

- teacher assignment and academic teaching mapping

Typical functionality:

- teacher list for academic assignment
- class assignment APIs
- subject assignment APIs
- assignment query endpoints for UIs

---

## Promotion (`/promotion`)

Primary role:

- student promotion workflows

Typical functionality:

- load promotion candidates
- execute promotion actions
- update student academic placement fields

---

## Attendance (`/attendance`)

Primary role:

- student and staff attendance APIs

Typical functionality:

- mark student attendance
- mark staff attendance
- attendance history retrieval
- daily summaries for dashboard/reporting usage

---

## Fee Heads (`/fee-heads`)

Primary role:

- manage fee head definitions

Typical functionality:

- fee head CRUD
- active/inactive state handling
- head type support for tuition/prev-balance and other categories

---

## Fee Plans (`/fee-plans`)

Primary role:

- build and manage fee plans per class/context

Typical functionality:

- fee plan CRUD
- head-to-plan mapping
- class association
- active plan selection data for generation flow

---

## Fee Slips and Payment Engine (`/fee-slips`)

Primary role:

- monthly fee operations and payment processing

Typical functionality:

- generate slips (single/multi-month, family-aware logic)
- fetch available months and generated slips
- print queue and printed-state marking
- get slip details and line items
- collect payments and update statuses
- reverse/delete payments and reconcile values
- admission fee ledger operations
- class-month undo for unpaid slips
- family fee summary retrieval

---

## Exam Fees (`/exam-fees`)

Primary role:

- exam fee collection and tracking

Typical functionality:

- exam fee dues/list retrieval
- payment/collection posting
- status updates and reporting support

---

## Examinations (`/exams`)

Primary role:

- exam marks, results, test marking workflows

Typical functionality:

- context retrieval for marks entry
- save/update marks
- result card data APIs
- marks sheet APIs
- test paper and test marking endpoints
- lock/unlock behavior for controlled submissions

---

## Expense Categories (`/expense-categories`)

Primary role:

- expense category setup management

Typical functionality:

- category CRUD
- active category retrieval for expense forms

---

## Expenses (`/expenses`)

Primary role:

- expense record management and financial summaries

Typical functionality:

- create/list/update/delete expenses
- filtered list APIs
- category/date/method/status filtering
- aggregated totals and summary stats

---

## HRM (`/hrm`)

Primary role:

- departments/employees operations and staff record handling

Typical functionality:

- department CRUD
- employee CRUD
- employee status updates
- optional app-user linkage support for employee login workflows

---

## Reports (`/reports`)

Primary role:

- reporting APIs for frontend report screens

Typical functionality:

- student report datasets
- result report datasets
- expense report datasets
- family-fee report datasets
- admission report datasets

---

## Settings (`/settings`)

Primary role:

- school-level configuration APIs

Typical functionality:

- school settings read/update
- logo upload and file handling
- database reset operation endpoint

---

## System (`/system`)

Primary role:

- operational system config and backup management

Typical functionality:

- system settings read/update
- backup list/create/delete/download
- DB restore from uploaded SQL
- DB size/connection stats
- scheduler refresh when backup config changes

---

## 5) Database and Schema Artifacts

Primary schema/config sources:

- `server/master-seeder.js`
- `server/migrations/001_add_role_level.sql`
- additional maintenance/migration scripts under `server/old_scipts/*`

Major table groups include:

- user/role/permissions
- student/family/sibling
- class/section/subject/academic terms/years
- employee/department/teacher assignments
- attendance tables
- fees/slips/line-items/payments
- admission fee ledgers and opening balance ledgers
- exams and test marking tables
- expenses and categories
- settings/system tables

---

## 6) Boot and Maintenance Scripts

- server startup path runs migration and seeding helpers.
- backup scheduler functionality is referenced in runtime.
- repo also includes old scripts for:
  - table creation
  - schema patching
  - repair and diagnostics
  - seed/reset/check operations

---

## 7) Backend Responsibility Summary

Backend is responsible for:

- business rules enforcement
- permission-bearing user payload generation
- transactional financial updates
- attendance/academic/report aggregation
- file upload and system maintenance operations
- preserving cross-module data consistency (family fees, opening balances, ledgers, promotion states)

---

## 8) Family Fee Engine - Server Implementation Notes

Primary route file:

- `server/routes/fee-slips.js`

Key internal behaviors:

- multi-month generation with overlap checks using `months_list`
- family grouping via `family_id` + active family size
- family-slip generation with primary student selection by class ordering
- tuition head rewrite to family monthly fee label for family vouchers
- optional previous-balance line insertion from OPB + historical pending dues
- payment waterfall:
  - first settle family OPB
  - then oldest unpaid family slips
- payment reversal recomputation to restore ledger integrity

Related routes:

- `server/routes/students.js` (OPB family endpoints)
- `server/routes/reports.js` (family fee reporting endpoints)

Companion deep doc:

- `doc/FAMILY_FEE_SYSTEM_IMPLEMENTATION.md`

---

## 9) Multi-User Shared Portal - Server Responsibilities

Server side of role portal model:

- `auth.js` returns user + role + permissions payload
- `roles.js` manages role-level and permission matrix
- `users.js` manages user-role assignment and account status
- student onboarding in `students.js` auto-creates student user accounts

Core tables:

- `app_users`
- `app_roles`
- `role_permissions`
- `user_direct_permissions` (migration-defined)

Companion deep doc:

- `doc/MULTIUSER_SHARED_PORTAL_SYSTEM.md`

