# Shaheen School Management System - Complete QA & System Testing Checklist

Is testing checklist file mein software ke tamam modules, key concepts, business rules, UI validation aur workflows ki testing list mojood hai. Test karte waqt har feature ke aage checkbox `[x]` mark karein.

---

## 1. Authentication & Security Module
- [ ] **User Login**
  - [ ] Correct username aur password se successful login.
  - [ ] Incorrect credentials par proper error message.
  - [ ] Empty fields validation (Username & Password required).
- [ ] **Role-Based Access Control (RBAC)**
  - [ ] Admin User ko tamam routes aur edit/delete permissions milna.
  - [ ] Restricted Users (Teacher/Staff) ko unauthorized routes se redirect/block karna.
  - [ ] Read-only users ko edit/delete buttons hide ya disable dikhana.
- [ ] **Session & Security**
  - [ ] Token expiration / auto logout verify karna.
  - [ ] Logout karne par session clear hona aur login page par redirect hona.

---

## 2. Student Admission & Registration Module
- [ ] **Single Student Admission**
  - [ ] System auto-generated Admission Number assign kar raha hai.
  - [ ] Student details (First Name, Last Name, Gender, DOB, Class, Section) save ho rahe hain.
  - [ ] Required field validations (e.g. Student Name, Class, Guardian Name).
- [ ] **Sibling & Family Identification during Admission**
  - [ ] Admission Form mein sibling search feature working condition mein hai.
  - [ ] Sibling select karne par system automatically **Family Mode** switch kar raha hai.
  - [ ] **Blood Sibling vs Cousin Auto-Detection:**
    - [ ] Agar new student ka **Father Name** selected sibling se match hota hai $\rightarrow$ **Blood Sibling** assign ho raha hai.
    - [ ] Agar **Father Name** match nahi hota $\rightarrow$ **Cousin** assign ho raha hai.
- [ ] **Parents & Guardian Information**
  - [ ] Father Name, CNIC, Phone Number aur Occupation proper format mein save ho rahe hain.
  - [ ] Mother Name, CNIC, Phone Number save ho rahe hain.
  - [ ] Guardian Type selection (Father, Mother, Other) par dependent fields properly update ho rahe hain.
  - [ ] Orphan checkbox toggle hone par Father/Mother requirement logic verify karna.
- [ ] **Fee Structure Assignment at Admission**
  - [ ] Individual student admission par Monthly Tuition Fee, Admission Fee, aur Other Charges input karna.
  - [ ] Family Sibling admission par **Family Monthly Fee** verify karna.

---

## 3. Student & Family Profile Management
- [ ] **Student Directory & Details**
  - [ ] Class, Section, Gender, Status, aur Search Keywords (Name/Roll/Adm/Family ID) se student filtering.
  - [ ] Pagination aur sorting properly kaam kar rahi hai.
- [ ] **Student Profile View**
  - [ ] Personal details, Academic record, aur Attendance status correct show ho rahe hain.
  - [ ] Profile picture view aur update functionality.
- [ ] **Family Tree & Relationship Logic (Critical)**
  - [ ] Student profile mein **Family Siblings** section dekhna.
  - [ ] Same Father Name wale students **Blood Sibling** show ho rahe hain.
  - [ ] Cross-family linked / merged students **Cousin** show ho rahe hain.
  - [ ] Student profile A se sibling B ki profile par navigate karne par relation swap/distort nahi hota.
  - [ ] Backward aur Forward direction queries `student_siblings` table se exact `relation_type` fetch kar rahi hain.
- [ ] **Family Merge & Cross-Linking**
  - [ ] Merge Families feature se do families ko combine karna.
  - [ ] Merge hone ke baad original blood siblings ka status **Blood** hi rehta hai aur nayi family ke members **Cousin** bante hain.

---

## 4. Fee Structure & Fee Generation Module
- [ ] **Fee Plans & Heads Setup**
  - [ ] Naye Fee Heads (Tuition Fee, Admission Fee, Exam Fee, Sports Fee, Previous Balance) create aur edit karna.
  - [ ] Class-wise Fee Plans define karna.
  - [ ] Per Student vs Per Family head types verify karna.
- [ ] **Monthly Fee Generation**
  - [ ] Specific Month aur Year ke liye fee slips batch generate karna.
  - [ ] Pre-existing slips wale month ke liye duplicate generation block hona ya overwrite option dena.
  - [ ] Custom Fee Heads generate karte waqt include/exclude karna.
