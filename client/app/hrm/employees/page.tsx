'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { notify } from '@/app/utils/notify';
import * as XLSX from 'xlsx';

// Types
type Employee = {
    employee_id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    designation: string;
    department_name: string;
    department_id: string; // Needed for edit
    status: string;
    system_username?: string;
    cnic?: string;
    joining_date?: string;
    salary?: string;
    address?: string;
    gender?: string;
    dob?: string;
    marital_status?: string;
    father_name?: string;
    emergency_contact?: string;
    qualification?: string;
    experience?: string;
    blood_group?: string;
    app_user_id?: number;
};

type Department = { department_id: number; department_name: string; };
type Role = { id: number; role_name: string; };

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');

    // Modal State
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit' | 'details'>('create');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [mounted, setMounted] = useState(false);

    // Form State
    const [isSysUser, setIsSysUser] = useState(false);
    const { hasPermission } = useAuth();
    const [formData, setFormData] = useState({
        first_name: '', last_name: '', email: '', phone: '', cnic: '', designation: '',
        department_id: '', joining_date: '', salary: '', address: '',
        gender: '', dob: '', marital_status: '', father_name: '',
        emergency_contact: '', qualification: '', experience: '', blood_group: '',
        status: 'Active', username: '', password: '', role_id: ''
    });

    useEffect(() => {
        setMounted(true);
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [empRes, deptRes, roleRes] = await Promise.all([
                fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/hrm/employees`, { cache: 'no-store' }),
                fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/hrm/departments`, { cache: 'no-store' }),
                fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/roles`, { cache: 'no-store' })
            ]);

            if (empRes.ok) setEmployees(await empRes.json());
            if (deptRes.ok) setDepartments(await deptRes.json());
            if (roleRes.ok) setRoles(await roleRes.json());
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const resetForm = () => {
        setFormData({
            first_name: '', last_name: '', email: '', phone: '', cnic: '', designation: '',
            department_id: '', joining_date: '', salary: '', address: '',
            gender: '', dob: '', marital_status: '', father_name: '',
            emergency_contact: '', qualification: '', experience: '', blood_group: '',
            status: 'Active', username: '', password: '', role_id: ''
        });
        setIsSysUser(false);
        setModalMode('create');
        setSelectedId(null);
    };

    const handleOpenCreate = () => {
        resetForm();
        setModalMode('create');
        setShowModal(true);
    };

    const handleOpenEdit = (emp: Employee) => {
        resetForm();
        setModalMode('edit');
        setSelectedId(emp.employee_id);
        setFormData({
            first_name: emp.first_name || '',
            last_name: emp.last_name || '',
            email: emp.email || '',
            phone: emp.phone || '',
            cnic: emp.cnic || '',
            designation: emp.designation || '',
            department_id: emp.department_id || '',
            joining_date: emp.joining_date ? emp.joining_date.substring(0, 10) : '',
            salary: emp.salary || '',
            address: emp.address || '',
            gender: emp.gender || '',
            dob: emp.dob ? emp.dob.substring(0, 10) : '',
            marital_status: emp.marital_status || '',
            father_name: emp.father_name || '',
            emergency_contact: emp.emergency_contact || '',
            qualification: emp.qualification || '',
            experience: emp.experience || '',
            blood_group: emp.blood_group || '',
            status: emp.status || 'Active',
            username: '', password: '', role_id: '',
            _has_user: emp.app_user_id ? 'yes' : ''
        } as any);
        setShowModal(true);
    };

    const handleOpenDetails = (emp: Employee) => {
        handleOpenEdit(emp);
        setModalMode('details');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const payload = { ...formData, create_system_user: isSysUser };
        const url = modalMode === 'create'
            ? `${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/hrm/employees`
            : `${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/hrm/employees/${selectedId}`;

        const method = modalMode === 'create' ? 'POST' : 'PUT';

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                fetchData();
                setShowModal(false);
                resetForm();
                notify.success(modalMode === 'create' ? "Employee created successfully!" : "Employee updated successfully!");
            } else {
                const err = await res.json();
                notify.error("Error: " + (err.error || "Failed to save employee"));
            }
        } catch (err) { notify.error('Failed to save employee'); }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this employee?')) return;
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/hrm/employees/${id}`, { method: 'DELETE' });
            if (res.ok) {
                notify.success("Employee deleted successfully");
                fetchData();
            } else {
                notify.error("Failed to delete employee");
            }
        } catch (err) { notify.error('Failed to delete'); }
    };

    const handleToggleStatus = async (emp: Employee) => {
        const isCurrentActive = (emp.status || '').trim().toLowerCase() === 'active';
        const newStatus = isCurrentActive ? 'Inactive' : 'Active';
        const actionText = isCurrentActive ? 'Deactivate / Resign' : 'Re-Activate / Join';
        if (!confirm(`Are you sure you want to mark ${emp.first_name} ${emp.last_name} as ${newStatus} (${actionText})?`)) return;

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/hrm/employees/${emp.employee_id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (res.ok) {
                setEmployees(prev => prev.map(e => e.employee_id === emp.employee_id ? { ...e, status: newStatus } : e));
                notify.success(`${emp.first_name} ${emp.last_name} marked as ${newStatus}!`);
            } else {
                notify.error("Failed to update status");
            }
        } catch (err) {
            notify.error("Error updating status");
        }
    };

    const activeCount = useMemo(() => employees.filter(e => (e.status || '').trim().toLowerCase() === 'active').length, [employees]);
    const inactiveCount = useMemo(() => employees.filter(e => (e.status || '').trim().toLowerCase() !== 'active').length, [employees]);

    const filteredEmployees = useMemo(() => {
        let list = employees;
        if (statusFilter === 'Active') {
            list = list.filter(emp => (emp.status || '').trim().toLowerCase() === 'active');
        } else if (statusFilter === 'Inactive') {
            list = list.filter(emp => (emp.status || '').trim().toLowerCase() !== 'active');
        }

        const q = searchQuery.toLowerCase().trim();
        if (!q) return list;
        return list.filter(emp => {
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            return (
                fullName.includes(q) ||
                (emp.email && emp.email.toLowerCase().includes(q)) ||
                (emp.phone && emp.phone.includes(q)) ||
                (emp.designation && emp.designation.toLowerCase().includes(q)) ||
                (emp.department_name && emp.department_name.toLowerCase().includes(q)) ||
                (emp.system_username && emp.system_username.toLowerCase().includes(q)) ||
                (emp.cnic && emp.cnic.includes(q)) ||
                (emp.status && emp.status.toLowerCase().includes(q))
            );
        });
    }, [employees, searchQuery, statusFilter]);

    // ── Export Handlers (Excel, CSV, PDF) ──────────────────────────────────────
    const prepareExportData = () => {
        return filteredEmployees.map((emp, index) => ({
            "Sr #": index + 1,
            "Employee ID": emp.employee_id,
            "Full Name": `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
            "Father/Husband Name": emp.father_name || '—',
            "Designation": emp.designation || '—',
            "Department": emp.department_name || 'Unassigned',
            "Phone / Mobile": emp.phone || '—',
            "Email": emp.email || '—',
            "CNIC": emp.cnic || '—',
            "Gender": emp.gender || '—',
            "Joining Date": emp.joining_date ? emp.joining_date.substring(0, 10) : '—',
            "Salary (PKR)": emp.salary ? Number(emp.salary) : 0,
            "Status": emp.status || 'Active',
            "System Username": emp.system_username || 'None'
        }));
    };

    const exportToExcel = () => {
        if (filteredEmployees.length === 0) {
            notify.warning("No employee records to export");
            return;
        }
        const data = prepareExportData();
        const ws = XLSX.utils.json_to_sheet(data);
        ws['!cols'] = [
            { wch: 6 },  // Sr #
            { wch: 14 }, // Employee ID
            { wch: 22 }, // Full Name
            { wch: 22 }, // Father/Husband Name
            { wch: 18 }, // Designation
            { wch: 18 }, // Department
            { wch: 16 }, // Phone
            { wch: 24 }, // Email
            { wch: 18 }, // CNIC
            { wch: 10 }, // Gender
            { wch: 14 }, // Joining Date
            { wch: 14 }, // Salary
            { wch: 12 }, // Status
            { wch: 18 }, // System Username
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Employees");
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `Employees_List_${dateStr}.xlsx`);
        notify.success("Employees list exported to Excel successfully!");
    };

    const exportToCSV = () => {
        if (filteredEmployees.length === 0) {
            notify.warning("No employee records to export");
            return;
        }
        const data = prepareExportData();
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];

        for (const row of data) {
            const values = headers.map(header => {
                const val = (row as any)[header];
                const escaped = ('' + (val ?? '')).replace(/"/g, '""');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        }

        const csvString = "\uFEFF" + csvRows.join("\n");
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStr = new Date().toISOString().split('T')[0];
        link.href = url;
        link.setAttribute('download', `Employees_List_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        notify.success("Employees list exported to CSV successfully!");
    };

    const exportToPDF = () => {
        if (filteredEmployees.length === 0) {
            notify.warning("No employee records to export");
            return;
        }
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            notify.error("Please allow popups to print / export PDF");
            return;
        }

        const dateStr = new Date().toLocaleDateString('en-PK', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const rowsHtml = filteredEmployees.map((emp, index) => {
            const isAct = (emp.status || '').trim().toLowerCase() === 'active';
            return `
                <tr>
                    <td style="text-align: center;">${index + 1}</td>
                    <td><strong>${emp.first_name || ''} ${emp.last_name || ''}</strong></td>
                    <td>${emp.father_name || '—'}</td>
                    <td>${emp.designation || '—'}</td>
                    <td>${emp.department_name || 'Unassigned'}</td>
                    <td>${emp.phone || '—'}</td>
                    <td>${emp.cnic || '—'}</td>
                    <td>${emp.gender || '—'}</td>
                    <td>${emp.joining_date ? emp.joining_date.substring(0, 10) : '—'}</td>
                    <td style="text-align: right; font-weight: bold;">${emp.salary ? 'Rs. ' + Number(emp.salary).toLocaleString() : '—'}</td>
                    <td style="text-align: center;">
                        <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: ${isAct ? '#d1fae5' : '#fee2e2'}; color: ${isAct ? '#065f46' : '#991b1b'};">
                            ${emp.status || 'Active'}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8" />
                <title>Employee Directory - Shaheen Public School</title>
                <style>
                    @page {
                        size: A4 landscape;
                        margin: 10mm 10mm;
                    }
                    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
                    body { margin: 0; padding: 15px; color: #1f2937; background: #fff; font-size: 11px; }
                    .header { text-align: center; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 12px; }
                    .header h1 { margin: 0; font-size: 22px; color: #0f766e; text-transform: uppercase; letter-spacing: 0.5px; }
                    .header h2 { margin: 4px 0 0 0; font-size: 14px; font-weight: 600; color: #4b5563; }
                    .meta { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 10.5px; color: #4b5563; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10.5px; }
                    th { background-color: #0f766e; color: #ffffff; text-align: left; padding: 7px 6px; font-weight: 600; border: 1px solid #0f766e; }
                    td { padding: 6px; border: 1px solid #e5e7eb; vertical-align: middle; }
                    tr:nth-child(even) td { background-color: #f9fafb; }
                    .footer { margin-top: 25px; display: flex; justify-content: space-between; font-size: 10px; color: #6b7280; page-break-inside: avoid; }
                    .sig-box { border-top: 1px solid #9ca3af; width: 180px; text-align: center; padding-top: 4px; }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none !important; }
                    }
                </style>
            </head>
            <body>
                <div class="no-print" style="margin-bottom: 15px; text-align: right;">
                    <button onclick="window.print()" style="padding: 8px 16px; background: #0f766e; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        🖨️ Print / Save as PDF
                    </button>
                </div>
                <div class="header">
                    <h1>Shaheen English Model School</h1>
                    <h2>Official Employee Directory & Staff Roster</h2>
                    <div class="meta">
                        <span><strong>Total Records:</strong> ${filteredEmployees.length} Employee(s)</span>
                        <span><strong>Status Filter:</strong> ${statusFilter}</span>
                        <span><strong>Generated On:</strong> ${dateStr}</span>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 35px; text-align: center;">#</th>
                            <th>Name</th>
                            <th>Father/Husband</th>
                            <th>Designation</th>
                            <th>Department</th>
                            <th>Phone</th>
                            <th>CNIC</th>
                            <th>Gender</th>
                            <th>Joining Date</th>
                            <th style="text-align: right;">Salary</th>
                            <th style="text-align: center;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
                <div class="footer">
                    <div>Report automatically compiled from Shaheen English Model School</div>
                    <div class="sig-box">HR / Principal Signature</div>
                </div>
                <script>
                    window.onload = function() {
                        window.print();
                    };
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
    };

    return (
        <div className="container-fluid animate__animated animate__fadeIn">
            {/* Header with Searchbar, Status Filters & Add Button */}
            <div className="d-flex flex-column flex-lg-row justify-content-between align-items-start align-items-lg-center gap-3 mb-4">
                <div>
                    <h2 className="h3 mb-0 text-primary-dark fw-bold">Employees</h2>
                    <p className="text-muted small mb-0">Manage staff records, contracts, system access, and reports.</p>
                </div>
                <div className="d-flex flex-wrap align-items-center gap-2 w-100 w-lg-auto justify-content-start justify-content-lg-end">
                    {/* Status Filter Tabs */}
                    <div className="btn-group shadow-sm" role="group" aria-label="Status filter">
                        <button
                            type="button"
                            className={`btn btn-sm ${statusFilter === 'All' ? 'btn-primary' : 'btn-outline-secondary'}`}
                            style={{ borderRadius: '8px 0 0 8px', fontSize: '0.82rem', padding: '0.42rem 0.75rem', fontWeight: 600, background: statusFilter === 'All' ? 'var(--primary-dark)' : undefined, borderColor: statusFilter === 'All' ? 'var(--primary-dark)' : '#d1d5db' }}
                            onClick={() => setStatusFilter('All')}
                        >
                            All ({employees.length})
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${statusFilter === 'Active' ? 'btn-success text-white' : 'btn-outline-secondary'}`}
                            style={{ fontSize: '0.82rem', padding: '0.42rem 0.75rem', fontWeight: 600, borderColor: statusFilter === 'Active' ? '#198754' : '#d1d5db' }}
                            onClick={() => setStatusFilter('Active')}
                        >
                            Active ({activeCount})
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${statusFilter === 'Inactive' ? 'btn-danger text-white' : 'btn-outline-secondary'}`}
                            style={{ borderRadius: '0 8px 8px 0', fontSize: '0.82rem', padding: '0.42rem 0.75rem', fontWeight: 600, borderColor: statusFilter === 'Inactive' ? '#dc3545' : '#d1d5db' }}
                            onClick={() => setStatusFilter('Inactive')}
                        >
                            Inactive ({inactiveCount})
                        </button>
                    </div>

                    {/* Search Box */}
                    <div className="input-group" style={{ maxWidth: '320px', minWidth: '220px' }}>
                        <span className="input-group-text bg-white border-end-0" style={{ borderRadius: '10px 0 0 10px', borderColor: '#d1d5db' }}>
                            <i className="bi bi-search text-muted"></i>
                        </span>
                        <input
                            type="text"
                            className="form-control bg-white border-start-0 ps-0"
                            placeholder="Search staff, dept, role..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={{ borderRadius: searchQuery ? '0' : '0 10px 10px 0', borderColor: '#d1d5db', fontSize: '0.88rem' }}
                        />
                        {searchQuery && (
                            <button
                                className="btn btn-outline-secondary border-start-0 bg-white"
                                type="button"
                                onClick={() => setSearchQuery('')}
                                style={{ borderRadius: '0 10px 10px 0', borderColor: '#d1d5db' }}
                                title="Clear search"
                            >
                                <i className="bi bi-x-lg text-muted" style={{ fontSize: '0.75rem' }}></i>
                            </button>
                        )}
                    </div>

                    {hasPermission('hrm', 'write') && (
                        <button className="btn btn-primary-custom d-inline-flex align-items-center" onClick={handleOpenCreate} style={{ borderRadius: '10px', whiteSpace: 'nowrap' }}>
                            <i className="bi bi-person-plus me-1.5"></i> Add Employee
                        </button>
                    )}
                </div>
            </div>

            <div className="card border-0 shadow-sm" style={{ borderRadius: '12px' }}>
                <div className="px-4 py-2.5 border-bottom bg-light bg-opacity-75 text-muted small d-flex flex-wrap justify-content-between align-items-center gap-2" style={{ borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span>
                            Showing <strong>{filteredEmployees.length}</strong> of <strong>{employees.length}</strong> employee{employees.length !== 1 ? 's' : ''}
                        </span>
                        {statusFilter !== 'All' && (
                            <span className={`badge ${statusFilter === 'Active' ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-danger-subtle text-danger border border-danger-subtle'}`}>
                                {statusFilter} Staff
                            </span>
                        )}
                        {searchQuery && (
                            <span className="badge bg-secondary-subtle text-secondary border">
                                Filtered: "{searchQuery}"
                            </span>
                        )}
                    </div>

                    {/* Export Action Icons & Buttons on Right Side */}
                    <div className="d-flex align-items-center gap-1.5">
                        <span className="text-uppercase fw-bold text-muted me-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>
                            Export:
                        </span>
                        {/* PDF Export */}
                        <button
                            type="button"
                            className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1 px-2.5 py-1 shadow-sm"
                            style={{ borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600 }}
                            onClick={exportToPDF}
                            title="Print / Save as PDF"
                        >
                            <i className="bi bi-file-earmark-pdf-fill fs-6 text-danger"></i>
                            <span>PDF</span>
                        </button>
                        {/* Excel Export */}
                        <button
                            type="button"
                            className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1 px-2.5 py-1 shadow-sm"
                            style={{ borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600 }}
                            onClick={exportToExcel}
                            title="Export to Excel (.xlsx)"
                        >
                            <i className="bi bi-file-earmark-excel-fill fs-6 text-success"></i>
                            <span>Excel</span>
                        </button>
                        {/* CSV Export */}
                        <button
                            type="button"
                            className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 px-2.5 py-1 shadow-sm"
                            style={{ borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600 }}
                            onClick={exportToCSV}
                            title="Export to CSV (.csv)"
                        >
                            <i className="bi bi-file-earmark-text-fill fs-6 text-primary"></i>
                            <span>CSV</span>
                        </button>
                    </div>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover mb-0 align-middle">
                            <thead className="bg-light">
                                <tr>
                                    <th className="ps-4">Name</th>
                                    <th>Designation</th>
                                    <th>Department</th>
                                    <th>Contact</th>
                                    <th>User Account</th>
                                    <th>Status</th>
                                    <th className="text-end pe-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={7} className="text-center py-4">Loading...</td></tr>
                                ) : filteredEmployees.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="text-center py-5 text-muted">
                                            <i className="bi bi-search fs-2 d-block mb-2 text-secondary opacity-50"></i>
                                            <div>{searchQuery ? `No employees found matching "${searchQuery}"` : 'No employees found.'}</div>
                                            {(searchQuery || statusFilter !== 'All') && (
                                                <button className="btn btn-sm btn-outline-secondary mt-2" onClick={() => { setSearchQuery(''); setStatusFilter('All'); }}>
                                                    Reset Filters
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredEmployees.map(emp => (
                                        <tr key={emp.employee_id}>
                                            <td className="ps-4">
                                                <div className="fw-bold">{emp.first_name} {emp.last_name}</div>
                                                <small className="text-muted">{emp.email}</small>
                                            </td>
                                            <td>{emp.designation}</td>
                                            <td><span className="badge bg-light text-dark border">{emp.department_name || 'Unassigned'}</span></td>
                                            <td>{emp.phone}</td>
                                            <td>
                                                {emp.system_username ? (
                                                    <span className="badge bg-success-subtle text-success">
                                                        <i className="bi bi-check-circle me-1"></i> {emp.system_username}
                                                    </span>
                                                ) : <span className="text-muted small">-</span>}
                                            </td>
                                            <td>
                                                <span className={`badge ${(emp.status || '').trim().toLowerCase() === 'active' ? 'bg-success' : 'bg-secondary'}`}>
                                                    {emp.status || 'Active'}
                                                </span>
                                            </td>
                                            <td className="text-end pe-4">
                                                <Link href={`/hrm/employees/${emp.employee_id}`}>
                                                    <button title="View Profile" className="btn btn-sm btn-outline-primary me-1">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                                            <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z" />
                                                            <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
                                                        </svg>
                                                    </button>
                                                </Link>
                                                {hasPermission('hrm', 'write') && (
                                                    <button
                                                        title={(emp.status || '').trim().toLowerCase() === 'active' ? "Deactivate Employee" : "Re-Activate Employee"}
                                                        className={`btn btn-sm ${(emp.status || '').trim().toLowerCase() === 'active' ? 'btn-outline-warning' : 'btn-outline-success'} me-1`}
                                                        onClick={() => handleToggleStatus(emp)}
                                                    >
                                                        <i className={`bi ${(emp.status || '').trim().toLowerCase() === 'active' ? 'bi-slash-circle' : 'bi-check-circle'}`}></i>
                                                    </button>
                                                )}
                                                {hasPermission('hrm', 'write') && (
                                                    <button title="Edit" className="btn btn-sm btn-outline-secondary me-1" onClick={() => handleOpenEdit(emp)}>
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                                            <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
                                                        </svg>
                                                    </button>
                                                )}
                                                {hasPermission('hrm', 'delete') && (
                                                    <button title="Delete" className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(emp.employee_id)}>
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                                                            <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Large Modal */}
            {showModal && mounted && createPortal(
                <div className="modal-backdrop-custom">
                    <div className="modal-content-custom animate__animated animate__zoomIn">
                        <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                            <h4 className="mb-0">
                                {modalMode === 'create' && 'Add New Employee'}
                                {modalMode === 'edit' && 'Edit Employee'}
                                {modalMode === 'details' && 'Employee Details'}
                            </h4>
                            <button onClick={() => setShowModal(false)} className="btn-close"></button>
                        </div>

                        <div className="p-3" style={{ overflowY: 'auto', flex: 1 }}>
                            <form id="createEmpForm" onSubmit={handleSubmit}>
                                <fieldset disabled={modalMode === 'details'}>
                                    <div className="row g-0">
                                        {/* Left Col: Personal */}
                                        <div className="col-12 col-lg-6 pe-lg-4">
                                            <h6 className="text-primary mb-3 bg-light p-2 rounded"><i className="bi bi-person me-2"></i>Personal Information</h6>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">First Name</label>
                                                    <input required type="text" className="form-control" value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} />
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Last Name</label>
                                                    <input required type="text" className="form-control" value={formData.last_name} onChange={e => setFormData({ ...formData, last_name: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="mb-3">
                                                <label className="form-label small fw-bold">Father/Husband Name</label>
                                                <input type="text" className="form-control" value={formData.father_name} onChange={e => setFormData({ ...formData, father_name: e.target.value })} />
                                            </div>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Gender</label>
                                                    <select className="form-select" value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })}>
                                                        <option value="">Select...</option>
                                                        <option value="Male">Male</option>
                                                        <option value="Female">Female</option>
                                                    </select>
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Date of Birth</label>
                                                    <input type="date" className="form-control" value={formData.dob} onChange={e => setFormData({ ...formData, dob: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Marital Status</label>
                                                    <select className="form-select" value={formData.marital_status} onChange={e => setFormData({ ...formData, marital_status: e.target.value })}>
                                                        <option value="">Select...</option>
                                                        <option value="Single">Single</option>
                                                        <option value="Married">Married</option>
                                                    </select>
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">CNIC</label>
                                                    <input type="text" className="form-control" value={formData.cnic} onChange={e => setFormData({ ...formData, cnic: e.target.value })} />
                                                </div>
                                            </div>

                                            <h6 className="text-primary mb-3 bg-light p-2 rounded mt-4"><i className="bi bi-geo-alt me-2"></i>Contact Details</h6>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Email</label>
                                                    <input type="email" className="form-control" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Phone</label>
                                                    <input type="text" className="form-control" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="mb-3">
                                                <label className="form-label small fw-bold">Emergency Contact (Name & No)</label>
                                                <input type="text" className="form-control" value={formData.emergency_contact} onChange={e => setFormData({ ...formData, emergency_contact: e.target.value })} />
                                            </div>

                                            <div className="mb-3">
                                                <label className="form-label small fw-bold">Direct Address</label>
                                                <textarea className="form-control" rows={2} value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}></textarea>
                                            </div>
                                        </div>

                                        {/* Right Col: Job & System */}
                                        <div className="col-12 col-lg-6 ps-lg-4 border-start-lg">
                                            <h6 className="text-primary mb-3 bg-light p-2 rounded"><i className="bi bi-briefcase me-2"></i>Job Details</h6>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Designation</label>
                                                    <input required type="text" className="form-control" placeholder="e.g. Teacher" value={formData.designation} onChange={e => setFormData({ ...formData, designation: e.target.value })} />
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Department</label>
                                                    <select className="form-select" value={formData.department_id} onChange={e => setFormData({ ...formData, department_id: e.target.value })}>
                                                        <option value="">Select Dept</option>
                                                        {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Qualification</label>
                                                    <input type="text" className="form-control" placeholder="e.g. Master in CS" value={formData.qualification} onChange={e => setFormData({ ...formData, qualification: e.target.value })} />
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Total Experience</label>
                                                    <input type="text" className="form-control" placeholder="e.g. 5 Years" value={formData.experience} onChange={e => setFormData({ ...formData, experience: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="row g-3 mb-3">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Joining Date</label>
                                                    <input type="date" className="form-control" value={formData.joining_date} onChange={e => setFormData({ ...formData, joining_date: e.target.value })} />
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Blood Group</label>
                                                    <input type="text" className="form-control" placeholder="e.g. O+" value={formData.blood_group} onChange={e => setFormData({ ...formData, blood_group: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="row g-3 mb-4">
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Salary (PKR)</label>
                                                    <div className="input-group">
                                                        <span className="input-group-text">Rs</span>
                                                        <input type="number" className="form-control" value={formData.salary} onKeyDown={e => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()} onChange={e => setFormData({ ...formData, salary: e.target.value })} />
                                                    </div>
                                                </div>
                                                <div className="col-6">
                                                    <label className="form-label small fw-bold">Employee Status</label>
                                                    <select className="form-select" value={formData.status || 'Active'} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                                                        <option value="Active">Active</option>
                                                        <option value="Inactive">Inactive</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <h6 className="text-primary mb-3 bg-light p-2 rounded"><i className="bi bi-shield-lock me-2"></i>System Access</h6>
                                            <div className="bg-light p-3 rounded border">
                                                {/* If editing and employee already has a user account → show info only */}
                                                {modalMode === 'edit' && (formData as any)._has_user ? (
                                                    <div className="d-flex align-items-center gap-2 text-success">
                                                        <i className="bi bi-shield-check fs-5"></i>
                                                        <div>
                                                            <div className="fw-bold small">System account already linked</div>
                                                            <div className="text-muted" style={{ fontSize: '0.78rem' }}>To reset password, open the employee's profile page.</div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="form-check form-switch mb-2">
                                                            <input className="form-check-input" type="checkbox" checked={isSysUser} onChange={e => setIsSysUser(e.target.checked)} />
                                                            <label className="form-check-label fw-bold">Create System User Login</label>
                                                        </div>

                                                        {isSysUser && (
                                                            <div className="animate__animated animate__fadeIn">
                                                                <div className="mb-2">
                                                                    <label className="form-label small fw-bold">Username</label>
                                                                    <input required={isSysUser} type="text" className="form-control form-control-sm" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                                                                </div>
                                                                <div className="mb-2">
                                                                    <label className="form-label small fw-bold">Password</label>
                                                                    <input required={isSysUser} type="password" className="form-control form-control-sm" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                                                                </div>
                                                                <div>
                                                                    <label className="form-label small fw-bold">Role</label>
                                                                    <select required={isSysUser} className="form-select form-select-sm" value={formData.role_id} onChange={e => setFormData({ ...formData, role_id: e.target.value })}>
                                                                        <option value="">Select Role</option>
                                                                        {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </fieldset>
                            </form>
                        </div>

                        <div className="d-flex justify-content-end p-3 border-top bg-light rounded-bottom">
                            <button type="button" onClick={() => setShowModal(false)} className="btn btn-light me-2">Cancel</button>
                            {modalMode !== 'details' && hasPermission('hrm', 'write') && (
                                <button type="submit" form="createEmpForm" className="btn btn-primary-custom px-4">
                                    {modalMode === 'create' ? 'Create Employee' : 'Update Employee'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                , document.body)}

            <style jsx>{`
                .modal-backdrop-custom {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1050;
                }
                .modal-content-custom {
                    background: white; border-radius: 12px;
                    width: 90%; max-width: 900px;
                    display: flex; flex-direction: column;
                    max-height: 90vh;
                    overflow: hidden;
                }
            `}</style>
        </div>
    );
}
