# Smart School System - Complete Features and Workflows

This document is a full feature and workflow explanation covering major user journeys across the system.

## 1) Core Features (Complete List)

- Role-based authentication and permission-based UI
- Multi-dashboard experience (admin/teacher/accountant/student)
- Student admission and profile lifecycle
- Family grouping and sibling relation tracking
- Bulk student import
- Academic setup (classes, sections, subjects, teacher assignments)
- Student promotion workflows
- Student/staff attendance with history
- Fees engine:
  - fee heads
  - fee plans
  - monthly slip generation
  - family-aware slips
  - print queue
  - payment collection
  - payment reversal
  - opening balance and previous balance handling
  - admission fee ledger
  - exam fee collection
- Examination/marks/result workflows
- HRM (departments, employees)
- Expense categories and expense records
- Reports (student/results/expenses/family-fee/admission)
- School settings and system settings
- Backup creation/list/download/delete/restore

---

## 2) User Role Workflows

## Administrator / Principal

- Logs in to full dashboard.
- Configures settings, users, roles, permissions.
- Manages academics, students, fees, HRM, expenses, reports.
- Performs system-level operations (backup/settings administration).

## Teacher

- Uses teacher dashboard.
- Views assigned classes/subjects.
- Works on attendance and exam/marks sections based on permissions.

## Accountant / Finance

- Uses accountant dashboard.
- Generates/prints/collects fee slips.
- Manages admission fee collection and exam fee collection.
- Monitors pending dues and payment reports.

## Student (portal-style role)

- Receives restricted role-level view.
- Can access limited dashboard/report features according to assigned permissions.

---

## 3) End-to-End Workflow Details

## A) Student Admission Workflow

1. Open `Students -> New Admission`.
2. Enter personal/guardian/contact/academic/fee fields.
3. Upload image/documents if needed.
4. System:
   - generates admission number
   - links/creates family
   - creates/links sibling relations if selected
   - creates corresponding app user (student login)
   - creates admission ledger record when admission fee is set
5. Student appears in details/profile pages.

---

## B) Family and Sibling Workflow

1. Search potential siblings during admission or from family tools.
2. Link students as blood/cousin relations.
3. Merge duplicate family groups when required.
4. Maintain family-level fields:
   - family fee
   - opening balance
   - opening balance payments

---

## C) Academic Setup Workflow

1. Configure classes.
2. Configure sections per class.
3. Configure subjects.
4. Assign teachers to classes/subjects.
5. Set academic year/term.
6. Use promotion flow at year-end/term transitions.

---

## D) Attendance Workflow

### Student attendance

1. Open attendance page.
2. Select class/section/date context.
3. Mark present/absent/late/leave.
4. Submit records.
5. Review student attendance history page.

### Staff attendance

1. Open staff attendance page.
2. Mark status/check-in/check-out context.
3. Submit.
4. Review staff history.

---

## E) Fee Generation to Collection Workflow

1. Configure fee heads and plans.
2. Open `Fees -> Generate Slips`.
3. Select class, month(s), year, due date, and optional extras.
4. System generates slips with line items, including family-aware handling where applicable.
5. Open `Fees -> Print` to print vouchers and mark printed state.
6. Open `Fees -> Collect` to receive payments:
   - full or partial payment
   - status transition to paid/partial/unpaid
   - print tracking and receipt behavior
7. For corrections, payment reversal logic updates slip totals/statuses and related ledgers.

---

## F) Opening Balance and Previous Balance Workflow

1. Maintain family opening balances from opening balance screen.
2. Record OPB payments.
3. During monthly slip/payment flows, previous balances can be included and reconciled.
4. System updates outstanding and paid values across relevant records.

---

## G) Admission Fee Ledger Workflow

1. Admission fee amount is captured on admission/edit.
2. Ledger entries track:
   - billed amount
   - collected amount
   - discounts
   - remaining
3. Payments can optionally inject related tuition flow depending on backend logic.

---

## H) Examination Workflow

1. Open marks entry context.
2. Select class/section/subject/term/exam context.
3. Enter or update marks.
4. Generate result-card and marks-sheet views.
5. Use test-marking workflow for test-level records where applicable.

---

## I) HRM Workflow

1. Create departments.
2. Add/update employee records.
3. Use employee detail pages for profile-level operations.
4. Use teacher assignment module where employee data intersects academics.

---

## J) Expense Management Workflow

1. Create/maintain expense categories.
2. Add expense records with amount/date/category/method/status/vendor notes.
3. Edit expenses when needed.
4. Track summaries and reports in expenses pages/reports module.

---

## K) Reporting Workflow

Report pages provide filtered data and summary views for:

- students
- exam results
- expenses
- family fee
- admission

These report views rely on backend aggregated query endpoints.

---

## L) Settings and System Operations Workflow

1. Configure school profile settings and branding.
2. Manage academic/system settings.
3. Manage users and roles.
4. Use system tools for:
   - backup creation
   - backup download
   - backup deletion
   - backup restore
   - database stats
   - scheduler-related backup preferences

---

## 4) Architecture-to-Feature Mapping

- UI modules in `client/app` map directly to backend routes in `server/routes`.
- Permission checks are applied at frontend route and navigation levels.
- Database stores module-level data; backend performs SQL joins and aggregations for dashboards and reports.
- Feature-rich fee and family flows use transactional logic due to cross-table impact.

---

## 5) Complete Module Coverage Checklist

- [x] Dashboard
- [x] Auth / login
- [x] Students
- [x] Family and sibling
- [x] Academic (classes/sections/subjects/teachers/promotion)
- [x] Attendance
- [x] Fees (all submodules)
- [x] Examination
- [x] HRM
- [x] Expenses
- [x] Reports
- [x] Settings
- [x] System/backup operations

---

## 6) Documentation Companion Files

For complete project understanding, read these together:

- `doc/SYSTEM_DETAILED_ARCHITECTURE.md`
- `doc/CLIENT_MODULES_AND_PAGES.md`
- `doc/SERVER_API_AND_MODULES.md`
- `doc/FEATURES_AND_WORKFLOWS_COMPLETE.md`
- `doc/FAMILY_FEE_SYSTEM_IMPLEMENTATION.md`
- `doc/MULTIUSER_SHARED_PORTAL_SYSTEM.md`

---

## 7) Advanced Workflow Notes (Implementation-Matched)

### Family Fee Advanced Notes

- family-slip vs individual-slip behavior depends on active family size.
- previous-balance handling is not only display-level; it is transactional in payment flows.
- OPB and old pending fee reconciliation is automated in payment and payment-reversal operations.

### Shared Portal Advanced Notes

- this is one shared portal, not separate apps per role.
- role level resolves dashboard tier.
- permission matrix resolves page/module visibility and action capability.
- student portal users are generated from student admission lifecycle.

