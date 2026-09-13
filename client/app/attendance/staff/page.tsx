'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notify } from '@/app/utils/notify';

interface Department {
    department_id: number;
    department_name: string;
}

interface StaffRow {
    employee_id: number;
    first_name: string;
    last_name: string;
    designation: string;
    department_name: string;
    department_id: number;
    attendance_id: number | null;
    status: string | null;
    remarks?: string | null;
    attendance_date?: string;
    academic_year_id?: number | null;
}

interface HolidayInfo {
    is_holiday: boolean;
    id: number;
    title: string;
    holiday_type: string;
    description: string | null;
}

interface AcademicYear {
    id: number;
    year_name: string;
    is_active: boolean;
    status: string;
    start_date: string | null;
    end_date: string | null;
}

const STATUS_OPTS = ['Present', 'Absent', 'Leave'] as const;
type StatusType = typeof STATUS_OPTS[number];

const S_COLOR: Record<StatusType | 'Holiday', string> = {
    Present: '#0d9e6e',
    Absent: '#e13232',
    Leave: '#1a6fd4',
    Holiday: '#7c3aed'
};

const S_BG: Record<StatusType | 'Holiday', string> = {
    Present: '#e6f9f3',
    Absent: '#fde8e8',
    Leave: '#e8f0fd',
    Holiday: '#f3e8ff'
};

const S_ICON: Record<StatusType | 'Holiday', string> = {
    Present: 'bi-check-circle-fill',
    Absent: 'bi-x-circle-fill',
    Leave: 'bi-calendar2-x-fill',
    Holiday: 'bi-sun-fill'
};

