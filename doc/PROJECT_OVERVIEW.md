# 📚 Smart School Management System - Project Overview

## System Architecture
**Frontend:** Next.js 14 (React 18, TypeScript, Bootstrap 5)  
**Backend:** Node.js Express API  
**Database:** PostgreSQL  
**Deployment:** Local (Port 3000 - Client, Port 5000 - API)

---

## 🎯 Core Modules

### 1. **Academic Management**
- Classes & Sections configuration
- Subjects management
- Teacher assignments
- Examination scheduling & management
- Automatic class promotion system
- Teachers' academic view & permissions

### 2. **Student Management**
- Complete admission process with discounts
- Student profile creation & editing
- Bulk student import via Excel
- Student details & record management
- **Family ID System** - Groups related students
- **Sibling Relationship Tracking** - Blood siblings & cousins with auto-filled parent details
- Student search with advanced filters

### 3. **Fee Management**
- Configurable fee heads (Tuition, Transport, etc.)
- Multiple fee plans per class
- Fee slip generation & printing
- Fee collection tracking
- Opening balance management
- Exam fees separate collection module
- Admission discounts system
- Payment status tracking (Paid/Pending/Unpaid)

### 4. **Attendance Module**
- Staff attendance tracking
- Student attendance marking
- Daily/monthly attendance reports
- Attendance history & analytics

### 5. **Expense Management**
- 7 default expense categories (Salaries, Utilities, Office Supplies, Maintenance, Transportation, Marketing, Miscellaneous)
- Expense entry with vendor details
- Payment method tracking (Cash, Bank Transfer, Cheque, Credit Card, Online)
- Status management (Pending/Approved/Rejected)
- Advanced filtering by category, date range, payment method
- Financial summary dashboard with category breakdown

### 6. **Human Resource Management (HRM)**
- Employee/Staff master database
- Department management
- Role assignments
- Staff leave tracking
- Employee records with attendance data

### 7. **Reporting & Analytics**
- Admission reports with statistics
- Student records export
- Expense reports with summaries
- Family-wise fee reports
- Examination result reports
- Attendance reports
- Real-time dashboards with visual analytics (Charts & Graphs)

### 8. **Settings & System Configuration**
- General system settings
- Academic calendar configuration
- User management & authentication
- Role-based permission setup
- System defaults configuration
- Backup scheduling (Auto-backup feature)

### 9. **Access Control & Authentication**
- Role-based access control (RBAC)
- Multiple user roles:
  - Administrator/Principal (Full system access)
  - Teachers (Academic & attendance view)
  - Accountant/Finance/Cashier (Fee & expense management)
  - Students (Portal access)
  - Custom roles support
- User login with encrypted passwords
- Per-role customized dashboards

### 10. **Dashboard Analytics**
- **Admin Dashboard** - System overview, key metrics
- **Teacher Dashboard** - Class attendance, exam data, student list
- **Accountant Dashboard** - Fee collection, pending payments, expense summary
- **Student Dashboard** - Personal profile, fee status, results
- Real-time data visualization with Recharts

---

## ✨ Key Features

| Feature | Details |
|---------|---------|
| **Multi-Role Support** | 5+ configurable roles with granular permissions |
| **Family Management** | Track student families with multiple siblings |
| **Data Import/Export** | Excel support for bulk operations |
| **Financial Tracking** | Complete fee & expense management |
| **Auto-Backup** | Scheduled automatic database backups |
| **Permission-Based UI** | Interface adapts based on user role |
| **Search & Filter** | Advanced filtering across all modules |
| **Print Ready** | Fee slips, admission forms, reports printable |
| **Real-time Updates** | Instant status changes and notifications |
| **Responsive Design** | Bootstrap-based responsive layout |

---

## 🗄️ Database Features

- **Students Table** - Complete admission & family data
- **Families Table** - Family grouping with auto-generated IDs (FAM-YYYY-NNNN)
- **Siblings Table** - Relationship tracking (blood/cousin)
- **Fee Structure** - Configurable heads, plans, and slips
- **Expense Tracking** - Categories and transaction history
- **Attendance Records** - Daily tracking for staff & students
- **Employee Database** - Staff details with departments
- **User Accounts** - Login credentials with role assignments
- **Audit Logs** - Transaction history tracking

---

## 🚀 Quick Start

1. **First Time:** Double-click `FIRST_TIME_SETUP.bat`
2. **Daily Usage:** Double-click `RUN_APP.bat` → Select Option 1
3. **Access:** http://localhost:3000 (Client) | http://localhost:5000 (API)
4. **Default Login:** Username: `root` | Password: `root123`

---

## 📊 Technology Stack

**Frontend:**
- Next.js 14, React 18, TypeScript
- Bootstrap 5 & Bootstrap Icons
- Recharts (Data Visualization)
- React Toastify (Notifications)
- XLSX (Excel Export)

**Backend:**
- Express.js, Node.js
- PostgreSQL with node-pg driver
- Multer (File Upload)
- Bcryptjs (Password Encryption)
- CORS (Cross-Origin Support)
- Node-Cron (Scheduled Tasks)

---

## 📝 Current Status

✅ **Fully Functional System** with:
- Complete student lifecycle management
- Integrated family tracking
- Financial management & reporting
- Staff attendance & management
- Role-based access control
- Automated backup system
- Production-ready architecture

---

**Version:** 1.0.0 | **Last Updated:** April 2026
