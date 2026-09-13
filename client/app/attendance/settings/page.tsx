'use client';

import React from 'react';
import Link from 'next/link';

export default function AttendanceSettingsHubPage() {
    return (
        <div className="container-fluid px-3 px-md-4 py-3 animate__animated animate__fadeIn">
            {/* Header */}
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
                <div>
                    <h2 className="fw-bold mb-1" style={{ color: 'var(--primary-dark)' }}>
                        <i className="bi bi-sliders me-2" style={{ color: 'var(--accent-orange)' }} />
                        Attendance Settings
                    </h2>
                    <p className="text-muted mb-0 small">
                        Configure duty shift timings, biometric verification, coordinator delegations, and official holiday calendars.
                    </p>
                </div>
            </div>

            {/* 2 Main Premium Navigation Cards */}
            <div className="row g-4">
                {/* 1. Staff Attendance Setting Card (Disabled/Commented Out)
                <div className="col-12 col-lg-6">
                    <Link href="/attendance/settings/staff" className="text-decoration-none">
                        <div className="card border-0 shadow-sm rounded-4 h-100 p-4 p-md-5 position-relative overflow-hidden hub-card transition-all"
                            style={{
                                background: '#ffffff',
                                borderTop: '4px solid var(--primary-teal)',
                                transition: 'all 0.25s ease'
                            }}>
                            <div className="d-flex align-items-start justify-content-between mb-4">
                                <div className="d-flex align-items-center gap-3">
                                    <div className="rounded-4 d-flex align-items-center justify-content-center text-white flex-shrink-0"
                                        style={{
                                            width: 56,
                                            height: 56,
                                            background: 'linear-gradient(135deg, var(--primary-dark), var(--primary-teal))',
                                            boxShadow: '0 8px 18px rgba(33, 94, 97, 0.25)',
                                            fontSize: '1.6rem'
                                        }}>
                                        <i className="bi bi-person-badge-fill" />
                                    </div>
                                    <div>
                                        <span className="badge rounded-pill px-3 py-1 text-uppercase fw-bold mb-1"
                                            style={{ background: 'rgba(33, 94, 97, 0.1)', color: 'var(--primary-teal)', fontSize: '0.72rem' }}>
                                            Configuration Area 01
                                        </span>
                                        <h3 className="fw-bold mb-0 fs-4" style={{ color: 'var(--primary-dark)' }}>
                                            Staff Attendance Setting
                                        </h3>
                                    </div>
                                </div>
                                <div className="rounded-circle d-flex align-items-center justify-content-center arrow-circle"
                                    style={{
                                        width: 42,
                                        height: 42,
                                        background: '#f8f9fa',
                                        border: '1.5px solid #dee2e6',
                                        color: '#6c757d',
                                        transition: 'all 0.2s ease'
                                    }}>
                                    <i className="bi bi-arrow-right-short fs-4" />
                                </div>
                            </div>

                            <p className="text-secondary mb-4" style={{ lineHeight: '1.6', fontSize: '0.92rem' }}>
                                Manage teacher and staff shift timings (In-Time &amp; Out-Time), late arrival grace period, official holiday schedules, and automated notifications.
                            </p>

                            <div className="d-flex flex-wrap gap-2 mb-4">
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-clock-fill me-1.5" style={{ color: 'var(--primary-teal)' }} /> Duty Shift Limits
                                </span>
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-hourglass-split me-1.5" style={{ color: 'var(--accent-orange)' }} /> Grace Minutes
                                </span>
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-calendar-event me-1.5 text-primary" /> Staff Holidays
                                </span>
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-calendar-heart-fill me-1.5" style={{ color: '#7c3aed' }} /> Staff Holidays
                                </span>
                            </div>

                            <div className="d-flex align-items-center justify-content-between pt-3 border-top mt-auto">
                                <span className="text-muted small fw-semibold">Click to open full staff settings</span>
                                <span className="fw-bold d-inline-flex align-items-center gap-1" style={{ color: 'var(--primary-teal)', fontSize: '0.88rem' }}>
                                    <span>Configure Staff Settings</span>
                                    <i className="bi bi-chevron-right" />
                                </span>
                            </div>
                        </div>
                    </Link>
                </div>
                */}

                {/* 2. Student Attendance Setting Card */}
                <div className="col-12 col-lg-8 col-xl-7">
                    <Link href="/attendance/settings/students" className="text-decoration-none">
                        <div className="card border-0 shadow-sm rounded-4 h-100 p-4 p-md-5 position-relative overflow-hidden hub-card transition-all"
                            style={{
                                background: '#ffffff',
                                borderTop: '4px solid var(--accent-orange)',
                                transition: 'all 0.25s ease'
                            }}>
                            <div className="d-flex align-items-start justify-content-between mb-4">
                                <div className="d-flex align-items-center gap-3">
                                    <div className="rounded-4 d-flex align-items-center justify-content-center text-white flex-shrink-0"
                                        style={{
                                            width: 56,
                                            height: 56,
                                            background: 'linear-gradient(135deg, #1f4e5b, var(--accent-orange))',
                                            boxShadow: '0 8px 18px rgba(254, 127, 45, 0.25)',
                                            fontSize: '1.6rem'
                                        }}>
                                        <i className="bi bi-mortarboard-fill" />
                                    </div>
                                    <div>
                                        <span className="badge rounded-pill px-3 py-1 text-uppercase fw-bold mb-1"
                                            style={{ background: 'rgba(254, 127, 45, 0.1)', color: 'var(--accent-orange)', fontSize: '0.72rem' }}>
                                            Configuration Area 02
                                        </span>
                                        <h3 className="fw-bold mb-0 fs-4" style={{ color: 'var(--primary-dark)' }}>
                                            Student Attendance Setting
                                        </h3>
                                    </div>
                                </div>
                                <div className="rounded-circle d-flex align-items-center justify-content-center arrow-circle"
                                    style={{
                                        width: 42,
                                        height: 42,
                                        background: '#f8f9fa',
                                        border: '1.5px solid #dee2e6',
                                        color: '#6c757d',
                                        transition: 'all 0.2s ease'
                                    }}>
                                    <i className="bi bi-arrow-right-short fs-4" />
                                </div>
                            </div>

                            <p className="text-secondary mb-4" style={{ lineHeight: '1.6', fontSize: '0.92rem' }}>
                                Delegate class and section attendance marking to School Coordinators via our 3-column assignment tool, configure personalized parent notification templates per child, 3-day consecutive absent rules, and student holiday calendars.
                            </p>

                            <div className="d-flex flex-wrap gap-2 mb-4">
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-person-lines-fill me-1.5" style={{ color: 'var(--primary-teal)' }} /> Coordinator Delegation
                                </span>
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-chat-heart-fill me-1.5 text-danger" /> Family Per-Child Alerts
                                </span>
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-exclamation-triangle-fill me-1.5 text-warning" /> 3-Day Absent Rule
                                </span>
                                <span className="badge rounded-pill px-3 py-2 fw-semibold"
                                    style={{ background: '#f8f9fa', color: 'var(--primary-dark)', border: '1px solid #e9ecef', fontSize: '0.78rem' }}>
                                    <i className="bi bi-sun-fill me-1.5 text-warning" /> Student Holidays
                                </span>
                            </div>

                            <div className="d-flex align-items-center justify-content-between pt-3 border-top mt-auto">
                                <span className="text-muted small fw-semibold">Click to open full student settings</span>
                                <span className="fw-bold d-inline-flex align-items-center gap-1" style={{ color: 'var(--accent-orange)', fontSize: '0.88rem' }}>
                                    <span>Configure Student Settings</span>
                                    <i className="bi bi-chevron-right" />
                                </span>
                            </div>
                        </div>
                    </Link>
                </div>
            </div>

            <style jsx>{`
                .hub-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 16px 28px rgba(0, 0, 0, 0.08) !important;
                }
                .hub-card:hover .arrow-circle {
                    background: var(--primary-teal) !important;
                    color: #ffffff !important;
                    border-color: var(--primary-teal) !important;
                    transform: translateX(4px);
                }
                .hub-card:last-child:hover .arrow-circle {
                    background: var(--accent-orange) !important;
                    color: #ffffff !important;
                    border-color: var(--accent-orange) !important;
                }
            `}</style>
        </div>
    );
}
