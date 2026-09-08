'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as RechartsTooltip,
    Legend,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    ReferenceLine
} from 'recharts';

type AcademicYear = { id: number; year_name: string; is_active: boolean; status: string; start_date?: string; end_date?: string };
type Class = { class_id: number; class_name: string };
type Section = { section_id: number; section_name: string; class_id: number };
type FeeHead = { head_id: number; head_name: string };
type LineItem = { slip_id: number; head_id: number; head_name: string; amount: number; paid_amount: number };
type FeeSlip = {
    slip_id: number;
    student_id: number;
    family_id: number;
    month: number;
    year: number;
    total_amount: number;
    paid_amount: number;
    balance?: number;
    status: string;
    due_date: string;
    issue_date?: string;
    student_name: string;
    admission_no: string;
    roll_no?: string;
    father_name?: string;
    father_phone?: string;
    family_name: string;
    class_name: string;
    section_name: string;
    line_items: LineItem[];
};

type HeadSummary = {
    head_id?: number;
    head_name: string;
    total: number;
    collected: number;
    pending: number;
    collection_rate: number;
    percentage: number;
    students_count?: number;
};

type Collective = {
    total_billed: number;
    total_collected: number;
    total_pending: number;
    total_students: number;
    paid_count: number;
    partial_count: number;
    unpaid_count: number;
    collection_rate?: number;
};

type TimelinePoint = {
    date: string;
    day: string;
    day_num: number;
    daily_collected: number;
    cumulative_collected: number;
    target_billed: number;
    remaining_dues: number;
    collection_rate: number;
};

type WeeklySummary = {
    week: string;
    days: number[];
    collected: number;
    percentage: number;
};

interface AvailableMonth {
    value: string;
    label: string;
    months: number[];
}

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

