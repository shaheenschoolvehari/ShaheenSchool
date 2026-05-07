# Client Documentation - Modules, Pages, and Functionality

This document describes the frontend application under `client/app` and related shared components.

## 1) Frontend Structure

- App router pages live in `client/app/**/page.tsx`.
- Route-level guards are mostly in `client/app/**/layout.tsx`.
- Global shell and auth wrappers:
  - `client/app/layout.tsx`
  - `client/components/ClientLayout.tsx`
  - `client/contexts/AuthContext.tsx`
  - `client/components/PermissionGuard.tsx`

---

## 2) Global Pages and Shell

### `/` (`client/app/page.tsx`)

- Main dashboard selector.
- Shows dashboard variant based on role level:
  - admin dashboard
  - teacher dashboard
  - accountant dashboard
  - student dashboard
  - generic fallback dashboard

### `/login` (`client/app/login/page.tsx`)

- Username/password login page.
- Calls auth login action from context.
- Redirects authenticated users to dashboard.
- Shows loading and error states.

### App-wide layout (`client/app/layout.tsx`)

- Loads global styles and libraries.
- Wraps app with `AuthProvider` and `ClientLayout`.

---

## 3) Shared Auth/Guard/Navigation Behavior

### `AuthContext`

- Manages:
  - current user object
  - login/logout functions
  - loading state
  - permission checks (`hasPermission`)

### `ClientLayout`

- Handles:
  - sidebar rendering and mobile behavior
  - auth redirects
  - module navigation visibility based on permissions
  - app-level toast container

### `PermissionGuard`

- Route/module guard that blocks unauthorized content.
- Supports read/write/delete checks and access denied UI.

---

## 4) Module-wise Page Inventory and Functionality

## Students Module

Routes:

- `/students` (`client/app/students/page.tsx`)
- `/students/admission`
- `/students/import`
- `/students/details`
- `/students/edit/[id]`
- `/students/profile/[id]`

Functionality:

- New student admission form and creation workflow.
- Bulk import for student records.
- Searchable/filterable student listing.
- Student profile detail view.
- Student record editing and updates.
- Family/sibling aware student context.

---

## Academic Module

Routes:

- `/academic/classes`
- `/academic/sections`
- `/academic/subjects`
- `/academic/teachers`
- `/academic/promotion`

Functionality:

- Class setup and class data management.
- Section setup and mapping to classes.
- Subject creation and academic mapping.
- Teacher assignment views and controls.
- Student promotion workflows between classes/years.

---

## Attendance Module

Routes:

- `/attendance/students`
- `/attendance/students/history`
- `/attendance/staff`
- `/attendance/staff/history`

Functionality:

- Daily student attendance marking.
- Student attendance history and trend views.
- Daily staff attendance marking.
- Staff attendance history and reporting views.

---

## Examination Module

Routes:

- `/examination/marks`
- `/examination/result-card`
- `/examination/marks-sheet`
- `/examination/test-marking`

Functionality:

- Marks entry and update flows.
- Result card generation/view.
- Marks sheet viewing and reporting.
- Test-level marking workflows.

---

## Fee Management Module

Routes:

- `/fees/generate`
- `/fees/print`
- `/fees/collect`
- `/fees/admission`
- `/fees/exam-collection`
- `/fees/plans`
- `/fees/heads`
- `/fees/opening-balance`

Functionality:

- Monthly fee slip generation.
- Slip print queue and printed-state handling.
- Fee collection/payment posting.
- Admission fee ledger and collection workflows.
- Exam fee collection.
- Fee heads management.
- Fee plans management.
- Family opening balance management.

---

## Expenses Module

Routes:

- `/expenses/add`
- `/expenses/list`
- `/expenses/categories`
- `/expenses/edit/[id]`

Functionality:

- New expense entry creation.
- Expense list browsing, filtering, and summaries.
- Expense category configuration.
- Expense edit/update flow.

---

## HRM Module

Routes:

- `/hrm`
- `/hrm/departments`
- `/hrm/employees`
- `/hrm/employees/[id]`

Functionality:

- HRM landing and navigation area.
- Department management.
- Employee list and profile management.
- Employee detail page for deeper record actions.

---

## Reports Module

Routes:

- `/reports/students`
- `/reports/results`
- `/reports/expenses`
- `/reports/family-fee`
- `/reports/admission`

Functionality:

- Student report generation and review.
- Academic result reporting.
- Expense analysis/reporting.
- Family-fee focused reporting.
- Admission statistics and reporting.

---

## Settings Module

Routes:

- `/settings`
- `/settings/general`
- `/settings/academic`
- `/settings/roles`
- `/settings/users`
- `/settings/system`

Functionality:

- General school/system settings.
- Academic configuration settings.
- Role and permission management UI.
- System users management.
- System-level operations (including backup/config tooling).

---

## Test/Utility Route

- `/test` (`client/app/test/page.tsx`)

Functionality:

- Internal testing/sandbox page for development validation workflows.

---

## 5) Dashboard Components

Dashboard components used by root route:

- `components/dashboards/AdminDashboard.tsx`
- `components/dashboards/TeacherDashboard.tsx`
- `components/dashboards/AccountantDashboard.tsx`
- `components/dashboards/StudentDashboard.tsx`
- `components/dashboards/GenericDashboard.tsx`

Each dashboard provides role-tailored data cards, charts, summaries, and quick actions.

---

## 6) Client Utilities and UX Helpers

- Toast helper and notification wrappers:
  - `client/utils/toastHelper.ts`
  - `client/app/utils/notify.ts`
- Animated/login experience component:
  - `client/components/AnimatedBackground.tsx`

---

## 7) Permission Coverage via Layouts

Most module and submodule routes include a route `layout.tsx` wrapper to enforce read access at section level. This provides:

- consistent access control behavior
- predictable unauthorized handling
- centralized guard logic at route-group boundary

---

## 8) Detailed Fee Module Page Behaviors

### `/fees/generate`

- loads class and plan context
- allows single or multi-month selection
- submits generation payload with dates/extras
- displays generated/skipped outcomes from backend

### `/fees/print`

- fetches print queue
- renders family/individual vouchers
- supports printed-state updates

### `/fees/collect`

- retrieves slips and payment states
- accepts partial/full payments
- supports receipt/print handling
- handles payment reversal paths from backend responses

### `/fees/opening-balance`

- lists family OPB records
- supports OPB create/update/payment/reversal actions
- tracks cleared vs pending family opening dues

### `/fees/admission`

- works with admission ledger data
- records admission fee payments and discounts
- displays remaining status and payment history

---

## 9) Detailed Multi-User UI Behavior

- Sidebar is permission-filtered via route-permission map.
- `PermissionGuard` wraps protected route groups.
- Root dashboard route resolves dashboard by role-level.
- Same page tree is shared by all users, but visible pages differ by permissions.

See:

- `doc/MULTIUSER_SHARED_PORTAL_SYSTEM.md`

