'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'react-toastify';
import Link from 'next/link';

const API = (process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com").replace(/\/+$/, '').replace(/\/api$/, '');

interface AttendanceSettings {
    id: number;
    staff_in_time: string;
    staff_out_time: string;
    staff_grace_minutes: number;
    staff_biometric_mode: string;
    staff_auto_absent_enabled: boolean;
    staff_notify_in_out: boolean;
    staff_notify_holidays: boolean;
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

export default function StaffAttendanceSettingsPage() {
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
        staff_in_time: '08:00',
        staff_out_time: '14:00',
        staff_grace_minutes: 15,
        staff_biometric_mode: 'both',
        staff_auto_absent_enabled: true,
        staff_notify_in_out: true,
        staff_notify_holidays: true,
        updated_at: new Date().toISOString()
    });

    const [holidays, setHolidays] = useState<HolidayItem[]>([]);
    const [showHolidayModal, setShowHolidayModal] = useState(false);
    const [holidayTitle, setHolidayTitle] = useState('');
    const [holidayStartDate, setHolidayStartDate] = useState('');
    const [holidayEndDate, setHolidayEndDate] = useState('');
    const [holidayDesc, setHolidayDesc] = useState('');
    const [holidayBroadcast, setHolidayBroadcast] = useState(true);
    const [savingHoliday, setSavingHoliday] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const [setRes, holRes] = await Promise.all([
                fetch(`${API}/attendance/settings`),
                fetch(`${API}/attendance/holidays?holiday_type=staff_only`)
            ]);

            if (setRes.ok) {
                const setData = await setRes.json();
                if (setData.settings) {
                    setSettings({
                        ...setData.settings,
                        staff_in_time: setData.settings.staff_in_time ? String(setData.settings.staff_in_time).slice(0, 5) : '08:00',
                        staff_out_time: setData.settings.staff_out_time ? String(setData.settings.staff_out_time).slice(0, 5) : '14:00'
                    });
                }
            }

            if (holRes.ok) {
                const holData = await holRes.json();
                setHolidays(Array.isArray(holData) ? holData : []);
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to load staff settings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [token]);

    const handleSaveSettings = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
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
            if (!res.ok) throw new Error(data.error || 'Failed to update settings');

            toast.success('✓ Staff attendance policies & timings saved successfully!');
            if (data.settings) {
                setSettings({
                    ...data.settings,
                    staff_in_time: data.settings.staff_in_time ? String(data.settings.staff_in_time).slice(0, 5) : '08:00',
                    staff_out_time: data.settings.staff_out_time ? String(data.settings.staff_out_time).slice(0, 5) : '14:00'
                });
            }
        } catch (err: any) {
            toast.error(err.message || 'Error saving settings');
        } finally {
            setSavingSettings(false);
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
                    holiday_type: 'staff_only',
                    start_date: holidayStartDate,
                    end_date: holidayEndDate || holidayStartDate,
                    is_recurring_weekly: false,
                    recurring_day_of_week: 0,
                    description: holidayDesc.trim() || null,
                    notify_broadcast: holidayBroadcast
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create holiday');

            toast.success(`✓ Holiday "${holidayTitle}" created successfully!`);
            setShowHolidayModal(false);
            setHolidayTitle('');
            setHolidayStartDate('');
            setHolidayEndDate('');
            setHolidayDesc('');
            loadData();
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

    return (
        <div className="container-fluid px-3 px-md-4 py-3 animate__animated animate__fadeIn">
            {/* Header with Back Button */}
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
                            <i className="bi bi-person-badge-fill me-2" style={{ color: 'var(--accent-orange)' }} />
                            Staff Attendance Settings
                        </h2>
                        <p className="text-muted mb-0 small">
                            Configure duty shift timings, biometric modes, notifications, and holidays
                        </p>
                    </div>
                </div>

                <div>
                    <button
                        type="button"
                        className="btn fw-bold px-4 py-2 rounded-3 shadow-sm d-flex align-items-center gap-2"
                        style={{ background: 'var(--accent-orange)', color: '#fff', border: 'none', transition: 'all 0.2s ease' }}
                        onClick={() => handleSaveSettings()}
                        disabled={savingSettings}
                    >
                        {savingSettings ? (
                            <><span className="spinner-border spinner-border-sm" />Saving...</>
                        ) : (
                            <><i className="bi bi-cloud-check-fill fs-5" /><span>Save Settings</span></>
                        )}
                    </button>
                </div>
            </div>

            {/* Main Form Grid */}
            <div className="row g-4">
                {/* Column 1: Shift Times & Biometric Rules */}
                <div className="col-12 col-xl-7">
                    <div className="card border-0 shadow-sm rounded-4 p-3.5 p-md-4 bg-white mb-4">
                        <div className="d-flex align-items-center justify-content-between border-bottom pb-3 mb-3">
                            <h5 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)' }}>
                                <i className="bi bi-clock-history" style={{ color: 'var(--primary-teal)' }} />
                                Shift Duty Timings &amp; Verification
                            </h5>
                            <span className="badge rounded-pill fw-bold px-3 py-1"
                                style={{ background: 'rgba(33, 94, 97, 0.1)', color: 'var(--primary-teal)', fontSize: '0.75rem' }}>
                                Core Policy
                            </span>
                        </div>

                        <form onSubmit={handleSaveSettings}>
                            <div className="row g-3 mb-4">
                                <div className="col-12 col-sm-6">
                                    <label className="form-label fw-bold small text-secondary">
                                        Staff In-Time (Start of Duty) <span className="text-danger">*</span>
                                    </label>
                                    <div className="input-group">
                                        <span className="input-group-text bg-light"><i className="bi bi-box-arrow-in-right text-success" /></span>
                                        <input
                                            type="time"
                                            className="form-control fw-bold fs-6"
                                            value={settings.staff_in_time}
                                            onChange={e => setSettings({ ...settings, staff_in_time: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <span className="text-muted" style={{ fontSize: '0.74rem' }}>Standard arrival time for teachers &amp; staff.</span>
                                </div>

                                <div className="col-12 col-sm-6">
                                    <label className="form-label fw-bold small text-secondary">
                                        Staff Out-Time (Shift End) <span className="text-danger">*</span>
                                    </label>
                                    <div className="input-group">
                                        <span className="input-group-text bg-light"><i className="bi bi-box-arrow-right text-danger" /></span>
                                        <input
                                            type="time"
                                            className="form-control fw-bold fs-6"
                                            value={settings.staff_out_time}
                                            onChange={e => setSettings({ ...settings, staff_out_time: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <span className="text-muted" style={{ fontSize: '0.74rem' }}>Official departure time for staff shift end.</span>
                                </div>

                                <div className="col-12 col-sm-6">
                                    <label className="form-label fw-bold small text-secondary">
                                        Late Grace Period (Minutes)
                                    </label>
                                    <div className="input-group">
                                        <span className="input-group-text bg-light"><i className="bi bi-hourglass-split" style={{ color: 'var(--accent-orange)' }} /></span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={120}
                                            className="form-control fw-bold fs-6"
                                            value={settings.staff_grace_minutes}
                                            onChange={e => setSettings({ ...settings, staff_grace_minutes: Number(e.target.value) })}
                                        />
                                        <span className="input-group-text bg-light small fw-bold">Mins</span>
                                    </div>
                                    <span className="text-muted" style={{ fontSize: '0.74rem' }}>Check-ins after this grace limit will be marked Late.</span>
                                </div>

                                <div className="col-12 col-sm-6">
                                    <label className="form-label fw-bold small text-secondary">
                                        Attendance Mode
                                    </label>
                                    <div className="input-group">
                                        <span className="input-group-text bg-light"><i className="bi bi-person-check text-primary" /></span>
                                        <input
                                            type="text"
                                            className="form-control fw-bold fs-6 bg-light"
                                            value="Manual Portal Marking &amp; Admin Locking"
                                            disabled
                                        />
                                    </div>
                                    <span className="text-muted" style={{ fontSize: '0.74rem' }}>Standard attendance register with role-based editing permissions.</span>
                                </div>
                            </div>

                            <div className="border-top pt-3.5 mb-2">
                                <h6 className="fw-bold mb-3 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)' }}>
                                    <i className="bi bi-bell-fill" style={{ color: 'var(--accent-orange)' }} />
                                    Push Notifications &amp; Automation
                                </h6>

                                <div className="p-3 rounded-3 bg-light-subtle border mb-3">
                                    <div className="form-check form-switch mb-0">
                                        <input
                                            className="form-check-input cursor-pointer"
                                            type="checkbox"
                                            id="staffNotifyInOutToggle"
                                            checked={settings.staff_notify_in_out}
                                            onChange={e => setSettings({ ...settings, staff_notify_in_out: e.target.checked })}
                                        />
                                        <label className="form-check-label fw-bold cursor-pointer ms-2" htmlFor="staffNotifyInOutToggle" style={{ color: 'var(--primary-dark)' }}>
                                            Send Instant Mobile Push Notification on Staff In &amp; Out Check
                                        </label>
                                        <p className="text-muted mb-0 small mt-1 ms-2">
                                            Whenever a teacher/staff member clocks in or out via biometric or portal, send a real-time notification to their smartphone and staff portal.
                                        </p>
                                    </div>
                                </div>

                                <div className="p-3 rounded-3 bg-light-subtle border mb-2">
                                    <div className="form-check form-switch mb-0">
                                        <input
                                            className="form-check-input cursor-pointer"
                                            type="checkbox"
                                            id="staffNotifyHolidaysToggle"
                                            checked={settings.staff_notify_holidays}
                                            onChange={e => setSettings({ ...settings, staff_notify_holidays: e.target.checked })}
                                        />
                                        <label className="form-check-label fw-bold cursor-pointer ms-2" htmlFor="staffNotifyHolidaysToggle" style={{ color: 'var(--primary-dark)' }}>
                                            Broadcast Holiday &amp; Weekend Alerts to Staff Portals
                                        </label>
                                        <p className="text-muted mb-0 small mt-1 ms-2">
                                            Automatically notifies staff regarding scheduled holidays and prevents the system from triggering automated absence.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Column 2: Staff Holidays Calendar Manager */}
                <div className="col-12 col-xl-5">
                    <div className="card border-0 shadow-sm rounded-4 p-3.5 p-md-4 bg-white h-100">
                        <div className="d-flex align-items-center justify-content-between border-bottom pb-3 mb-3">
                            <div>
                                <h5 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)' }}>
                                    <i className="bi bi-calendar2-check-fill" style={{ color: 'var(--primary-teal)' }} />
                                    Staff Holidays Calendar
                                </h5>
                                <p className="text-muted small mb-0 mt-0.5">Official off-days where attendance is exempt.</p>
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

                        <div className="holidays-scroll-list overflow-auto" style={{ maxHeight: 480 }}>
                            {holidays.length === 0 ? (
                                <div className="text-center py-5 text-muted">
                                    <i className="bi bi-calendar-x fs-1 d-block mb-2 text-secondary opacity-50" />
                                    <p className="small mb-0">No staff holidays scheduled yet.</p>
                                    <button
                                        type="button"
                                        className="btn btn-link text-decoration-none small fw-bold mt-1"
                                        style={{ color: 'var(--primary-teal)' }}
                                        onClick={() => setShowHolidayModal(true)}
                                    >
                                        Schedule a new holiday
                                    </button>
                                </div>
                            ) : (
                                holidays.map(h => (
                                    <div key={h.id} className="p-3 mb-2.5 rounded-3 border bg-light-subtle d-flex align-items-start justify-content-between gap-2 transition-all">
                                        <div>
                                            <span className="badge rounded-pill fw-bold mb-1"
                                                style={{ background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', fontSize: '0.74rem', border: '1px solid rgba(124, 58, 237, 0.2)' }}>
                                                <i className="bi bi-calendar-heart-fill me-1" />
                                                {h.start_date === h.end_date ? h.start_date : `${h.start_date} to ${h.end_date}`}
                                            </span>
                                            <h6 className="fw-bold text-dark mb-0.5">{h.title}</h6>
                                            {h.description && <p className="text-muted mb-0 small" style={{ fontSize: '0.78rem' }}>{h.description}</p>}
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

            {/* Add Holiday Modal */}
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
                                    <i className="bi bi-calendar-plus text-warning" />
                                    Add Staff Holiday / Off-Day
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
                                            placeholder="e.g. Staff Development Day, Independence Day"
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
                                        <label className="form-label fw-bold small text-secondary">Description / Notice</label>
                                        <textarea
                                            className="form-control"
                                            rows={2}
                                            placeholder="Optional notice for staff"
                                            value={holidayDesc}
                                            onChange={e => setHolidayDesc(e.target.value)}
                                        />
                                    </div>

                                    <div className="form-check form-switch mb-2">
                                        <input
                                            className="form-check-input cursor-pointer"
                                            type="checkbox"
                                            id="staffHolidayBroadcastCheck"
                                            checked={holidayBroadcast}
                                            onChange={e => setHolidayBroadcast(e.target.checked)}
                                        />
                                        <label className="form-check-label fw-semibold text-dark small cursor-pointer ms-1" htmlFor="staffHolidayBroadcastCheck">
                                            Send broadcast alert to staff portal &amp; mobile app
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
                .holidays-scroll-list::-webkit-scrollbar {
                    width: 5px;
                }
                .holidays-scroll-list::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 4px;
                }
            `}</style>
        </div>
    );
}
