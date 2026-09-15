'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type ClassItem = {
    class_id: number;
    class_name: string;
};

type SectionItem = {
    section_id: number;
    section_name: string;
};

type ExamMonthItem = {
    key: string;
    month: number;
    year: number;
    month_name: string;
    head_name: string;
    amount: number;
    collection_name: string;
    label: string;
    source: 'fee_slip' | 'history';
};

type StudentItem = {
    student_id: number;
    admission_no?: string;
    first_name: string;
    last_name: string;
    roll_no: string | null;
    family_id?: string;
    is_paid: boolean;
    collection_source: 'Office' | 'Class' | null;
    paid_amount: string | number | null;
    paid_remarks: string | null;
    collection_date: string | null;
    collector_name?: string | null;
    can_modify: boolean;
    remarks?: string;
    selected?: boolean;
};

const API = process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com";

export default function ExamCollectionPage() {
    const { user } = useAuth();

    const [classes, setClasses] = useState<ClassItem[]>([]);
    const [sections, setSections] = useState<SectionItem[]>([]);
    const [examMonths, setExamMonths] = useState<ExamMonthItem[]>([]);
    const [students, setStudents] = useState<StudentItem[]>([]);
    const [activeYear, setActiveYear] = useState<{ id: number; year_name: string; is_active: boolean } | null>(null);

    const [selectedClass, setSelectedClass] = useState('');
    const [selectedSection, setSelectedSection] = useState('');
    const [selectedMonthKey, setSelectedMonthKey] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const [loadingClasses, setLoadingClasses] = useState(false);
    const [loadingMonths, setLoadingMonths] = useState(false);
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'danger' | 'warning' | 'info'; text: string } | null>(null);

    // Selected exam month object
    const selectedMonthItem = useMemo(() => {
        return examMonths.find(m => m.key === selectedMonthKey) || null;
    }, [examMonths, selectedMonthKey]);

    // Statistics calculations
    const totalStudents = students.length;
    const officePaidStudents = useMemo(() => students.filter(s => s.is_paid && s.collection_source === 'Office'), [students]);
    const classPaidStudents = useMemo(() => students.filter(s => s.is_paid && s.collection_source === 'Class'), [students]);
    const totalPaidStudents = useMemo(() => students.filter(s => s.is_paid), [students]);
    const pendingStudents = useMemo(() => students.filter(s => !s.is_paid), [students]);

    const selectedCount = useMemo(() => students.filter(s => s.selected && !s.is_paid).length, [students]);
    const fixedFeeAmount = selectedMonthItem ? selectedMonthItem.amount : 0;
    const selectedTotalAmount = selectedCount * fixedFeeAmount;

    // Filtered students by search query
    const filteredStudents = useMemo(() => {
        if (!searchQuery.trim()) return students;
        const q = searchQuery.toLowerCase().trim();
        return students.filter(s => 
            (s.first_name || '').toLowerCase().includes(q) ||
            (s.last_name || '').toLowerCase().includes(q) ||
            (s.roll_no || '').toLowerCase().includes(q) ||
            (s.admission_no || '').toLowerCase().includes(q) ||
            (s.family_id || '').toLowerCase().includes(q)
        );
    }, [students, searchQuery]);

    // Load active academic year
    useEffect(() => {
        fetch(`${API}/academic/active-year`)
            .then(r => r.json())
            .then(data => {
                if (data && data.id) setActiveYear(data);
            })
            .catch(() => {});
    }, []);

    // Load classes accessible by user
    const loadClasses = useCallback(async () => {
        if (!user?.id) return;
        setLoadingClasses(true);
        setMsg(null);
        try {
            const res = await fetch(`${API}/exam-fees/classes?user_id=${user.id}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load classes');
            setClasses(Array.isArray(data) ? data : []);
        } catch (error: any) {
            setMsg({ type: 'danger', text: error.message || 'Failed to load classes' });
        } finally {
            setLoadingClasses(false);
        }
    }, [user?.id]);

    useEffect(() => {
        loadClasses();
    }, [loadClasses]);

    // Load sections when class changes
    const loadSections = useCallback(async (classId: string) => {
        if (!user?.id || !classId) {
            setSections([]);
            return;
        }
        try {
            const res = await fetch(`${API}/exam-fees/sections?class_id=${classId}&user_id=${user.id}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load sections');
            const secList = Array.isArray(data) ? data : [];
            setSections(secList);
            if (secList.length === 1) {
                setSelectedSection(secList[0].section_id.toString());
            }
        } catch (error: any) {
            setSections([]);
            setMsg({ type: 'danger', text: error.message || 'Failed to load sections' });
        }
    }, [user?.id]);

    // Load exam months from generated fee slips containing exam heads
    const loadExamMonths = useCallback(async (classId: string) => {
        if (!classId) {
            setExamMonths([]);
            setSelectedMonthKey('');
            return;
        }
        setLoadingMonths(true);
        try {
            const params = new URLSearchParams({ class_id: classId });
            if (activeYear?.id) params.append('academic_year_id', activeYear.id.toString());
            const res = await fetch(`${API}/exam-fees/months?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load exam months');
            
            const list: ExamMonthItem[] = Array.isArray(data) ? data : [];
            setExamMonths(list);

            if (list.length > 0) {
                // Default to the first (latest) generated exam month
                setSelectedMonthKey(list[0].key);
            } else {
                setSelectedMonthKey('');
            }
        } catch (error: any) {
            setExamMonths([]);
            setSelectedMonthKey('');
            setMsg({ type: 'warning', text: error.message || 'No exam fee heads found for this class.' });
        } finally {
            setLoadingMonths(false);
        }
    }, [activeYear?.id]);

    // Handle class selection
    const handleClassChange = (classId: string) => {
        setSelectedClass(classId);
        setSelectedSection('');
        setSelectedMonthKey('');
        setStudents([]);
        setSearchQuery('');
        if (classId) {
            loadSections(classId);
            loadExamMonths(classId);
        } else {
            setSections([]);
            setExamMonths([]);
        }
    };

    // Load students with real-time Office vs Class payment recognition
    const fetchStudents = useCallback(async () => {
        if (!selectedClass || !selectedSection || !selectedMonthItem) {
            setStudents([]);
            return;
        }

        setLoadingStudents(true);
        setMsg(null);
        try {
            const params = new URLSearchParams({
                class_id: selectedClass,
                section_id: selectedSection,
                collection_name: selectedMonthItem.collection_name,
                month: selectedMonthItem.month.toString(),
                year: selectedMonthItem.year.toString()
            });
            if (activeYear?.id) params.append('academic_year_id', activeYear.id.toString());

            const res = await fetch(`${API}/exam-fees/students?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Failed to load students');

            const rows: StudentItem[] = Array.isArray(data)
                ? data.map((student: StudentItem) => ({
                    ...student,
                    // If already paid, automatically checked and locked; if unpaid, default unchecked
                    selected: student.is_paid ? true : false,
                    remarks: student.paid_remarks || '',
                }))
                : [];

            setStudents(rows);
        } catch (error: any) {
            setStudents([]);
            setMsg({ type: 'danger', text: error.message || 'Failed to load students' });
        } finally {
            setLoadingStudents(false);
        }
    }, [selectedClass, selectedSection, selectedMonthItem, activeYear?.id]);

    // Fetch students whenever Class, Section, or Exam Month changes
    useEffect(() => {
        if (selectedClass && selectedSection && selectedMonthItem) {
            fetchStudents();
        } else {
            setStudents([]);
        }
    }, [selectedClass, selectedSection, selectedMonthItem, fetchStudents]);

    // Toggle Select All for UNPAID students only
    const handleSelectAll = (checked: boolean) => {
        setStudents(prev => prev.map(student => {
            if (student.is_paid) return student; // Already paid is permanently checked & disabled
            return { ...student, selected: checked };
        }));
    };

    // Toggle single student checkbox (only allowed for unpaid students)
    const handleStudentCheck = (studentId: number, checked: boolean) => {
        setStudents(prev => prev.map(student => {
            if (student.student_id === studentId && !student.is_paid) {
                return { ...student, selected: checked };
            }
            return student;
        }));
    };

    // Update teacher remarks for an unpaid student
    const handleRemarkChange = (studentId: number, value: string) => {
        setStudents(prev => prev.map(student => {
            if (student.student_id === studentId) {
                return { ...student, remarks: value };
            }
            return student;
        }));
    };

    // Save class collection & dispatch real-time dual notifications
    const handleSave = async () => {
        if (!selectedMonthItem) {
            setMsg({ type: 'warning', text: 'Please select an Exam Month & Head first.' });
            return;
        }

        const selectedRows = students
            .filter(student => student.selected && !student.is_paid)
            .map(student => ({
                student_id: student.student_id,
                amount: fixedFeeAmount,
                remarks: student.remarks || 'Cash collected in class',
            }));

        if (selectedRows.length === 0) {
            setMsg({ type: 'warning', text: 'Select at least one unpaid student to collect fee.' });
            return;
        }

        const confirmMsg = `Confirm collecting Exam Fee for ${selectedRows.length} student(s)?\nTotal: Rs. ${selectedTotalAmount.toLocaleString()}\nExam: ${selectedMonthItem.label}`;
        if (!window.confirm(confirmMsg)) return;

        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch(`${API}/exam-fees/collect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: user?.id,
                    class_id: selectedClass,
                    section_id: selectedSection,
                    collection_name: selectedMonthItem.collection_name,
                    month: selectedMonthItem.month,
                    year: selectedMonthItem.year,
                    academic_year_id: activeYear?.id,
                    students: selectedRows,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Failed to save collection');

            setMsg({ 
                type: 'success', 
                text: data.message || `Successfully collected exam fee for ${selectedRows.length} students. Notifications sent!` 
            });

            // Refresh student grid to reflect the newly paid status
            await fetchStudents();
        } catch (error: any) {
            setMsg({ type: 'danger', text: error.message || 'Error while saving collection' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page-wrap pb-5" style={{ backgroundColor: 'var(--bg-main, #f8fafc)', minHeight: '100vh' }}>
            {/* Page Header */}
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2 pt-2">
                <div>
                    <h4 className="mb-1 fw-bold d-flex align-items-center flex-wrap gap-2" style={{ color: 'var(--primary-dark, #0f172a)' }}>
                        <i className="bi bi-cash-coin me-1" style={{ color: 'var(--accent-orange, #f59e0b)' }} />
                        Class Exam Fee Collection
                        <span className="badge rounded-pill bg-light text-dark border ms-2" style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                            <i className="bi bi-calendar-check me-1 text-primary"></i>
                            Session: {activeYear?.year_name || 'Active'}
                        </span>
                    </h4>
                    <div className="text-muted small">
                        Collect exam fees in class with real-time automatic office payment detection and instant notifications.
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2">
                    <button
                        className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 shadow-sm"
                        onClick={() => fetchStudents()}
                        disabled={!selectedClass || !selectedSection || !selectedMonthItem || loadingStudents}
                        title="Reload students list"
                    >
                        {loadingStudents ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-arrow-repeat" />}
                        <span>Refresh</span>
                    </button>
                    {selectedCount > 0 && (
                        <button
                            className="btn btn-sm btn-primary d-flex align-items-center gap-1 shadow-sm fw-semibold"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? (
                                <>
                                    <span className="spinner-border spinner-border-sm me-1" /> Saving...
                                </>
                            ) : (
                                <>
                                    <i className="bi bi-check2-circle me-1" /> Save Collection ({selectedCount})
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Alert Message */}
            {msg && (
                <div className={`alert alert-${msg.type} alert-dismissible shadow-sm fade show mb-4`} role="alert">
                    <div className="d-flex align-items-center">
                        <i className={`bi ${msg.type === 'success' ? 'bi-check-circle-fill' : msg.type === 'warning' ? 'bi-exclamation-triangle-fill' : 'bi-x-circle-fill'} me-2 fs-5`}></i>
                        <div>{msg.text}</div>
                    </div>
                    <button type="button" className="btn-close" onClick={() => setMsg(null)} />
                </div>
            )}

            {/* Top KPI Statistics Cards */}
            <div className="row g-3 mb-4">
                <div className="col-6 col-md-3">
                    <div className="card border-0 shadow-sm rounded-3 h-100" style={{ borderLeft: '4px solid #3b82f6' }}>
                        <div className="card-body p-3">
                            <div className="d-flex align-items-center justify-content-between">
                                <div>
                                    <div className="text-muted small fw-semibold text-uppercase">Total Students</div>
                                    <div className="fs-4 fw-bold text-dark mt-1">{totalStudents}</div>
                                </div>
                                <div className="rounded-circle bg-primary-subtle text-primary p-3 d-flex align-items-center justify-content-center" style={{ width: 44, height: 44 }}>
                                    <i className="bi bi-people-fill fs-5"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-6 col-md-3">
                    <div className="card border-0 shadow-sm rounded-3 h-100" style={{ borderLeft: '4px solid #0ea5e9' }}>
                        <div className="card-body p-3">
                            <div className="d-flex align-items-center justify-content-between">
                                <div>
                                    <div className="text-muted small fw-semibold text-uppercase">Office Paid</div>
                                    <div className="fs-4 fw-bold text-info mt-1">
                                        {officePaidStudents.length}
                                        <span className="fs-6 fw-normal text-muted ms-1">students</span>
                                    </div>
                                    <div className="small text-muted">Auto-detected from fee slips</div>
                                </div>
                                <div className="rounded-circle bg-info-subtle text-info p-3 d-flex align-items-center justify-content-center" style={{ width: 44, height: 44 }}>
                                    <i className="bi bi-building fs-5"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-6 col-md-3">
                    <div className="card border-0 shadow-sm rounded-3 h-100" style={{ borderLeft: '4px solid #f59e0b' }}>
                        <div className="card-body p-3">
                            <div className="d-flex align-items-center justify-content-between">
                                <div>
                                    <div className="text-muted small fw-semibold text-uppercase">Class Paid</div>
                                    <div className="fs-4 fw-bold text-warning mt-1">
                                        {classPaidStudents.length}
                                        <span className="fs-6 fw-normal text-muted ms-1">students</span>
                                    </div>
                                    <div className="small text-muted">Collected by class teacher</div>
                                </div>
                                <div className="rounded-circle bg-warning-subtle text-warning p-3 d-flex align-items-center justify-content-center" style={{ width: 44, height: 44 }}>
                                    <i className="bi bi-person-workspace fs-5"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-6 col-md-3">
                    <div className="card border-0 shadow-sm rounded-3 h-100" style={{ borderLeft: '4px solid #ef4444' }}>
                        <div className="card-body p-3">
                            <div className="d-flex align-items-center justify-content-between">
                                <div>
                                    <div className="text-muted small fw-semibold text-uppercase">Pending Unpaid</div>
                                    <div className="fs-4 fw-bold text-danger mt-1">
                                        {pendingStudents.length}
                                        <span className="fs-6 fw-normal text-muted ms-1">students</span>
                                    </div>
                                    <div className="small text-muted">
                                        {selectedCount > 0 ? `${selectedCount} selected for save` : 'Awaiting collection'}
                                    </div>
                                </div>
                                <div className="rounded-circle bg-danger-subtle text-danger p-3 d-flex align-items-center justify-content-center" style={{ width: 44, height: 44 }}>
                                    <i className="bi bi-hourglass-split fs-5"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter & Configuration Card */}
            <div className="card border-0 shadow-sm mb-4 rounded-3">
                <div className="card-header bg-white border-bottom py-3" style={{ borderLeft: '4px solid var(--primary-teal, #0d9488)' }}>
                    <div className="d-flex align-items-center justify-content-between">
                        <h6 className="mb-0 fw-bold d-flex align-items-center" style={{ color: 'var(--primary-dark, #0f172a)' }}>
                            <i className="bi bi-funnel-fill me-2" style={{ color: 'var(--primary-teal, #0d9488)' }} />
                            Select Class & Exam Month
                        </h6>
                        {selectedMonthItem && (
                            <span className="badge bg-success-subtle text-success border border-success-subtle px-3 py-1.5">
                                <i className="bi bi-check-circle-fill me-1"></i>
                                Head Linked: {selectedMonthItem.head_name}
                            </span>
                        )}
                    </div>
                </div>

                <div className="card-body p-4">
                    <div className="row g-3 align-items-end">
                        {/* Class Dropdown */}
                        <div className="col-md-3">
                            <label className="form-label fw-semibold text-secondary small mb-1">
                                Class <span className="text-danger">*</span>
                            </label>
                            <select
                                className="form-select"
                                value={selectedClass}
                                onChange={e => handleClassChange(e.target.value)}
                                disabled={loadingClasses}
                            >
                                <option value="">Select Class</option>
                                {classes.map(c => (
                                    <option key={c.class_id} value={c.class_id}>
                                        {c.class_name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Section Dropdown */}
                        <div className="col-md-3">
                            <label className="form-label fw-semibold text-secondary small mb-1">
                                Section <span className="text-danger">*</span>
                            </label>
                            <select
                                className="form-select"
                                value={selectedSection}
                                onChange={e => setSelectedSection(e.target.value)}
                                disabled={!selectedClass || loadingClasses}
                            >
                                <option value="">Select Section</option>
                                {sections.map(s => (
                                    <option key={s.section_id} value={s.section_id}>
                                        {s.section_name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Exam Month & Head Dropdown (Strictly Generated Exam Months) */}
                        <div className="col-md-4">
                            <label className="form-label fw-semibold text-secondary small mb-1">
                                Exam Month & Fee Head <span className="text-danger">*</span>
                                {loadingMonths && <span className="spinner-border spinner-border-sm ms-2 text-primary"></span>}
                            </label>
                            <select
                                className="form-select"
                                value={selectedMonthKey}
                                onChange={e => setSelectedMonthKey(e.target.value)}
                                disabled={!selectedClass || loadingMonths || examMonths.length === 0}
                            >
                                {examMonths.length === 0 ? (
                                    <option value="">
                                        {selectedClass ? 'No Exam Fee Head Generated in Fee Slips' : 'Select Class First'}
                                    </option>
                                ) : (
                                    examMonths.map(item => (
                                        <option key={item.key} value={item.key}>
                                            {item.label}
                                        </option>
                                    ))
                                )}
                            </select>
                            {/* <div className="form-text small text-muted">
                                Only months with generated fee slips containing an Exam Head appear here.
                            </div> */}
                        </div>

                        {/* Amount (Locked & Fixed from Fee Head) */}
                        <div className="col-md-2">
                            <label className="form-label fw-semibold text-secondary small mb-1">
                                Amount (Rs.) <i className="bi bi-lock-fill text-muted ms-1" title="Locked to generated head"></i>
                            </label>
                            <div className="input-group">
                                <span className="input-group-text bg-light text-muted border-end-0">
                                    <i className="bi bi-lock-fill"></i>
                                </span>
                                <input
                                    type="text"
                                    className="form-control bg-light text-dark fw-bold border-start-0"
                                    value={fixedFeeAmount > 0 ? fixedFeeAmount.toLocaleString() : '—'}
                                    readOnly
                                    title="Fee amount is fixed from the fee head and locked for teachers"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Student Collection Sheet Card */}
            <div className="card border-0 shadow-sm rounded-3">
                <div
                    className="card-header bg-white d-flex flex-wrap gap-3 justify-content-between align-items-center border-bottom py-3"
                    style={{ borderLeft: '4px solid var(--accent-orange, #f59e0b)' }}
                >
                    <div className="d-flex align-items-center gap-2">
                        <h6 className="mb-0 fw-bold d-flex align-items-center" style={{ color: 'var(--primary-dark, #0f172a)' }}>
                            <i className="bi bi-table me-2" style={{ color: 'var(--accent-orange, #f59e0b)' }} />
                            Student Collection Sheet
                            <span className="ms-2 badge bg-secondary-subtle text-secondary rounded-pill">{totalStudents}</span>
                        </h6>
                    </div>

                    {/* Table Quick Filters & Actions */}
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                        {students.length > 0 && (
                            <div className="input-group input-group-sm" style={{ maxWidth: 220 }}>
                                <span className="input-group-text bg-light border-end-0">
                                    <i className="bi bi-search text-muted"></i>
                                </span>
                                <input
                                    type="text"
                                    className="form-control border-start-0"
                                    placeholder="Search roll / name..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                                {searchQuery && (
                                    <button className="btn btn-outline-secondary" onClick={() => setSearchQuery('')}>
                                        <i className="bi bi-x"></i>
                                    </button>
                                )}
                            </div>
                        )}

                        <button
                            className="btn btn-sm btn-primary fw-semibold px-3 d-flex align-items-center gap-1 shadow-sm"
                            onClick={handleSave}
                            disabled={saving || selectedCount === 0}
                        >
                            {saving ? (
                                <>
                                    <span className="spinner-border spinner-border-sm me-1" /> Saving...
                                </>
                            ) : (
                                <>
                                    <i className="bi bi-check2-circle me-1" /> Save Collection ({selectedCount})
                                </>
                            )}
                        </button>
                    </div>
                </div>

                <div className="card-body p-0">
                    {loadingStudents ? (
                        <div className="text-center py-5 text-muted">
                            <span className="spinner-border spinner-border-sm me-2 text-primary" /> Loading student records & payment status...
                        </div>
                    ) : !selectedClass || !selectedSection ? (
                        <div className="text-center py-5 text-muted">
                            <i className="bi bi-funnel fs-1 d-block mb-2 text-secondary opacity-50" />
                            <h5>Select Class & Section</h5>
                            <p className="small text-muted mb-0">Choose a class and section to inspect and record exam fee collections.</p>
                        </div>
                    ) : !selectedMonthItem ? (
                        <div className="text-center py-5 text-muted">
                            <i className="bi bi-calendar-x fs-1 d-block mb-2 text-warning opacity-75" />
                            <h5>No Exam Month Selected</h5>
                            <p className="small text-muted mb-0">Select an exam month head to view paid and unpaid students.</p>
                        </div>
                    ) : students.length === 0 ? (
                        <div className="text-center py-5 text-muted">
                            <i className="bi bi-people fs-1 d-block mb-2 text-secondary opacity-50" />
                            <h5>No Active Students Found</h5>
                            <p className="small text-muted mb-0">There are no active students in this class section.</p>
                        </div>
                    ) : (
                        <div className="table-responsive">
                            <table className="table table-hover mb-0 align-middle">
                                <thead className="table-light">
                                    <tr>
                                        <th style={{ width: 46 }} className="text-center">
                                            <input
                                                type="checkbox"
                                                className="form-check-input"
                                                checked={pendingStudents.length > 0 && selectedCount === pendingStudents.length}
                                                onChange={e => handleSelectAll(e.target.checked)}
                                                disabled={pendingStudents.length === 0}
                                                title={pendingStudents.length === 0 ? 'All students are already paid' : 'Select all unpaid students'}
                                            />
                                        </th>
                                        <th style={{ width: 60 }}>#</th>
                                        <th>Student</th>
                                        <th>Roll No</th>
                                        <th className="text-end" style={{ width: 120 }}>Amount</th>
                                        <th>Remarks</th>
                                        <th className="text-center" style={{ width: 150 }}>Source</th>
                                        <th className="text-center" style={{ width: 120 }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredStudents.map((student, index) => {
                                        const isPaid = student.is_paid;
                                        const isOffice = student.collection_source === 'Office';
                                        const isClass = student.collection_source === 'Class';
                                        const isChecked = isPaid ? true : !!student.selected;

                                        return (
                                            <tr
                                                key={student.student_id}
                                                style={{
                                                    backgroundColor: isOffice 
                                                        ? 'rgba(14, 165, 233, 0.05)' 
                                                        : isClass 
                                                        ? 'rgba(245, 158, 11, 0.05)' 
                                                        : student.selected 
                                                        ? 'rgba(13, 148, 136, 0.08)' 
                                                        : undefined,
                                                    cursor: !isPaid ? 'pointer' : 'default'
                                                }}
                                                onClick={() => {
                                                    if (!isPaid) {
                                                        handleStudentCheck(student.student_id, !student.selected);
                                                    }
                                                }}
                                            >
                                                {/* Checkbox Column */}
                                                <td className="text-center" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        className="form-check-input"
                                                        checked={isChecked}
                                                        disabled={isPaid}
                                                        onChange={e => handleStudentCheck(student.student_id, e.target.checked)}
                                                        title={isPaid ? (isOffice ? 'Paid at Office - Locked' : 'Paid in Class - Locked') : 'Select to collect'}
                                                    />
                                                </td>

                                                {/* Index */}
                                                <td className="text-muted small">{index + 1}</td>

                                                {/* Student Name & Admission No */}
                                                <td>
                                                    <div className="d-flex align-items-center gap-2">
                                                        <div 
                                                            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold shadow-sm"
                                                            style={{
                                                                width: 34,
                                                                height: 34,
                                                                fontSize: '0.85rem',
                                                                backgroundColor: isOffice ? '#0284c7' : isClass ? '#d97706' : '#64748b'
                                                            }}
                                                        >
                                                            {(student.first_name || 'S')[0].toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div className="fw-bold text-dark">
                                                                {student.first_name} {student.last_name || ''}
                                                            </div>
                                                            <div className="small text-muted d-flex align-items-center gap-2">
                                                                {student.admission_no && (
                                                                    <span>Adm: {student.admission_no}</span>
                                                                )}
                                                                {student.family_id && (
                                                                    <span className="text-secondary opacity-75">Fam: {student.family_id}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Roll No */}
                                                <td>
                                                    <span className="badge bg-light text-dark border">
                                                        {student.roll_no || '—'}
                                                    </span>
                                                </td>

                                                {/* Amount */}
                                                <td className="text-end">
                                                    <span className={`badge rounded-pill fw-bold ${isPaid ? 'bg-secondary-subtle text-secondary' : 'bg-primary-subtle text-primary border border-primary-subtle'}`}>
                                                        Rs. {isPaid ? (student.paid_amount || fixedFeeAmount) : fixedFeeAmount}
                                                    </span>
                                                </td>

                                                {/* Remarks Column */}
                                                <td onClick={e => e.stopPropagation()}>
                                                    {isPaid ? (
                                                        <span className="small text-muted d-flex align-items-center gap-1">
                                                            <i className="bi bi-info-circle"></i>
                                                            {student.paid_remarks || (isOffice ? 'Paid at Office' : 'Collected in class')}
                                                        </span>
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            className="form-control form-control-sm"
                                                            placeholder="Remarks (e.g. Cash)"
                                                            value={student.remarks || ''}
                                                            onChange={e => handleRemarkChange(student.student_id, e.target.value)}
                                                        />
                                                    )}
                                                </td>

                                                {/* Source Column: [Office] or [Class] */}
                                                <td className="text-center">
                                                    {isOffice ? (
                                                        <span className="badge bg-info text-white shadow-sm px-2.5 py-1.5" title="Collected at the office via Monthly Fee Slip">
                                                            <i className="bi bi-building me-1"></i>Office
                                                        </span>
                                                    ) : isClass ? (
                                                        <span className="badge bg-warning text-dark shadow-sm px-2.5 py-1.5" title={`Collected in class by ${student.collector_name || 'Teacher'}`}>
                                                            <i className="bi bi-person-workspace me-1"></i>Class
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted small">—</span>
                                                    )}
                                                </td>

                                                {/* Status Column */}
                                                <td className="text-center">
                                                    {isPaid ? (
                                                        <span className="badge bg-success-subtle text-success border border-success-subtle px-2.5 py-1.5 rounded-pill">
                                                            <i className="bi bi-check-circle-fill me-1"></i>Paid
                                                        </span>
                                                    ) : (
                                                        <span className="badge bg-danger-subtle text-danger border border-danger-subtle px-2.5 py-1.5 rounded-pill">
                                                            <i className="bi bi-hourglass-split me-1"></i>Unpaid
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Table Footer */}
                {students.length > 0 && (
                    <div className="card-footer bg-light d-flex justify-content-between align-items-center flex-wrap gap-2 py-3">
                        <div className="small text-muted">
                            Showing <strong>{filteredStudents.length}</strong> of <strong>{students.length}</strong> students
                        </div>
                        <div className="d-flex align-items-center gap-3 small">
                            <span className="text-info fw-semibold">
                                <i className="bi bi-building me-1"></i>Office: {officePaidStudents.length}
                            </span>
                            <span className="text-warning fw-semibold">
                                <i className="bi bi-person-workspace me-1"></i>Class: {classPaidStudents.length}
                            </span>
                            <span className="text-danger fw-semibold">
                                <i className="bi bi-hourglass-split me-1"></i>Pending: {pendingStudents.length}
                            </span>
                            {selectedCount > 0 && (
                                <span className="badge bg-primary text-white px-2 py-1">
                                    Selected: {selectedCount} (Rs. {selectedTotalAmount.toLocaleString()})
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