export default function StaffAttendancePage() {
    const today = new Date().toISOString().split('T')[0];
    const [departments, setDepartments] = useState<Department[]>([]);
    const [deptId, setDeptId] = useState('');
    const [date, setDate] = useState(today);
    const [staff, setStaff] = useState<StaffRow[]>([]);
    const [statuses, setStatuses] = useState<Record<number, StatusType>>({});
    const [remarks, setRemarks] = useState<Record<number, string>>({});
    const [lockedIds, setLockedIds] = useState<Set<number>>(new Set());
    const [allSaved, setAllSaved] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [holidayInfo, setHolidayInfo] = useState<HolidayInfo | null>(null);
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
    const [activeYear, setActiveYear] = useState<AcademicYear | null>(null);
    const [selectedYearId, setSelectedYearId] = useState<string>('');

    const { hasPermission, user } = useAuth();
    const isAdmin = (user?.role_level || 0) >= 90;
    const canEditLocked = isAdmin || hasPermission('attendance.edit_locked', 'write');
    const canMarkAdvance = isAdmin || hasPermission('attendance.mark_advance', 'write');

    const API = (process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com").replace(/\/+$/, '');

    // Fetch initial metadata: departments & academic years
    useEffect(() => {
        const fetchMeta = async () => {
            try {
                const [deptRes, yearsRes] = await Promise.all([
                    fetch(`${API}/hrm/departments`).then(r => r.json()).catch(() => []),
                    fetch(`${API}/attendance/academic-years`).then(r => r.json()).catch(() => [])
                ]);

                if (Array.isArray(deptRes)) setDepartments(deptRes);
                if (Array.isArray(yearsRes)) {
                    setAcademicYears(yearsRes);
                    const active = yearsRes.find((y: AcademicYear) => y.is_active || y.status === 'active') || yearsRes[0];
                    if (active) {
                        setActiveYear(active);
                        setSelectedYearId(String(active.id));
                    }
                }
            } catch (err) {
                console.error('Error fetching staff attendance meta:', err);
            }
        };
        fetchMeta();
    }, [API]);

    // Load Staff Attendance
    const loadAttendance = useCallback(async () => {
        if (!date) return;
        setLoading(true);
        try {
            const queryParams = new URLSearchParams({ date });
            if (deptId) queryParams.append('department_id', deptId);
            if (selectedYearId) queryParams.append('academic_year_id', selectedYearId);

            const res = await fetch(`${API}/attendance/staff/daily?${queryParams.toString()}`);
            const data = await res.json();

            const records: StaffRow[] = Array.isArray(data) ? data : (data.records || []);
            const hol: HolidayInfo | null = data.holiday || null;

            if (data.active_year) {
                setActiveYear(data.active_year);
            }

            setHolidayInfo(hol);
            setStaff(records);

            const st: Record<number, StatusType> = {};
            const rm: Record<number, string> = {};
            const locked = new Set<number>();

            records.forEach((e: StaffRow) => {
                st[e.employee_id] = (e.status as StatusType) || 'Present';
                rm[e.employee_id] = e.remarks || '';
                if (e.attendance_id !== null) {
                    locked.add(e.employee_id);
                }
            });

            setStatuses(st);
            setRemarks(rm);
            setLockedIds(locked);
            setAllSaved(records.length > 0 && records.every((e: StaffRow) => e.attendance_id !== null));
        } catch {
            notify.error('Server error loading staff attendance');
        }
        setLoading(false);
    }, [API, date, deptId, selectedYearId]);

    // Auto load when date, department, or academic year changes
    useEffect(() => {
        loadAttendance();
    }, [loadAttendance]);

    const toggleLock = (empId: number) => {
        if (!canEditLocked) {
            notify.warning('You do not have permission to unlock locked attendance');
            return;
        }
        setLockedIds(prev => {
            const next = new Set(prev);
            if (next.has(empId)) next.delete(empId);
            else next.add(empId);
            return next;
        });
    };

    const markAll = (status: StatusType) => {
        if (holidayInfo?.is_holiday) return;
        const next: Record<number, StatusType> = {};
        staff.forEach(e => {
            if (!lockedIds.has(e.employee_id) || canEditLocked) {
                next[e.employee_id] = status;
            } else {
                next[e.employee_id] = statuses[e.employee_id] || 'Present';
            }
        });
        setStatuses(p => ({ ...p, ...next }));
    };

    const saveAttendance = async () => {
        if (!date || staff.length === 0 || holidayInfo?.is_holiday) return;
        setSaving(true);
        try {
            const payload = staff.map(e => ({
                employee_id: e.employee_id,
                status: statuses[e.employee_id] || 'Present',
                remarks: remarks[e.employee_id] || ''
            }));

            const res = await fetch(`${API}/attendance/staff/daily`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date,
                    records: payload,
                    academic_year_id: selectedYearId ? Number(selectedYearId) : activeYear?.id,
                    user_id: user?.id
                })
            });

            const data = await res.json();
            if (res.ok) {
                notify.success(data.message || 'Staff attendance saved successfully!');
                // Lock rows that were saved
                const locked = new Set<number>();
                staff.forEach(e => locked.add(e.employee_id));
                setLockedIds(locked);
                setAllSaved(true);
            } else {
                notify.error(data.error || 'Failed to save staff attendance');
            }
        } catch {
            notify.error('Network or server error while saving');
        }
        setSaving(false);
    };

    // Group staff by department
    const grouped = useMemo(() => {
        const map: Record<string, StaffRow[]> = {};
        staff.forEach(e => {
            const dept = e.department_name || 'General Staff';
            if (!map[dept]) map[dept] = [];
            map[dept].push(e);
        });
        return map;
    }, [staff]);

    const counts = useMemo(() => {
        const c: Record<string, number> = { Present: 0, Absent: 0, Leave: 0 };
        staff.forEach(e => {
            const st = statuses[e.employee_id] || 'Present';
            if (c[st] !== undefined) c[st]++;
        });
        return c;
    }, [staff, statuses]);

    const total = staff.length;
    const unlockedCount = staff.filter(e => !lockedIds.has(e.employee_id)).length;
    const isSessionClosed = activeYear && activeYear.status !== 'active' && !activeYear.is_active;

    return (
        <div className="container-fluid px-3 px-md-4 py-3 animate__animated animate__fadeIn">
            {/* ══════ HEADER ══════ */}
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1" style={{ color: 'var(--primary-dark)' }}>
                        <i className="bi bi-person-check-fill me-2" style={{ color: 'var(--accent-orange)' }} />
                        Staff Attendance
                    </h2>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                        <p className="text-muted mb-0 small">Daily manual attendance management for school staff &amp; teachers</p>
                        {activeYear && (
                            <span className="badge rounded-pill bg-light text-dark border px-2.5 py-1 small fw-semibold">
                                <i className="bi bi-mortarboard-fill text-primary me-1" />
                                Session: <strong>{activeYear.year_name}</strong>
                            </span>
                        )}
                        {isSessionClosed && (
                            <span className="badge rounded-pill bg-warning-subtle text-warning border px-2 py-0.5 small fw-semibold">
                                <i className="bi bi-lock-fill me-1" />Closed Session
                            </span>
                        )}
                    </div>
                </div>

                {staff.length > 0 && !holidayInfo?.is_holiday && (
                    <div className="d-flex flex-wrap gap-2">
                        {STATUS_OPTS.map(s => (
                            <button
                                key={s}
                                onClick={() => markAll(s)}
                                disabled={allSaved && !canEditLocked}
                                className="btn btn-sm fw-semibold"
                                style={{
                                    background: S_BG[s],
                                    border: `1.5px solid ${S_COLOR[s]}`,
                                    color: S_COLOR[s],
                                    borderRadius: 8,
                                    fontSize: '0.78rem',
                                    opacity: (allSaved && !canEditLocked) ? 0.5 : 1
                                }}>
                                <i className={`bi ${S_ICON[s]} me-1`} />All {s}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ══════ FILTER CARD ══════ */}
            <div className="card border-0 shadow-sm rounded-4 mb-4">
                <div className="card-body p-3 p-md-4">
                    <div className="row g-3 align-items-end">
                        {/* Academic Year Selector */}
                        {academicYears.length > 0 && (
                            <div className="col-12 col-sm-6 col-md-3">
                                <label className="form-label fw-semibold small text-uppercase" style={{ color: 'var(--primary-dark)', letterSpacing: '0.05em' }}>
                                    <i className="bi bi-mortarboard me-1" style={{ color: 'var(--primary-teal)' }} />Academic Year
                                </label>
                                <select
                                    className="form-select rounded-3"
                                    value={selectedYearId}
                                    onChange={e => setSelectedYearId(e.target.value)}
                                    style={{ border: '1.5px solid #dee2e6', height: 42 }}>
                                    {academicYears.map(y => (
                                        <option key={y.id} value={y.id}>
                                            {y.year_name} {y.is_active ? '(Active)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Department Filter */}
                        <div className="col-12 col-sm-6 col-md-3">
                            <label className="form-label fw-semibold small text-uppercase" style={{ color: 'var(--primary-dark)', letterSpacing: '0.05em' }}>
                                <i className="bi bi-building me-1" style={{ color: 'var(--primary-teal)' }} />Department
                            </label>
                            <select
                                className="form-select rounded-3"
                                value={deptId}
                                onChange={e => setDeptId(e.target.value)}
                                style={{ border: '1.5px solid #dee2e6', height: 42 }}>
                                <option value="">All Departments</option>
                                {departments.map(d => (
                                    <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Date Picker */}
                        <div className="col-12 col-sm-6 col-md-3">
                            <label className="form-label fw-semibold small text-uppercase" style={{ color: 'var(--primary-dark)', letterSpacing: '0.05em' }}>
                                <i className="bi bi-calendar3 me-1" style={{ color: 'var(--primary-teal)' }} />Attendance Date
                            </label>
                            <input
                                type="date"
                                className="form-control rounded-3"
                                value={date}
                                max={canMarkAdvance ? undefined : today}
                                onChange={e => setDate(e.target.value)}
                                style={{ border: '1.5px solid #dee2e6', height: 42 }}
                            />
                        </div>

                        {/* Refresh Button */}
                        <div className="col-12 col-sm-6 col-md-3">
                            <button
                                className="btn fw-bold w-100 rounded-3 text-white"
                                onClick={loadAttendance}
                                disabled={loading}
                                style={{ background: 'var(--primary-teal)', height: 42 }}>
                                {loading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-arrow-repeat me-2" />}
                                Reload Attendance
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ══════ OFFICIAL HOLIDAY BANNER ══════ */}
            {holidayInfo?.is_holiday && (
                <div className="alert border-0 shadow-sm rounded-4 p-3 mb-4 animate__animated animate__headShake"
                    style={{ background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', borderLeft: '6px solid #7c3aed' }}>
                    <div className="d-flex align-items-center gap-3">
                        <div className="rounded-3 text-white fs-3 d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ background: '#7c3aed', width: 48, height: 48, boxShadow: '0 4px 12px rgba(124, 58, 237, 0.25)' }}>
                            <i className="bi bi-sun-fill text-warning" />
                        </div>
                        <div>
                            <div className="d-flex align-items-center gap-2">
                                <span className="badge rounded-pill text-white px-2.5 py-1 fw-bold text-uppercase"
                                    style={{ backgroundColor: '#7c3aed', fontSize: '0.72rem' }}>
                                    Official Staff Holiday
                                </span>
                                <span className="text-secondary small fw-semibold">Attendance Exempt</span>
                            </div>
                            <h5 className="fw-bold text-dark mb-0 mt-1">{holidayInfo.title}</h5>
                            {holidayInfo.description && (
                                <p className="text-secondary small mb-0 mt-0.5">{holidayInfo.description}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ══════ STATS CARDS ══════ */}
            {staff.length > 0 && (
                <div className="row g-3 mb-4">
                    <div className="col-6 col-md-3">
                        <div className="card border-0 shadow-sm rounded-4 p-3 bg-white border-start border-4 border-primary">
                            <div className="text-muted small text-uppercase fw-semibold">Total Staff</div>
                            <div className="fs-3 fw-bold text-dark mt-1">{total}</div>
                        </div>
                    </div>
                    {STATUS_OPTS.map(s => (
                        <div key={s} className="col-6 col-md-3">
                            <div className="card border-0 shadow-sm rounded-4 p-3 bg-white" style={{ borderLeft: `4px solid ${S_COLOR[s]}` }}>
                                <div className="text-muted small text-uppercase fw-semibold">{s}</div>
                                <div className="fs-3 fw-bold mt-1" style={{ color: S_COLOR[s] }}>{counts[s]}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ══════ ATTENDANCE TABLES (GROUPED BY DEPARTMENT) ══════ */}
            {staff.length > 0 && Object.entries(grouped).map(([deptName, members]) => (
                <div key={deptName} className="card border-0 shadow-sm rounded-4 mb-4 overflow-hidden">
                    <div className="card-header bg-white border-bottom py-3 px-3 px-md-4 d-flex justify-content-between align-items-center">
                        <div className="fw-bold text-dark d-flex align-items-center gap-2">
                            <i className="bi bi-diagram-3-fill text-primary" />
                            {deptName}
                            <span className="badge rounded-pill bg-light text-muted border px-2 py-0.5" style={{ fontSize: '0.75rem' }}>
                                {members.length} members
                            </span>
                        </div>
                    </div>

                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th className="ps-3 ps-md-4 py-2.5 small text-uppercase text-muted" style={{ width: 40 }}>#</th>
                                    <th className="py-2.5 small text-uppercase text-muted">Employee</th>
                                    <th className="py-2.5 small text-uppercase text-muted">Designation</th>
                                    <th className="py-2.5 small text-uppercase text-muted">Attendance Status</th>
                                    <th className="py-2.5 small text-uppercase text-muted" style={{ minWidth: 180 }}>Remarks</th>
                                    <th className="pe-3 pe-md-4 py-2.5 small text-uppercase text-muted text-center" style={{ width: 60 }}>Lock</th>
                                </tr>
                            </thead>
                            <tbody>
                                {members.map((e, idx) => {
                                    const cur = statuses[e.employee_id] || 'Present';
                                    const isRowLocked = (lockedIds.has(e.employee_id) && !canEditLocked) || Boolean(holidayInfo?.is_holiday);

                                    return (
                                        <tr key={e.employee_id} style={{ borderLeft: `3px solid ${S_COLOR[cur]}` }}>
                                            <td className="ps-3 ps-md-4 text-muted small">{idx + 1}</td>
                                            <td>
                                                <div className="d-flex align-items-center gap-2.5">
                                                    <div className="rounded-circle text-white fw-bold d-flex align-items-center justify-content-center flex-shrink-0"
                                                        style={{ width: 34, height: 34, background: 'var(--primary-teal)', fontSize: '0.8rem' }}>
                                                        {e.first_name[0]}{(e.last_name || '')[0] || ''}
                                                    </div>
                                                    <div>
                                                        <div className="fw-bold text-dark mb-0" style={{ fontSize: '0.9rem' }}>
                                                            {e.first_name} {e.last_name || ''}
                                                        </div>
                                                        <div className="text-muted small" style={{ fontSize: '0.75rem' }}>ID #{e.employee_id}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="badge text-bg-light border" style={{ fontSize: '0.78rem' }}>
                                                    {e.designation || 'Staff'}
                                                </span>
                                            </td>
                                            <td>
                                                {holidayInfo?.is_holiday ? (
                                                    <span className="badge rounded-pill px-3 py-2 fw-semibold d-inline-flex align-items-center gap-1"
                                                        style={{ background: '#f3e8ff', color: '#7c3aed', border: '1.5px solid #c4b5fd', fontSize: '0.8rem' }}>
                                                        <i className="bi bi-sun-fill text-warning" />
                                                        <span className="ms-1">Holiday</span>
                                                    </span>
                                                ) : isRowLocked ? (
                                                    <span className="badge rounded-pill px-3 py-2 fw-semibold d-inline-flex align-items-center gap-1"
                                                        style={{ background: S_BG[cur], color: S_COLOR[cur], border: `1.5px solid ${S_COLOR[cur]}55`, fontSize: '0.8rem' }}>
                                                        <i className={`bi ${S_ICON[cur]}`} />
                                                        <span className="ms-1">{cur}</span>
                                                    </span>
                                                ) : (
                                                    <div className="btn-group" role="group">
                                                        {STATUS_OPTS.map(opt => (
                                                            <button
                                                                key={opt}
                                                                type="button"
                                                                onClick={() => setStatuses(p => ({ ...p, [e.employee_id]: opt }))}
                                                                className="btn btn-sm fw-semibold"
                                                                style={{
                                                                    padding: '4px 12px',
                                                                    fontSize: '0.78rem',
                                                                    background: cur === opt ? S_COLOR[opt] : S_BG[opt],
                                                                    border: `1.5px solid ${cur === opt ? S_COLOR[opt] : '#dee2e6'}`,
                                                                    color: cur === opt ? '#fff' : S_COLOR[opt],
                                                                    transition: 'all 0.15s'
                                                                }}>
                                                                <i className={`bi ${S_ICON[opt]}`} style={{ fontSize: '0.72rem' }} />
                                                                <span className="d-none d-sm-inline ms-1">{opt}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <input
                                                    type="text"
                                                    className="form-control form-control-sm rounded-3"
                                                    placeholder={holidayInfo?.is_holiday ? 'Official Holiday' : 'Add remarks...'}
                                                    disabled={isRowLocked}
                                                    value={remarks[e.employee_id] || ''}
                                                    onChange={evt => setRemarks(p => ({ ...p, [e.employee_id]: evt.target.value }))}
                                                    style={{ border: '1.5px solid #e9ecef', fontSize: '0.82rem' }}
                                                />
                                            </td>
                                            <td className="pe-3 pe-md-4 text-center">
                                                <button
                                                    onClick={() => toggleLock(e.employee_id)}
                                                    title={lockedIds.has(e.employee_id) ? 'Unlock row' : 'Lock row'}
                                                    disabled={Boolean(holidayInfo?.is_holiday)}
                                                    className="btn btn-sm d-inline-flex align-items-center justify-content-center"
                                                    style={{
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 8,
                                                        border: `1.5px solid ${lockedIds.has(e.employee_id) ? '#e13232' : '#dee2e6'}`,
                                                        background: lockedIds.has(e.employee_id) ? '#fde8e8' : '#f8f9fa',
                                                        color: lockedIds.has(e.employee_id) ? '#e13232' : '#adb5bd',
                                                        transition: 'all 0.15s'
                                                    }}>
                                                    <i className={`bi ${lockedIds.has(e.employee_id) ? 'bi-lock-fill' : 'bi-unlock'}`} style={{ fontSize: '0.85rem' }} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {/* ══════ SAVE FOOTER ══════ */}
            {staff.length > 0 && (
                <div className="card border-0 shadow-sm rounded-4 mb-4">
                    <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3 p-3 p-md-4">
                        <div className="d-flex gap-3 flex-wrap align-items-center">
                            {STATUS_OPTS.map(s => (
                                <span key={s} style={{ fontSize: '0.85rem', color: S_COLOR[s], fontWeight: 700 }}>
                                    <i className={`bi ${S_ICON[s]} me-1`} />{counts[s]} {s}
                                </span>
                            ))}
                            {unlockedCount > 0 && (
                                <span className="badge rounded-pill px-2.5 py-1" style={{ background: '#fff3cd', color: '#856404', fontSize: '0.78rem', border: '1px solid #ffc10766' }}>
                                    <i className="bi bi-unlock me-1" />{unlockedCount} unlocked
                                </span>
                            )}
                        </div>

                        {hasPermission('attendance', 'write') && (
                            <button
                                className="btn fw-bold px-4 rounded-3 text-white"
                                onClick={saveAttendance}
                                disabled={saving || holidayInfo?.is_holiday || (allSaved && !canEditLocked)}
                                style={{
                                    background: (holidayInfo?.is_holiday || (allSaved && !canEditLocked)) ? '#adb5bd' : 'var(--accent-orange)',
                                    border: 'none',
                                    boxShadow: (holidayInfo?.is_holiday || (allSaved && !canEditLocked)) ? 'none' : '0 4px 14px rgba(254,127,45,0.4)',
                                    cursor: (holidayInfo?.is_holiday || (allSaved && !canEditLocked)) ? 'not-allowed' : 'pointer'
                                }}>
                                {saving ? (
                                    <><span className="spinner-border spinner-border-sm me-2" />Saving...</>
                                ) : holidayInfo?.is_holiday ? (
                                    <><i className="bi bi-calendar-check-fill me-2" />Holiday Attendance Exempt</>
                                ) : (allSaved && !canEditLocked) ? (
                                    <><i className="bi bi-lock-fill me-2" />Attendance Locked</>
                                ) : (
                                    <><i className="bi bi-cloud-check-fill me-2" />Save Attendance ({total})</>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ══════ EMPTY STATE ══════ */}
            {!staff.length && !loading && (
                <div className="card border-0 shadow-sm rounded-4 text-center">
                    <div className="card-body py-5">
                        <div className="mx-auto rounded-4 d-flex align-items-center justify-content-center mb-3"
                            style={{ width: 80, height: 80, background: 'rgba(33,94,97,0.08)' }}>
                            <i className="bi bi-person-badge fs-1" style={{ color: 'var(--primary-teal)' }} />
                        </div>
                        <h5 className="fw-bold mb-2" style={{ color: 'var(--primary-dark)' }}>No Staff Members Found</h5>
                        <p className="text-muted mb-0" style={{ maxWidth: 360, margin: '0 auto' }}>
                            Ensure employees are added in HRM and active in the selected department.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}