- [ ] **Family Fee Logic**
  - [ ] Single family unit ke tamaam active siblings ki fees ek hi combined **Family Voucher** mein aggregate ho rahi hai.
  - [ ] Individual students ke liye alag individual fee slip generate ho rahi hai.
- [ ] **Opening Balance (OPB) Setup**
  - [ ] Family level par Opening Balance amount aur notes add/update karna.
  - [ ] Monthly fee slip generation mein remaining OPB line-item auto-add hona.

---

## 5. Fee Collection & Payment Processing
- [ ] **Fee Collection Search**
  - [ ] Student Admission No, Family ID, ya Name se unpaid/partial fee slips find karna.
- [ ] **Payment Breakdown & Calculation**
  - [ ] Amount enter karne par Tuition Fee, Previous Balance, aur Other Heads mein dynamic distribution.
  - [ ] Partial payments update hona (Status: `unpaid` $\rightarrow$ `partial`).
  - [ ] Full payment par status `paid` mark hona.
  - [ ] Discount Amount apply hone par remaining balance properly adjust hona.
- [ ] **Payment Receipt & History**
  - [ ] Transaction Date, Payment Method (Cash, Bank, Online), Reference No, aur Received By save hona.
  - [ ] Payment reversal / refund logic (agar admin authorization ho).

---

## 6. Fee Printing & Print Queue Module
- [ ] **Print Queue Page**
  - [ ] Month, Year, aur optional Class Filter se fee vouchers queue load karna.
  - [ ] Stats Bar: Total Vouchers, Pending Print, Printed Count, Family Vouchers accurately match karna.
- [ ] **Queue Sorting & Arrangement (Class & Section Priority)**
  - [ ] Vouchers **Class Descending** order mein sorted hon (e.g. Class 10 pehle, phir Class 9).
  - [ ] Class ke ander vouchers **Section Alphabetical** order mein sorted hon (e.g. Class 8 Section A pehle, Section B baad mein).
  - [ ] Family Vouchers ke case mein Highest Class & Section wala sibling Voucher Placement aur Title decide kar raha hai.
- [ ] **Print Layout & A4 Landscape Template**
  - [ ] **3 Vouchers Per A4 Landscape Page** exact height/width (91mm x 185mm) fit ho rahe hain.
  - [ ] Print preview mein Header (Logo, School Name, Phone numbers) visible hai.
  - [ ] Voucher Serial Number format (`FEB000001`) correct show ho raha hai.
  - [ ] Family Slips mein tamam active family members ki table list (Name, Father Name, Class & Section) complete 9-row layout mein render ho rahi hai.
- [ ] **Print Tracking System**
  - [ ] Vouchers print hone par "Mark as Printed" confirmation modal display hona.
  - [ ] Printed slips par **Green Printed Badge** aur Timestamp update hona.

---

## 7. Examination & Grading Module
- [ ] **Exam Terms & Test Creation**
  - [ ] Exam Terms (First Term, Mid Term, Final Term) create aur manage karna.
  - [ ] Subject-wise Class Tests aur Total Marks define karna.
- [ ] **Marks Entry & Test Marking**
  - [ ] Class, Section, Subject select karke student list load karna.
  - [ ] Student-wise Obtained Marks enter karna.
  - [ ] Invalid marks validation (Obtained Marks > Total Marks block hona).
  - [ ] Class average aur pass/fail stats calculate hona.
- [ ] **Report Card & Position Generation**
  - [ ] Term-wise Result Cards compile hona.
  - [ ] Class/Section position (1st, 2nd, 3rd) accurately calculate hona.
  - [ ] Grade Assignment (A+, A, B, C, F) scaling rules ke mutabiq verify karna.

---

## 8. Attendance Management Module
- [ ] **Daily Student Attendance**
  - [ ] Date, Class, aur Section select karke attendance sheet load hona.
  - [ ] Present, Absent, Late, Leave mark karna.
  - [ ] Bulk "Mark All Present" button.
- [ ] **Teacher & Staff Attendance**
  - [ ] Staff daily attendance marking.
  - [ ] Monthly Attendance Summaries aur Percentage calculations.
