'use client';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as RechartsTooltip,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid
} from 'recharts';

type Category = { category_id: number; category_name: string };
type AcademicYear = { id: number; year_name: string; is_active: boolean; status: string; start_date?: string; end_date?: string };
type Expense = {
    expense_id: number;
    expense_title: string;
    amount: number;
    expense_date: string;
    payment_method: string;
    paid_to: string;
    status: string;
    category_name: string;
    academic_year_id?: number;
    academic_year_name?: string;
};
type CategorySummary = { category: string; total: number; count: number; percentage: number };

// Brand Theme Palette matching Executive Dashboard
const BRAND = {
    dark: '#233D4D',
    teal: '#215E61',
    orange: '#FE7F2D',
    green: '#16a34a',
    red: '#dc2626',
    amber: '#d97706',
    purple: '#7c3aed',
    indigo: '#4f46e5',
    cyan: '#0891b2',
    pink: '#db2777'
};

const CHART_PALETTE = [
    BRAND.teal,
    BRAND.orange,
    BRAND.dark,
    BRAND.indigo,
    BRAND.green,
    BRAND.amber,
    BRAND.purple,
    BRAND.cyan,
    BRAND.pink
];

function fmtPKR(n: number) {
    return 'Rs. ' + Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function fmtShort(n: number) {
    if (n >= 1_000_000) return 'Rs. ' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return 'Rs. ' + (n / 1_000).toFixed(0) + 'k';
    return 'Rs. ' + n;
}

export default function ExpenseReportPage() {
    const [years, setYears] = useState<AcademicYear[]>([]);
    const [academicYearId, setAcademicYearId] = useState<string>('');
    const [categories, setCategories] = useState<Category[]>([]);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [searchKeyword, setSearchKeyword] = useState('');

    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [categorySummary, setCategorySummary] = useState<CategorySummary[]>([]);
    const [grandTotal, setGrandTotal] = useState(0);
    const [approvedTotal, setApprovedTotal] = useState(0);
    const [pendingTotal, setPendingTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);

    const loadReport = useCallback(async (overrides?: { yearId?: string; fDate?: string; tDate?: string; catId?: string }) => {
        setLoading(true);
        setError('');
        try {
            const yId = overrides?.yearId !== undefined ? overrides.yearId : academicYearId;
            const fD = overrides?.fDate !== undefined ? overrides.fDate : fromDate;
            const tD = overrides?.tDate !== undefined ? overrides.tDate : toDate;
            const cId = overrides?.catId !== undefined ? overrides.catId : categoryId;

            const params = new URLSearchParams();
            if (yId) params.append('academic_year_id', yId);
            if (fD) params.append('from_date', fD);
            if (tD) params.append('to_date', tD);
            if (cId) params.append('category_id', cId);

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/reports/expenses?${params}`);
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to load expense report');
            const data = await res.json();

            const parsedExpenses = (data.expenses || []).map((e: Expense) => ({
                ...e,
                amount: Number(e.amount || 0)
            }));

            setExpenses(parsedExpenses);
            setCategorySummary(data.categorySummary || []);
            setGrandTotal(Number(data.grandTotal || 0));
            setApprovedTotal(Number(data.approvedTotal || 0));
            setPendingTotal(Number(data.pendingTotal || 0));
            setHasLoadedOnce(true);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [academicYearId, fromDate, toDate, categoryId]);

    // Initial load of years & categories + auto-fetch report
    useEffect(() => {
        let initialYearId = '';
        let initialFromDate = '';
        let initialToDate = '';

        Promise.all([
            fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/academic/years`).then(r => r.json()),
            fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/reports/expense-categories`).then(r => r.json())
        ])
            .then(([yearsData, catsData]) => {
                if (Array.isArray(yearsData) && yearsData.length > 0) {
                    setYears(yearsData);
                    const active = yearsData.find(y => y.is_active || y.status === 'active') || yearsData[0];
                    if (active) {
                        initialYearId = String(active.id);
                        setAcademicYearId(initialYearId);
                        if (active.start_date && active.end_date) {
                            initialFromDate = active.start_date.slice(0, 10);
                            initialToDate = active.end_date.slice(0, 10);
                            setFromDate(initialFromDate);
                            setToDate(initialToDate);
                        }
                    }
                }
                if (Array.isArray(catsData)) {
                    setCategories(catsData);
                }
                // Auto trigger initial report
                loadReport({ yearId: initialYearId, fDate: initialFromDate, tDate: initialToDate });
            })
            .catch(err => {
                console.error('Initial load error:', err);
                setError('Failed to connect to server.');
            });
    }, []);

    const handleYearChange = (id: string) => {
        setAcademicYearId(id);
        const sel = years.find(y => String(y.id) === id);
        let fD = '';
        let tD = '';
        if (sel && sel.start_date && sel.end_date) {
            fD = sel.start_date.slice(0, 10);
            tD = sel.end_date.slice(0, 10);
            setFromDate(fD);
            setToDate(tD);
        }
        loadReport({ yearId: id, fDate: fD, tDate: tD });
    };

    // Client-side search & status filtering
    const filteredExpenses = useMemo(() => {
        return expenses.filter(e => {
            if (statusFilter && e.status?.toLowerCase() !== statusFilter.toLowerCase()) return false;
            if (searchKeyword.trim()) {
                const q = searchKeyword.toLowerCase().trim();
                return (
                    (e.expense_title || '').toLowerCase().includes(q) ||
                    (e.paid_to || '').toLowerCase().includes(q) ||
                    (e.category_name || '').toLowerCase().includes(q) ||
                    (e.payment_method || '').toLowerCase().includes(q)
                );
            }
            return true;
        });
    }, [expenses, statusFilter, searchKeyword]);

    const activeYearName = years.find(y => String(y.id) === academicYearId)?.year_name || years.find(y => y.is_active)?.year_name || '';

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`<html><head><title>Expense Report - ${activeYearName}</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11.5px; margin: 20px; color: #1e293b; }
                h2, h3 { margin: 0 0 6px 0; color: #233D4D; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 16px; margin-top: 10px; }
                th { background: #233D4D; color: white; padding: 7px 8px; text-align: left; font-size: 10.5px; text-transform: uppercase; }
                td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
                tr:nth-child(even) { background: #f8fafc; }
                .summary-card { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 6px; }
                .grand-total { font-size: 14px; font-weight: bold; text-align: right; margin-top: 8px; color: #dc2626; }
                @media print { body { margin: 10mm; } -webkit-print-color-adjust: exact; }
            </style></head><body>${content.innerHTML}</body></html>`);
        win.document.close(); win.focus();
        setTimeout(() => { win.print(); win.close(); }, 400);
    };

    const statusBadge = (s: string) => {
        const st = (s || '').toLowerCase();
        if (st === 'approved' || st === 'paid' || st === 'completed') {
            return { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0', label: 'Approved' };
        }
        if (st === 'pending') {
            return { bg: '#fef3c7', text: '#b45309', border: '#fde68a', label: 'Pending' };
        }
        return { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5', label: s || 'Rejected' };
    };

    // Custom Tooltip for Recharts Donut Pie Chart
    const CustomPieTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data: CategorySummary = payload[0].payload;
            return (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 16px', boxShadow: '0 10px 28px rgba(0,0,0,0.12)', minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1e293b', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{data.category}</span>
                        <span style={{ color: BRAND.orange }}>{data.percentage}%</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Total Spent:</span>
                        <strong style={{ color: '#1e293b' }}>{fmtPKR(data.total)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Voucher Count:</span>
                        <strong style={{ color: BRAND.teal }}>{data.count} Entries</strong>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ minHeight: '100vh', background: '#f4f7f6', padding: '0 0 48px' }}>
            {/* Custom Responsive Styles */}
            <style jsx>{`
                .expense-hero-header {
                    background: linear-gradient(135deg, #1e3644 0%, #195053 100%);
                    padding: 24px 28px;
                    border-radius: 0 0 24px 24px;
                    box-shadow: 0 6px 20px rgba(33,94,97,0.18);
                    position: relative;
                    color: #fff;
                    margin-bottom: 24px;
                }
                .expense-content-container {
                    padding: 0 28px;
                }
                .expense-kpi-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 14px;
                    margin-bottom: 24px;
                }
                @media (max-width: 767.98px) {
                    .expense-hero-header {
                        padding: 18px 16px;
                        border-radius: 0 0 18px 18px;
                        margin-bottom: 16px;
                    }
                    .expense-content-container {
                        padding: 0 12px;
                    }
                    .expense-kpi-grid {
                        grid-template-columns: repeat(2, 1fr);
                        gap: 10px;
                        margin-bottom: 16px;
                    }
                    .expense-kpi-val {
                        font-size: 1.15rem !important;
                    }
                }
                @media (max-width: 480px) {
                    .expense-kpi-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }
            `}</style>

            {/* ── 1. Top Executive Hero Header ── */}
            <div className="expense-hero-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                            width: 46, height: 46, borderRadius: 14,
                            background: 'rgba(255,255,255,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1.5px solid rgba(255,255,255,0.25)',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.15)'
                        }}>
                            <i className="bi bi-cash-stack" style={{ fontSize: 22, color: BRAND.orange }} />
                        </div>
                        <div>
                            <h1 style={{ fontSize: 'clamp(1.2rem, 3vw, 1.4rem)', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                                Institutional Expense Report
                            </h1>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <i className="bi bi-pie-chart-fill" style={{ color: '#5eead4' }} />
                                Category-wise expense distribution &amp; disbursements
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="badge rounded-pill bg-white text-dark px-3 py-2 shadow-sm d-inline-flex align-items-center gap-1.5" style={{ fontSize: '13px', fontWeight: 700 }}>
                            <i className="bi bi-mortarboard-fill" style={{ color: BRAND.teal }}></i>
                            Academic Year: {activeYearName || '—'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="expense-content-container">

                {/* ── 2. Filters Panel (Standard Theme Panel) ── */}
                <div style={{
                    background: '#fff', borderRadius: 18,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                    border: '1px solid #f1f5f9', overflow: 'hidden', marginBottom: 24
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 22px', borderBottom: '1px solid #f1f5f9',
                        background: 'linear-gradient(135deg, #fafcff 0%, #f8fdf7 100%)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: 8, background: 'rgba(254,127,45,0.12)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <i className="bi bi-funnel-fill" style={{ fontSize: 13, color: BRAND.orange }} />
                            </div>
                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>Expense Report Filters</span>
                        </div>
                        {categoryId && (
                            <span className="badge bg-warning text-dark px-2.5 py-1 rounded-pill" style={{ fontSize: '11px', fontWeight: 600 }}>
                                Filtered: {categories.find(c => String(c.category_id) === categoryId)?.category_name}
                                <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={() => { setCategoryId(''); loadReport({ catId: '' }); }}></button>
                            </span>
                        )}
                    </div>

                    <div style={{ padding: '18px 22px' }}>
                        <div className="row g-2 g-md-3 align-items-end">
                            {/* Academic Year */}
                            <div className="col-12 col-sm-6 col-md-3">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    Academic Year
                                </label>
                                <select
                                    className="form-select form-select-sm fw-bold"
                                    value={academicYearId}
                                    onChange={e => handleYearChange(e.target.value)}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}
                                >
                                    {years.map(y => (
                                        <option key={y.id} value={y.id}>
                                            {y.year_name} {y.is_active || y.status === 'active' ? '(Active)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* From Date */}
                            <div className="col-6 col-sm-3 col-md-2">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    From Date
                                </label>
                                <input
                                    type="date"
                                    className="form-control form-control-sm"
                                    value={fromDate}
                                    onChange={e => setFromDate(e.target.value)}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}
                                />
                            </div>

                            {/* To Date */}
                            <div className="col-6 col-sm-3 col-md-2">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    To Date
                                </label>
                                <input
                                    type="date"
                                    className="form-control form-control-sm"
                                    value={toDate}
                                    onChange={e => setToDate(e.target.value)}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}
                                />
                            </div>

                            {/* Category */}
                            <div className="col-12 col-sm-6 col-md-3">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    Category
                                </label>
                                <select
                                    className="form-select form-select-sm fw-semibold"
                                    value={categoryId}
                                    onChange={e => setCategoryId(e.target.value)}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}
                                >
                                    <option value="">All Categories</option>
                                    {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                                </select>
                            </div>

                            {/* Generate Button */}
                            <div className="col-12 col-sm-6 col-md-2 d-flex gap-2">
                                <button
                                    className="btn btn-sm w-100 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-1.5"
                                    style={{
                                        background: 'linear-gradient(135deg, #FE7F2D 0%, #f97316 100%)',
                                        color: '#fff',
                                        borderRadius: 10,
                                        height: 33,
                                        border: 'none',
                                        boxShadow: '0 4px 12px rgba(254,127,45,0.3)'
                                    }}
                                    onClick={() => loadReport()}
                                    disabled={loading}
                                >
                                    {loading ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-search" />}
                                    Generate
                                </button>
                                {expenses.length > 0 && (
                                    <button
                                        className="btn btn-light btn-sm border shadow-sm px-2.5"
                                        onClick={handlePrint}
                                        title="Print Expense Report"
                                        style={{ borderRadius: 10 }}
                                    >
                                        <i className="bi bi-printer text-dark" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {error && <div className="alert alert-danger py-2 rounded-3 mb-4"><i className="bi bi-exclamation-triangle me-2" />{error}</div>}

                {/* ── 3. KPI StatCards ── */}
                {hasLoadedOnce && (
                    <div className="expense-kpi-grid">
                        {[
                            { label: 'Total Expenditure', val: fmtPKR(grandTotal), icon: 'bi-cash-coin', accent: BRAND.red, sub: `${expenses.length} Vouchers` },
                            { label: 'Approved / Paid', val: fmtPKR(approvedTotal), icon: 'bi-check-circle-fill', accent: BRAND.green, sub: 'Disbursed funds' },
                            { label: 'Pending Approvals', val: fmtPKR(pendingTotal), icon: 'bi-clock-history', accent: BRAND.orange, sub: 'Under review' },
                            { label: 'Expense Records', val: expenses.length, icon: 'bi-receipt-cutoff', accent: BRAND.teal, sub: `${categorySummary.length} Active Categories` },
                            { label: 'Top Spend Category', val: categorySummary[0]?.category || 'None', icon: 'bi-award-fill', accent: BRAND.indigo, sub: categorySummary[0] ? `${categorySummary[0].percentage}% of total` : '—' }
                        ].map(card => (
                            <div key={card.label} style={{
                                background: '#fff',
                                borderRadius: 16,
                                padding: '14px 16px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                                border: '1px solid #f1f5f9',
                                borderLeft: '4px solid ' + card.accent,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</span>
                                    <div style={{
                                        width: 28, height: 28, borderRadius: 8,
                                        background: card.accent + '15',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        <i className={'bi ' + card.icon} style={{ fontSize: 14, color: card.accent }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="expense-kpi-val" style={{ fontSize: typeof card.val === 'number' ? 22 : 16, fontWeight: 800, color: '#1a2e3b', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {card.val}
                                    </div>
                                    <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4, fontWeight: 500 }} className="text-truncate">{card.sub}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Empty State */}
                {!loading && hasLoadedOnce && expenses.length === 0 && (
                    <div style={{
                        background: '#fff', borderRadius: 18, padding: '60px 20px', textAlign: 'center',
                        border: '1px solid #f1f5f9', boxShadow: '0 4px 20px rgba(35,61,77,0.06)'
                    }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: '50%', background: 'rgba(33,94,97,0.08)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
                        }}>
                            <i className="bi bi-cash-stack fs-2" style={{ color: BRAND.teal }} />
                        </div>
                        <h5 style={{ fontWeight: 800, color: '#1a2e3b' }}>No Expense Records Found</h5>
                        <p style={{ color: '#64748b', fontSize: 13, maxWidth: 450, margin: '0 auto' }}>
                            No expenses recorded for <strong>{activeYearName}</strong> {fromDate && toDate ? `between ${fromDate} and ${toDate}` : ''}. Try broadening your date filter or category selection.
                        </p>
                    </div>
                )}

                {/* ── Active Report ── */}
                {expenses.length > 0 && (
                    <div ref={printRef}>

                        {/* ── Visual Analytics: Donut & Category Summary ── */}
                        <div className="row g-3 mb-4">
                            {/* Left: Category Composition Donut Ring */}
                            <div className="col-12 col-lg-5">
                                <div style={{
                                    background: '#fff', borderRadius: 18,
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                                    border: '1px solid #f1f5f9', overflow: 'hidden', height: '100%',
                                    display: 'flex', flexDirection: 'column'
                                }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '14px 20px', borderBottom: '1px solid #f1f5f9',
                                        background: 'linear-gradient(135deg, #fafcff 0%, #f8fdf7 100%)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(254,127,45,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <i className="bi bi-pie-chart-fill" style={{ fontSize: 13, color: BRAND.orange }} />
                                            </div>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>Expense Category Share</span>
                                        </div>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.teal, background: 'rgba(33,94,97,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                                            {categorySummary.length} Categories
                                        </span>
                                    </div>

                                    <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                        {categorySummary.length > 0 ? (
                                            <>
                                                {/* Chart with Center Hub */}
                                                <div style={{ position: 'relative', width: 220, height: 220 }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={categorySummary}
                                                                dataKey="total"
                                                                nameKey="category"
                                                                cx="50%"
                                                                cy="50%"
                                                                innerRadius={68}
                                                                outerRadius={98}
                                                                paddingAngle={3}
                                                                cornerRadius={5}
                                                                animationDuration={900}
                                                            >
                                                                {categorySummary.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} stroke="#ffffff" strokeWidth={2} />
                                                                ))}
                                                            </Pie>
                                                            <RechartsTooltip content={<CustomPieTooltip />} />
                                                        </PieChart>
                                                    </ResponsiveContainer>

                                                    {/* Center Donut Hub */}
                                                    <div style={{
                                                        position: 'absolute', inset: 0,
                                                        display: 'flex', flexDirection: 'column',
                                                        alignItems: 'center', justifyContent: 'center',
                                                        pointerEvents: 'none'
                                                    }}>
                                                        <span style={{ fontSize: 18, fontWeight: 800, color: BRAND.red, lineHeight: 1 }}>
                                                            {fmtShort(grandTotal)}
                                                        </span>
                                                        <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>
                                                            Total Spent
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Legend Grid Below Donut */}
                                                <div style={{
                                                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                                                    gap: 6, width: '100%', marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 12
                                                }}>
                                                    {categorySummary.map((c, idx) => (
                                                        <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569' }}>
                                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_PALETTE[idx % CHART_PALETTE.length], flexShrink: 0 }} />
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{c.category}</span>
                                                            <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#1e293b' }}>{c.percentage}%</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-muted p-4 text-center">No category data</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Category Breakdown Matrix */}
                            <div className="col-12 col-lg-7">
                                <div style={{
                                    background: '#fff', borderRadius: 18,
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                                    border: '1px solid #f1f5f9', overflow: 'hidden', height: '100%',
                                    display: 'flex', flexDirection: 'column'
                                }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '14px 20px', borderBottom: '1px solid #f1f5f9',
                                        background: 'linear-gradient(135deg, #fafcff 0%, #f8fdf7 100%)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(33,94,97,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <i className="bi bi-bar-chart-steps" style={{ fontSize: 13, color: BRAND.teal }} />
                                            </div>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>Category Expenditure Matrix</span>
                                        </div>
                                        <span style={{ fontSize: 11, color: '#94a3b8' }}>Click row to filter</span>
                                    </div>

                                    <div style={{ padding: 0, flex: 1 }}>
                                        <div className="table-responsive" style={{ maxHeight: 310, overflowY: 'auto' }}>
                                            <table className="table table-hover align-middle mb-0" style={{ fontSize: 12 }}>
                                                <thead className="sticky-top bg-light">
                                                    <tr>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Category</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Vouchers</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Total Spent</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', width: 140, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Share %</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {categorySummary.map((c, idx) => (
                                                        <tr key={c.category} style={{ cursor: 'pointer' }}>
                                                            <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                                                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: CHART_PALETTE[idx % CHART_PALETTE.length], marginRight: 8 }} />
                                                                {c.category}
                                                            </td>
                                                            <td style={{ padding: '10px 14px', textAlign: 'center', color: '#64748b' }}>{c.count}</td>
                                                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: BRAND.red }}>{fmtPKR(c.total)}</td>
                                                            <td style={{ padding: '10px 14px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 10, height: 6, overflow: 'hidden' }}>
                                                                        <div style={{
                                                                            width: `${Math.min(100, c.percentage)}%`,
                                                                            height: '100%',
                                                                            background: CHART_PALETTE[idx % CHART_PALETTE.length],
                                                                            borderRadius: 10
                                                                        }} />
                                                                    </div>
                                                                    <span style={{ fontSize: 11, fontWeight: 700, minWidth: 30, color: '#334155' }}>{c.percentage}%</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── Expense Detail Table ── */}
                        <div style={{
                            background: '#fff', borderRadius: 18,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                            border: '1px solid #f1f5f9', overflow: 'hidden', marginBottom: 24
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '14px 22px', borderBottom: '1px solid #f1f5f9',
                                background: 'linear-gradient(135deg, #fafcff 0%, #f8fdf7 100%)',
                                flexWrap: 'wrap', gap: 12
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(35,61,77,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <i className="bi bi-table" style={{ fontSize: 13, color: BRAND.dark }} />
                                    </div>
                                    <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>
                                        Disbursement Ledger &amp; Vouchers
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: 12 }}>
                                        {filteredExpenses.length} Records
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {/* Status Filter */}
                                    <select
                                        className="form-select form-select-sm"
                                        value={statusFilter}
                                        onChange={e => setStatusFilter(e.target.value)}
                                        style={{ width: 120, borderRadius: 10, borderColor: '#cbd5e1' }}
                                    >
                                        <option value="">All Status</option>
                                        <option value="approved">Approved</option>
                                        <option value="pending">Pending</option>
                                    </select>

                                    {/* Search Input */}
                                    <div className="input-group input-group-sm" style={{ width: 220 }}>
                                        <span className="input-group-text bg-light border-end-0" style={{ borderRadius: '10px 0 0 10px' }}><i className="bi bi-search text-muted"></i></span>
                                        <input
                                            type="text"
                                            className="form-control border-start-0 bg-light"
                                            placeholder="Search title / payee..."
                                            value={searchKeyword}
                                            onChange={e => setSearchKeyword(e.target.value)}
                                            style={{ borderRadius: '0 10px 10px 0' }}
                                        />
                                        {searchKeyword && (
                                            <button className="btn btn-light border" onClick={() => setSearchKeyword('')}><i className="bi bi-x text-danger"></i></button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ padding: 0 }}>
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle mb-0" style={{ fontSize: 12.5, minWidth: 850 }}>
                                        <thead>
                                            <tr>
                                                {['#', 'Date', 'Expense Title / Description', 'Category', 'Paid To / Beneficiary', 'Payment Method', 'Amount', 'Status'].map((h, idx) => (
                                                    <th key={h} style={{
                                                        background: BRAND.dark,
                                                        color: '#fff',
                                                        padding: '10px 12px',
                                                        whiteSpace: 'nowrap',
                                                        fontSize: 11,
                                                        textTransform: 'uppercase',
                                                        textAlign: idx === 6 ? 'right' : idx === 7 ? 'center' : 'left'
                                                    }}>
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredExpenses.map((e, i) => {
                                                const badge = statusBadge(e.status);
                                                const dateFormatted = e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                                                return (
                                                    <tr key={e.expense_id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                                        <td style={{ padding: '9px 12px', color: '#94a3b8', fontSize: 11 }}>{i + 1}</td>
                                                        <td style={{ padding: '9px 12px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>{dateFormatted}</td>
                                                        <td style={{ padding: '9px 12px', fontWeight: 700, color: '#1e293b' }}>{e.expense_title}</td>
                                                        <td style={{ padding: '9px 12px' }}>
                                                            <span className="badge bg-light text-dark border px-2 py-1" style={{ fontSize: 11, fontWeight: 600 }}>
                                                                {e.category_name || 'Uncategorized'}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '9px 12px', color: '#64748b' }}>{e.paid_to || '—'}</td>
                                                        <td style={{ padding: '9px 12px', color: '#475569' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                                <i className="bi bi-wallet2 text-muted" /> {e.payment_method || 'Cash'}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: BRAND.red }}>
                                                            {fmtPKR(e.amount)}
                                                        </td>
                                                        <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                                            <span style={{
                                                                background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`,
                                                                padding: '3px 9px', borderRadius: 12, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase'
                                                            }}>
                                                                {badge.label}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: '#eef2f7' }}>
                                                <td colSpan={6} style={{ padding: '11px 12px', fontWeight: 800, fontSize: 13 }}>
                                                    TOTAL EXPENDITURE ({filteredExpenses.length} records)
                                                </td>
                                                <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, fontSize: 14, color: BRAND.red }}>
                                                    {fmtPKR(filteredExpenses.reduce((sum, e) => sum + e.amount, 0))}
                                                </td>
                                                <td />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
}
