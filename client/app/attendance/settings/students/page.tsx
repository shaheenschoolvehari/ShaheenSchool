'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'react-toastify';
import Link from 'next/link';

const API = (process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com").replace(/\/+$/, '').replace(/\/api$/, '');

interface AttendanceSettings {
    id: number;
    student_notify_parents: boolean;
    student_notify_holidays: boolean;
    student_auto_absent_enabled: boolean;
    family_notify_each_child: boolean;
    consecutive_absent_alert_days: number;
    updated_at: string;
}

interface HolidayItem {
    id: number;
    title: string;
    holiday_type: string;
    start_date: string;
    end_date: string;
    is_recurring_weekly: boolean;
    recurring_day_of_week: number;
    description: string | null;
}

interface ClassItem {
    class_id: number;
    class_name: string;
}

interface SectionItem {
    section_id: number;
    section_name: string;
    class_id: number;
}

interface AssignedSection {
    assignment_id?: number;
    class_id: number;
    class_name: string;
    section_id: number;
    section_name: string;
}

interface CoordinatorStaff {
    employee_id: number;
    first_name: string;
    last_name: string;
    designation: string | null;
    email: string | null;
    phone: string | null;
    department_name: string | null;
    assigned_sections: AssignedSection[];
}

export default function StudentAttendanceSettingsPage() {
    const { user } = useAuth();
    const token = user?.token;

    const [mounted, setMounted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [savingSettings, setSavingSettings] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const [settings, setSettings] = useState<AttendanceSettings>({
        id: 1,
        student_notify_parents: true,
        student_notify_holidays: true,
        student_auto_absent_enabled: true,
        family_notify_each_child: true,
        consecutive_absent_alert_days: 3,
        updated_at: new Date().toISOString()
    });

    const [coordinators, setCoordinators] = useState<CoordinatorStaff[]>([]);
    const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
    const [allSections, setAllSections] = useState<SectionItem[]>([]);
    const [holidays, setHolidays] = useState<HolidayItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    // 3-Column Modal State
    const [selectedCoordinator, setSelectedCoordinator] = useState<CoordinatorStaff | null>(null);
    const [modalActiveTabClassId, setModalActiveTabClassId] = useState<number | null>(null);
    const [modalSelectedPairs, setModalSelectedPairs] = useState<{ class_id: number; section_id: number }[]>([]);
    const [savingAssignments, setSavingAssignments] = useState(false);
    const [modalMobileTab, setModalMobileTab] = useState<'classes' | 'sections' | 'summary'>('classes');

    // Holiday Modal State
    const [showHolidayModal, setShowHolidayModal] = useState(false);
    const [holidayTitle, setHolidayTitle] = useState('');
    const [holidayStartDate, setHolidayStartDate] = useState('');
    const [holidayEndDate, setHolidayEndDate] = useState('');
    const [holidayDesc, setHolidayDesc] = useState('');
    const [holidayBroadcast, setHolidayBroadcast] = useState(true);
    const [savingHoliday, setSavingHoliday] = useState(false);
    const [activeYear, setActiveYear] = useState<{ id: number; year_name: string; is_active: boolean; status?: string } | null>(null);

    const loadAllData = async () => {
        setLoading(true);
        try {
            const [setRes, coordRes, classRes, secRes, holRes, yearsRes] = await Promise.all([
                fetch(`${API}/attendance/settings`),
                fetch(`${API}/attendance/coordinators`),
                fetch(`${API}/academic/classes`),
                fetch(`${API}/academic/sections`),
                fetch(`${API}/attendance/holidays?holiday_type=students_only`),
                fetch(`${API}/attendance/academic-years`).catch(() => null)
            ]);

            if (yearsRes && yearsRes.ok) {
                const yData = await yearsRes.json();
                const act = yData?.active_year || (Array.isArray(yData?.years) ? yData.years.find((y: any) => y.is_active || y.status === 'active') || yData.years[0] : null);
                if (act) setActiveYear(act);
            }

            if (setRes.ok) {
                const setData = await setRes.json();
                if (setData.settings) setSettings(setData.settings);
            }

            if (coordRes.ok) {
                const coordData = await coordRes.json();
                setCoordinators(Array.isArray(coordData) ? coordData : []);
            }

            if (classRes.ok) {
                const classData = await classRes.json();
                setAllClasses(Array.isArray(classData) ? classData : []);
            }

            if (secRes.ok) {
                const secData = await secRes.json();
                setAllSections(Array.isArray(secData) ? secData : []);
            }

            if (holRes.ok) {
                const holData = await holRes.json();
                setHolidays(Array.isArray(holData) ? holData : []);
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to load student attendance settings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAllData();
    }, [token]);

    const handleSaveNotificationPolicy = async () => {
        setSavingSettings(true);
        try {
            const res = await fetch(`${API}/attendance/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(settings)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update notification settings');

            toast.success('✓ Student & family notification policies saved successfully!');
            if (data.settings) setSettings(data.settings);
        } catch (err: any) {
            toast.error(err.message || 'Error saving settings');
        } finally {
            setSavingSettings(false);
        }
    };

    const handleOpenAssignmentModal = (staff: CoordinatorStaff) => {
        setSelectedCoordinator(staff);
        const pairs = (staff.assigned_sections || []).map(a => ({
            class_id: Number(a.class_id),
            section_id: Number(a.section_id)
        }));
        setModalSelectedPairs(pairs);
        setModalMobileTab('classes');

        if (allClasses.length > 0) {
            setModalActiveTabClassId(allClasses[0].class_id);
        } else {
            setModalActiveTabClassId(null);
        }
    };

    const handleToggleSectionPair = (classId: number, sectionId: number) => {
        setModalSelectedPairs(prev => {
            const exists = prev.some(p => p.class_id === classId && p.section_id === sectionId);
            if (exists) {
                return prev.filter(p => !(p.class_id === classId && p.section_id === sectionId));
            } else {
                return [...prev, { class_id: classId, section_id: sectionId }];
            }
        });
    };

    const handleToggleAllSectionsForClass = (classId: number) => {
        const classSections = allSections.filter(s => Number(s.class_id) === Number(classId));
        const allSelected = classSections.every(s => modalSelectedPairs.some(p => p.class_id === classId && p.section_id === s.section_id));

        if (allSelected) {
            setModalSelectedPairs(prev => prev.filter(p => p.class_id !== classId));
        } else {
            const newPairs = classSections.map(s => ({ class_id: classId, section_id: s.section_id }));
            setModalSelectedPairs(prev => {
                const filtered = prev.filter(p => p.class_id !== classId);
                return [...filtered, ...newPairs];
            });
        }
    };

    const handleSaveCoordinatorAssignments = async () => {
        if (!selectedCoordinator) return;
        setSavingAssignments(true);
        try {
            const res = await fetch(`${API}/attendance/coordinators/assign`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    employee_id: selectedCoordinator.employee_id,
                    assignments: modalSelectedPairs
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save assignments');

            toast.success(`✓ Assignments saved for ${selectedCoordinator.first_name} ${selectedCoordinator.last_name || ''}!`);
            setSelectedCoordinator(null);
            loadAllData();
        } catch (err: any) {
            toast.error(err.message || 'Error saving assignments');
        } finally {
            setSavingAssignments(false);
        }
    };

    const handleAddHoliday = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!holidayTitle.trim() || !holidayStartDate) {
            toast.warning('Title and Start Date are required');
            return;
        }

        setSavingHoliday(true);
        try {
            const res = await fetch(`${API}/attendance/holidays`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: holidayTitle.trim(),
                    holiday_type: 'students_only',
                    start_date: holidayStartDate,
                    end_date: holidayEndDate || holidayStartDate,
                    is_recurring_weekly: false,
                    recurring_day_of_week: 0,
                    description: holidayDesc.trim() || null,
                    notify_broadcast: holidayBroadcast
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create student holiday');

            toast.success(`✓ Student Holiday "${holidayTitle}" created!`);
            setShowHolidayModal(false);
            setHolidayTitle('');
            setHolidayStartDate('');
            setHolidayEndDate('');
            setHolidayDesc('');
            loadAllData();
        } catch (err: any) {
            toast.error(err.message || 'Error creating holiday');
        } finally {
            setSavingHoliday(false);
        }
    };

    const handleDeleteHoliday = async (id: number, title: string) => {
        if (!confirm(`Are you sure you want to delete holiday "${title}"?`)) return;
        try {
            const res = await fetch(`${API}/attendance/holidays/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to delete holiday');
            toast.success(`Holiday "${title}" removed`);
            setHolidays(prev => prev.filter(h => h.id !== id));
        } catch (err: any) {
            toast.error(err.message || 'Error deleting holiday');
        }
    };

    const getSelectedCountForClass = (classId: number) => {
        return modalSelectedPairs.filter(p => p.class_id === classId).length;
    };

    const filteredCoordinators = coordinators.filter(c => {
        const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
        const des = (c.designation || '').toLowerCase();
        const dep = (c.department_name || '').toLowerCase();
        const q = searchTerm.toLowerCase();
        return name.includes(q) || des.includes(q) || dep.includes(q);
    });

    return (
        <div className="student-settings-container py-3 py-md-4 px-2 px-sm-3 px-md-4 animate__animated animate__fadeIn">
            {/* Top Navigation & Header with Back Button */}
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4">
                <div className="d-flex align-items-center gap-3">
                    <Link
                        href="/attendance/settings"
                        className="btn btn-light rounded-circle border shadow-sm d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: 42, height: 42, color: 'var(--primary-dark)' }}
                        title="Back to Settings Hub"
                    >
                        <i className="bi bi-arrow-left fs-5" />
                    </Link>
                    <div>
                        <h2 className="fw-bold mb-0 fs-3 fs-md-2" style={{ color: 'var(--primary-dark)' }}>
                            <i className="bi bi-mortarboard-fill me-2" style={{ color: 'var(--accent-orange)' }} />
                            Student Attendance Settings
                        </h2>
                        <div className="d-flex align-items-center gap-2 flex-wrap mt-0.5">
                            <p className="text-muted mb-0 small">
                                Coordinator class delegations, family per-child notifications, and student holidays
                            </p>
                            {activeYear && (
                                <span className="badge rounded-pill border px-3 py-1 fw-semibold d-inline-flex align-items-center gap-1.5 shadow-sm"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(33, 94, 97, 0.08), rgba(254, 127, 45, 0.12))',
                                        color: 'var(--primary-dark)',
                                        borderColor: 'rgba(33, 94, 97, 0.25)',
                                        fontSize: '0.8rem'
                                    }}>
                                    <i className="bi bi-mortarboard-fill" style={{ color: 'var(--accent-orange)' }} />
                                    <span>Academic Year: <strong className="text-dark">{activeYear.year_name}</strong></span>
                                    {(activeYear.is_active || activeYear.status === 'active') && (
                                        <span className="badge rounded-pill bg-success text-white ms-1 px-2 py-0.5" style={{ fontSize: '0.65rem' }}>
                                            Active
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Layout Grid */}
            <div className="row g-4">
                {/* Column 1: Coordinator Delegations Table */}
                <div className="col-12 col-xl-8">
                    <div className="card border-0 shadow-sm rounded-4 p-3.5 p-md-4 bg-white mb-4">
                        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 border-bottom pb-3 mb-3">
                            <div>
                                <h5 className="fw-bold mb-0.5 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)' }}>
                                    <i className="bi bi-person-lines-fill" style={{ color: 'var(--primary-teal)' }} />
                                    Staff &amp; Coordinator Class Delegations
                                </h5>
                                <p className="text-muted small mb-0">
                                    Assigned staff members will only see and mark attendance for their designated classes &amp; sections.
                                </p>
                            </div>
                            <div className="search-box-wrapper w-100 w-sm-auto" style={{ minWidth: 240 }}>
                                <div className="input-group input-group-sm">
                                    <span className="input-group-text bg-light border-end-0"><i className="bi bi-search text-muted" /></span>
                                    <input
                                        type="text"
                                        className="form-control border-start-0"
                                        placeholder="Search by name, role..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0">
                                <thead className="table-light">
                                    <tr className="small text-uppercase fw-bold" style={{ letterSpacing: '0.5px', color: 'var(--primary-dark)', borderBottom: '2px solid #e2e8f0' }}>
                                        <th style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>Staff / Coordinator</th>
                                        <th style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>Role &amp; Department</th>
                                        <th style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>Assigned Classes &amp; Sections</th>
                                        <th className="text-end" style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCoordinators.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="text-center py-5 text-muted">
                                                <i className="bi bi-person-x fs-2 d-block mb-1 opacity-50" />
                                                <span className="small">No staff member matches your search filter.</span>
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredCoordinators.map(c => {
                                            const assigned = c.assigned_sections || [];
                                            return (
                                                <tr key={c.employee_id}>
                                                    <td>
                                                        <div className="d-flex align-items-center gap-2.5">
                                                            <div
                                                                className="rounded-circle text-white fw-bold d-flex align-items-center justify-content-center flex-shrink-0 shadow-sm"
                                                                style={{
                                                                    width: 40,
                                                                    height: 40,
                                                                    fontSize: '0.85rem',
                                                                    background: 'linear-gradient(135deg, var(--primary-dark), var(--primary-teal))'
                                                                }}
                                                            >
                                                                {(c.first_name?.[0] || 'S') + (c.last_name?.[0] || '')}
                                                            </div>
                                                            <div>
                                                                <div className="fw-bold text-dark">{c.first_name} {c.last_name || ''}</div>
                                                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>{c.email || c.phone || 'ID #' + c.employee_id}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className="badge bg-light text-dark border">
                                                            {c.designation || 'Staff'}
                                                        </span>
                                                        {c.department_name && (
                                                            <div className="text-muted mt-0.5" style={{ fontSize: '0.72rem' }}>{c.department_name}</div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {assigned.length === 0 ? (
                                                            <span className="badge rounded-pill fw-normal px-2.5 py-1 text-muted bg-light border" style={{ fontSize: '0.72rem' }}>
                                                                No classes assigned (All / None)
                                                            </span>
                                                        ) : (
                                                            <div className="d-flex flex-wrap gap-1.5 align-items-center" style={{ maxWidth: 360 }}>
                                                                {assigned.slice(0, 3).map((a, idx) => (
                                                                    <span
                                                                        key={idx}
                                                                        className="badge rounded-pill fw-semibold px-2 py-1"
                                                                        style={{ background: 'rgba(33, 94, 97, 0.08)', color: 'var(--primary-teal)', border: '1px solid rgba(33, 94, 97, 0.2)', fontSize: '0.73rem' }}
                                                                    >
                                                                        {a.class_name} - Sec {a.section_name}
                                                                    </span>
                                                                ))}
                                                                {assigned.length > 3 && (
                                                                    <span
                                                                        className="badge rounded-pill fw-bold px-2 py-1"
                                                                        style={{ background: 'rgba(254, 127, 45, 0.1)', color: 'var(--accent-orange)', border: '1px solid rgba(254, 127, 45, 0.3)', fontSize: '0.73rem' }}
                                                                    >
                                                                        +{assigned.length - 3} more
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="text-end">
                                                        <button
                                                            type="button"
                                                            className="btn btn-sm rounded-pill px-3 py-1.5 fw-bold d-inline-flex align-items-center gap-1.5 shadow-sm coordinator-manage-btn"
                                                            style={{
                                                                background: 'var(--primary-teal)',
                                                                color: '#ffffff',
                                                                border: 'none',
                                                                transition: 'all 0.2s ease'
                                                            }}
                                                            onClick={() => handleOpenAssignmentModal(c)}
                                                        >
                                                            <i className="bi bi-sliders" style={{ color: '#ffffff' }} />
                                                            <span style={{ color: '#ffffff' }}>Manage</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Column 2: Family Notifications & Student Holidays */}
                <div className="col-12 col-xl-4">
                    {/* Card 1: Family Notification Policy */}
                    <div className="card border-0 shadow-sm rounded-4 p-3.5 p-md-4 bg-white mb-4">
                        <div className="d-flex align-items-center justify-content-between border-bottom pb-3 mb-3">
                            <h5 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)' }}>
                                <i className="bi bi-bell-fill" style={{ color: 'var(--accent-orange)' }} />
                                Family Per-Child Alerts
                            </h5>
                            <span className="badge rounded-pill fw-bold px-2.5 py-1"
                                style={{ background: 'rgba(254, 127, 45, 0.1)', color: 'var(--accent-orange)', fontSize: '0.75rem' }}>
                                Policy
                            </span>
                        </div>

                        <p className="text-muted small mb-3">
                            Define which automated push notifications are dispatched to parents when daily student attendance is registered.
                        </p>

                        <div className="p-3 rounded-3 bg-light-subtle border mb-2.5">
                            <div className="form-check form-switch mb-0">
                                <input
                                    className="form-check-input cursor-pointer"
                                    type="checkbox"
                                    id="studentNotifyParentsToggle"
                                    checked={settings.student_notify_parents}
                                    onChange={e => setSettings({ ...settings, student_notify_parents: e.target.checked })}
                                />
                                <label className="form-check-label fw-bold cursor-pointer ms-2" htmlFor="studentNotifyParentsToggle" style={{ color: 'var(--primary-dark)' }}>
                                    Parent Attendance SMS / Alerts
                                </label>
                                <p className="text-muted mb-0 small mt-1 ms-2" style={{ fontSize: '0.75rem' }}>
                                    Send automated push &amp; SMS alerts to parents when student attendance is marked.
                                </p>
                            </div>
                        </div>

                        <div className="p-3 rounded-3 bg-light-subtle border mb-2.5">
                            <div className="form-check form-switch mb-0">
                                <input
                                    className="form-check-input cursor-pointer"
                                    type="checkbox"
                                    id="familyNotifyEachChildToggle"
                                    checked={settings.family_notify_each_child}
                                    onChange={e => setSettings({ ...settings, family_notify_each_child: e.target.checked })}
                                />
                                <label className="form-check-label fw-bold cursor-pointer ms-2" htmlFor="familyNotifyEachChildToggle" style={{ color: 'var(--primary-dark)' }}>
                                    Personalized Salutation Per Child
                                </label>
                                <p className="text-muted mb-0 small mt-1 ms-2" style={{ fontSize: '0.75rem' }}>
                                    Address parent with distinct student name &amp; class details for each child in family.
                                </p>
                            </div>
                        </div>

                        <div className="p-3 rounded-3 bg-light-subtle border mb-3">
                            <div className="form-check form-switch mb-0">
                                <input
                                    className="form-check-input cursor-pointer"
                                    type="checkbox"
                                    id="studentNotifyHolidaysToggle"
                                    checked={settings.student_notify_holidays}
                                    onChange={e => setSettings({ ...settings, student_notify_holidays: e.target.checked })}
                                />
                                <label className="form-check-label fw-bold cursor-pointer ms-2" htmlFor="studentNotifyHolidaysToggle" style={{ color: 'var(--primary-dark)' }}>
                                    Broadcast Holiday Alerts to Parents
                                </label>
                                <p className="text-muted mb-0 small mt-1 ms-2" style={{ fontSize: '0.75rem' }}>
                                    Notify parents in advance about scheduled vacations &amp; student holidays.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            className="btn w-100 text-white fw-bold py-2.5 rounded-3 shadow-sm d-flex align-items-center justify-content-center gap-2"
                            style={{ background: 'var(--accent-orange)', border: 'none' }}
                            onClick={handleSaveNotificationPolicy}
                            disabled={savingSettings}
                        >
                            {savingSettings ? (
                                <><span className="spinner-border spinner-border-sm" />Saving Policy...</>
                            ) : (
                                <><i className="bi bi-cloud-check-fill fs-5" /><span>Save Notification Policy</span></>
                            )}
                        </button>
                    </div>

                    {/* Card 2: Student Holidays & Breaks */}
                    <div className="card border-0 shadow-sm rounded-4 p-3.5 p-md-4 bg-white">
                        <div className="d-flex align-items-center justify-content-between border-bottom pb-3 mb-3">
                            <div>
                                <h5 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)' }}>
                                    <i className="bi bi-calendar-event-fill" style={{ color: 'var(--primary-teal)' }} />
                                    Student Holidays &amp; Breaks
                                </h5>
                                <p className="text-muted small mb-0 mt-0.5">Vacations and breaks exempt from attendance.</p>
                            </div>
                            <button
                                type="button"
                                className="btn btn-sm fw-bold px-3 py-1.5 rounded-3 d-flex align-items-center gap-1.5"
                                style={{ background: 'rgba(33, 94, 97, 0.1)', color: 'var(--primary-teal)', border: '1px solid rgba(33, 94, 97, 0.2)' }}
                                onClick={() => setShowHolidayModal(true)}
                            >
                                <i className="bi bi-plus-lg" />
                                <span>Add Holiday</span>
                            </button>
                        </div>

                        <div className="holidays-scroll-list overflow-auto" style={{ maxHeight: 380 }}>
                            {holidays.length === 0 ? (
                                <div className="text-center py-4 text-muted">
                                    <i className="bi bi-calendar-x fs-2 d-block mb-1 text-secondary opacity-50" />
                                    <p className="small mb-0">No student holidays scheduled.</p>
                                    <button
                                        type="button"
                                        className="btn btn-link text-decoration-none small fw-bold mt-1"
                                        style={{ color: 'var(--primary-teal)' }}
                                        onClick={() => setShowHolidayModal(true)}
                                    >
                                        Schedule holiday / vacation
                                    </button>
                                </div>
                            ) : (
                                holidays.map(h => (
                                    <div key={h.id} className="p-3 mb-2 rounded-3 border bg-light-subtle d-flex align-items-start justify-content-between gap-2">
                                        <div>
                                            <span className="badge rounded-pill fw-bold mb-1"
                                                style={{ background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', fontSize: '0.74rem', border: '1px solid rgba(124, 58, 237, 0.2)' }}>
                                                <i className="bi bi-calendar-heart-fill me-1" />
                                                {h.start_date === h.end_date ? h.start_date : `${h.start_date} to ${h.end_date}`}
                                            </span>
                                            <h6 className="fw-bold text-dark mb-0.5">{h.title}</h6>
                                            {h.description && <p className="text-muted mb-0 small" style={{ fontSize: '0.75rem' }}>{h.description}</p>}
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-outline-danger border-0 rounded-circle"
                                            onClick={() => handleDeleteHoliday(h.id, h.title)}
                                            title="Delete Holiday"
                                        >
                                            <i className="bi bi-trash3-fill" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ═════════════════════════════════════════════════════════════════════ */}
            {/* 3-COLUMN COORDINATOR ASSIGNMENT MODAL (PORTAL TO DOCUMENT.BODY)   */}
            {/* ═════════════════════════════════════════════════════════════════════ */}
            {selectedCoordinator && mounted && createPortal(
                <div style={{ position: 'fixed', inset: 0, zIndex: 99990, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Backdrop */}
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            backdropFilter: 'blur(5px)',
                            zIndex: 99991
                        }}
                        onClick={() => setSelectedCoordinator(null)}
                    />

                    {/* Modal Dialog */}
                    <div
                        className="modal-dialog modal-xl modal-dialog-centered"
                        style={{
                            position: 'relative',
                            zIndex: 99995,
                            maxWidth: 1100,
                            width: '95vw',
                            margin: 'auto',
                            maxHeight: '90vh'
                        }}
                    >
                        <div className="modal-content border-0 shadow-2xl rounded-4 overflow-hidden bg-white d-flex flex-column" style={{ maxHeight: '90vh' }}>
                            {/* Modal Header */}
                            <div className="modal-header border-0 py-3 px-3 px-md-4 text-white" style={{ background: 'linear-gradient(135deg, var(--primary-dark) 0%, var(--primary-teal) 100%)' }}>
                                <div>
                                    <div className="d-flex align-items-center gap-2">
                                        <div
                                            className="rounded-circle d-flex align-items-center justify-content-center fw-bold"
                                            style={{ width: 32, height: 32, background: 'rgba(255, 255, 255, 0.2)', color: '#fff', fontSize: '0.85rem' }}
                                        >
                                            <i className="bi bi-person-gear text-warning" />
                                        </div>
                                        <h5 className="modal-title fw-bold text-white mb-0 fs-5">
                                            Class Delegations: {selectedCoordinator.first_name} {selectedCoordinator.last_name || ''}
                                        </h5>
                                        <span
                                            className="badge rounded-pill fw-bold px-3 py-1 ms-1 shadow-sm d-inline-flex align-items-center gap-1.5"
                                            style={{
                                                backgroundColor: '#ffffff',
                                                color: 'var(--primary-dark)',
                                                border: '1px solid rgba(255, 255, 255, 0.9)',
                                                fontSize: '0.78rem',
                                                letterSpacing: '0.3px',
                                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.18)'
                                            }}
                                        >
                                            <i className="bi bi-person-badge-fill" style={{ color: 'var(--accent-orange)', fontSize: '0.76rem' }} />
                                            <span style={{ color: 'var(--primary-dark)' }}>{selectedCoordinator.designation || selectedCoordinator.department_name || 'Staff Member'}</span>
                                        </span>
                                    </div>
                                    <p className="small mb-0 mt-1 ms-4 ps-2" style={{ color: 'rgba(255, 255, 255, 0.92)' }}>
                                        Select classes and sections to grant attendance roll call permissions for this staff member.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="btn-close btn-close-white"
                                    onClick={() => setSelectedCoordinator(null)}
                                    title="Close"
                                />
                            </div>

                            {/* Mobile Step Navigator (< 768px) */}
                            <div className="d-md-none bg-light border-bottom p-2 d-flex gap-1 justify-content-between">
                                <button
                                    type="button"
                                    className={`btn btn-sm flex-fill fw-bold rounded-3 ${modalMobileTab === 'classes' ? 'text-white' : 'btn-light border'}`}
                                    style={modalMobileTab === 'classes' ? { background: 'var(--primary-teal)' } : {}}
                                    onClick={() => setModalMobileTab('classes')}
                                >
                                    1. Classes ({allClasses.length})
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-sm flex-fill fw-bold rounded-3 ${modalMobileTab === 'sections' ? 'text-white' : 'btn-light border'}`}
                                    style={modalMobileTab === 'sections' ? { background: 'var(--primary-teal)' } : {}}
                                    onClick={() => setModalMobileTab('sections')}
                                >
                                    2. Sections
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-sm flex-fill fw-bold rounded-3 ${modalMobileTab === 'summary' ? 'text-white' : 'btn-light border'}`}
                                    style={modalMobileTab === 'summary' ? { background: 'var(--accent-orange)' } : {}}
                                    onClick={() => setModalMobileTab('summary')}
                                >
                                    3. Summary ({modalSelectedPairs.length})
                                </button>
                            </div>

                            {/* 3-Columns Modal Body */}
                            <div className="modal-body p-0 overflow-hidden flex-grow-1">
                                <div className="row g-0 h-100" style={{ minHeight: 460 }}>
                                    {/* COLUMN 1: 1. SELECT CLASS */}
                                    <div className={`col-12 col-md-3 border-end bg-light-subtle ${modalMobileTab !== 'classes' ? 'd-none d-md-block' : 'd-block'}`} style={{ maxHeight: 480, overflowY: 'auto' }}>
                                        <div className="p-3 border-bottom bg-white fw-bold text-uppercase small d-flex align-items-center justify-content-between sticky-top" style={{ zIndex: 2, color: 'var(--primary-dark)' }}>
                                            <div className="d-flex align-items-center gap-2">
                                                <i className="bi bi-building-fill" style={{ color: 'var(--primary-teal)' }} />
                                                <span style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>1. Select Class</span>
                                            </div>
                                            <span className="badge rounded-pill bg-light text-dark border">
                                                {allClasses.length}
                                            </span>
                                        </div>
                                        <div className="class-list">
                                            {allClasses.map(c => {
                                                const selectedCount = getSelectedCountForClass(c.class_id);
                                                const isActive = modalActiveTabClassId === c.class_id;
                                                return (
                                                    <div
                                                        key={c.class_id}
                                                        className={`p-3 d-flex align-items-center justify-content-between border-bottom transition-all ${isActive ? 'bg-white shadow-sm' : ''}`}
                                                        style={{
                                                            cursor: 'pointer',
                                                            borderLeft: isActive ? '4px solid var(--accent-orange)' : '4px solid transparent',
                                                            backgroundColor: isActive ? 'rgba(254, 127, 45, 0.08)' : undefined,
                                                            transition: 'all 0.15s ease'
                                                        }}
                                                        onClick={() => {
                                                            setModalActiveTabClassId(c.class_id);
                                                            setModalMobileTab('sections');
                                                        }}
                                                    >
                                                        <div className="d-flex align-items-center gap-2">
                                                            <i className={`bi ${isActive ? 'bi-folder2-open text-warning' : 'bi-folder2 text-muted'}`} />
                                                            <span className={`small ${isActive ? 'fw-bold text-dark' : 'text-secondary'}`}>{c.class_name}</span>
                                                        </div>
                                                        {selectedCount > 0 && (
                                                            <span
                                                                className="badge rounded-pill fw-bold"
                                                                style={{ backgroundColor: 'var(--accent-orange)', color: '#fff', fontSize: '0.72rem' }}
                                                            >
                                                                {selectedCount}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* COLUMN 2: 2. SELECT SECTION */}
                                    <div className={`col-12 col-md-4 border-end bg-white ${modalMobileTab !== 'sections' ? 'd-none d-md-block' : 'd-block'}`} style={{ maxHeight: 480, overflowY: 'auto' }}>
                                        <div className="p-3 border-bottom bg-white fw-bold text-uppercase small d-flex align-items-center justify-content-between sticky-top" style={{ zIndex: 2, color: 'var(--primary-dark)' }}>
                                            <div className="d-flex align-items-center gap-2">
                                                <i className="bi bi-grid-3x3-gap-fill" style={{ color: 'var(--primary-teal)' }} />
                                                <span style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>2. Select Section</span>
                                            </div>
                                            {modalActiveTabClassId && (
                                                <button
                                                    type="button"
                                                    className="btn btn-sm py-0.5 px-2.5 fw-bold text-decoration-none rounded-pill"
                                                    style={{ color: 'var(--accent-orange)', background: 'rgba(254, 127, 45, 0.1)', border: '1px solid rgba(254, 127, 45, 0.25)', fontSize: '0.74rem' }}
                                                    onClick={() => handleToggleAllSectionsForClass(modalActiveTabClassId)}
                                                >
                                                    Toggle All
                                                </button>
                                            )}
                                        </div>

                                        <div className="section-list p-3">
                                            {!modalActiveTabClassId ? (
                                                <div className="text-center py-5 text-muted">
                                                    <i className="bi bi-arrow-left fs-3 d-block mb-1 opacity-50" />
                                                    <span className="small">Select a class on the left to view sections</span>
                                                </div>
                                            ) : (
                                                allSections
                                                    .filter(s => Number(s.class_id) === Number(modalActiveTabClassId))
                                                    .map(s => {
                                                        const isChecked = modalSelectedPairs.some(
                                                            p => p.class_id === modalActiveTabClassId && p.section_id === s.section_id
                                                        );
                                                        return (
                                                            <div
                                                                key={s.section_id}
                                                                className={`p-3 mb-2.5 rounded-3 border d-flex align-items-center justify-content-between cursor-pointer transition-all ${isChecked ? 'shadow-sm' : 'bg-light-subtle'}`}
                                                                style={{
                                                                    cursor: 'pointer',
                                                                    borderColor: isChecked ? 'var(--primary-teal)' : '#e2e8f0',
                                                                    backgroundColor: isChecked ? 'rgba(33, 94, 97, 0.08)' : '#f8fafc',
                                                                    transition: 'all 0.15s ease'
                                                                }}
                                                                onClick={() => handleToggleSectionPair(modalActiveTabClassId, s.section_id)}
                                                            >
                                                                <div className="d-flex align-items-center gap-2.5">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="form-check-input cursor-pointer m-0"
                                                                        checked={isChecked}
<<<<<<< HEAD
                                                                        onChange={() => {}}
=======
                                                                        onChange={() => { }}
>>>>>>> ce92bb0 (feat: add general settings, attendance management modules, and cross-platform app icons)
                                                                        style={{ width: 18, height: 18, accentColor: 'var(--primary-teal)' }}
                                                                    />
                                                                    <span className="fw-bold text-dark small">
                                                                        Section {s.section_name}
                                                                    </span>
                                                                </div>
                                                                {isChecked && (
                                                                    <span className="badge rounded-pill fw-bold text-white small px-2.5 py-1" style={{ background: 'var(--primary-teal)', fontSize: '0.72rem' }}>
                                                                        ✓ Assigned
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                            )}
                                        </div>
                                    </div>

                                    {/* COLUMN 3: 3. ASSIGNMENT SUMMARY */}
                                    <div className={`col-12 col-md-5 bg-light-subtle ${modalMobileTab !== 'summary' ? 'd-none d-md-block' : 'd-block'}`} style={{ maxHeight: 480, overflowY: 'auto' }}>
                                        <div className="p-3 border-bottom bg-white fw-bold text-uppercase small d-flex align-items-center justify-content-between sticky-top" style={{ zIndex: 2, color: 'var(--primary-dark)' }}>
                                            <div className="d-flex align-items-center gap-2">
                                                <i className="bi bi-clipboard-check-fill" style={{ color: 'var(--primary-teal)' }} />
                                                <span style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>3. Selected Summary</span>
                                            </div>
                                            <span className="badge rounded-pill fw-bold" style={{ background: 'rgba(33, 94, 97, 0.1)', color: 'var(--primary-teal)' }}>
                                                {modalSelectedPairs.length} Selected
                                            </span>
                                        </div>

                                        <div className="p-3">
                                            {modalSelectedPairs.length === 0 ? (
                                                <div className="text-center py-5 text-muted">
                                                    <i className="bi bi-card-checklist fs-2 d-block mb-2 opacity-50" />
                                                    <p className="small mb-0">No sections selected yet.</p>
                                                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>Select classes &amp; sections on the left to assign to this coordinator.</span>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div className="d-flex flex-column gap-2.5">
                                                        {allClasses
                                                            .filter(c => getSelectedCountForClass(c.class_id) > 0)
                                                            .map(c => {
                                                                const classSelectedSections = allSections.filter(s =>
                                                                    Number(s.class_id) === Number(c.class_id) &&
                                                                    modalSelectedPairs.some(p => p.class_id === c.class_id && p.section_id === s.section_id)
                                                                );
                                                                return (
                                                                    <div key={c.class_id} className="p-3 bg-white border rounded-3 shadow-sm">
                                                                        <div className="d-flex align-items-center justify-content-between mb-2 pb-1.5 border-bottom">
                                                                            <div className="d-flex align-items-center gap-2">
                                                                                <i className="bi bi-mortarboard-fill" style={{ color: 'var(--primary-teal)' }} />
                                                                                <span className="fw-bold text-dark small">{c.class_name}</span>
                                                                            </div>
                                                                            <span className="badge rounded-pill fw-bold"
                                                                                style={{ background: 'rgba(33, 94, 97, 0.1)', color: 'var(--primary-teal)', fontSize: '0.72rem' }}>
                                                                                {classSelectedSections.length} Sections
                                                                            </span>
                                                                        </div>
                                                                        <div className="d-flex flex-wrap gap-1.5">
                                                                            {classSelectedSections.map(s => (
                                                                                <span
                                                                                    key={s.section_id}
                                                                                    className="badge rounded-pill fw-semibold px-2.5 py-1 text-dark"
                                                                                    style={{ background: 'rgba(33, 94, 97, 0.08)', border: '1px solid rgba(33, 94, 97, 0.2)', fontSize: '0.74rem' }}
                                                                                >
                                                                                    Section {s.section_name}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="modal-footer border-top bg-white py-3 px-3 px-md-4 d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center justify-content-between gap-2">
                                <div>
                                    <span
                                        className="badge rounded-pill px-3 py-2 fw-bold text-white d-inline-flex align-items-center gap-1.5"
                                        style={{ backgroundColor: 'var(--primary-teal)', fontSize: '0.84rem' }}
                                    >
                                        <i className="bi bi-check2-all fs-6" />
                                        <span>{modalSelectedPairs.length} Sections Assigned</span>
                                    </span>
                                </div>
                                <div className="d-flex align-items-center gap-2 justify-content-end">
                                    <button
                                        type="button"
                                        className="btn btn-light px-4 py-2 fw-bold rounded-3 flex-fill flex-sm-grow-0 border"
                                        onClick={() => setSelectedCoordinator(null)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn text-white px-4 py-2 fw-bold rounded-3 shadow-sm d-flex align-items-center justify-content-center gap-2 flex-fill flex-sm-grow-0"
                                        style={{ background: 'var(--accent-orange)', border: 'none' }}
                                        onClick={handleSaveCoordinatorAssignments}
                                        disabled={savingAssignments}
                                    >
                                        {savingAssignments ? (
                                            <><span className="spinner-border spinner-border-sm" />Saving...</>
                                        ) : (
                                            <><i className="bi bi-cloud-check-fill fs-5" /><span>Confirm &amp; Save</span></>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Add Holiday Modal (PORTAL TO DOCUMENT.BODY) */}
            {showHolidayModal && mounted && createPortal(
                <div style={{ position: 'fixed', inset: 0, zIndex: 99990, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            backgroundColor: 'rgba(0,0,0,0.65)',
                            backdropFilter: 'blur(4px)',
                            zIndex: 99991
                        }}
                        onClick={() => setShowHolidayModal(false)}
                    />
                    <div className="modal-dialog modal-dialog-centered" style={{ position: 'relative', zIndex: 99995, maxWidth: 480, width: '90vw', margin: 'auto' }}>
                        <div className="modal-content border-0 shadow-2xl rounded-4 overflow-hidden bg-white">
                            <div className="modal-header border-0 py-3 px-4 text-white" style={{ background: 'linear-gradient(135deg, var(--primary-dark), var(--primary-teal))' }}>
                                <h5 className="modal-title fw-bold text-white mb-0 d-flex align-items-center gap-2">
                                    <i className="bi bi-sun-fill text-warning" />
                                    Add Student Holiday / Vacation
                                </h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowHolidayModal(false)} />
                            </div>

                            <form onSubmit={handleAddHoliday}>
                                <div className="modal-body p-4">
                                    <div className="mb-3">
                                        <label className="form-label fw-bold small text-secondary">Holiday Title <span className="text-danger">*</span></label>
                                        <input
                                            type="text"
                                            className="form-control fw-bold"
                                            placeholder="e.g. Summer Vacation, Eid Holidays"
                                            value={holidayTitle}
                                            onChange={e => setHolidayTitle(e.target.value)}
                                            required
                                        />
                                    </div>

                                    <div className="row g-2 mb-3">
                                        <div className="col-6">
                                            <label className="form-label fw-bold small text-secondary">Start Date <span className="text-danger">*</span></label>
                                            <input
                                                type="date"
                                                className="form-control fw-bold"
                                                value={holidayStartDate}
                                                onChange={e => setHolidayStartDate(e.target.value)}
                                                required
                                            />
                                        </div>
                                        <div className="col-6">
                                            <label className="form-label fw-bold small text-secondary">End Date (Optional)</label>
                                            <input
                                                type="date"
                                                className="form-control fw-bold"
                                                value={holidayEndDate}
                                                onChange={e => setHolidayEndDate(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label fw-bold small text-secondary">Notice / Details</label>
                                        <textarea
                                            className="form-control"
                                            rows={2}
                                            placeholder="Optional note for parents and students"
                                            value={holidayDesc}
                                            onChange={e => setHolidayDesc(e.target.value)}
                                        />
                                    </div>

                                    <div className="form-check form-switch mb-2">
                                        <input
                                            className="form-check-input cursor-pointer"
                                            type="checkbox"
                                            id="studentHolidayBroadcastCheck"
                                            checked={holidayBroadcast}
                                            onChange={e => setHolidayBroadcast(e.target.checked)}
                                        />
                                        <label className="form-check-label fw-semibold text-dark small cursor-pointer ms-1" htmlFor="studentHolidayBroadcastCheck">
                                            Send broadcast alert to student/family portal &amp; mobile app
                                        </label>
                                    </div>
                                </div>

                                <div className="modal-footer border-top bg-light py-2.5 px-4">
                                    <button type="button" className="btn btn-secondary px-3 py-2 fw-bold rounded-3" onClick={() => setShowHolidayModal(false)}>
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn text-white px-4 py-2 fw-bold rounded-3 shadow-sm"
                                        style={{ background: 'var(--accent-orange)', border: 'none' }}
                                        disabled={savingHoliday}
                                    >
                                        {savingHoliday ? 'Saving...' : 'Create Holiday'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <style jsx>{`
                .cursor-pointer { cursor: pointer; }
                .coordinator-manage-btn {
                    background: var(--primary-teal) !important;
                    color: #ffffff !important;
                }
                .coordinator-manage-btn:hover {
                    background: var(--primary-teal-hover, #1a4a4d) !important;
                    color: #ffffff !important;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 10px rgba(33, 94, 97, 0.3) !important;
                }
                .class-list::-webkit-scrollbar,
                .section-list::-webkit-scrollbar,
                .holidays-scroll-list::-webkit-scrollbar {
                    width: 5px;
                }
                .class-list::-webkit-scrollbar-thumb,
                .section-list::-webkit-scrollbar-thumb,
                .holidays-scroll-list::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 4px;
                }
            `}</style>
        </div>
    );
}
