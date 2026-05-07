# Family Fee System - Full Implementation Detail

This document explains exactly how the family-fee system is implemented in this project (frontend + backend + data behavior).

## 1) Purpose of Family Fee System

Family fee system is designed to:

- treat siblings/cousins as one billing unit where needed
- generate one family slip instead of duplicate individual tuition burden
- support family-level opening balance (old dues before system)
- support previous-balance carry-forward into current month slips
- keep compatibility with individual slips for non-family or single-member families

---

## 2) Core Data Model Used

Main tables involved:

- `students`
  - `student_id`, `family_id`, `monthly_fee`, class linkage, status
- `families`
  - `family_id`
  - `family_fee`
  - `opening_balance`
  - `opening_balance_paid`
  - `opb_notes`
- `student_siblings`
  - explicit sibling/cousin relation links
- `fee_plans`, `fee_plan_heads`, `fee_heads`
  - fee engine configuration and head typing (`prev_balance` etc.)
- `monthly_fee_slips`
  - generated slips (individual/family)
  - `is_family_slip`, `has_multi_months`, `months_list`
- `slip_line_items`
  - detailed head-wise billed amounts
- `fee_payments`
  - payment transactions against slips
- `family_opb_payments`
  - opening balance payments tracked at family level
- `admission_fee_ledger`, `admission_fee_payments`
  - admission dues handled parallel to monthly cycle

---

## 3) Family ID and Family Context Creation

Family IDs are generated in students admission flows (`students.js`) with pattern:

- `FAM-{YEAR}-{NNNN}`

Behavior:

- if sibling already exists with family, new student inherits same `family_id`
- if sibling has no family yet, new family is generated and backfilled
- if no sibling selected, new family is created
- family record is upserted in `families` table

This makes family fee and opening balance centrally manageable for all linked members.

---

## 4) Fee Generation Engine (How Family Fee Is Applied)

Implemented in `server/routes/fee-slips.js` (`POST /fee-slips/generate`).

Input shape includes:

- `class_id`
- `months` (or single month backward compatible)
- `year`
- optional `due_date`, `issue_date`, `extra_heads`, `plan_id`

### 4.1 Duplicate Protection

Before generation, system checks if selected month(s) already generated for:

- class level
- or corresponding students in class
- including `months_list` overlap check for multi-month slips

If collision found, generation is blocked with explicit month conflict message.

### 4.2 Plan Selection

Plan source:

- explicit plan (`plan_id`) if passed
- else latest active class/applicable/global plan fallback

Then all plan heads are loaded.

### 4.3 Student Family Grouping Rule

Students in class are split into:

- **family groups**: `family_id` exists and total active family size > 1
- **solo students**: no family or only one active member

### 4.4 Family Slip Generation Rule

For each family group:

1. skip if any family slip exists for selected months/year
2. choose primary student (highest class order in family)
3. use `family_fee` as tuition basis (instead of personal monthly fee)
4. build line items from plan heads
5. rename tuition line as `Family Monthly Fee` (and include month label for multi-month)
6. include `extra_heads` if provided
7. set `is_family_slip = true`

### 4.5 Individual Slip Rule

For solo students:

- use personal `monthly_fee` for tuition-like head
- keep other plan heads
- create standard slip with `is_family_slip = false`

### 4.6 Previous Balance Injection

If plan contains a `prev_balance` type head:

System computes family previous-balance total as:

- `OPB_remaining` from `families`
- plus pending unpaid old slip dues
- while excluding old prev-balance/admission-like line items to avoid double counting

Then `Previous Balance` line is appended in new slip and included in total.

---

## 5) Print Queue and Family Voucher Logic

Implemented in `GET /fee-slips/print-queue`.

Behavior:

- groups generated slips into vouchers
- family slips create family voucher blocks
- primary student selected by highest class
- family members list attached
- print status derived from all included slips
- supports class-filter with cross-class family coverage visibility

This is important where siblings span different classes.

---

## 6) Collection Workflow (Family Fee + Previous Balance Interaction)

Implemented in `POST /fee-slips/:id/pay`.

When payment is posted:

- `fee_payments` row inserted
- slip `paid_amount` and `status` updated
- optional head-level paid breakdown updates `slip_line_items.paid_amount`

### Previous Balance Waterfall Logic

If slip has previous-balance line:

payment component allocated to prev-balance is calculated and then:

1. **settle family opening balance first**
   - update `families.opening_balance_paid`
   - insert `family_opb_payments` audit row
2. **remaining amount settles oldest unpaid old family slips**
   - in chronological order
   - avoids counting prev-balance/admission components again

This keeps old dues auto-clearing in controlled order.

---

## 7) Payment Reversal Logic (Critical Consistency Layer)

Implemented in `DELETE /fee-slips/payments/:payment_id`.

When a payment is deleted:

- remove payment row
- recompute slip paid/status from remaining payments
- if previous-balance was involved:
  - remove auto-generated OPB payment rows for that slip
  - recompute `families.opening_balance_paid` from valid remaining OPB entries
  - recalculate this slip's OPB contribution
  - restore/recompute older slips paid/status based on actual remaining `fee_payments`

This prevents stale paid states and keeps family ledgers consistent after rollback.

---

## 8) Opening Balance Management APIs

From `students.js`:

- `GET /students/opb/families`
- `GET /students/opb/families/:family_id`
- `PUT /students/opb/families/:family_id`
- `POST /students/opb/families/:family_id/payment`
- `DELETE /students/opb/families/:family_id/payment/:payment_id`

Capabilities:

- list families with OPB status filters
- set/update opening balance
- record OPB payments
- reverse OPB payments
- track remaining OPB centrally at family level

---

## 9) Admission Fee vs Monthly Family Fee

Admission fee is separate from monthly family fee:

- tracked in admission ledger tables
- paid through dedicated admission payment APIs
- optionally injects current-month tuition behavior depending on payload

This separation allows one-time admission dues and recurring family monthly dues to coexist.

---

## 10) Frontend Pages Driving Family Fee Behavior

Main UI pages:

- `client/app/fees/generate/page.tsx`
- `client/app/fees/print/page.tsx`
- `client/app/fees/collect/page.tsx`
- `client/app/fees/opening-balance/page.tsx`
- `client/app/fees/admission/page.tsx`
- `client/app/reports/family-fee/page.tsx`
- `client/app/students/admission/page.tsx`
- `client/app/students/details/page.tsx`
- `client/app/students/profile/[id]/page.tsx`

Together these pages cover creation, billing, reconciliation, collection, and reporting.

---

## 11) Business Rules Summary (as implemented)

- family with multiple active students can be billed as family slip
- single-member family gets individual slip
- family fee overrides personal tuition logic in family slip context
- previous balance can flow from both opening balance and historical unpaid dues
- payment updates are transactional and status-aware
- payment reversal recomputes downstream financial consistency

---

## 12) Practical Example (Real Engine Behavior)

Scenario:

- Family `FAM-2026-0007` has 3 active students
- `family_fee = 6000`
- opening balance remaining = 2000
- one old unpaid slip pending = 1500
- generating for 2 months

Engine output:

- one family slip created
- tuition-like line: `Family Monthly Fee (Mon1 - Mon2)` = `6000 * 2 = 12000`
- previous balance line = `2000 + 1500 = 3500` (if prev-balance head enabled)
- total before extras = `15500` + other plan heads

On collection:

- prev-balance portion pays OPB first, then old pending slip(s)

