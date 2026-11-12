'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { notify } from '@/app/utils/notify';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://shaheenschool.onrender.com';

interface ExtraHeadDraft {
    head_id: number | null;
    head_name: string;
    amount: string;
    note: string;
}

interface PlanHeadDraft {
    head_id: number;
    head_name: string;
    head_type: string;
    unit_amount: number;
    multiplier: number;
    amount: number;
    is_fine: boolean;
    checked: boolean;
}

interface Props {
    isOpen: boolean;
    studentId: number | string;
    onClose: () => void;
    onSuccess: () => void;
}

export default function StudentReactivationModal({ isOpen, studentId, onClose, onSuccess }: Props) {
    const router = useRouter();

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState<any>(null);
    const [result, setResult] = useState<any>(null);

    // Interactive Form State
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [targetClassId, setTargetClassId] = useState<string>('');
    const [targetSectionId, setTargetSectionId] = useState<string>('');
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [chargeCurrentMonth, setChargeCurrentMonth] = useState<boolean>(true);
    const [billingStrategy, setBillingStrategy] = useState<'reopen_supplement' | 'defer_next_month'>('reopen_supplement');

    const [tuitionAmount, setTuitionAmount] = useState<string>('0');
    const [tuitionMode, setTuitionMode] = useState<'set_total' | 'increment'>('set_total');
    const [savePermanentFee, setSavePermanentFee] = useState<boolean>(true);
    const [permanentFeeAmount, setPermanentFeeAmount] = useState<string>('0');

    const [issueDate, setIssueDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
    const [dueDate, setDueDate] = useState<string>(() => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

    const [oldBalanceAction, setOldBalanceAction] = useState<'carry_all' | 'waive_all' | 'partial'>('carry_all');
    const [carriedBalanceAmount, setCarriedBalanceAmount] = useState<string>('0');
    const [oldBalanceReason, setOldBalanceReason] = useState<string>('');

    const [planHeadDrafts, setPlanHeadDrafts] = useState<PlanHeadDraft[]>([]);
    const [extraHeads, setExtraHeads] = useState<ExtraHeadDraft[]>([]);
    const [applyAdvance, setApplyAdvance] = useState<boolean>(true);
    const [notes, setNotes] = useState<string>('');

    const loadPreview = async (overrideParams?: {
        month?: string;
        selectedIds?: number[];
        classId?: string;
        preserveUserEdits?: boolean;
    }) => {
        setLoading(true);
        setError('');
        try {
            const q = new URLSearchParams();
            const m = overrideParams?.month ?? selectedMonth;
            const sIds = overrideParams?.selectedIds ?? selectedIds;
            const cId = overrideParams?.classId ?? targetClassId;

            if (m) q.set('month', m);
            if (sIds && sIds.length > 0) q.set('selected_ids', sIds.join(','));
            if (cId) q.set('class_id', cId);

            const res = await fetch(`${API}/students/${studentId}/reactivation-preview?${q.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to inspect student billing context');

            setPreview(data);

            const bCase = data.billing_case;
            const targetStu = data.target_student;
            setSelectedIds(data.cohort?.selected_inactive_ids || [targetStu.student_id]);
            if (!overrideParams?.preserveUserEdits) {
                setTargetClassId(targetStu.class_id ? String(targetStu.class_id) : '');
                setTargetSectionId(targetStu.section_id ? String(targetStu.section_id) : '');
                setSelectedMonth(String(data.billing_period?.month || ''));
            } else if (!targetSectionId && targetStu.section_id) {
                setTargetSectionId(String(targetStu.section_id));
            }

            // Initialize suggested amounts per case
            if (bCase === 'CASE_3B_PAID_EXISTING') {
                setTuitionMode('increment');
                const inc = data.fee_suggestion?.suggested_increment ?? 0;
                setTuitionAmount(String(inc));
                const existingT = data.existing_slip?.existing_tuition_amount || 0;
                setPermanentFeeAmount(String(data.saved_family_fee > 0 ? data.saved_family_fee : existingT + inc));
                setBillingStrategy('reopen_supplement');
            } else if (bCase === 'CASE_3A_UNPAID_EXISTING') {
                setTuitionMode('set_total');
                const sug = data.fee_suggestion?.suggested_tuition ?? 0;
                setTuitionAmount(String(sug));
                setPermanentFeeAmount(String(data.saved_family_fee > 0 ? data.saved_family_fee : sug));
            } else {
                setTuitionMode('set_total');
                const sug = data.fee_suggestion?.suggested_tuition ?? 0;
                setTuitionAmount(String(sug));
                setPermanentFeeAmount(String(sug));
            }

            // Initialize plan heads
            const rawHeads = data.fee_suggestion?.plan_heads || [];
            setPlanHeadDrafts(
                rawHeads
                    .filter((h: any) => !h.is_tuition)
                    .map((h: any) => ({
                        head_id: h.head_id,
                        head_name: h.head_name,
                        head_type: h.head_type,
                        unit_amount: Number(h.unit_amount || 0),
                        multiplier: Number(h.multiplier || 1),
                        amount: bCase === 'CASE_3A_UNPAID_EXISTING' || bCase === 'CASE_3B_PAID_EXISTING'
                            ? Number(h.unit_amount || 0)
                            : Number(h.default_amount || 0),
                        is_fine: Boolean(h.is_fine),
                        checked: bCase === 'CASE_3A_UNPAID_EXISTING' || bCase === 'CASE_3B_PAID_EXISTING'
                            ? false
                            : Boolean(h.recommended_checked)
                    }))
            );

            setCarriedBalanceAmount(String(data.arrears?.total_arrears_payable || 0));
        } catch (err: any) {
            setError(err.message || 'Unable to load reactivation wizard');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        setResult(null);
        setExtraHeads([]);
        setOldBalanceAction('carry_all');
        setOldBalanceReason('');
        setNotes('');
        setChargeCurrentMonth(true);
        setApplyAdvance(true);
        setSavePermanentFee(true);
        setSelectedIds([]);
        setTargetClassId('');
        setTargetSectionId('');
        setSelectedMonth('');
        loadPreview({ month: '', selectedIds: [], classId: '', preserveUserEdits: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, studentId]);

    const handleToggleSibling = (sibId: number) => {
        if (preview && sibId === preview.target_student.student_id) return;
        const next = selectedIds.includes(sibId)
            ? selectedIds.filter(id => id !== sibId)
            : [...selectedIds, sibId];
        setSelectedIds(next);
        loadPreview({ selectedIds: next, preserveUserEdits: true });
    };

    const handleSelectAllInactive = () => {
        if (!preview?.siblings?.inactive) return;
        const allIds = preview.siblings.inactive.map((m: any) => m.student_id);
        setSelectedIds(allIds);
        loadPreview({ selectedIds: allIds, preserveUserEdits: true });
    };

    const handleMonthChange = (newMonth: string) => {
        setSelectedMonth(newMonth);
        loadPreview({ month: newMonth, preserveUserEdits: true });
    };

    const handleClassChange = (newClassId: string) => {
        setTargetClassId(newClassId);
        // Reset section when class changes unless section still belongs to new class
        const matchingSections = (preview?.sections || []).filter((s: any) => String(s.class_id) === newClassId);
        if (matchingSections.length > 0 && !matchingSections.some((s: any) => String(s.section_id) === targetSectionId)) {
            setTargetSectionId(String(matchingSections[0].section_id));
        } else if (matchingSections.length === 0) {
            setTargetSectionId('');
        }
        loadPreview({ classId: newClassId, preserveUserEdits: true });
    };

    const addExtraHeadPreset = (name: string, amt: string, headId: number | null = null) => {
        setExtraHeads(prev => [...prev, { head_id: headId, head_name: name, amount: amt, note: '' }]);
    };

    const liveCalculations = useMemo(() => {
        if (!preview) {
            return {
                tuitionCharge: 0,
                planHeadsCharge: 0,
                extraHeadsCharge: 0,
                arrearsAdded: 0,
                grossNewOrRevisedTotal: 0,
                advanceUsed: 0,
                netPayableAfterAdvance: 0
            };
        }

        const isTrusted = Boolean(preview.cohort?.is_trusted_after);
        const inputTuition = Math.max(0, parseFloat(tuitionAmount) || 0);
        const tuitionCharge = isTrusted ? 0 : inputTuition;

        const planHeadsCharge = planHeadDrafts
            .filter(h => h.checked && h.amount > 0)
            .reduce((s, h) => s + Number(h.amount || 0), 0);

        const extraHeadsCharge = extraHeads
            .filter(h => h.head_name.trim() && parseFloat(h.amount) > 0)
            .reduce((s, h) => s + parseFloat(h.amount), 0);

        const bCase = preview.billing_case;
        const arrearsPayable = Number(preview.arrears?.total_arrears_payable || 0);
        let keptArrears = arrearsPayable;
        if (oldBalanceAction === 'waive_all') keptArrears = 0;
        else if (oldBalanceAction === 'partial') keptArrears = Math.max(0, Math.min(arrearsPayable, parseFloat(carriedBalanceAmount) || 0));

        const availAdv = Number(preview.arrears?.advance_balance || 0);
        let gross = 0;

        if (!chargeCurrentMonth) {
            return {
                tuitionCharge: 0,
                planHeadsCharge: 0,
                extraHeadsCharge: 0,
                arrearsAdded: 0,
                grossNewOrRevisedTotal: 0,
                advanceUsed: 0,
                netPayableAfterAdvance: 0
            };
        }

        if (bCase === 'CASE_1_SOLO' || bCase === 'CASE_2_WHOLE_FAMILY') {
            const effectiveArrears = isTrusted ? Number(preview.arrears?.tracked_extra_sum || 0) : keptArrears;
            gross = tuitionCharge + planHeadsCharge + extraHeadsCharge + effectiveArrears;
            const advUsed = applyAdvance ? Math.min(availAdv, gross) : 0;
            return {
                tuitionCharge,
                planHeadsCharge,
                extraHeadsCharge,
                arrearsAdded: effectiveArrears,
                grossNewOrRevisedTotal: gross,
                advanceUsed: advUsed,
                netPayableAfterAdvance: Math.max(0, gross - advUsed)
            };
        }

        if (bCase === 'CASE_3A_UNPAID_EXISTING') {
            const ex = preview.existing_slip;
            const nonTuitionExisting = Math.max(
                0,
                Number(ex?.total_amount || 0) - Number(ex?.existing_tuition_amount || 0)
            );
            const exPb = Number(ex?.existing_pb_on_slip || 0);
            const pbDelta = isTrusted
                ? (oldBalanceAction !== 'carry_all' ? -exPb : 0)
                : (oldBalanceAction === 'waive_all'
                    ? -exPb
                    : oldBalanceAction === 'partial'
                        ? Math.min(0, keptArrears - exPb)
                        : 0);

            const revisedTotal = Math.max(
                0,
                (tuitionMode === 'increment' ? Number(ex?.existing_tuition_amount || 0) + tuitionCharge : tuitionCharge) +
                nonTuitionExisting +
                pbDelta +
                planHeadsCharge +
                extraHeadsCharge
            );
            const remBeforeAdv = Math.max(0, revisedTotal - Number(ex?.paid_amount || 0));
            const advUsed = applyAdvance ? Math.min(availAdv, remBeforeAdv) : 0;
            return {
                tuitionCharge,
                planHeadsCharge,
                extraHeadsCharge,
                arrearsAdded: Math.max(0, keptArrears),
                grossNewOrRevisedTotal: Math.max(0, revisedTotal - advUsed),
                advanceUsed: advUsed,
                netPayableAfterAdvance: Math.max(0, remBeforeAdv - advUsed)
            };
        }

        // CASE_3B_PAID_EXISTING
        const ex = preview.existing_slip;
        const supTuition = tuitionMode === 'set_total'
            ? Math.max(0, tuitionCharge - Number(ex?.existing_tuition_amount || 0))
            : tuitionCharge;
        const supplementGross = supTuition + planHeadsCharge + extraHeadsCharge;
        const advUsed = (billingStrategy === 'reopen_supplement' && applyAdvance)
            ? Math.min(availAdv, supplementGross)
            : 0;
        const netSup = Math.max(0, supplementGross - advUsed);
        return {
            tuitionCharge: supTuition,
            planHeadsCharge,
            extraHeadsCharge,
            arrearsAdded: 0,
            grossNewOrRevisedTotal: billingStrategy === 'reopen_supplement'
                ? Number(ex?.paid_amount || 0) + netSup
                : supplementGross,
            advanceUsed: advUsed,
            netPayableAfterAdvance: netSup
        };
    }, [
        preview,
        tuitionAmount,
        tuitionMode,
        planHeadDrafts,
        extraHeads,
        oldBalanceAction,
        carriedBalanceAmount,
        chargeCurrentMonth,
        applyAdvance,
        billingStrategy
    ]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!preview) return;
        setSubmitting(true);
        setError('');

        try {
            const payload = {
                student_ids: selectedIds,
                target_class_id: targetClassId ? parseInt(targetClassId, 10) : undefined,
                target_section_id: targetSectionId ? parseInt(targetSectionId, 10) : undefined,
                charge_current_month: chargeCurrentMonth,
                month: selectedMonth ? parseInt(selectedMonth, 10) : preview.billing_period?.month,
                year: preview.billing_period?.year,
                issue_date: issueDate,
                due_date: dueDate,
                billing_strategy: preview.billing_case === 'CASE_3B_PAID_EXISTING' ? billingStrategy : (preview.billing_case === 'CASE_3A_UNPAID_EXISTING' ? 'update_existing' : 'new_slip'),
                tuition_amount: Math.max(0, parseFloat(tuitionAmount) || 0),
                tuition_mode: tuitionMode,
                save_permanent_fee: savePermanentFee,
                permanent_fee_amount: savePermanentFee ? Math.max(0, parseFloat(permanentFeeAmount || tuitionAmount) || 0) : undefined,
                old_balance_action: oldBalanceAction,
                carried_balance_amount: oldBalanceAction === 'partial' ? Math.max(0, parseFloat(carriedBalanceAmount) || 0) : undefined,
                old_balance_reason: oldBalanceReason.trim() || undefined,
                plan_head_items: planHeadDrafts
                    .filter(h => h.checked && h.amount > 0)
                    .map(h => ({ head_id: h.head_id, head_name: h.head_name, amount: h.amount })),
                extra_heads: extraHeads
                    .filter(h => h.head_name.trim() && parseFloat(h.amount) > 0)
                    .map(h => ({
                        head_id: h.head_id,
                        head_name: h.head_name.trim(),
                        amount: parseFloat(h.amount),
                        note: h.note.trim() || undefined
                    })),
                apply_advance: applyAdvance,
                defer_target_month: preview.billing_period?.next_month_in_session?.month,
                defer_target_year: preview.billing_period?.next_month_in_session?.year,
                notes: notes.trim() || undefined
            };

            const res = await fetch(`${API}/students/${studentId}/reactivate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Reactivation failed');

            setResult(data);
            notify.success(`${data.activated_names} reactivated successfully!`);
            onSuccess();
        } catch (err: any) {
            setError(err.message || 'Failed to complete reactivation');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const filteredSections = (preview?.sections || []).filter(
        (s: any) => !targetClassId || String(s.class_id) === String(targetClassId)
    );

    const caseBadgeInfo = (bCase: string) => {
        switch (bCase) {
            case 'CASE_1_SOLO':
                return { label: 'Case 1: Solo Student Return', color: '#0d6efd', bg: '#e7f1ff', desc: 'No existing voucher this month — will generate a clean individual/student voucher.' };
            case 'CASE_2_WHOLE_FAMILY':
                return { label: 'Case 2: Whole Family Return', color: '#198754', bg: '#d1e7dd', desc: 'No existing voucher this month — will recalculate Lead student and issue one consolidated Family Voucher.' };
            case 'CASE_3A_UNPAID_EXISTING':
                return { label: 'Case 3A: Existing Unpaid / Partial Family Slip', color: '#995c00', bg: '#fff3cd', desc: 'Active sibling already has an unpaid/partial voucher — will update it in-place without creating duplicates.' };
            case 'CASE_3B_PAID_EXISTING':
                return { label: 'Case 3B: Active Sibling Slip Already Paid', color: '#6f42c1', bg: '#f3ebff', desc: 'Active sibling already paid this month — choose to re-open with a balance supplement or defer to next month.' };
            default:
                return { label: 'Smart Reactivation', color: '#195053', bg: '#e9f5f5', desc: '' };
        }
    };

    const badge = preview ? caseBadgeInfo(preview.billing_case) : null;

    return (
        <>
            <div className="modal-backdrop fade show" style={{ zIndex: 1050 }} onClick={() => !submitting && onClose()} />
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1055 }}>
                <div className="modal-dialog modal-xl modal-dialog-scrollable modal-dialog-centered">
                    <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
                        {/* HEADER */}
                        <div className="modal-header text-white border-0 px-4 py-3" style={{ background: 'linear-gradient(135deg, #195053 0%, #215e61 100%)' }}>
                            <div>
                                <h5 className="modal-title fw-bold mb-0">
                                    <i className="bi bi-person-check-fill me-2"></i>
                                    Smart Student Reactivation & Mid-Month Billing
                                </h5>
                                {preview?.target_student && (
                                    <small className="text-white-50">
                                        {preview.target_student.full_name} ({preview.target_student.admission_no})
                                        {preview.family_id ? ` • Family: ${preview.family_id}` : ' • Solo Account'}
                                    </small>
                                )}
                            </div>
                            <button type="button" className="btn-close btn-close-white" onClick={onClose} disabled={submitting}></button>
                        </div>

                        {/* BODY */}
                        <div className="modal-body p-4 bg-light">
                            {loading && !preview ? (
                                <div className="text-center py-5">
                                    <div className="spinner-border text-primary mb-3" />
                                    <p className="text-muted mb-0">Inspecting family structure, current-month vouchers, and fee ledger...</p>
                                </div>
                            ) : result ? (
                                /* SUCCESS VIEW */
                                <div className="card border-0 shadow-sm rounded-4 p-4 text-center bg-white">
                                    <div className="mx-auto mb-3 rounded-circle bg-success bg-opacity-10 text-success d-flex align-items-center justify-content-center" style={{ width: 68, height: 68 }}>
                                        <i className="bi bi-check2-circle fs-1"></i>
                                    </div>
                                    <h4 className="fw-bold text-dark mb-1">Reactivation Completed!</h4>
                                    <p className="text-muted mb-3">
                                        Activated: <strong className="text-dark">{result.activated_names}</strong>
                                        {result.lead_student && (
                                            <> • Active Family Lead: <strong className="text-primary">{result.lead_student.first_name} {result.lead_student.last_name}</strong> ({result.lead_student.class_name})</>
                                        )}
                                    </p>

                                    {result.billing_case === 'ACTIVATE_ONLY' && (
                                        <div className="alert alert-info text-start mx-auto" style={{ maxWidth: 620 }}>
                                            <i className="bi bi-info-circle-fill me-2"></i>
                                            Student(s) marked <strong>Active</strong> without issuing a monthly voucher for this month. They will automatically appear in next month&apos;s batch generation.
                                        </div>
                                    )}

                                    {result.billing_case === 'CASE_3B_DEFER_NEXT_MONTH' && (
                                        <div className="alert alert-primary text-start mx-auto" style={{ maxWidth: 620 }}>
                                            <i className="bi bi-calendar-plus-fill me-2"></i>
                                            Paid voucher <strong>#{result.slip?.slip_id}</strong> stayed untouched. <strong>{result.pending_adjustments_created}</strong> supplementary adjustment line(s) have been queued and will auto-inject on the next monthly generation.
                                        </div>
                                    )}

                                    {result.slip && result.billing_case !== 'CASE_3B_DEFER_NEXT_MONTH' && (
                                        <div className="border rounded-4 p-3 bg-light mx-auto mb-4 text-start" style={{ maxWidth: 640 }}>
                                            <div className="d-flex justify-content-between align-items-center mb-2">
                                                <span className="badge bg-dark">Slip #{result.slip.slip_id}</span>
                                                <span className={`badge ${result.slip.status === 'paid' || result.slip.status === 'satteled' ? 'bg-success' : result.slip.status === 'partial' ? 'bg-warning text-dark' : 'bg-danger'}`}>
                                                    {(result.slip.status || '').toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="row g-2 small">
                                                <div className="col-4">
                                                    <span className="text-muted d-block">Total Bill</span>
                                                    <strong className="fs-6">PKR {Number(result.slip.total_amount || 0).toLocaleString()}</strong>
                                                </div>
                                                <div className="col-4">
                                                    <span className="text-muted d-block">Paid So Far</span>
                                                    <strong className="fs-6 text-success">PKR {Number(result.slip.paid_amount || 0).toLocaleString()}</strong>
                                                </div>
                                                <div className="col-4">
                                                    <span className="text-muted d-block">Balance Due</span>
                                                    <strong className="fs-6 text-danger">
                                                        PKR {Math.max(0, Number(result.slip.total_amount || 0) - Number(result.slip.paid_amount || 0)).toLocaleString()}
                                                    </strong>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="d-flex flex-wrap justify-content-center gap-2 mt-2">
                                        {result.slip && result.billing_case !== 'CASE_3B_DEFER_NEXT_MONTH' && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn-primary px-4 fw-semibold"
                                                    onClick={() => {
                                                        onClose();
                                                        router.push(`/fees/print?month=${result.month}&year=${result.year}`);
                                                    }}
                                                >
                                                    <i className="bi bi-printer-fill me-2"></i>Print Voucher
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-success px-4 fw-semibold"
                                                    onClick={() => {
                                                        onClose();
                                                        const q = result.lead_student?.admission_no || preview?.target_student?.admission_no || '';
                                                        router.push(`/fees/collect?search=${encodeURIComponent(q)}`);
                                                    }}
                                                >
                                                    <i className="bi bi-cash-coin me-2"></i>Collect Fee Now
                                                </button>
                                            </>
                                        )}
                                        <button type="button" className="btn btn-outline-secondary px-4 fw-semibold" onClick={onClose}>
                                            Done & Refresh Profile
                                        </button>
                                    </div>
                                </div>
                            ) : preview ? (
                                <form id="reactivationForm" onSubmit={handleSubmit}>
                                    {error && (
                                        <div className="alert alert-danger d-flex align-items-center gap-2 mb-3">
                                            <i className="bi bi-exclamation-triangle-fill"></i>
                                            <span>{error}</span>
                                        </div>
                                    )}

                                    {/* CASE BANNER */}
                                    {badge && (
                                        <div className="rounded-4 p-3 mb-3 border d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2" style={{ backgroundColor: badge.bg, borderColor: `${badge.color}40` }}>
                                            <div>
                                                <span className="badge rounded-pill mb-1" style={{ backgroundColor: badge.color }}>{badge.label}</span>
                                                <div className="small text-dark fw-medium">{badge.desc}</div>
                                            </div>
                                            <div className="text-md-end flex-shrink-0">
                                                <span className={`badge ${preview.billing_period?.batch_slips_in_month > 0 ? 'bg-info text-dark' : 'bg-secondary'}`}>
                                                    {preview.billing_period?.batch_slips_in_month > 0
                                                        ? `${preview.billing_period.label}: ${preview.billing_period.batch_slips_in_month} vouchers already issued`
                                                        : `${preview.billing_period?.label}: Batch not yet issued`}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {preview.cohort?.mixed_trusted_warning && (
                                        <div className="alert alert-warning d-flex align-items-start gap-2 small mb-3">
                                            <i className="bi bi-shield-exclamation fs-5 mt-0.5"></i>
                                            <div>
                                                <strong>Mixed Trusted & Normal Family Detected:</strong> One sibling has Trusted category while another is Normal. Whole-family tuition exemption only applies when <strong>all</strong> active siblings are Trusted — this family voucher will charge normal tuition.
                                            </div>
                                        </div>
                                    )}

                                    {/* STEP 1: CLASS CONFIRMATION & FAMILY SIBLINGS */}
                                    <div className="card border-0 shadow-sm rounded-4 mb-3">
                                        <div className="card-header bg-white border-bottom py-2 px-3 d-flex justify-content-between align-items-center">
                                            <span className="fw-bold small text-uppercase text-secondary">
                                                <i className="bi bi-1-circle-fill me-2 text-primary"></i>Class Placement & Returning Members
                                            </span>
                                            <span className="badge bg-light text-dark border">
                                                Lead Will Be: <strong className="text-primary">{preview.cohort?.simulated_lead?.full_name}</strong> ({preview.cohort?.simulated_lead?.class_name})
                                                {preview.cohort?.lead_will_change && <span className="ms-1 text-warning">• Shift!</span>}
                                            </span>
                                        </div>
                                        <div className="card-body p-3">
                                            <div className="row g-3 align-items-end">
                                                <div className="col-md-4">
                                                    <label className="form-label small fw-bold text-muted mb-1">Confirm Class for {preview.target_student.first_name}</label>
                                                    <select
                                                        className="form-select form-select-sm"
                                                        value={targetClassId}
                                                        onChange={e => handleClassChange(e.target.value)}
                                                    >
                                                        {(preview.classes || []).map((c: any) => (
                                                            <option key={c.class_id} value={c.class_id}>{c.class_name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="col-md-4">
                                                    <label className="form-label small fw-bold text-muted mb-1">Confirm Section</label>
                                                    <select
                                                        className="form-select form-select-sm"
                                                        value={targetSectionId}
                                                        onChange={e => setTargetSectionId(e.target.value)}
                                                    >
                                                        <option value="">Default / Keep Current</option>
                                                        {filteredSections.map((s: any) => (
                                                            <option key={s.section_id} value={s.section_id}>{s.section_name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="col-md-4">
                                                    <label className="form-label small fw-bold text-muted mb-1">Target Billing Month</label>
                                                    <select
                                                        className="form-select form-select-sm"
                                                        value={selectedMonth}
                                                        onChange={e => handleMonthChange(e.target.value)}
                                                    >
                                                        {(preview.billing_period?.available_months || []).map((m: any) => (
                                                            <option key={m.month} value={m.month}>{m.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Inactive Siblings Multi-Select (Case 2 / Partial Family) */}
                                            {(preview.siblings?.inactive?.length || 0) > 1 && (
                                                <div className="mt-3 pt-3 border-top">
                                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                                        <span className="small fw-bold text-dark">
                                                            <i className="bi bi-people-fill me-1 text-success"></i>
                                                            Other Inactive Siblings Found in Family ({preview.siblings.inactive.length} total inactive)
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="btn btn-sm btn-outline-success py-0 px-2"
                                                            onClick={handleSelectAllInactive}
                                                        >
                                                            Select All Inactive Siblings
                                                        </button>
                                                    </div>
                                                    <div className="row g-2">
                                                        {preview.siblings.inactive.map((sib: any) => {
                                                            const checked = selectedIds.includes(sib.student_id);
                                                            return (
                                                                <div className="col-md-6 col-lg-4" key={sib.student_id}>
                                                                    <label
                                                                        className={`d-flex align-items-center gap-2 p-2 rounded-3 border w-100 ${checked ? 'border-success bg-success bg-opacity-10' : 'bg-white'}`}
                                                                        style={{ cursor: sib.is_target ? 'default' : 'pointer' }}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            className="form-check-input mt-0"
                                                                            checked={checked}
                                                                            disabled={sib.is_target}
                                                                            onChange={() => handleToggleSibling(sib.student_id)}
                                                                        />
                                                                        <div className="small lh-sm">
                                                                            <div className="fw-bold text-dark">
                                                                                {sib.full_name}
                                                                                {sib.is_target && <span className="badge bg-primary ms-1" style={{ fontSize: '0.62rem' }}>Current</span>}
                                                                            </div>
                                                                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                                                {sib.class_name} • Fee: PKR {Number(sib.monthly_fee || 0).toLocaleString()}
                                                                            </div>
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Already Active Siblings Display */}
                                            {(preview.siblings?.active?.length || 0) > 0 && (
                                                <div className="mt-2 pt-2 border-top d-flex flex-wrap align-items-center gap-2 small">
                                                    <span className="text-muted fw-semibold">Already Active Siblings:</span>
                                                    {preview.siblings.active.map((a: any) => (
                                                        <span key={a.student_id} className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">
                                                            {a.full_name} ({a.class_name})
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* STEP 2: BILL THIS MONTH OR ACTIVATE ONLY */}
                                    <div className="card border-0 shadow-sm rounded-4 mb-3">
                                        <div className="card-header bg-white border-bottom py-2 px-3 fw-bold small text-uppercase text-secondary">
                                            <i className="bi bi-2-circle-fill me-2 text-primary"></i>Current Month Fee Action ({preview.billing_period?.label})
                                        </div>
                                        <div className="card-body p-3">
                                            <div className="row g-2">
                                                <div className="col-md-6">
                                                    <label className={`p-3 rounded-3 border d-block h-100 ${chargeCurrentMonth ? 'border-primary bg-primary bg-opacity-10' : 'bg-white'}`} style={{ cursor: 'pointer' }}>
                                                        <div className="form-check">
                                                            <input
                                                                className="form-check-input"
                                                                type="radio"
                                                                checked={chargeCurrentMonth}
                                                                onChange={() => setChargeCurrentMonth(true)}
                                                            />
                                                            <span className="form-check-label fw-bold text-dark">
                                                                {preview.billing_case === 'CASE_3A_UNPAID_EXISTING'
                                                                    ? `Update Family Voucher #${preview.existing_slip?.slip_id} Now`
                                                                    : preview.billing_case === 'CASE_3B_PAID_EXISTING'
                                                                        ? `Bill Sibling Addition for ${preview.billing_period?.label}`
                                                                        : `Generate ${preview.billing_period?.label} Fee Voucher Now`}
                                                            </span>
                                                        </div>
                                                        <small className="text-muted d-block ms-4 mt-1">
                                                            Charge full or pro-rata tuition, manage old balance, and add optional Re-Admission/other heads.
                                                        </small>
                                                    </label>
                                                </div>
                                                <div className="col-md-6">
                                                    <label className={`p-3 rounded-3 border d-block h-100 ${!chargeCurrentMonth ? 'border-secondary bg-secondary bg-opacity-10' : 'bg-white'}`} style={{ cursor: 'pointer' }}>
                                                        <div className="form-check">
                                                            <input
                                                                className="form-check-input"
                                                                type="radio"
                                                                checked={!chargeCurrentMonth}
                                                                onChange={() => setChargeCurrentMonth(false)}
                                                            />
                                                            <span className="form-check-label fw-bold text-dark">
                                                                Activate Only (Do Not Bill {preview.billing_period?.month_name})
                                                            </span>
                                                        </div>
                                                        <small className="text-muted d-block ms-4 mt-1">
                                                            Marks student(s) Active for attendance & future months without generating/modifying this month&apos;s bill.
                                                        </small>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* CASE 3B STRATEGY CHOICE */}
                                    {chargeCurrentMonth && preview.billing_case === 'CASE_3B_PAID_EXISTING' && (
                                        <div className="card border-0 shadow-sm rounded-4 mb-3 border-start border-4 border-primary">
                                            <div className="card-body p-3">
                                                <div className="d-flex justify-content-between align-items-center mb-2">
                                                    <h6 className="fw-bold mb-0 text-dark">
                                                        Paid Receipt Protection (Slip #{preview.existing_slip?.slip_id})
                                                    </h6>
                                                    <span className="badge bg-success">
                                                        Paid: PKR {Number(preview.existing_slip?.paid_amount || 0).toLocaleString()}
                                                    </span>
                                                </div>
                                                <div className="row g-2">
                                                    <div className="col-md-6">
                                                        <label className={`p-2 rounded-3 border d-block ${billingStrategy === 'reopen_supplement' ? 'border-primary bg-primary bg-opacity-10' : ''}`} style={{ cursor: 'pointer' }}>
                                                            <div className="form-check">
                                                                <input
                                                                    type="radio"
                                                                    className="form-check-input"
                                                                    checked={billingStrategy === 'reopen_supplement'}
                                                                    onChange={() => setBillingStrategy('reopen_supplement')}
                                                                />
                                                                <span className="form-check-label fw-bold small">Re-Open Slip & Issue Balance Voucher (Recommended)</span>
                                                            </div>
                                                            <small className="text-muted d-block ms-4">Past receipt stays safe; only returning sibling share is added so remaining balance can be printed & collected today.</small>
                                                        </label>
                                                    </div>
                                                    <div className="col-md-6">
                                                        <label
                                                            className={`p-2 rounded-3 border d-block ${billingStrategy === 'defer_next_month' ? 'border-primary bg-primary bg-opacity-10' : ''} ${!preview.billing_period?.has_next_month_in_session ? 'opacity-50' : ''}`}
                                                            style={{ cursor: preview.billing_period?.has_next_month_in_session ? 'pointer' : 'not-allowed' }}
                                                        >
                                                            <div className="form-check">
                                                                <input
                                                                    type="radio"
                                                                    className="form-check-input"
                                                                    disabled={!preview.billing_period?.has_next_month_in_session}
                                                                    checked={billingStrategy === 'defer_next_month'}
                                                                    onChange={() => setBillingStrategy('defer_next_month')}
                                                                />
                                                                <span className="form-check-label fw-bold small">
                                                                    Leave Paid Slip & Add to Next Month ({preview.billing_period?.next_month_in_session?.label || 'End of Session'})
                                                                </span>
                                                            </div>
                                                            <small className="text-muted d-block ms-4">
                                                                {preview.billing_period?.has_next_month_in_session
                                                                    ? `Queues returning share into ${preview.billing_period.next_month_in_session.label}'s voucher automatically.`
                                                                    : 'No remaining month in active session — use Immediate Balance Voucher.'}
                                                            </small>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* STEP 3: TUITION, DATES & PLAN HEADS */}
                                    {chargeCurrentMonth && (
                                        <div className="card border-0 shadow-sm rounded-4 mb-3">
                                            <div className="card-header bg-white border-bottom py-2 px-3 fw-bold small text-uppercase text-secondary">
                                                <i className="bi bi-3-circle-fill me-2 text-primary"></i>Monthly Tuition & Fee Plan Heads
                                            </div>
                                            <div className="card-body p-3">
                                                {preview.billing_case === 'CASE_3A_UNPAID_EXISTING' && (
                                                    <div className="alert alert-light border small py-2 mb-3 d-flex flex-wrap justify-content-between gap-2">
                                                        <span>Existing Slip <strong>#{preview.existing_slip?.slip_id}</strong> ({preview.existing_slip?.status?.toUpperCase()})</span>
                                                        <span>Old Tuition: <strong>PKR {Number(preview.existing_slip?.existing_tuition_amount || 0).toLocaleString()}</strong></span>
                                                        <span>Already Paid: <strong className="text-success">PKR {Number(preview.existing_slip?.paid_amount || 0).toLocaleString()}</strong></span>
                                                    </div>
                                                )}

                                                <div className="row g-3 align-items-end">
                                                    <div className="col-md-5">
                                                        <label className="form-label small fw-bold text-dark mb-1">
                                                            {preview.billing_case === 'CASE_3B_PAID_EXISTING'
                                                                ? 'Supplementary Sibling Tuition Addition (PKR)'
                                                                : (preview.family_id && (selectedIds.length > 1 || (preview.siblings?.active?.length || 0) > 0 || preview.saved_family_fee > 0))
                                                                    ? 'Family Monthly Fee for This Month (PKR)'
                                                                    : 'Student Monthly Tuition Fee (PKR)'}
                                                        </label>
                                                        {preview.cohort?.is_trusted_after && (
                                                            <span className="badge bg-info text-dark mb-1 d-inline-block">Trusted Category — Tuition Free (Rs 0 billed)</span>
                                                        )}
                                                        <div className="input-group">
                                                            <span className="input-group-text">PKR</span>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step="1"
                                                                className="form-control fw-bold"
                                                                value={tuitionAmount}
                                                                onChange={e => setTuitionAmount(e.target.value)}
                                                            />
                                                        </div>
                                                        <div className="d-flex flex-wrap gap-1 mt-1" style={{ fontSize: '0.72rem' }}>
                                                            {preview.saved_family_fee > 0 && (
                                                                <span className="badge bg-light text-dark border">Saved Family Fee: {Number(preview.saved_family_fee).toLocaleString()}</span>
                                                            )}
                                                            {preview.fee_suggestion?.plan_tuition_amount > 0 && (
                                                                <span className="badge bg-light text-dark border">Plan Tuition: {Number(preview.fee_suggestion.plan_tuition_amount).toLocaleString()}</span>
                                                            )}
                                                            {preview.fee_suggestion?.last_billed_tuition > 0 && (
                                                                <span className="badge bg-light text-dark border">Last Billed ({preview.fee_suggestion.last_billed_month_label}): {Number(preview.fee_suggestion.last_billed_tuition).toLocaleString()}</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="col-md-4">
                                                        <label className="form-check-label d-flex align-items-center gap-2 small fw-bold text-dark mb-1" style={{ cursor: 'pointer' }}>
                                                            <input
                                                                type="checkbox"
                                                                className="form-check-input mt-0"
                                                                checked={savePermanentFee}
                                                                onChange={e => setSavePermanentFee(e.target.checked)}
                                                            />
                                                            Save Future Monthly Fee
                                                        </label>
                                                        <div className="input-group">
                                                            <span className="input-group-text">PKR</span>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step="1"
                                                                disabled={!savePermanentFee}
                                                                className="form-control"
                                                                value={permanentFeeAmount}
                                                                onChange={e => setPermanentFeeAmount(e.target.value)}
                                                            />
                                                        </div>
                                                        <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                                                            Allows charging pro-rata this month while storing regular fee for next month.
                                                        </small>
                                                    </div>

                                                    {(preview.billing_case === 'CASE_1_SOLO' || preview.billing_case === 'CASE_2_WHOLE_FAMILY') && (
                                                        <div className="col-md-3">
                                                            <label className="form-label small fw-bold text-muted mb-1">Due Date</label>
                                                            <input
                                                                type="date"
                                                                className="form-control form-control-sm mb-1"
                                                                value={dueDate}
                                                                onChange={e => setDueDate(e.target.value)}
                                                            />
                                                            <small className="text-muted" style={{ fontSize: '0.68rem' }}>Issue: {issueDate}</small>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Non-Tuition Fee Plan Heads */}
                                                {planHeadDrafts.length > 0 && (
                                                    <div className="mt-3 pt-3 border-top">
                                                        <div className="small fw-bold text-muted mb-2">
                                                            Fee Plan Heads ({preview.fee_suggestion?.plan?.plan_name || 'Class Plan'}):
                                                        </div>
                                                        <div className="row g-2">
                                                            {planHeadDrafts.map((ph, idx) => (
                                                                <div className="col-md-4" key={ph.head_id}>
                                                                    <div className={`p-2 rounded-3 border ${ph.checked ? 'border-primary bg-primary bg-opacity-10' : 'bg-white'}`}>
                                                                        <label className="d-flex align-items-center gap-2 small fw-semibold mb-1" style={{ cursor: 'pointer' }}>
                                                                            <input
                                                                                type="checkbox"
                                                                                className="form-check-input mt-0"
                                                                                checked={ph.checked}
                                                                                onChange={e => setPlanHeadDrafts(prev => prev.map((x, i) => i === idx ? { ...x, checked: e.target.checked } : x))}
                                                                            />
                                                                            <span className="text-truncate">{ph.head_name}</span>
                                                                            {ph.is_fine && <span className="badge bg-warning text-dark" style={{ fontSize: '0.62rem' }}>Fine</span>}
                                                                        </label>
                                                                        <input
                                                                            type="number"
                                                                            min={0}
                                                                            disabled={!ph.checked}
                                                                            className="form-control form-control-sm"
                                                                            value={ph.amount}
                                                                            onChange={e => setPlanHeadDrafts(prev => prev.map((x, i) => i === idx ? { ...x, amount: Math.max(0, parseFloat(e.target.value) || 0) } : x))}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* STEP 4: OLD BALANCE & ADVANCE WALLET */}
                                    {((preview.arrears?.total_arrears_payable || 0) > 0 || (preview.arrears?.advance_balance || 0) > 0) && (
                                        <div className="card border-0 shadow-sm rounded-4 mb-3">
                                            <div className="card-header bg-white border-bottom py-2 px-3 fw-bold small text-uppercase text-secondary">
                                                <i className="bi bi-4-circle-fill me-2 text-primary"></i>Previous Unpaid Balance & Advance Credit
                                            </div>
                                            <div className="card-body p-3">
                                                {(preview.arrears?.total_arrears_payable || 0) > 0 && (
                                                    <div className="mb-3">
                                                        <div className="d-flex flex-wrap justify-content-between align-items-center mb-2">
                                                            <div>
                                                                <span className="fw-bold text-danger">
                                                                    Outstanding Prior Arrears: PKR {Number(preview.arrears.total_arrears_payable).toLocaleString()}
                                                                </span>
                                                                <span className="text-muted small ms-2">
                                                                    (OPB: PKR {Number(preview.arrears.opb_remaining || 0).toLocaleString()} • Unpaid Prior Slips: {preview.arrears.unpaid_prior_slips?.length || 0})
                                                                </span>
                                                            </div>
                                                            {(preview.billing_case === 'CASE_3A_UNPAID_EXISTING' || preview.billing_case === 'CASE_3B_PAID_EXISTING') && (
                                                                <span className="badge bg-secondary">
                                                                    Current Slip PB: PKR {Number(preview.existing_slip?.existing_pb_on_slip || 0).toLocaleString()}
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div className="d-flex flex-wrap gap-2">
                                                            {[
                                                                { id: 'carry_all', label: 'Keep / Carry Forward', icon: 'bi-arrow-right-circle' },
                                                                { id: 'waive_all', label: 'Waive Old Balance to 0 Forever', icon: 'bi-eraser-fill' },
                                                                { id: 'partial', label: 'Partial Carry Only', icon: 'bi-sliders' }
                                                            ].map(opt => (
                                                                <button
                                                                    key={opt.id}
                                                                    type="button"
                                                                    className={`btn btn-sm ${oldBalanceAction === opt.id ? (opt.id === 'waive_all' ? 'btn-danger' : 'btn-primary') : 'btn-outline-secondary'}`}
                                                                    onClick={() => setOldBalanceAction(opt.id as any)}
                                                                >
                                                                    <i className={`bi ${opt.icon} me-1`}></i>{opt.label}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        {oldBalanceAction === 'partial' && (
                                                            <div className="row g-2 mt-2 align-items-center">
                                                                <div className="col-md-4">
                                                                    <label className="form-label small fw-bold mb-1">Amount to Carry Forward (PKR)</label>
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        max={preview.arrears.total_arrears_payable}
                                                                        className="form-control form-control-sm"
                                                                        value={carriedBalanceAmount}
                                                                        onChange={e => setCarriedBalanceAmount(e.target.value)}
                                                                    />
                                                                </div>
                                                                <div className="col-md-8">
                                                                    <label className="form-label small fw-bold mb-1">Waiver / Agreement Note</label>
                                                                    <input
                                                                        type="text"
                                                                        className="form-control form-control-sm"
                                                                        placeholder="e.g. Discount agreed by Principal"
                                                                        value={oldBalanceReason}
                                                                        onChange={e => setOldBalanceReason(e.target.value)}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}

                                                        {oldBalanceAction === 'waive_all' && (
                                                            <div className="mt-2">
                                                                <input
                                                                    type="text"
                                                                    className="form-control form-control-sm"
                                                                    placeholder="Optional reason for waiving prior unpaid dues (stored on audit notes)"
                                                                    value={oldBalanceReason}
                                                                    onChange={e => setOldBalanceReason(e.target.value)}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {(preview.arrears?.advance_balance || 0) > 0 && chargeCurrentMonth && (
                                                    <div className="alert alert-success py-2 px-3 mb-0 d-flex align-items-center justify-content-between">
                                                        <label className="form-check-label d-flex align-items-center gap-2 small fw-semibold mb-0" style={{ cursor: 'pointer' }}>
                                                            <input
                                                                type="checkbox"
                                                                className="form-check-input mt-0"
                                                                checked={applyAdvance}
                                                                onChange={e => setApplyAdvance(e.target.checked)}
                                                            />
                                                            Auto-Apply Available Advance Credit: <strong>PKR {Number(preview.arrears.advance_balance).toLocaleString()}</strong>
                                                        </label>
                                                        {liveCalculations.advanceUsed > 0 && (
                                                            <span className="badge bg-success">- PKR {liveCalculations.advanceUsed.toLocaleString()} applied</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* STEP 5: EXTRA CUSTOM HEADS & NOTES */}
                                    {chargeCurrentMonth && (
                                        <div className="card border-0 shadow-sm rounded-4 mb-3">
                                            <div className="card-header bg-white border-bottom py-2 px-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
                                                <span className="fw-bold small text-uppercase text-secondary">
                                                    <i className="bi bi-5-circle-fill me-2 text-primary"></i>Additional Heads (Re-Admission Fee, Exam, Transport, etc.)
                                                </span>
                                                <div className="d-flex gap-1">
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-outline-primary py-0 px-2"
                                                        onClick={() => addExtraHeadPreset('Re-Admission Fee', '500', null)}
                                                    >
                                                        + Re-Admission Fee
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-outline-secondary py-0 px-2"
                                                        onClick={() => addExtraHeadPreset('', '', null)}
                                                    >
                                                        + Other Head
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="card-body p-3">
                                                {extraHeads.length === 0 ? (
                                                    <p className="text-muted small mb-0">No extra charges added. Click &quot;+ Re-Admission Fee&quot; or &quot;+ Other Head&quot; if needed (never overwrites original admission history).</p>
                                                ) : (
                                                    <div className="d-flex flex-column gap-2">
                                                        {extraHeads.map((eh, idx) => (
                                                            <div className="row g-2 align-items-center" key={idx}>
                                                                <div className="col-md-4">
                                                                    <input
                                                                        type="text"
                                                                        list="feeHeadsSuggestList"
                                                                        className="form-control form-control-sm"
                                                                        placeholder="Head Name (e.g. Re-Admission Fee)"
                                                                        value={eh.head_name}
                                                                        onChange={e => {
                                                                            const val = e.target.value;
                                                                            const matched = (preview.available_fee_heads || []).find((f: any) => f.head_name.toLowerCase() === val.trim().toLowerCase());
                                                                            setExtraHeads(prev => prev.map((x, i) => i === idx ? { ...x, head_name: val, head_id: matched ? matched.head_id : null } : x));
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="col-md-3">
                                                                    <div className="input-group input-group-sm">
                                                                        <span className="input-group-text">PKR</span>
                                                                        <input
                                                                            type="number"
                                                                            min={0}
                                                                            className="form-control"
                                                                            placeholder="Amount"
                                                                            value={eh.amount}
                                                                            onChange={e => setExtraHeads(prev => prev.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="col-md-4">
                                                                    <input
                                                                        type="text"
                                                                        className="form-control form-control-sm"
                                                                        placeholder="Optional note"
                                                                        value={eh.note}
                                                                        onChange={e => setExtraHeads(prev => prev.map((x, i) => i === idx ? { ...x, note: e.target.value } : x))}
                                                                    />
                                                                </div>
                                                                <div className="col-md-1 text-end">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-sm btn-outline-danger"
                                                                        onClick={() => setExtraHeads(prev => prev.filter((_, i) => i !== idx))}
                                                                    >
                                                                        <i className="bi bi-trash"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <datalist id="feeHeadsSuggestList">
                                                    <option value="Re-Admission Fee" />
                                                    {(preview.available_fee_heads || []).map((fh: any) => (
                                                        <option key={fh.head_id} value={fh.head_name} />
                                                    ))}
                                                </datalist>

                                                <div className="mt-3">
                                                    <input
                                                        type="text"
                                                        className="form-control form-control-sm"
                                                        placeholder="Internal remark / reason for reactivation (optional)"
                                                        value={notes}
                                                        onChange={e => setNotes(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </form>
                            ) : (
                                <div className="alert alert-danger mb-0">{error || 'Unable to load preview'}</div>
                            )}
                        </div>

                        {/* FOOTER */}
                        {!result && preview && (
                            <div className="modal-footer bg-white border-top px-4 py-3 d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3">
                                <div className="d-flex flex-wrap gap-3 align-items-center small">
                                    <div>
                                        <span className="text-muted d-block">Activating</span>
                                        <strong className="text-dark">{selectedIds.length} Student(s)</strong>
                                    </div>
                                    {chargeCurrentMonth && (
                                        <>
                                            <div className="vr d-none d-md-block" />
                                            <div>
                                                <span className="text-muted d-block">
                                                    {preview.billing_case === 'CASE_3B_PAID_EXISTING' && billingStrategy === 'defer_next_month'
                                                        ? `Queued for ${preview.billing_period?.next_month_in_session?.label}`
                                                        : 'Net Payable Now'}
                                                </span>
                                                <strong className="fs-5 text-primary">
                                                    PKR {liveCalculations.netPayableAfterAdvance.toLocaleString()}
                                                </strong>
                                            </div>
                                            {liveCalculations.advanceUsed > 0 && (
                                                <div>
                                                    <span className="text-muted d-block">Advance Deducted</span>
                                                    <strong className="text-success">-PKR {liveCalculations.advanceUsed.toLocaleString()}</strong>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>

                                <div className="d-flex gap-2">
                                    <button type="button" className="btn btn-light px-4" onClick={onClose} disabled={submitting}>
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        form="reactivationForm"
                                        className="btn btn-success px-4 fw-bold shadow-sm"
                                        disabled={submitting || loading}
                                    >
                                        {submitting ? (
                                            <><span className="spinner-border spinner-border-sm me-2"></span>Processing...</>
                                        ) : chargeCurrentMonth ? (
                                            <><i className="bi bi-check2-circle me-2"></i>Confirm Reactivation & Billing</>
                                        ) : (
                                            <><i className="bi bi-person-check-fill me-2"></i>Confirm Activation Only</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