export default function FamilyFeeReportPage() {
    const now = new Date();
    const [years, setYears] = useState<AcademicYear[]>([]);
    const [academicYearId, setAcademicYearId] = useState<string>('');
    const [classes, setClasses] = useState<Class[]>([]);
    const [sections, setSections] = useState<Section[]>([]);
    const [filteredSections, setFilteredSections] = useState<Section[]>([]);
    const [feeHeads, setFeeHeads] = useState<FeeHead[]>([]);

    const [month, setMonth] = useState<string>('');
    const [year, setYear] = useState<string>(String(now.getFullYear()));
    const [availableMonths, setAvailableMonths] = useState<AvailableMonth[]>([]);
    const [loadingMonths, setLoadingMonths] = useState<boolean>(true);
    const [classId, setClassId] = useState('');
    const [sectionId, setSectionId] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [headId, setHeadId] = useState('');
    const [asOfDate, setAsOfDate] = useState('');
    const [searchKeyword, setSearchKeyword] = useState('');

    const [timelineView, setTimelineView] = useState<'cumulative' | 'daily' | 'weekly'>('cumulative');

    const [slips, setSlips] = useState<FeeSlip[]>([]);
    const [headSummary, setHeadSummary] = useState<HeadSummary[]>([]);
    const [collective, setCollective] = useState<Collective | null>(null);
    const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
    const [weeklySummary, setWeeklySummary] = useState<WeeklySummary[]>([]);
    const [selectedHeadInfo, setSelectedHeadInfo] = useState<HeadSummary | null>(null);
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [uniqueHeads, setUniqueHeads] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/academic/years`)
            .then(r => r.json())
            .then((data: AcademicYear[]) => {
                if (Array.isArray(data) && data.length > 0) {
                    setYears(data);
                    const active = data.find(y => y.is_active || y.status === 'active') || data[0];
                    if (active) setAcademicYearId(String(active.id));
                }
            })
            .catch(console.error);

        fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/academic/classes`).then(r => r.json()).then(setClasses).catch(console.error);
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/academic/sections`).then(r => r.json()).then(setSections).catch(console.error);
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/reports/fee-heads`).then(r => r.json()).then(setFeeHeads).catch(console.error);
    }, []);

    useEffect(() => {
        if (!academicYearId) return;
        setLoadingMonths(true);
        const selYear = years.find(y => String(y.id) === academicYearId);
        const yParam = selYear?.start_date ? new Date(selYear.start_date).getFullYear().toString() : year;
        if (yParam) setYear(yParam);

        fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/fee-slips/available-months?academic_year_id=${academicYearId}`)
            .then(r => r.json())
            .then(data => {
                if (data.months) {
                    setAvailableMonths(data.months);
                    if (data.months.length > 0) {
                        const currentM = (new Date().getMonth() + 1);
                        const exact = data.months.find((m: AvailableMonth) => m.months.includes(currentM));
                        setMonth(exact ? exact.value : data.months[data.months.length - 1].value);
                    } else {
                        setMonth('');
                        setSlips([]);
                        setHeadSummary([]);
                        setCollective(null);
                        setTimeline([]);
                        setWeeklySummary([]);
                    }
                }
            })
            .catch(() => {
                setAvailableMonths([]);
                setMonth('');
            })
            .finally(() => setLoadingMonths(false));
    }, [academicYearId, years]);

    useEffect(() => {
        if (month && year) {
            const mNum = parseInt(month.split(',')[0], 10);
            const yNum = parseInt(year, 10);
            if (!isNaN(mNum) && !isNaN(yNum)) {
                const daysInM = new Date(yNum, mNum, 0).getDate();
                const start = `${yNum}-${String(mNum).padStart(2, '0')}-01`;
                const end = `${yNum}-${String(mNum).padStart(2, '0')}-${String(daysInM).padStart(2, '0')}`;
                setDateRange({ start, end });
                if (asOfDate && (asOfDate < start || asOfDate > end)) {
                    setAsOfDate('');
                }
            }
        }
    }, [month, year]);

    useEffect(() => {
        setSectionId('');
        setFilteredSections(classId ? sections.filter(s => s.class_id === Number(classId)) : sections);
    }, [classId, sections]);

    const loadReport = async () => {
        if (!month || !year) {
            setSlips([]); setHeadSummary([]); setCollective(null); setError(''); setLoading(false);
            return;
        }
        setLoading(true); setError('');
        try {
            const params = new URLSearchParams({ month, year });
            if (academicYearId) params.append('academic_year_id', academicYearId);
            if (classId) params.append('class_id', classId);
            if (sectionId) params.append('section_id', sectionId);
            if (statusFilter) params.append('status', statusFilter);
            if (headId) params.append('head_id', headId);
            if (asOfDate) params.append('as_of_date', asOfDate);

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/reports/family-fee?${params}`);
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to load report');
            const data = await res.json();

            const parsedSlips: FeeSlip[] = (data.slips || []).map((s: FeeSlip) => ({
                ...s,
                total_amount: Number(s.total_amount),
                paid_amount: Number(s.paid_amount),
                balance: Number(s.balance !== undefined ? s.balance : s.total_amount - s.paid_amount),
                line_items: (s.line_items || []).map((li: LineItem) => ({
                    ...li,
                    amount: Number(li.amount),
                    paid_amount: Number(li.paid_amount || 0)
                })),
            }));

            const headSet = new Set<string>();
            parsedSlips.forEach(s => s.line_items.forEach(li => headSet.add(li.head_name)));
            setUniqueHeads(Array.from(headSet).sort());

            setSlips(parsedSlips);
            setHeadSummary(data.headSummary || []);
            setCollective(data.collective || null);
            setTimeline(data.timeline || []);
            setWeeklySummary(data.weeklySummary || []);
            setSelectedHeadInfo(data.selectedHeadInfo || null);
            if (data.dateRange) setDateRange(data.dateRange);
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    const filteredSlips = useMemo(() => {
        if (!searchKeyword.trim()) return slips;
        const q = searchKeyword.toLowerCase().trim();
        return slips.filter(s =>
            (s.student_name || '').toLowerCase().includes(q) ||
            (s.father_name || '').toLowerCase().includes(q) ||
            (s.admission_no || '').toLowerCase().includes(q) ||
            (s.family_name || '').toLowerCase().includes(q) ||
            (s.class_name || '').toLowerCase().includes(q)
        );
    }, [slips, searchKeyword]);

    const currentSelMonth = availableMonths.find(m => m.value === month);
    const monthLabel = currentSelMonth ? currentSelMonth.label : (month ? `Month ${month}` : 'No Fee Slips');
    const classLabel = classId ? classes.find(c => String(c.class_id) === classId)?.class_name || '' : '';
    const secLabel = sectionId ? filteredSections.find(s => String(s.section_id) === sectionId)?.section_name || '' : '';
    const activeYearName = years.find(y => String(y.id) === academicYearId)?.year_name || years.find(y => y.is_active)?.year_name || '';

    const statusBadge = (s: string) => {
        if (s === 'paid') return { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0', label: 'Paid' };
        if (s === 'partial') return { bg: '#ffedd5', text: '#c2410c', border: '#fed7aa', label: 'Partial' };
        return { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5', label: 'Unpaid' };
    };

    const headTotals: Record<string, number> = {};
    uniqueHeads.forEach(h => {
        headTotals[h] = filteredSlips.reduce((sum, slip) => {
            const li = slip.line_items.find(l => l.head_name === h);
            return sum + (li ? li.amount : 0);
        }, 0);
    });

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`
            <html><head><title>Family Fee Report - ${monthLabel} ${year}</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; margin: 15px; color: #1e293b; }
                h2, h3, h4 { margin: 0 0 6px 0; color: #233D4D; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th { background: #233D4D; color: white; padding: 7px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
                td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10.5px; }
                tr:nth-child(even) { background: #f8fafc; }
                .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
                .summary-card { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 6px; }
                @media print { @page { margin: 8mm; size: landscape; } body { -webkit-print-color-adjust: exact; } }
            </style></head><body>${content.innerHTML}</body></html>
        `);
        win.document.close(); win.focus();
        setTimeout(() => { win.print(); win.close(); }, 400);
    };

    const CustomPieTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data: HeadSummary = payload[0].payload;
            return (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 16px', boxShadow: '0 10px 28px rgba(0,0,0,0.12)', minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1e293b', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{data.head_name}</span>
                        <span style={{ color: BRAND.orange }}>{data.percentage}%</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Billed Total:</span>
                        <strong style={{ color: '#1e293b' }}>{fmtPKR(data.total)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Collected:</span>
                        <strong style={{ color: BRAND.green }}>{fmtPKR(data.collected)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Pending Dues:</span>
                        <strong style={{ color: BRAND.red }}>{fmtPKR(data.pending)}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: BRAND.teal, fontWeight: 700, marginTop: 4, borderTop: '1px solid #f1f5f9', paddingTop: 4 }}>
                        Recovery Rate: {data.collection_rate}%
                    </div>
                </div>
            );
        }
        return null;
    };

    const CustomTimelineTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data: TimelinePoint = payload[0].payload;
            return (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 16px', boxShadow: '0 10px 28px rgba(0,0,0,0.12)', minWidth: 220 }}>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span><i className="bi bi-calendar-event me-1 text-primary"></i>{data.date}</span>
                        <span className="badge bg-light text-dark border">Day {data.day_num}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Day Inflow:</span>
                        <strong style={{ color: BRAND.orange }}>{fmtPKR(data.daily_collected)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Cumulative Recovered:</span>
                        <strong style={{ color: BRAND.green }}>{fmtPKR(data.cumulative_collected)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Remaining Dues:</span>
                        <strong style={{ color: BRAND.red }}>{fmtPKR(data.remaining_dues)}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: BRAND.teal, fontWeight: 700, marginTop: 4, borderTop: '1px solid #f1f5f9', paddingTop: 4 }}>
                        Pace: {data.collection_rate}% of Month Target
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
                .family-fee-hero {
                    background: linear-gradient(135deg, #1e3644 0%, #195053 100%);
                    padding: 24px 28px;
                    border-radius: 0 0 24px 24px;
                    box-shadow: 0 6px 20px rgba(33,94,97,0.18);
                    position: relative;
                    color: #fff;
                    margin-bottom: 24px;
                }
                .family-fee-container {
                    padding: 0 28px;
                }
                @media (max-width: 767.98px) {
                    .family-fee-hero {
                        padding: 18px 16px;
                        border-radius: 0 0 18px 18px;
                        margin-bottom: 16px;
                    }
                    .family-fee-container {
                        padding: 0 12px;
                    }
                }
            `}</style>

            <div className="family-fee-hero">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                            width: 46, height: 46, borderRadius: 14,
                            background: 'rgba(255,255,255,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1.5px solid rgba(255,255,255,0.25)',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.15)'
                        }}>
                            <i className="bi bi-wallet2" style={{ fontSize: 22, color: BRAND.orange }} />
                        </div>
                        <div>
                            <h1 style={{ fontSize: 'clamp(1.2rem, 3vw, 1.4rem)', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                                Family Fee &amp; Head Analytics Report
                            </h1>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <i className="bi bi-bar-chart-fill" style={{ color: '#5eead4' }} />
                                Head-wise fee collection, recovery tracking &amp; daily velocity
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

            <div className="family-fee-container">
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
                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>Report Filters &amp; Controls</span>
                        </div>
                        {headId && (
                            <span className="badge bg-warning text-dark px-2.5 py-1 rounded-pill" style={{ fontSize: '11px', fontWeight: 600 }}>
                                Filtered: {feeHeads.find(h => String(h.head_id) === headId)?.head_name}
                                <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={() => setHeadId('')}></button>
                            </span>
                        )}
                    </div>
                    <div style={{ padding: '18px 22px' }}>
                        <div className="row g-2 g-md-3 align-items-end">
                            <div className="col-12 col-sm-6 col-md-2">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    Academic Year
                                </label>
                                <select
                                    className="form-select form-select-sm fw-bold"
                                    value={academicYearId}
                                    onChange={e => setAcademicYearId(e.target.value)}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}
                                >
                                    {years.map(y => (
                                        <option key={y.id} value={y.id}>
                                            {y.year_name} {y.is_active || y.status === 'active' ? '(Active)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="col-6 col-sm-4 col-md-2">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    Month <span className="text-danger">*</span>
                                </label>
                                <select className="form-select form-select-sm fw-semibold"
                                    value={month}
                                    onChange={e => setMonth(e.target.value)}
                                    disabled={availableMonths.length === 0 || loadingMonths}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}>
                                    {availableMonths.length > 0 ? (
                                        availableMonths.map(m => (
                                            <option key={m.value} value={m.value}>{m.label}</option>
                                        ))
                                    ) : (
                                        <option value="">{loadingMonths ? 'Loading...' : 'No Fee Slips'}</option>
                                    )}
                                </select>
                            </div>
                            <div className="col-6 col-sm-4 col-md-2">
                                <label className="form-label fw-bold text-muted small mb-1 d-flex justify-content-between" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    <span>As of Date</span>
                                    {asOfDate && <span className="text-danger" style={{ cursor: 'pointer', fontSize: 9 }} onClick={() => setAsOfDate('')}>Clear</span>}
                                </label>
                                <input
                                    type="date"
                                    className="form-control form-control-sm"
                                    value={asOfDate}
                                    min={dateRange.start}
                                    max={dateRange.end}
                                    onChange={e => setAsOfDate(e.target.value)}
                                    style={{ borderRadius: 10, borderColor: '#cbd5e1' }}
                                />
                            </div>
                            <div className="col-6 col-sm-4 col-md-2">
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    Fee Head
                                </label>
                                <select className="form-select form-select-sm fw-semibold" value={headId} onChange={e => setHeadId(e.target.value)} style={{ borderRadius: 10, borderColor: '#cbd5e1' }}>
                                    <option value="">All Fee Heads</option>
                                    {feeHeads.map(h => <option key={h.head_id} value={h.head_id}>{h.head_name}</option>)}
                                </select>
                            </div>
                            <div className="col-6 col-sm-4 col-md-1.5" style={{ flex: '1 1 110px' }}>
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Class</label>
                                <select className="form-select form-select-sm" value={classId} onChange={e => setClassId(e.target.value)} style={{ borderRadius: 10, borderColor: '#cbd5e1' }}>
                                    <option value="">All</option>
                                    {classes.map(c => <option key={c.class_id} value={c.class_id}>{c.class_name}</option>)}
                                </select>
                            </div>
                            <div className="col-6 col-sm-4 col-md-1.5" style={{ flex: '1 1 100px' }}>
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Section</label>
                                <select className="form-select form-select-sm" value={sectionId} onChange={e => setSectionId(e.target.value)} disabled={!classId} style={{ borderRadius: 10, borderColor: '#cbd5e1' }}>
                                    <option value="">All</option>
                                    {filteredSections.map(s => <option key={s.section_id} value={s.section_id}>{s.section_name}</option>)}
                                </select>
                            </div>
                            <div className="col-6 col-sm-4 col-md-1.5" style={{ flex: '1 1 90px' }}>
                                <label className="form-label fw-bold text-muted small mb-1" style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Status</label>
                                <select className="form-select form-select-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ borderRadius: 10, borderColor: '#cbd5e1' }}>
                                    <option value="">All</option>
                                    <option value="paid">Paid</option>
                                    <option value="partial">Partial</option>
                                    <option value="unpaid">Unpaid</option>
                                </select>
                            </div>
                            <div className="col-12 col-sm-6 col-md-2">
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
                                    onClick={loadReport}
                                    disabled={loading}
                                >
                                    {loading ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-search" />}
                                    Generate
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {error && <div className="alert alert-danger py-2 rounded-3 mb-4"><i className="bi bi-exclamation-triangle me-2" />{error}</div>}

                {!loading && !collective && (
                    <div style={{
                        background: '#fff', borderRadius: 18, padding: '60px 20px', textAlign: 'center',
                        border: '1px solid #f1f5f9', boxShadow: '0 4px 20px rgba(35,61,77,0.06)'
                    }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: '50%', background: 'rgba(33,94,97,0.08)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
                        }}>
                            <i className="bi bi-wallet2 fs-2" style={{ color: BRAND.teal }} />
                        </div>
                        <h5 style={{ fontWeight: 800, color: '#1a2e3b' }}>Generate Family Fee &amp; Head Report</h5>
                        <p style={{ color: '#64748b', fontSize: 13, maxWidth: 450, margin: '0 auto' }}>
                            Select the academic year, month, and optional fee head filters above to generate full cash flow analytics and ledger details.
                        </p>
                    </div>
                )}

                {!loading && collective && slips.length === 0 && (
                    <div className="alert alert-info rounded-3 shadow-sm">
                        <i className="bi bi-info-circle me-2" />
                        No fee slips found for <strong>{monthLabel} {year}</strong> with selected filters.
                    </div>
                )}

                {collective && slips.length > 0 && (
                    <div ref={printRef}>
                        <div style={{
                            background: 'linear-gradient(135deg, #1e3644 0%, #195053 100%)',
                            borderRadius: 16, padding: '16px 24px', color: '#fff',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
                            boxShadow: '0 4px 16px rgba(33,94,97,0.15)', marginBottom: 20
                        }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{ background: 'rgba(255,255,255,0.15)', color: '#5eead4', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, letterSpacing: '0.05em' }}>
                                        {selectedHeadInfo ? `FEE HEAD: ${selectedHeadInfo.head_name.toUpperCase()}` : 'ALL FEE HEADS'}
                                    </span>
                                    {asOfDate && (
                                        <span style={{ background: '#fef08a', color: '#854d0e', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                                            <i className="bi bi-pin-angle-fill me-1" />AS OF: {asOfDate}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 17, fontWeight: 800 }}>
                                    Fee Collection Report {monthLabel} {year} {classLabel && ` | ${classLabel} ${secLabel && '› ' + secLabel}`}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
                                    {slips.length} student slips tracked • Recovery Pace: <strong>{collective.collection_rate}%</strong>
                                </div>
                            </div>
                            <button className="btn btn-light btn-sm fw-bold px-3 shadow-sm d-flex align-items-center gap-1.5" onClick={handlePrint} style={{ borderRadius: 10 }}>
                                <i className="bi bi-printer text-dark" /> Print Report
                            </button>
                        </div>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                            gap: 14,
                            marginBottom: 24
                        }}>
                            {[
                                { label: headId ? `${selectedHeadInfo?.head_name || 'Head'} Billed` : 'Total Billed', val: fmtPKR(collective.total_billed), icon: 'bi-receipt', accent: BRAND.teal, sub: `${slips.length} Students` },
                                { label: 'Collected', val: fmtPKR(collective.total_collected), icon: 'bi-check-circle-fill', accent: BRAND.green, sub: `${collective.collection_rate}% recovered` },
                                { label: 'Pending Dues', val: fmtPKR(collective.total_pending), icon: 'bi-exclamation-circle-fill', accent: BRAND.red, sub: 'Outstanding' },
                                { label: 'Total Students', val: slips.length, icon: 'bi-people-fill', accent: BRAND.dark, sub: 'In Filter' },
                                { label: 'Fully Paid', val: collective.paid_count, icon: 'bi-check2-all', accent: BRAND.green, sub: `${slips.length > 0 ? Math.round((collective.paid_count / slips.length) * 100) : 0}% of slips` },
                                { label: 'Partial Paid', val: collective.partial_count, icon: 'bi-clock-history', accent: BRAND.orange, sub: 'Partially settled' },
                                { label: 'Unpaid', val: collective.unpaid_count, icon: 'bi-x-circle-fill', accent: BRAND.red, sub: 'Zero payment' },
                            ].map(card => (
                                <div key={card.label} style={{
                                    background: '#fff',
                                    borderRadius: 16,
                                    padding: '16px 18px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                                    border: '1px solid #f1f5f9',
                                    borderLeft: '4px solid ' + card.accent,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                    transition: 'transform 0.2s, box-shadow 0.2s'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</span>
                                        <div style={{
                                            width: 32, height: 32, borderRadius: 8,
                                            background: card.accent + '15',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}>
                                            <i className={'bi ' + card.icon} style={{ fontSize: 15, color: card.accent }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: typeof card.val === 'number' ? 24 : 18, fontWeight: 800, color: '#1a2e3b', lineHeight: 1.15 }}>
                                            {card.val}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontWeight: 500 }}>{card.sub}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="row g-3 mb-4">
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
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>Fee Heads Composition</span>
                                        </div>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.teal, background: 'rgba(33,94,97,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                                            {headSummary.length} Heads
                                        </span>
                                    </div>
                                    <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                        {headSummary.length > 0 ? (
                                            <>
                                                <div style={{ position: 'relative', width: 220, height: 220 }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={headSummary}
                                                                dataKey="total"
                                                                nameKey="head_name"
                                                                cx="50%"
                                                                cy="50%"
                                                                innerRadius={68}
                                                                outerRadius={98}
                                                                paddingAngle={3}
                                                                cornerRadius={5}
                                                                animationDuration={900}
                                                            >
                                                                {headSummary.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} stroke="#ffffff" strokeWidth={2} />
                                                                ))}
                                                            </Pie>
                                                            <RechartsTooltip content={<CustomPieTooltip />} />
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                    <div style={{
                                                        position: 'absolute', inset: 0,
                                                        display: 'flex', flexDirection: 'column',
                                                        alignItems: 'center', justifyContent: 'center',
                                                        pointerEvents: 'none'
                                                    }}>
                                                        <span style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>
                                                            {fmtShort(collective.total_billed)}
                                                        </span>
                                                        <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>
                                                            Total Billed
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{
                                                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                                                    gap: 6, width: '100%', marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 12
                                                }}>
                                                    {headSummary.map((h, idx) => (
                                                        <div key={h.head_name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569' }}>
                                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_PALETTE[idx % CHART_PALETTE.length], flexShrink: 0 }} />
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{h.head_name}</span>
                                                            <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#1e293b' }}>{h.percentage}%</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-muted p-4 text-center">No fee heads data</div>
                                        )}
                                    </div>
                                </div>
                            </div>
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
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>Head-wise Recovery Matrix</span>
                                        </div>
                                        <span style={{ fontSize: 11, color: '#94a3b8' }}>Click row to filter</span>
                                    </div>
                                    <div style={{ padding: 0, flex: 1 }}>
                                        <div className="table-responsive" style={{ maxHeight: 310, overflowY: 'auto' }}>
                                            <table className="table table-hover align-middle mb-0" style={{ fontSize: 12 }}>
                                                <thead className="sticky-top bg-light">
                                                    <tr>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Fee Head</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Billed</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Collected</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Pending</th>
                                                        <th style={{ background: '#f8fafc', color: '#64748b', padding: '9px 14px', width: 140, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Recovery</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {headSummary.map((h, idx) => (
                                                        <tr key={h.head_name} style={{ cursor: 'pointer' }} onClick={() => setHeadId(String(h.head_id || ''))} title="Click to filter by this head">
                                                            <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                                                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: CHART_PALETTE[idx % CHART_PALETTE.length], marginRight: 8 }} />
                                                                {h.head_name}
                                                            </td>
                                                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{fmtPKR(h.total)}</td>
                                                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: BRAND.green }}>{fmtPKR(h.collected)}</td>
                                                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: h.pending > 0 ? BRAND.red : BRAND.green }}>
                                                                {fmtPKR(h.pending)}
                                                            </td>
                                                            <td style={{ padding: '10px 14px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 10, height: 6, overflow: 'hidden' }}>
                                                                        <div style={{
                                                                            width: `${Math.min(100, h.collection_rate)}%`,
                                                                            height: '100%',
                                                                            background: h.collection_rate > 50 ? BRAND.green : BRAND.orange,
                                                                            borderRadius: 10
                                                                        }} />
                                                                    </div>
                                                                    <span style={{ fontSize: 11, fontWeight: 700, minWidth: 30, color: '#334155' }}>{h.collection_rate}%</span>
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

                        {timeline.length > 0 && (
                            <div style={{
                                background: '#fff', borderRadius: 18,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
                                border: '1px solid #f1f5f9', overflow: 'hidden', marginBottom: 24
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '14px 22px', borderBottom: '1px solid #f1f5f9',
                                    background: 'linear-gradient(135deg, #fafcff 0%, #f8fdf7 100%)',
                                    flexWrap: 'wrap', gap: 10
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(22,163,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <i className="bi bi-graph-up-arrow" style={{ fontSize: 13, color: BRAND.green }} />
                                        </div>
                                        <div>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>
                                                Collection Velocity &amp; Financial Position Curve ({monthLabel} {year})
                                            </span>
                                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                                Track daily cash receipts, cumulative velocity vs remaining month target dues
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {(['cumulative', 'daily', 'weekly'] as const).map(t => (
                                            <button key={t} onClick={() => setTimelineView(t)} style={{
                                                padding: '5px 14px', borderRadius: 20, border: 'none', fontSize: 12,
                                                fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                                                background: timelineView === t ? BRAND.dark : '#f1f5f9',
                                                color: timelineView === t ? '#fff' : '#64748b',
                                                boxShadow: timelineView === t ? '0 2px 8px rgba(35,61,77,0.25)' : 'none',
                                            }}>
                                                {t === 'cumulative' ? 'Cumulative Recovery' : t === 'daily' ? 'Daily Cash Inflow' : 'Weekly Breakdown'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div style={{
                                    display: 'flex', gap: 16, padding: '12px 24px', background: '#f8fafc',
                                    borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', fontSize: 12
                                }}>
                                    <div><span style={{ color: '#64748b' }}>Month Target:</span> <strong style={{ color: '#1e293b' }}>{fmtPKR(collective.total_billed)}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Collected To-Date:</span> <strong style={{ color: BRAND.green }}>{fmtPKR(collective.total_collected)}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Remaining Unpaid:</span> <strong style={{ color: BRAND.red }}>{fmtPKR(collective.total_pending)}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Recovery Pace:</span> <strong style={{ color: BRAND.orange }}>{collective.collection_rate}%</strong></div>
                                </div>
                                <div style={{ padding: '18px 20px' }}>
                                    {timelineView === 'cumulative' && (
                                        <div style={{ width: '100%', height: 260 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={timeline} margin={{ top: 10, right: 16, left: 10, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="gradCum" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor={BRAND.green} stopOpacity={0.3} />
                                                            <stop offset="100%" stopColor={BRAND.green} stopOpacity={0.0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                                    <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                                                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                                    <RechartsTooltip content={<CustomTimelineTooltip />} />
                                                    <ReferenceLine y={collective.total_billed} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: `Target: ${fmtShort(collective.total_billed)}`, fill: '#64748b', fontSize: 10, position: 'top' }} />
                                                    <Area
                                                        type="monotone"
                                                        dataKey="cumulative_collected"
                                                        name="Cumulative Collected"
                                                        stroke={BRAND.green}
                                                        strokeWidth={2.5}
                                                        fill="url(#gradCum)"
                                                        dot={{ r: 3, fill: '#fff', stroke: BRAND.green, strokeWidth: 2 }}
                                                        activeDot={{ r: 5, fill: BRAND.green, stroke: '#fff', strokeWidth: 2 }}
                                                    />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                    {timelineView === 'daily' && (
                                        <div style={{ width: '100%', height: 260 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={timeline} margin={{ top: 10, right: 16, left: 10, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="gradDaily" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor={BRAND.orange} stopOpacity={0.35} />
                                                            <stop offset="100%" stopColor={BRAND.orange} stopOpacity={0.0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                                    <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                                                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                                    <RechartsTooltip content={<CustomTimelineTooltip />} />
                                                    <Area
                                                        type="monotone"
                                                        dataKey="daily_collected"
                                                        name="Daily Inflow"
                                                        stroke={BRAND.orange}
                                                        strokeWidth={2.5}
                                                        fill="url(#gradDaily)"
                                                        dot={{ r: 3, fill: '#fff', stroke: BRAND.orange, strokeWidth: 2 }}
                                                        activeDot={{ r: 5, fill: BRAND.orange, stroke: '#fff', strokeWidth: 2 }}
                                                    />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                    {timelineView === 'weekly' && (
                                        <div style={{ width: '100%', height: 260 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={weeklySummary} margin={{ top: 10, right: 16, left: 10, bottom: 0 }} barCategoryGap="30%">
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                                    <RechartsTooltip
                                                        formatter={(val: any) => [fmtPKR(Number(val)), 'Weekly Collected']}
                                                        contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 12, boxShadow: '0 10px 28px rgba(0,0,0,0.12)' }}
                                                    />
                                                    <Bar dataKey="collected" fill={BRAND.teal} radius={[6, 6, 0, 0]} maxBarSize={36} name="Weekly Cash Flow" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

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
                                        Student-wise Fee Ledger Breakdown
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: 12 }}>
                                        {filteredSlips.length} Students
                                    </span>
                                </div>
                                <div className="input-group input-group-sm" style={{ width: 240 }}>
                                    <span className="input-group-text bg-light border-end-0" style={{ borderRadius: '10px 0 0 10px' }}><i className="bi bi-search text-muted"></i></span>
                                    <input
                                        type="text"
                                        className="form-control border-start-0 bg-light"
                                        placeholder="Search student / father..."
                                        value={searchKeyword}
                                        onChange={e => setSearchKeyword(e.target.value)}
                                        style={{ borderRadius: '0 10px 10px 0' }}
                                    />
                                    {searchKeyword && (
                                        <button className="btn btn-light border" onClick={() => setSearchKeyword('')}><i className="bi bi-x text-danger"></i></button>
                                    )}
                                </div>
                            </div>
                            <div style={{ padding: 0 }}>
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle mb-0" style={{ fontSize: 12.5, minWidth: 950 }}>
                                        <thead>
                                            <tr>
                                                {['#', 'Adm#', 'Student Name', 'Father Name', 'Class', 'Section'].map(h => (
                                                    <th key={h} style={{ background: BRAND.dark, color: '#fff', padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                                                ))}
                                                {!headId && uniqueHeads.map(h => (
                                                    <th key={h} style={{ background: '#1a4a5e', color: '#fff', padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                                                ))}
                                                <th style={{ background: BRAND.dark, color: '#fff', padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11, textTransform: 'uppercase' }}>
                                                    {headId ? `${selectedHeadInfo?.head_name || 'Head'} Bill` : 'Total Bill'}
                                                </th>
                                                <th style={{ background: BRAND.dark, color: '#fff', padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11, textTransform: 'uppercase' }}>
                                                    {headId ? `${selectedHeadInfo?.head_name || 'Head'} Paid` : 'Paid'}
                                                </th>
                                                <th style={{ background: BRAND.dark, color: '#fff', padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11, textTransform: 'uppercase' }}>Balance</th>
                                                <th style={{ background: BRAND.dark, color: '#fff', padding: '10px 12px', textAlign: 'center', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredSlips.map((s, i) => {
                                                const balance = s.balance !== undefined ? s.balance : s.total_amount - s.paid_amount;
                                                const badge = statusBadge(s.status);
                                                return (
                                                    <tr key={s.slip_id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                                        <td style={{ padding: '9px 12px', color: '#94a3b8', fontSize: 11 }}>{i + 1}</td>
                                                        <td style={{ padding: '9px 12px', fontWeight: 600 }}>{s.admission_no}</td>
                                                        <td style={{ padding: '9px 12px', fontWeight: 700, color: '#1e293b' }}>{s.student_name}</td>
                                                        <td style={{ padding: '9px 12px', color: '#64748b' }}>{s.father_name || '—'}</td>
                                                        <td style={{ padding: '9px 12px' }}>{s.class_name}</td>
                                                        <td style={{ padding: '9px 12px' }}>{s.section_name}</td>
                                                        {!headId && uniqueHeads.map(h => {
                                                            const li = s.line_items.find(l => l.head_name === h);
                                                            return (
                                                                <td key={h} style={{ padding: '9px 12px', textAlign: 'right', color: li ? '#1e293b' : '#cbd5e1', fontWeight: li ? 600 : 400 }}>
                                                                    {li ? fmtPKR(li.amount) : '—'}
                                                                </td>
                                                            );
                                                        })}
                                                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtPKR(s.total_amount)}</td>
                                                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: BRAND.green }}>{fmtPKR(s.paid_amount)}</td>
                                                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: balance > 0 ? BRAND.red : BRAND.green }}>
                                                            {fmtPKR(balance)}
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
                                                    TOTAL ({filteredSlips.length} students)
                                                </td>
                                                {!headId && uniqueHeads.map(h => (
                                                    <td key={h} style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 700, color: BRAND.dark }}>
                                                        {fmtPKR(headTotals[h] || 0)}
                                                    </td>
                                                ))}
                                                <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: BRAND.dark }}>
                                                    {fmtPKR(filteredSlips.reduce((sum, s) => sum + s.total_amount, 0))}
                                                </td>
                                                <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: BRAND.green }}>
                                                    {fmtPKR(filteredSlips.reduce((sum, s) => sum + s.paid_amount, 0))}
                                                </td>
                                                <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: BRAND.red }}>
                                                    {fmtPKR(filteredSlips.reduce((sum, s) => sum + (s.balance !== undefined ? s.balance : s.total_amount - s.paid_amount), 0))}
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
