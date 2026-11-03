'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    AreaChart, Area, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
    ResponsiveContainer, ReferenceLine
} from 'recharts';
import { API, C } from './shared';

interface AvailableMonth {
    value: string;
    label: string;
    months: number[];
}

interface TimelinePoint {
    date: string;
    day: string;
    day_num: number;
    daily_collected: number;
    cumulative_collected: number;
    target_billed: number;
    remaining_dues: number;
    collection_rate: number;
}

interface WeeklySummary {
    week: string;
    days: number[];
    collected: number;
    percentage: number;
}

interface Collective {
    total_billed: number;
    total_collected: number;
    total_pending: number;
    total_advance?: number;
    collection_rate: number;
}

function fmtPKR(n?: number | null) {
    return 'Rs. ' + Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function fmtShort(n: number) {
    if (n >= 1_000_000) return 'Rs. ' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return 'Rs. ' + (n / 1_000).toFixed(0) + 'k';
    return 'Rs. ' + n;
}

export default function CollectionVelocityCurve() {
    const [timelineView, setTimelineView] = useState<'cumulative' | 'daily' | 'weekly'>('cumulative');
    const [showAmounts, setShowAmounts] = useState<boolean>(false); // Numeric values hidden by default
    const [availableMonths, setAvailableMonths] = useState<AvailableMonth[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
    const [collective, setCollective] = useState<Collective | null>(null);
    const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
    const [weeklySummary, setWeeklySummary] = useState<WeeklySummary[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    const fetchReport = async (mVal: string, yVal: string) => {
        if (!mVal) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({ month: mVal, year: yVal });
            const res = await fetch(`${API}/reports/family-fee?${params}`);
            if (!res.ok) throw new Error('Failed to load velocity report');
            const data = await res.json();
            setCollective(data.collective || null);
            setTimeline(data.timeline || []);
            setWeeklySummary(data.weeklySummary || []);
        } catch (e) {
            console.error('Error loading Collection Velocity report:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let isMounted = true;
        async function init() {
            try {
                const now = new Date();
                const curYear = String(now.getFullYear());
                const curMonth = String(now.getMonth() + 1);

                const mRes = await fetch(`${API}/fee-slips/available-months`);
                let monthsList: AvailableMonth[] = [];
                if (mRes.ok) {
                    const mData = await mRes.json();
                    if (Array.isArray(mData.months) && mData.months.length > 0) {
                        monthsList = mData.months;
                    }
                }

                if (!isMounted) return;
                setAvailableMonths(monthsList);

                // Default to latest available month or current month
                const initialMonth = monthsList.length > 0
                    ? monthsList[monthsList.length - 1].value
                    : curMonth;

                setSelectedMonth(initialMonth);
                setSelectedYear(curYear);
                fetchReport(initialMonth, curYear);
            } catch (err) {
                console.error('Failed to init available months:', err);
                if (isMounted) setLoading(false);
            }
        }

        init();
        return () => { isMounted = false; };
    }, []);

    const handleMonthChange = (newVal: string) => {
        setSelectedMonth(newVal);
        fetchReport(newVal, selectedYear);
    };

    const currentSelMonth = availableMonths.find(m => m.value === selectedMonth);
    const monthLabel = currentSelMonth ? currentSelMonth.label : (selectedMonth ? `Month ${selectedMonth}` : 'Current Month');

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
                        <strong style={{ color: C.orange }}>{showAmounts ? fmtPKR(data.daily_collected) : 'Rs *****'}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Cumulative Recovered:</span>
                        <strong style={{ color: C.green }}>{showAmounts ? fmtPKR(data.cumulative_collected) : 'Rs *****'}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>Remaining Dues:</span>
                        <strong style={{ color: C.red }}>{showAmounts ? fmtPKR(data.remaining_dues) : 'Rs *****'}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: C.teal, fontWeight: 700, marginTop: 4, borderTop: '1px solid #f1f5f9', paddingTop: 4 }}>
                        Pace: {showAmounts ? `${data.collection_rate}% of Month Target` : '**% of Month Target'}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{
            background: '#fff',
            borderRadius: 18,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 20px rgba(35,61,77,0.06)',
            border: '1px solid #f1f5f9',
            borderLeft: `4px solid ${C.green}`,
            overflow: 'hidden',
            marginBottom: 20
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 22px', borderBottom: '1px solid #f1f5f9',
                background: 'linear-gradient(135deg, #fafcff 0%, #f8fdf7 100%)',
                flexWrap: 'wrap', gap: 10
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: 'rgba(22,163,74,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <i className="bi bi-graph-up-arrow" style={{ fontSize: 13, color: C.green }} />
                    </div>
                    <div>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2e3b' }}>
                            Collection Velocity &amp; Financial Position Curve ({monthLabel} {selectedYear})
                        </span>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            Track daily cash receipts, cumulative velocity vs remaining month target dues
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Month Picker Dropdown */}
                    {availableMonths.length > 0 && (
                        <select
                            value={selectedMonth}
                            onChange={(e) => handleMonthChange(e.target.value)}
                            style={{
                                fontSize: 12, padding: '5px 12px',
                                border: '1px solid #e2e8f0', borderRadius: 8, color: '#334155',
                                outline: 'none', background: '#f8fafc', fontWeight: 600,
                                cursor: 'pointer'
                            }}
                            title="Select Month"
                        >
                            {availableMonths.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    )}

                    {/* Eye Toggle Button */}
                    <button
                        type="button"
                        onClick={() => setShowAmounts(s => !s)}
                        title={showAmounts ? 'Hide Numeric Values' : 'Show Numeric Values'}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0',
                            background: showAmounts ? `${C.teal}1a` : '#f8fafc',
                            cursor: 'pointer', transition: 'all 0.2s',
                            color: showAmounts ? C.teal : '#94a3b8',
                        }}
                    >
                        <i className={showAmounts ? 'bi bi-eye-slash' : 'bi bi-eye'} style={{ fontSize: 13 }} />
                    </button>

                    {/* Timeline View Tabs */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(['cumulative', 'daily', 'weekly'] as const).map(t => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setTimelineView(t)}
                                style={{
                                    padding: '5px 14px', borderRadius: 20, border: 'none', fontSize: 12,
                                    fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                                    background: timelineView === t ? C.dark : '#f1f5f9',
                                    color: timelineView === t ? '#fff' : '#64748b',
                                    boxShadow: timelineView === t ? '0 2px 8px rgba(35,61,77,0.25)' : 'none',
                                }}
                            >
                                {t === 'cumulative' ? 'Cumulative Recovery' : t === 'daily' ? 'Daily Cash Inflow' : 'Weekly Breakdown'}
                            </button>
                        ))}
                    </div>

                    {/* View Full Report Link */}
                    <Link
                        href="/reports/family-fee"
                        style={{
                            fontSize: 12, color: C.orange, fontWeight: 700,
                            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 8px', borderRadius: 6
                        }}
                        title="Open Family Fee Report"
                    >
                        Report <i className="bi bi-arrow-right-short" style={{ fontSize: 15 }} />
                    </Link>
                </div>
            </div>

            {/* Summary Row */}
            {collective && (
                <div style={{
                    display: 'flex', gap: 16, padding: '12px 24px', background: '#f8fafc',
                    borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', fontSize: 12
                }}>
                    <div>
                        <span style={{ color: '#64748b' }}>Month Target:</span>{' '}
                        <strong style={{ color: '#1e293b' }}>
                            {showAmounts ? fmtPKR(collective.total_billed) : 'Rs *****'}
                        </strong>
                    </div>
                    <div>
                        <span style={{ color: '#64748b' }}>Collected To-Date:</span>{' '}
                        <strong style={{ color: C.green }}>
                            {showAmounts ? fmtPKR(collective.total_collected) : 'Rs *****'}
                        </strong>
                    </div>
                    {Number(collective.total_advance || 0) > 0 && (
                        <div>
                            <span style={{ color: '#64748b' }}>Advance Surplus:</span>{' '}
                            <strong style={{ color: '#4338ca' }}>
                                {showAmounts ? `+${fmtPKR(collective.total_advance)}` : '+Rs *****'}
                            </strong>
                        </div>
                    )}
                    <div>
                        <span style={{ color: '#64748b' }}>Remaining Unpaid:</span>{' '}
                        <strong style={{ color: C.red }}>
                            {showAmounts ? fmtPKR(collective.total_pending) : 'Rs *****'}
                        </strong>
                    </div>
                    <div>
                        <span style={{ color: '#64748b' }}>Recovery Pace:</span>{' '}
                        <strong style={{ color: C.orange }}>
                            {showAmounts ? `${collective.collection_rate}%` : '**%'}
                        </strong>
                    </div>
                </div>
            )}

            {/* Chart Area */}
            <div style={{ padding: '18px 20px' }}>
                {loading ? (
                    <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                        <span className="spinner-border spinner-border-sm me-2" /> Loading Collection Velocity &amp; Financial Position Curve...
                    </div>
                ) : timeline.length === 0 ? (
                    <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                        <i className="bi bi-graph-up me-2" /> No fee collection records found for {monthLabel} {selectedYear}.
                    </div>
                ) : (
                    <>
                        {timelineView === 'cumulative' && (
                            <div style={{ width: '100%', height: 260 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                                    <AreaChart data={timeline} margin={{ top: 10, right: 16, left: 10, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="dashGradCum" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={C.green} stopOpacity={0.3} />
                                                <stop offset="100%" stopColor={C.green} stopOpacity={0.0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                                        <YAxis tickFormatter={v => showAmounts ? fmtShort(v) : '***'} tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip content={<CustomTimelineTooltip />} />
                                        {collective && collective.total_billed > 0 && (
                                            <ReferenceLine
                                                y={collective.total_billed}
                                                stroke="#94a3b8"
                                                strokeDasharray="3 3"
                                                label={{
                                                    value: showAmounts ? `Target: ${fmtShort(collective.total_billed)}` : 'Target: ***',
                                                    fill: '#64748b',
                                                    fontSize: 10,
                                                    position: 'top'
                                                }}
                                            />
                                        )}
                                        <Area
                                            type="monotone"
                                            dataKey="cumulative_collected"
                                            name="Cumulative Collected"
                                            stroke={C.green}
                                            strokeWidth={2.5}
                                            fill="url(#dashGradCum)"
                                            dot={{ r: 3, fill: '#fff', stroke: C.green, strokeWidth: 2 }}
                                            activeDot={{ r: 5, fill: C.green, stroke: '#fff', strokeWidth: 2 }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}

                        {timelineView === 'daily' && (
                            <div style={{ width: '100%', height: 260 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                                    <AreaChart data={timeline} margin={{ top: 10, right: 16, left: 10, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="dashGradDaily" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={C.orange} stopOpacity={0.35} />
                                                <stop offset="100%" stopColor={C.orange} stopOpacity={0.0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                                        <YAxis tickFormatter={v => showAmounts ? fmtShort(v) : '***'} tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip content={<CustomTimelineTooltip />} />
                                        <Area
                                            type="monotone"
                                            dataKey="daily_collected"
                                            name="Daily Inflow"
                                            stroke={C.orange}
                                            strokeWidth={2.5}
                                            fill="url(#dashGradDaily)"
                                            dot={{ r: 3, fill: '#fff', stroke: C.orange, strokeWidth: 2 }}
                                            activeDot={{ r: 5, fill: C.orange, stroke: '#fff', strokeWidth: 2 }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}

                        {timelineView === 'weekly' && (
                            <div style={{ width: '100%', height: 260 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                                    <BarChart data={weeklySummary} margin={{ top: 10, right: 16, left: 10, bottom: 0 }} barCategoryGap="30%">
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                        <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <YAxis tickFormatter={v => showAmounts ? fmtShort(v) : '***'} tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip
                                            formatter={(val: any) => [showAmounts ? fmtPKR(Number(val)) : 'Rs *****', 'Weekly Collected']}
                                            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 12, boxShadow: '0 10px 28px rgba(0,0,0,0.12)' }}
                                        />
                                        <Bar dataKey="collected" fill={C.teal} radius={[6, 6, 0, 0]} maxBarSize={36} name="Weekly Cash Flow" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
