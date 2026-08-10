# Smart School System - Complete Requirement Document (Layman Style)

This document explains what the system must do, in simple non-technical language, based on complete analysis of `doc`, `client`, and `server`.

---

## 1) Project Goal

School ko ek aisa complete software chahiye jahan:

- student, teacher, accountant, admin sab ek hi system use karein
- admissions se le kar fee collection, exams, attendance, HR, expenses aur reports sab manage ho
- har user ko us ke role ke hisab se screen aur permissions milen

---

## 2) User Types (Actors)

System me primary users:

- **Admin / Principal**
- **Teacher**
- **Accountant / Finance**
- **Student**
- **Custom role users** (agar school apna role banana chahe)

Har user ka access role aur permissions se control hoga.

---

## 3) Shared Portal Requirement

System ko alag alag apps nahi banani; ek hi shared portal hoga:

- ek login screen
- ek main dashboard route
- same menu structure
- role ke mutabiq visible sections alag honge
- unauthorized page access block hoga

---

## 4) Authentication and Security Requirements

System ko:

- username + password se login allow karna hoga
- wrong credentials reject karni hongi
- inactive user ko login deny karna hoga
- login ke baad user role + permissions load karni hongi
- logout par session clear karna hoga

Role/permission model:

- module/page level permission support (`read`, `write`, `delete`)
- admin-level role ko broad/full access
- lower roles ko restricted access

---

## 5) Dashboard Requirements

Dashboard role ke hisab se change hona chahiye:

- **Admin dashboard:** full school stats
- **Teacher dashboard:** assigned classes/subjects/attendance/exam info
- **Accountant dashboard:** fee collection and pending dues
- **Student dashboard:** limited personal/assigned information

Dashboard me cards, summary numbers, trends aur recent activity show honi chahiye.

---

## 6) Student Module Requirements

### 6.1 New Admission

System ko allow karna hoga:

- new student create karna
- personal, parent/guardian, contact, academic details save karna
- photo/documents upload karna
- admission number auto-generate karna
- student ka portal account create karna

### 6.2 Student List & Search

System ko:

- class, section, gender, category, status, keyword se filter karna
- list view + detail/profile view dena
- export options provide karna

### 6.3 Student Edit & Status

System ko:

- student information update karne dena
- active/inactive status toggle karna
- status change par linked user account status update karna

### 6.4 Student Credentials

System ko:

- student credentials generate karna
- password reset/change allow karna

---

## 7) Family & Sibling Requirements

System ko family-based structure support karna hoga:

- `family_id` auto-generate format: `FAM-YYYY-NNNN`
- sibling search by name/admission/father etc.
- relation type: `blood` aur `cousin`
- sibling linking both directions me save ho
- duplicate family detect aur merge support ho

Family-level data:

- family fee
- opening balance (old dues)
- opening balance payment history

---

## 8) Academic Module Requirements

System ko academic setup complete dena hoga:

- classes create/update/delete
- sections per class manage
- subjects create/update/delete
- teacher assignments (class + subject mapping)
- academic years and terms manage
- active year/term select
- promotion process run karna

Promotion workflow:

- eligible students load
- target class/section set
- promotion/retention/transfer handling

---

## 9) Attendance Module Requirements

### Student Attendance

- daily attendance mark
- present/absent/late/leave support
- class-section-date context based entry
- history and summaries

### Staff Attendance

- daily staff marking
- status, check-in/check-out context
- department/date filters
- history page

Role behavior:

- teacher ko sirf assigned classes ka access
- admin/supervisor ko broader view/edit capabilities

---

## 10) Fee System Requirements (Complete)

## 10.1 Fee Heads

- fee head create/update/delete
- head types (including previous balance type)

## 10.2 Fee Plans

- class-wise ya all-class fee plans
- plan me multiple heads and amounts define karna

## 10.3 Monthly Slip Generation

- class/month/year basis generation
- single month + multi-month generation
- duplicate month generation block
- optional extra heads

## 10.4 Family Fee Billing

- multi-member families ke liye family slip
- solo student ke liye individual slip
- family fee line item apply

## 10.5 Print Queue

- generated slips print queue me aayen
- printed/unprinted tracking ho
- family voucher style grouping support ho

## 10.6 Fee Collection

- full or partial payment accept ho
- payment methods and references track hon
- paid/unpaid/partial status auto-update ho
- receipt print ho

## 10.7 Payment Reversal

- wrong payment delete/reverse ki ja sakay
- slip totals and statuses recalculate hon
- related balances consistent rahen

## 10.8 Previous Balance + Opening Balance

- family opening balance maintain ho
- previous balance slip me include ki ja sakay
- payment waterfall rule:
  - pehle opening balance settle
  - phir oldest pending dues settle

## 10.9 Admission Fee Ledger

- admission fee separate ledger me track ho
- billed, collected, discount, remaining clear ho
- student-level admission fee payment history ho

## 10.10 Exam Fee Collection