- [ ] **Attendance Reports**
  - [ ] Low attendance alert lists.
  - [ ] Student profile mein attendance ratio matching.

---

## 9. Human Resource Management (HRM) & Staff
- [ ] **Employee/Teacher Management**
  - [ ] Staff registration (Name, CNIC, Contact, Designation, Joining Date, Base Salary).
  - [ ] Teacher-to-Subject aur Teacher-to-Class-Section mapping.
- [ ] **Payroll & Salary Tracking**
  - [ ] Employee Monthly Salary record keeping.
  - [ ] Salary disbursement notes aur receipts.

---

## 10. Expenses & Accounting Module
- [ ] **Expense Categories**
  - [ ] Categories create karna (e.g. Utility Bills, Building Rent, Stationary, Refreshment, Salaries).
- [ ] **Daily Expense Entry**
  - [ ] Amount (PKR), Category, Date, Paid To, aur Description input karke expense record karna.
  - [ ] Expense receipts upload/attach karna.
- [ ] **Expense Reports**
  - [ ] Monthly aur Category-wise Expense Summaries.
  - [ ] Income vs Expense Net Cashflow Statement verify karna.

---

## 11. Class Promotion & Transfer Module
- [ ] **Academic Session End Promotion**
  - [ ] Class X ke students ko Class X+1 mein promote karna.
  - [ ] Promoted, Retained (Pass/Fail) status update hona.
  - [ ] Graduated / Left School status update.
  - [ ] Family fee aur individual fee profiles new class mein pass-on hona.

---

## 12. General Settings & System Utilities
- [ ] **School Information & Branding**
  - [ ] School Name, Address, Contact Numbers update karna.
  - [ ] School Logo upload aur Fee Slip/Report Header par Logo render hona.
- [ ] **Data Backup & Restore**
  - [ ] Database Backup download option verify karna.
- [ ] **Database Master Seeder & Health Checker**
  - [ ] `node master-seeder.js` run karne par bina kisi error ke tamaam 36+ tables aur default seed data populate hona.
  - [ ] `node db_health_check.js` run karne par routes aur database columns mein 100% verification match milna.

---

## 13. Examination Approvals & Locks Module
- [ ] **Mark Sheet Approvals (`/examination/approvals`)**
  - [ ] Status filter (`pending`, `approved`, `published`) aur Type filter (`term_exam`, `class_test`) verify karna.
  - [ ] Sheet Modal Review mein student marks view aur edit karna.
  - [ ] Approve action par status `approved` hona aur sound chime play hona.
  - [ ] Publish action par status `published` hona, sheet lock lagna, aur alert notification generate hona.
- [ ] **Mark Locks & Tamper Protection**
  - [ ] Published mark sheets par further marks modification block hona.

---

## 14. Real-Time Notifications Module
- [ ] **Notification Bell & Header Dropdown**
  - [ ] Header Notification Bell par unread notification count badge display hona.
  - [ ] Mobile view par Bell button stetch hone se prevent rehna (`width: 42px`).
  - [ ] Dropdown mein notifications view karna, Mark as Read, Mark All Read, aur Delete verify karna.
  - [ ] Notification action link click karne par destination page open hona.

---

## 15. Student Credentials & Profile Quick Info
- [ ] **Quick Info Credentials Block**
  - [ ] Student profile mein User ID (Username) aur Password show/hide eye toggle test karna.
  - [ ] Copy Username aur Copy Password buttons clipboard copy toast notification render kar rahe hain.
  - [ ] Change Password Modal se new password save karna.
  - [ ] Account Na hone par "Generate Login Credentials" button click karne par student account auto-create hona.
  - [ ] Quick Info card ke bottom par styled "Edit Student Profile" button click karne par edit page redirect verify karna.

---

## 16. Form Input & UI/UX Validation (Global Standards)
- [ ] **Numeric Field Validation**
  - [ ] All numeric inputs (`type="number"`) se browser counter spinner arrows (up/down buttons) removed hain.
  - [ ] Invalid characters (e.g., `e`, `E`, `+`, `-`) keydown par block hotay hain.
  - [ ] Amount fields (Fee, Salary, Expense) mein negative values block hona.
- [ ] **Responsive Design & UX**
  - [ ] Desktop, Tablet, aur Mobile screen resolutions par layout adjust hona.
  - [ ] Modals, Tables, aur Sidebar responsive behave kar rahe hain.
