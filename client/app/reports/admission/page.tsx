'use client';
import { useState, useEffect, useRef } from 'react';

type AcademicYear = { id: number; year_name: string; is_active: boolean; status: string; start_date?: string; end_date?: string };

type AdmissionFee = {
    ledger_id: number;
    student_id: number;
    admission_no: string;
    student_name: string;
    class_name: string;
    section_name: string;
    total_amount: number;
    paid_amount: number;
    remaining_amount: number;
    discount_amount: number;
    status: string;
    admission_date: string;
};

type MonthlyStat = {
    month: string;
    admissions: number;
    total_amount: number;
    paid_amount: number;
    discount_amount: number;
    remaining_amount: number;
};

type Summary = {
    total_admissions: number;
    total_billed: number;
    total_collected: number;
    total_discount: number;
    total_pending: number;
};

export default function AdmissionFeeReportPage() {
    const [years, setYears] = useState<AcademicYear[]>([]);
    const [academicYearId, setAcademicYearId] = useState<string>('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [status, setStatus] = useState('');
    const [fees, setFees] = useState<AdmissionFee[]>([]);
    const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>([]);
    const [summary, setSummary] = useState<Summary>({
        total_admissions: 0,
        total_billed: 0,
        total_collected: 0,
        total_discount: 0,
        total_pending: 0
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Fetch academic years
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/academic/years`)
            .then(r => r.json())
            .then((data: AcademicYear[]) => {
                if (Array.isArray(data) && data.length > 0) {
                    setYears(data);
                    const active = data.find(y => y.is_active || y.status === 'active') || data[0];
                    if (active) {
                        setAcademicYearId(String(active.id));
                        if (active.start_date && active.end_date) {
                            setFromDate(active.start_date.slice(0, 10));
                            setToDate(active.end_date.slice(0, 10));
                        }
                    }
                }
            })
            .catch(console.error);
    }, []);

    const handleYearChange = (id: string) => {
        setAcademicYearId(id);
        const sel = years.find(y => String(y.id) === id);
        if (sel && sel.start_date && sel.end_date) {
            setFromDate(sel.start_date.slice(0, 10));
            setToDate(sel.end_date.slice(0, 10));
        }
    };

    const loadReport = async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            if (academicYearId) params.append('academic_year_id', academicYearId);
            if (fromDate) params.append('from_date', fromDate);
            if (toDate) params.append('to_date', toDate);
            if (status) params.append('status', status);

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/reports/admission-fee?${params}`);
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch report');

            const data = await res.json();
            setFees(data.admission_fees);
            setMonthlyStats(data.monthlyStats);
            setSummary(data.summary);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`
            <html>
            <head>
                <title>Admission Fee Report</title>
                <style>
                    body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
                    h2, h3, h4 { text-align: center; margin-bottom: 4px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; page-break-inside: avoid; }
                    th { background: #233D4D; color: white; padding: 7px 8px; text-align: left; font-size: 11px; }
                    td { padding: 6px 8px; border-bottom: 1px solid #e0e0e0; font-size: 11px; }
                    tr:nth-child(even) { background: #f9f9f9; }
                    .summary-grid { display: flex; justify-content: space-between; margin-bottom: 20px; }
                    .summary-box { border: 1px solid #ccc; padding: 10px; width: 18%; text-align: center; font-weight: bold; }
                    @media print { body { margin: 10px; } }
                </style>
            </head>
            <body>
                ${content.innerHTML}
            </body>
            </html>
        `);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); win.close(); }, 400);
    };

    return (
        <div className="container-fluid p-2 p-sm-3 p-md-4" style={{ backgroundColor: 'var(--bg-main)', minHeight: '100vh' }}>
            {/* Custom Responsive Styles */}
            <style jsx>{`
                @media (max-width: 575.98px) {
                    .admission-table {
                        min-width: 650px;
                    }
                    .summary-box {
                        padding: 8px 10px !important;
                    }
                }
            `}</style>

            <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-3 mb-md-4">
                <div>
                    <h4 className="mb-1 fw-bold" style={{ color: 'var(--primary-dark)', fontSize: 'clamp(1.25rem, 3vw, 1.6rem)' }}>
                        <i className="bi bi-person-lines-fill me-2" style={{ color: 'var(--accent-orange)' }} />
                        Admission Fee Report
                    </h4>
                    <div className="text-muted small">Monthly admissions, revenue and outstanding dues tracker</div>
                </div>
                <div>
                    <span className="badge rounded-pill bg-light text-dark border px-3 py-2 shadow-sm d-inline-flex align-items-center gap-1.5" style={{ fontSize: '13px', fontWeight: 600 }}>
                        <i className="bi bi-mortarboard-fill text-primary"></i>
                        Academic Year: {years.find(y => String(y.id) === academicYearId)?.year_name || years.find(y => y.is_active)?.year_name || '—'}
                    </span>
                </div>
            </div>

            <div className="card border-0 shadow-sm mb-3 mb-md-4" style={{ borderRadius: 16 }}>
                <div className="card-header bg-white border-bottom py-3" style={{ borderLeft: '4px solid var(--primary-teal)', borderRadius: '16px 16px 0 0' }}>
                    <h6 className="mb-0 fw-bold"><i className="bi bi-funnel me-2 text-muted" />Filters</h6>
                </div>
                <div className="card-body">
                    <div className="row g-2 g-md-3 align-items-end">
                        <div className="col-12 col-sm-6 col-md-3">
                            <label className="form-label fw-semibold small mb-1">
                                <i className="bi bi-mortarboard-fill me-1 text-primary"></i>Academic Year
                            </label>
                            <select className="form-select form-select-sm" value={academicYearId} onChange={e => handleYearChange(e.target.value)}>
                                {years.map(y => (
                                    <option key={y.id} value={y.id}>
                                        {y.year_name} {y.is_active || y.status === 'active' ? '(Active)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="col-6 col-sm-6 col-md-2">
                            <label className="form-label fw-semibold small mb-1">From Date</label>
                            <input type="date" className="form-control form-control-sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                        </div>
                        <div className="col-6 col-sm-6 col-md-2">
                            <label className="form-label fw-semibold small mb-1">To Date</label>
                            <input type="date" className="form-control form-control-sm" value={toDate} onChange={e => setToDate(e.target.value)} />
                        </div>
                        <div className="col-12 col-sm-6 col-md-2">
                            <label className="form-label fw-semibold small mb-1">Status</label>
                            <select className="form-select form-select-sm" value={status} onChange={e => setStatus(e.target.value)}>
                                <option value="">All Status</option>
                                <option value="Paid">Paid</option>
                                <option value="Unpaid">Unpaid</option>
                                <option value="Partial">Partial</option>
                            </select>
                        </div>
                        <div className="col-12 col-sm-6 col-md-3 d-flex gap-2">
                            <button className="btn btn-sm fw-bold px-4 flex-grow-1" style={{ background: 'var(--primary-teal)', color: '#fff', height: 34, borderRadius: 10 }} onClick={loadReport} disabled={loading}>
                                {loading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-search me-2" />}
                                Generate
                            </button>
                            <button className="btn btn-sm btn-outline-secondary" style={{ borderRadius: 10 }} onClick={handlePrint} disabled={!fees.length}>
                                <i className="bi bi-printer" />
                            </button>
                        </div>
                    </div>
                    {error && <div className="alert alert-danger mt-3 mb-0 py-2 small">{error}</div>}
                </div>
            </div>

            <div className="card border-0 shadow-sm" style={{ borderRadius: 16, overflow: 'hidden' }}>
                <div className="card-body p-0">
                    {fees.length === 0 ? (
                        <div className="text-center p-5 text-muted">
                            <i className="bi bi-inbox fs-1 d-block mb-3 opacity-50" />
                            No report generated or no data found.
                        </div>
                    ) : (
                        <div className="p-3 p-md-4" ref={printRef}>
                            <div className="d-none d-print-block">
                                <h2>Admission Fee Report</h2>
                                <h4>From: {fromDate || 'Start'} To: {toDate || 'End'}</h4>
                            </div>

                            {/* Key Metrics */}
                            <div className="row g-2 g-md-3 mb-3 mb-md-4 summary-grid">
                                <div className="col-6 col-sm-4 col-md summary-box">
                                    <div className="small text-muted mb-1 d-print-none text-truncate" style={{ fontSize: '0.72rem' }}>Total Admissions</div>
                                    <div className="d-none d-print-block">Total Admissions</div>
                                    <div className="fs-5 fw-bold text-primary">{summary.total_admissions}</div>
                                </div>
                                <div className="col-6 col-sm-4 col-md summary-box">
                                    <div className="small text-muted mb-1 d-print-none text-truncate" style={{ fontSize: '0.72rem' }}>Billed Revenue</div>
                                    <div className="d-none d-print-block">Billed Revenue</div>
                                    <div className="fs-5 fw-bold text-dark">Rs {summary.total_billed.toLocaleString()}</div>
                                </div>
                                <div className="col-6 col-sm-4 col-md summary-box">
                                    <div className="small text-muted mb-1 d-print-none text-truncate" style={{ fontSize: '0.72rem' }}>Collected</div>
                                    <div className="d-none d-print-block">Collected</div>
                                    <div className="fs-5 fw-bold text-success">Rs {summary.total_collected.toLocaleString()}</div>
                                </div>
                                <div className="col-6 col-sm-4 col-md summary-box">
                                    <div className="small text-muted mb-1 d-print-none text-truncate" style={{ fontSize: '0.72rem' }}>Discounts</div>
                                    <div className="d-none d-print-block">Discounts</div>
                                    <div className="fs-5 fw-bold text-warning">Rs {summary.total_discount.toLocaleString()}</div>
                                </div>
                                <div className="col-12 col-sm-4 col-md summary-box">
                                    <div className="small text-muted mb-1 d-print-none text-truncate" style={{ fontSize: '0.72rem' }}>Outstanding Dues</div>
                                    <div className="d-none d-print-block">Outstanding</div>
                                    <div className="fs-5 fw-bold text-danger">Rs {summary.total_pending.toLocaleString()}</div>
                                </div>
                            </div>

                            {/* Monthly Breakdown */}
                            <h6 className="fw-bold mb-3 border-bottom pb-2" style={{ color: 'var(--primary-dark)' }}>Monthly Breakdown</h6>
                            <div className="table-responsive mb-4">
                                <table className="table table-bordered table-sm align-middle admission-table">
                                    <thead className="table-light">
                                        <tr>
                                            <th>Month (YYYY-MM)</th>
                                            <th className="text-center">Admissions</th>
                                            <th className="text-end">Total Billed</th>
                                            <th className="text-end">Collected</th>
                                            <th className="text-end">Discount</th>
                                            <th className="text-end">Outstanding</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {monthlyStats.map(stat => (
                                            <tr key={stat.month}>
                                                <td className="fw-semibold">{stat.month}</td>
                                                <td className="text-center">{stat.admissions}</td>
                                                <td className="text-end text-dark">Rs {Number(stat.total_amount).toLocaleString()}</td>
                                                <td className="text-end text-success">Rs {Number(stat.paid_amount).toLocaleString()}</td>
                                                <td className="text-end text-warning">Rs {Number(stat.discount_amount).toLocaleString()}</td>
                                                <td className="text-end text-danger fw-semibold">Rs {Number(stat.remaining_amount).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Detailed List */}
                            <h6 className="fw-bold mb-3 border-bottom pb-2" style={{ color: 'var(--primary-dark)' }}>Student Wise Details</h6>
                            <div className="table-responsive">
                                <table className="table table-hover table-sm align-middle">
                                    <thead className="table-light">
                                        <tr>
                                            <th>Adm.Date</th>
                                            <th>Adm.No</th>
                                            <th>Student Name</th>
                                            <th>Class/Section</th>
                                            <th className="text-end">Total</th>
                                            <th className="text-end">Paid</th>
                                            <th className="text-end">Discount</th>
                                            <th className="text-end">Due</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {fees.map(f => (
                                            <tr key={f.ledger_id}>
                                                <td>{new Date(f.admission_date).toLocaleDateString('en-GB')}</td>
                                                <td>{f.admission_no}</td>
                                                <td className="fw-semibold">{f.student_name}</td>
                                                <td>{f.class_name} {f.section_name}</td>
                                                <td className="text-end">Rs {Number(f.total_amount).toLocaleString()}</td>
                                                <td className="text-end text-success">Rs {Number(f.paid_amount).toLocaleString()}</td>
                                                <td className="text-end text-warning">Rs {Number(f.discount_amount).toLocaleString()}</td>
                                                <td className="text-end text-danger fw-semibold">Rs {Number(f.remaining_amount).toLocaleString()}</td>
                                                <td>
                                                    <span className={`badge bg-${f.status === 'Paid' ? 'success' : f.status === 'Partial' ? 'warning text-dark' : 'danger'}`}>
                                                        {f.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}