- exam fee collection cycles
- class/section based selection
- batch collection save

---

## 11) Examination Module Requirements

System ko:

- marks entry context provide karna (class/section/subject/term)
- marks save/update karna
- marks sheet generate karna
- result cards generate/print karna
- test marking flow support karna
- where needed lock/unlock controls provide karna

---

## 12) HRM Module Requirements

System ko:

- departments manage karne dena
- employees add/edit/delete/status manage karna
- employee detail and attendance history show karna
- optional employee portal account linkage support karna

---

## 13) Expenses Module Requirements

System ko:

- expense categories manage karna
- expense create/edit/delete/list karna
- filters provide karna (date, category, status, method)
- summary totals and breakdowns show karna
- category delete tab block karna jab us category me expenses already hon

---

## 14) Reports Module Requirements

System ko reports provide karni hongi:

- student report
- result report
- expense report
- family fee report
- admission report

Har report me:

- filters
- summary figures
- printable output

---

## 15) Settings Requirements

### General Settings

- school info (name/address/contact/email/tagline etc.)
- logo upload

### Academic Settings

- academic year setup/configure/activate
- terms setup

### User and Role Settings

- users management
- roles and permissions management

### System Settings

- backup related settings
- system toggles

---

## 16) System Operations Requirements

System-level tools:

- backup list/create/download/delete
- backup restore from SQL
- DB stats (size/connections)
- reset database operation (with strong confirmation)

Scheduler requirement:

- backup scheduling support according to configured time/frequency

---

## 17) Integration and Data Requirements

System architecture:

- frontend and backend API integration
- backend and PostgreSQL integration
- upload storage support
- transactional operations for financial integrity

Data consistency required in:

- fees and slips
- family balances
- payment reversals
- admission ledgers
- promotion and academic records

---

---

## 19) Real-Time Notifications & Alerts Requirements

System me ek automatic alert engine hona chahiye jahan:

- jab bhi koi important action ho (jaise fee collect hona, attendance lagna, exam sheet approve/publish hona), system automated notification generate kare
- header bar par Notification Bell dropdown active ho jahan unread badge counter dikhe
- user target roles, families, ya specific students ke mutabiq alerts filter kar sake aur mark-as-read kar sake

---

## 20) Examination Sheet Approval & Lock Requirements

Exam marks and tests safety ke liye:

- teacher ke submit kiye hue marks pehle `pending` approval state me hon
- Principal / Coordinator `/examination/approvals` page par sheets ko review, edit aur approve kar saken
- Publish hone par sheet auto-lock ho jaye (`exam_mark_locks` / `test_paper_locks`) taake publishing ke baad koi marks me illegal alteration na kar sake

---

## 21) Student Credentials & Quick Info Requirements

Student Profile (`/students/profile/[id]`) me:

- User ID (Username) aur Password system credentials block me direct visible/toggleable hon
- One-click copy buttons se username/password copy ho sake
- Password change modal se portal credentials update kiye ja saken
- Quick Info card ke bottom par styled **Edit Student Profile** button available ho

---

## 22) Database Master Seeder & Diagnostics Requirements

System installation aur maintenance ke liye:

- `node master-seeder.js` script bina kisi failure ke tamaam 36+ tables aur default system roles/data initialize kare
- `node db_health_check.js` script route queries aur database schema columns ki 100% diagnostic verification report de

---

## 23) Validation and UX Requirements

System must provide:

- required field validation
- clear error/success messages
- confirmation prompts before destructive actions
- loading states during API calls
- role-based visible actions (buttons/options)
- access denied behavior on unauthorized pages

---

## 24) Non-Functional Requirements (Layman)

System should be:

- easy to use for non-technical school staff
- fast enough for daily operations
- reliable in financial calculations
- secure for user accounts and sensitive data
- maintainable with clear module separation

---

## 25) Complete Module Checklist

- [x] Auth/Login
- [x] Role/Permission/User management
- [x] Dashboards
- [x] Students (profile, credentials, edit, admission, family link)
- [x] Family/Sibling
- [x] Academic setup
- [x] Promotion
- [x] Attendance (students & staff)
- [x] Fees (full cycle, opening balance, admission & exam collection)
- [x] Admission fee ledger
- [x] Opening balance
- [x] Exam fee collection
- [x] Exams/marks/result cards & **approvals/locks**
- [x] HRM
- [x] Expenses
- [x] Reports
- [x] Notifications (bell dropdown & real-time alerts)
- [x] Settings
- [x] System operations/backups & **Master Seeder / Health Diagnostics**

---

## 26) Final Requirement Summary

School ko is project me ek **complete end-to-end management system** milta hai jahan:

- ek hi platform par saari daily operations chal sakti hain
- roles ke mutabiq access control hota hai
- student se le kar accounts tak full workflow digital hai
- family-based fee and dues logic advanced level par implemented hai
- reporting and admin controls available hain

Yeh requirements document implementation ke practical behavior par based hai aur modules ke complete scope ko cover karta hai.

