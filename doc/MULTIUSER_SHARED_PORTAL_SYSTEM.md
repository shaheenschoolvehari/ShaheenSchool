# Multi-User Shared Portal System - Full Implementation Detail

This document explains how the project implements a shared multi-user portal for Admin, Teacher, Accountant, and Student roles.

## 1) Design Objective

Single frontend + single backend serve multiple user personas by combining:

- role identity (`role_name`, `role_level`)
- role permission matrix (`role_permissions`)
- frontend route guards and navigation filtering
- backend role/permission data payload on login

---

## 2) Authentication Flow

Core files:

- `client/contexts/AuthContext.tsx`
- `client/app/login/page.tsx`
- `server/routes/auth.js`

Flow:

1. User submits username/password on login page.
2. Frontend calls `POST /auth/login`.
3. Backend:
   - finds user
   - validates hashed password with bcrypt
   - checks account active state
   - joins role and permission rows
   - returns user payload excluding password hash
4. Frontend stores user session object in browser storage.
5. User is redirected to dashboard route.

---

## 3) Session and App Shell Behavior

`AuthProvider` stores:

- `user`
- `isLoggedIn`
- `isLoading`
- `login()`
- `logout()`
- `hasPermission()`

`ClientLayout` controls:

- unauthenticated redirect to `/login`
- authenticated app shell rendering
- sidebar menu visibility by permission
- shared toast and layout behavior

This means all roles use one portal UI shell with dynamic visibility and access.

---

## 4) Role Model and Hierarchy

DB model:

- `app_roles`
- `role_permissions`
- `app_users`
- role level migration with `role_level` column

Observed role-level behavior in frontend:

- `>= 90` -> admin-level dashboard
- `>= 50` -> teacher-level dashboard
- `>= 20` -> accountant-level dashboard
- `< 20` -> student-level dashboard

Also supports custom roles because permission checks are key-driven, not hard-coded only to four names.

---

## 5) Shared Portal + Dedicated Dashboard Strategy

Root route (`/`) chooses dashboard component by role level:

- `AdminDashboard`
- `TeacherDashboard`
- `AccountantDashboard`
- `StudentDashboard`
- fallback generic dashboard

So the portal is shared, but initial experience is role-targeted.

---

## 6) Permission System (Page + Module Level)

Permission object fields:

- `module_name`
- `can_read`
- `can_write`
- `can_delete`

Frontend `hasPermission()` supports:

- exact page key checks (example: `students.admission`)
- parent fallback checks (example: `students`)
- module discovery from page-level rows
- role-level overrides for higher authority roles

This allows granular control per feature and per action type.

---

## 7) Route Protection Layers

Protection is applied at multiple levels:

1. Global auth redirect (`ClientLayout`)
2. Route-group guards (`client/app/**/layout.tsx` using `PermissionGuard`)
3. Sidebar visibility filter (`NAV_PERMISSION_MAP`)
4. Inline access denied UI if unauthorized

Result:

- unauthorized user usually cannot see menu item
- direct route hit still guarded by route-level wrapper
- protected content hidden without proper permissions

---

## 8) Shared Modules Across Roles

Portal modules include:

- students
- academic
- attendance
- examination
- fees
- expenses
- HRM
- reports
- settings

Each role gets subset access according to assigned permission matrix and role level.

---

## 9) Example Role Access Patterns (Implementation-Oriented)

## Admin

- broad read/write/delete access
- sees full sidebar
- handles settings/system, users, roles, and all modules

## Teacher

- strong access to attendance/academic/examination workflows
- limited/non-admin system access
- teacher dashboard APIs used

## Accountant

- strong access to fee, collection, finance-related reports
- accountant dashboard APIs used

## Student

- restricted portal visibility
- student-centric dashboard and limited read scope

Note: exact final access depends on permission rows configured for the user role.

---

## 10) User and Role Administration Workflow

Managed via:

- `/settings/roles` page + `/roles` APIs
- `/settings/users` page + `/users` APIs

Capabilities:

- create/edit/delete custom roles
- assign role levels
- assign module permissions
- clone role templates
- assign users to roles
- enable/disable users

This allows school-specific portal policies without code changes.

---

## 11) Student Portal Account Provisioning

In student admission flow (`students.js`):

- app user is auto-generated for student
- username pattern based on admission number
- default password hashed and stored
- student linked to `app_users` via `user_id`

Also available:

- generate credentials manually if missing
- update student account password
- activate/deactivate linked account when student status changes

So student portal is integrated directly with admission lifecycle.

---

## 12) Teacher/Employee Portal Linkage

HRM and teacher modules connect employee and teaching assignments:

- employee records are maintained in HRM
- teacher dashboard uses employee/app-user mapping where present
- assignments drive teacher-specific dashboard data (classes/subjects/attendance context)

---

## 13) Why This Is Called Shared Portal

Because:

- one app shell
- one login
- one route tree
- one backend API service
- dynamic role/permission driven visibility and capability

Instead of separate apps, behavior changes by user context.

---

## 14) Implementation Boundaries to Keep in Mind

- frontend enforces UX-level access control
- backend returns permission-aware user data
- role-level logic provides broad fallback privileges
- granular permission rows provide page/module-level control

For production hardening, server-side authorization middleware should mirror frontend guards for all protected endpoints.

