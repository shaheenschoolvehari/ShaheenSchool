'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notify } from '@/app/utils/notify';

const API = process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com";


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface SlipRow {
    category?: string;
    slip_id: number;
    student_id: number;
    first_name: string; last_name: string;
    admission_no: string;
    father_name: string | null;
    father_phone: string | null;
    class_name: string;
    section_name?: string;
    family_id: string | null;
    is_family_slip: boolean;
    total_amount: number;
    paid_amount: number;
    status: 'paid' | 'partial' | 'unpaid' | 'satteled';
    due_date: string | null;
    issue_date: string | null;
    month: number;
    year: number;
    line_items: { 
        item_id: number; 
        head_name: string; 
        amount: number; 
        paid_amount?: number; 
        note?: string;
        class_collected_amount?: number;
        class_collected_students?: {
            student_id: number;
            name: string;
            admission_no?: string;
            class_name?: string;
            amount: number;
            collector_name?: string;
            collection_date?: string;
        }[];
        original_amount?: number;
    }[];
    family_members?: { student_id: number; first_name: string; last_name: string; class_name: string; admission_no: string; section_name?: string; father_name?: string; }[];
    academic_year_id?: number;
    academic_year_name?: string;
    is_active_year?: boolean;
    class_collected_amount?: number;
    class_collected_students?: {
        student_id: number;
        name: string;
        admission_no?: string;
        class_name?: string;
        amount: number;
        collector_name?: string;
        collection_date?: string;
    }[];
    original_total_amount?: number;
}
interface Stats {
    total_students: number; total_amount: number; paid_amount: number;
    paid_count: number; unpaid_count: number; partial_count: number;
}
interface Payment {
    payment_id: number; amount_paid: number; payment_date: string;
    payment_method: string; received_by: string; reference_no: string; notes: string;
    is_printed?: boolean;
}
interface SchoolInfo {
    school_name: string; school_address: string;
    phone_number: string; school_phone2: string; school_phone3: string; school_logo_url: string;
}

function fmt(n: number) { return `PKR ${Number(n || 0).toLocaleString('en-PK')}`; }
function fmtDate(d: string | null) {
    if (!d) return '—'; return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bg: string; label: string }> = {
        paid: { bg: '#198754', label: 'Paid' },
        satteled: { bg: '#0891b2', label: 'Settled' },
        settled: { bg: '#0891b2', label: 'Settled' },
        partial: { bg: '#fd7e14', label: 'Partial' },
        unpaid: { bg: '#dc3545', label: 'Unpaid' },
    };
    const s = map[(status || '').toLowerCase()] || { bg: '#6c757d', label: status };
    return <span className="badge rounded-pill" style={{ backgroundColor: s.bg, fontSize: '0.7rem' }}>{s.label}</span>;
}

function normalizeSlips(rawSlips: any[]): SlipRow[] {
    return (rawSlips || []).map((s: any) => {
        const isTrusted = Boolean(
            s.is_trusted ||
            (s.category && s.category.trim().toLowerCase() === 'trusted') ||
            (s.family_members && s.family_members.length > 0 && s.family_members.every((m: any) => (m.category || '').toLowerCase() === 'trusted'))
        );

        if (isTrusted) {
            let nonTuitionTotal = 0;
            if (s.line_items && s.line_items.length > 0) {
                const extraItems = s.line_items.filter((li: any) => {
                    const hn = (li.head_name || '').toLowerCase();
                    return !hn.includes('tuition') && 
                           !hn.includes('family monthly fee') && 
                           !hn.includes('monthly fee') && 
                           !hn.includes('previous balance');
                });
                nonTuitionTotal = extraItems.reduce((sum: number, li: any) => sum + parseFloat(li.amount as any || 0), 0);
            } else {
                nonTuitionTotal = parseFloat(s.total_amount as any || 0);
            }

            const paid = parseFloat(s.paid_amount as any || 0);
            const status: 'paid' | 'partial' | 'unpaid' | 'satteled' = 
                nonTuitionTotal <= 0 
                    ? 'satteled' 
                    : (paid >= nonTuitionTotal ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'));

            return {
                ...s,
                is_trusted: true,
                total_amount: nonTuitionTotal,
                status
            };
        }
        return s;
    });
}

export default function CollectFeePage() {
    // Filters
    const [classes, setClasses] = useState<{ class_id: number; class_name: string }[]>([]);
    const { hasPermission } = useAuth();
    const [selectedClass, setSelectedClass] = useState('');
    const [year, setYear] = useState(new Date().getFullYear().toString());
    const [academicYears, setAcademicYears] = useState<{ id: number; year_name: string; is_active: boolean }[]>([]);
    const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>('all');
    const [activeYear, setActiveYear] = useState<{ id: number; year_name: string; is_active: boolean } | null>(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [search, setSearch] = useState('');

    // Data
    const [slips, setSlips] = useState<SlipRow[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);

    // Payment Modal
    const [payModal, setPayModal] = useState(false);
    const [activeSlip, setActiveSlip] = useState<SlipRow | null>(null);
    const [slipPayments, setSlipPayments] = useState<Payment[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(null);

    // Slip Breakdown Modal (when a student has single or multiple months)
    const [slipPickerGroup, setSlipPickerGroup] = useState<{ first_name: string; last_name: string; admission_no?: string; class_name?: string; slips: SlipRow[] } | null>(null);

    const [headPayVals, setHeadPayVals] = useState<Record<string, string>>({});
    const [waivedItemIds, setWaivedItemIds] = useState<number[]>([]);
    const [payMethod, setPayMethod] = useState('cash');
    const [payDate, setPayDate] = useState(getTodayDateStr());
    const [receivedBy, setReceivedBy] = useState('');
    const [refNo, setRefNo] = useState('');
    const [notes, setNotes] = useState('');
    const [paying, setPaying] = useState(false);
    const [school, setSchool] = useState<SchoolInfo>({ school_name: '', school_address: '', phone_number: '', school_phone2: '', school_phone3: '', school_logo_url: '' });

    useEffect(() => {
        fetch(`${API}/academic`).then(r => r.json()).then(setClasses).catch(() => { });
        fetch(`${API}/academic/years`).then(r => r.json()).then(data => {
            if (Array.isArray(data)) {
                setAcademicYears(data);
                const active = data.find(y => y.is_active);
                if (active) {
                    setActiveYear(active);
                    setSelectedAcademicYear(active.id.toString());
                }
            }
        }).catch(() => {});
        fetch(`${API}/academic/active-year`).then(r => r.json()).then(data => {
            if (data && data.id) {
                setActiveYear(data);
                setSelectedAcademicYear(data.id.toString());
                const startY = data.start_date ? new Date(data.start_date).getFullYear().toString() : (data.year_name ? data.year_name.split('-')[0].trim() : new Date().getFullYear().toString());
                if (startY && !isNaN(parseInt(startY))) {
                    setYear(startY);
                }
            }
        }).catch(() => {});
        // School info lives in school_settings table (via /settings), NOT system_settings
        fetch(`${API}/settings`).then(r => r.json()).then((data: any) => {
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const getLogo = (raw?: string) => {
                    const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com").replace(/\/+$/, '');
                    if (!raw || !raw.trim()) return `${API_URL}/icon.png`;
                    const s = raw.trim();
                    if (s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) return s;
                    return `${API_URL}/${s.replace(/^\/+/, '')}`;
                };
                setSchool({
                    school_name: data.school_name || '',
                    school_address: data.address || '',
                    phone_number: data.contact_number || '',
                    school_phone2: '',
                    school_phone3: '',
                    school_logo_url: getLogo(data.logo_url)
                });
            }
        }).catch(() => { });

        // Auto load slips if URL search parameter is provided
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const querySearch = urlParams.get('search') || urlParams.get('student') || urlParams.get('family_id') || urlParams.get('student_id');
            if (querySearch) {
                setSearch(querySearch);
                // Trigger slips load automatically
                const currentYear = new Date().getFullYear().toString();
                setLoading(true);
                fetch(`${API}/fee-slips?year=${currentYear}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.slips) {
                            setSlips(normalizeSlips(data.slips));
                            setStats(data.stats || null);
                            setLoaded(true);
                        }
                    })
                    .catch(() => { })
                    .finally(() => setLoading(false));
            }
        }
    }, []);

    const loadSlips = async () => {
        if (!year) {
            notify.error('Please enter a Year.');
            return;
        }
        setLoading(true); setSlips([]); setStats(null); setLoaded(false);
        try {
            const params = new URLSearchParams({ year });
            if (selectedClass) params.append('class_id', selectedClass);
            const targetYearId = (selectedAcademicYear && selectedAcademicYear !== 'all') ? selectedAcademicYear : (activeYear ? activeYear.id.toString() : '');
            if (targetYearId) {
                params.append('academic_year_id', targetYearId);
            }
            const r = await fetch(`${API}/fee-slips?${params.toString()}`);
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            setSlips(normalizeSlips(data.slips));
            setStats(data.stats || null);
            setLoaded(true);
        } catch (e: any) { notify.error(e.message); }
        finally { setLoading(false); }
    };

    // Silent reload re-fetches all slips in the background without clearing UI or spinner.
    // Called after payment/reversal so waterfall-updated old slips also reflect their new state.
    const silentReload = async () => {
        if (!year) return;
        try {
            const params = new URLSearchParams({ year });
            if (selectedClass) params.append('class_id', selectedClass);
            const targetYearId = (selectedAcademicYear && selectedAcademicYear !== 'all') ? selectedAcademicYear : (activeYear ? activeYear.id.toString() : '');
            if (targetYearId) {
                params.append('academic_year_id', targetYearId);
            }
            const r = await fetch(`${API}/fee-slips?${params.toString()}`);
            const data = await r.json();
            if (r.ok) {
                setSlips(normalizeSlips(data.slips));
                setStats(data.stats || null);
            }
        } catch { }
    };

    const openPayModal = async (slip: SlipRow) => {
        setActiveSlip(slip);
        setWaivedItemIds([]);
        const pDate = getTodayDateStr();
        setPayDate(pDate);

        const buildInitialHeads = (targetSlip: SlipRow, currentPayDate: string) => {
            const initialHeads: Record<string, string> = {};
            const isTrusted = Boolean(
                (targetSlip as any).is_trusted ||
                (targetSlip.category && targetSlip.category.trim().toLowerCase() === 'trusted') ||
                (targetSlip.family_members && targetSlip.family_members.length > 0 && targetSlip.family_members.every((m: any) => (m.category || '').toLowerCase() === 'trusted'))
            );

            if (targetSlip.line_items && targetSlip.line_items.length > 0) {
                targetSlip.line_items.forEach((item: any) => {
                    const headId = item.item_id ? item.item_id.toString() : item.head_name;
                    const isTuitionOrPb = (item.head_name || '').toLowerCase().includes('tuition') || 
                        (item.head_name || '').toLowerCase().includes('family monthly fee') || 
                        (item.head_name || '').toLowerCase().includes('monthly fee') || 
                        (item.head_name || '').toLowerCase().includes('previous balance');

                    if (isTrusted && isTuitionOrPb) {
                        initialHeads[headId] = '';
                        return;
                    }

                    const rem = Math.max(0, parseFloat(item.amount as any || 0) - parseFloat(item.paid_amount as any || 0));
                    const isLateFine = (item.head_name || '').toLowerCase().includes('late') || (item.head_name || '').toLowerCase().includes('fine');
                    
                    if (isLateFine && targetSlip.due_date) {
                        let cutoff = new Date(targetSlip.due_date);
                        if (item.fine_after_day && parseInt(item.fine_after_day) > 0) {
                            cutoff.setDate(parseInt(item.fine_after_day));
                        }
                        const payD = new Date(currentPayDate);
                        if (payD <= cutoff) {
                            initialHeads[headId] = '';
                            return;
                        }
                    }

                    initialHeads[headId] = rem > 0 ? rem.toString() : '';
                });
            } else {
                const balance = Math.max(0, parseFloat(targetSlip.total_amount as any) - parseFloat(targetSlip.paid_amount as any));
                initialHeads['fallback'] = balance > 0 ? balance.toString() : '';
            }
            return initialHeads;
        };

        setHeadPayVals(buildInitialHeads(slip, pDate));
        setPayMethod('cash');
        setReceivedBy(''); setRefNo(''); setNotes('');
        setPayModal(true);
        setLoadingHistory(true); setSlipPayments([]);
        try {
            const r = await fetch(`${API}/fee-slips/${slip.slip_id}`);
            const d = await r.json();
            setSlipPayments(d.payments || []);
            if (d.slip) {
                setActiveSlip(d.slip);
                if (d.slip.line_items && d.slip.line_items.length > 0) {
                    setHeadPayVals(buildInitialHeads(d.slip, pDate));
                }
            }
        } catch { setSlipPayments([]); }
        finally { setLoadingHistory(false); }
    };

    /* ============================================================================
       PREVIOUS OPEN RECEIPT WINDOW (PRESERVED IN COMMENTS)
       ============================================================================
    const oldOpenReceiptWindow = (
        slip: SlipRow,
        receivingAmt: number,
        submissionDate: string,
        prevPaid: number
    ) => {
        const total = parseFloat(slip.total_amount as any);
        const balance = Math.max(0, total - prevPaid - receivingAmt);
        const fmtR = (n: number) => `${Number(n || 0).toLocaleString('en-PK')}/-`;
        const fmtD = (d: string | null) => { if (!d) return '\u2014'; try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };
        const zeroPad = (n: number) => String(n).padStart(8, '0');

        const members: any[] = (slip.family_members && slip.family_members.length > 0)
            ? slip.family_members
            : [{ first_name: slip.first_name, last_name: slip.last_name, father_name: slip.father_name || '', class_name: slip.class_name, section_name: slip.section_name }];
        const rows9 = [...members];
        while (rows9.length < 9) rows9.push({ first_name: '', last_name: '', father_name: '', class_name: '' });

        let feeBody = (slip.line_items || []).map((li) =>
            `<tr><td>${li.head_name.replace('Family Monthly Fee', 'Monthly Fee')}${li.note ? ` (${li.note})` : ''}</td><td>${fmtR(parseFloat(li.amount as any))}</td></tr>`
        ).join('');
        if (prevPaid > 0) feeBody += `<tr><td>Previous Payment (Credit)</td><td>\u2212 ${fmtR(prevPaid)}</td></tr>`;
        feeBody += `<tr><td><strong>Total Payable Amount</strong></td><td><strong>${fmtR(total)}</strong></td></tr>`;
        feeBody += `<tr class="thick"><td><strong>Receiving Amount</strong></td><td><strong>${fmtR(receivingAmt)}</strong></td></tr>`;
        feeBody += `<tr class="thick"><td><strong>Balance Amount</strong></td><td><strong>${fmtR(balance)}</strong></td></tr>`;

        const studentBody = rows9.map(m =>
            `<tr><td>${m.first_name || ''} ${m.last_name || ''}</td><td>${m.father_name || ''}</td><td>${m.class_name || ''} ${m.section_name ? m.section_name : ''}</td></tr>`
        ).join('');

        const phones = [school.phone_number, school.school_phone2, school.school_phone3].filter(Boolean).join(' ; ');
        const logoHtml = school.school_logo_url
            ? `<img src="${school.school_logo_url}" style="width:16mm;height:16mm;object-fit:contain;margin-right:3mm;flex-shrink:0;" />`
            : `<div style="width:16mm;height:16mm;background-color:#007bff;margin-right:3mm;flex-shrink:0;"></div>`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Fee Receipt</title>
  <style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; width: 72mm; box-sizing: border-box; font-family: Arial, sans-serif; color: #000; }
    .voucher { width: 100%; padding: 3mm; display: flex; flex-direction: column; box-sizing: border-box; }
    .header { display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 2mm; }
    .school-name { font-size: 12pt; font-weight: bold; line-height: 1.2; text-transform: uppercase; text-align: center; margin-top: 1mm; }
    .address-block { text-align: center; font-size: 8.5pt; margin-bottom: 1mm; line-height: 1.3; }
    .address-block p { margin: 0; }
    hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
    .voucher-title { text-align: center; font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 1mm 0; }
    .info { font-size: 8.5pt; margin-bottom: 2mm; line-height: 1.4; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 0.5mm; }
    .info-row2 { margin-bottom: 0.5mm; }
    .section-label { font-size: 10pt; font-weight: bold; margin-bottom: 0; margin-top: 3mm; text-align: center; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 1mm 0; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 3mm; table-layout: fixed; word-wrap: break-word; }
    th, td { padding: 1.5mm 0.5mm; text-align: center; }
    th { border-bottom: 1.5px solid #000; font-weight: bold; }
    td { border-bottom: 1px dotted #ccc; }
    .details tbody td:nth-child(1) { text-align: left; }
    .details tbody td:nth-child(2) { text-align: right; }
    tr.thick td { border-top: 1.5px dashed #000; border-bottom: none; font-weight: bold; padding-top: 1.5mm; }
    .students th:nth-child(1), .students td:nth-child(1) { text-align: left; }
    .students th:nth-child(2), .students td:nth-child(2) { text-align: left; }
    .students th:nth-child(3), .students td:nth-child(3) { text-align: right; }
    .spacer { flex-grow: 1; }
    .thank-you { text-align: center; font-size: 10pt; font-weight: bold; margin-top: 3mm; margin-bottom: 2mm; }
    .print-btn { display: block; width: 100%; margin-top: 4mm; padding: 2mm; font-size: 10pt; font-weight: bold; background: #007bff; color: #fff; border: none; border-radius: 2mm; cursor: pointer; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <div class="voucher">
    <div class="header">${logoHtml}<div class="school-name">${school.school_name || 'SCHOOL NAME'}</div></div>
    <div class="address-block"><p>${school.school_address || ''}</p><p>${phones}</p></div>
    <hr><div class="voucher-title">Fee Receipt</div><hr>
    <div class="info">
      <div class="info-row">
        <div>Voucher No: <strong><u>${zeroPad(slip.slip_id)}</u></strong></div>
        <div>Family ID: <strong><u>${slip.family_id || '\u2014'}</u></strong></div>
      </div>
      <div class="info-row2">Fee Submission Date: <strong><u>${fmtD(submissionDate)}</u></strong></div>
    </div>
    <div class="section-label">Students Details</div>
    <table class="students"><thead><tr><th>Student Name</th><th>Father Name</th><th>Class</th></tr></thead><tbody>${studentBody}</tbody></table>
    <div class="section-label">Fee Details</div>
    <table class="details"><thead><tr><th>Fee Description</th><th>Amount</th></tr></thead><tbody>${feeBody}</tbody></table>
    <div class="thank-you">Thank You</div>
    <div class="spacer"></div>
  </div>
  <button class="print-btn" onclick="window.print()">&#128438; Print Receipt</button>
</body>
</html>`;

        const w = window.open('', '_blank', 'width=420,height=680,toolbar=0,menubar=0,scrollbars=1');
        if (w) {
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(() => w.print(), 250);
        }
    };
       ============================================================================ */

    /* ============================================================================
       NEW THERMAL FEE RECEIPT (Strictly matching fee-voucher thermal printer.html)
       ============================================================================ */
    const openReceiptWindow = (
        slip: SlipRow,
        receivingAmt: number,
        submissionDate: string,
        prevPaid: number
    ) => {
        const escStr = (text: unknown): string => {
            return String(text ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const totalPayable = parseFloat(slip.total_amount as any) || 0;
        const totalReceivedBefore = prevPaid || 0;
        const totalReceivedNow = totalReceivedBefore + receivingAmt;
        const remainingBalance = Math.max(0, totalPayable - totalReceivedNow);

        const fmtMoney = (n: number) => `${Number(n || 0).toLocaleString('en-PK')}/-`;
        const fmtD = (d: string | null) => {
            if (!d) return '\u2014';
            try {
                const dt = new Date(d);
                return ("0" + dt.getDate()).slice(-2) + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + dt.getFullYear();
            } catch {
                return String(d);
            }
        };
        const zeroPad = (n: number) => String(n).padStart(5, '0');

        // Students list: exactly 1 row per student, no blank filler rows
        const members: any[] = (slip.family_members && slip.family_members.length > 0)
            ? slip.family_members
            : [{
                first_name: slip.first_name,
                last_name: slip.last_name,
                father_name: slip.father_name || '',
                class_name: slip.class_name,
                section_name: slip.section_name
            }];

        const studentRows = members.map(m =>
            `<tr>
                <td>${escStr(m.first_name || '')} ${escStr(m.last_name || '')}</td>
                <td>${escStr(m.father_name || slip.father_name || '')}</td>
                <td>${escStr(m.class_name || '')}${m.section_name ? ` (${escStr(m.section_name)})` : ''}</td>
            </tr>`
        ).join('');

        // Fee Details: 1 row per fee head with Sr.#
        const lineItems = slip.line_items || [];
        let srNo = 0;
        let feeRows = '';

        lineItems.forEach(li => {
            srNo++;
            let desc = li.head_name.replace('Family Monthly Fee', 'Monthly Fee') + (li.note ? ` (${li.note})` : '');
            if (li.class_collected_amount && li.class_collected_amount > 0) {
                desc += ` [Class Coll: PKR ${li.class_collected_amount.toLocaleString('en-PK')}]`;
            }
            feeRows += `<tr>
                <td>${srNo}</td>
                <td>${escStr(desc)}</td>
                <td>${fmtMoney(parseFloat(li.amount as any) || 0)}</td>
            </tr>`;
        });

        if (lineItems.length === 0) {
            srNo++;
            feeRows += `<tr>
                <td>${srNo}</td>
                <td>Monthly Fee</td>
                <td>${fmtMoney(totalPayable)}</td>
            </tr>`;
        }

        // Subtotal row
        srNo++;
        feeRows += `<tr class="subtotal-row">
            <td>${srNo}</td>
            <td>Total Payable</td>
            <td>${fmtMoney(totalPayable)}</td>
        </tr>`;

        // Receiving Amount & Remaining Balance
        feeRows += `
            <tr class="divider-row">
                <td colspan="2">Receiving Amount</td>
                <td>${fmtMoney(receivingAmt)}</td>
            </tr>
            <tr class="bold-row">
                <td colspan="2">Remaining Balance</td>
                <td>${fmtMoney(remainingBalance)}</td>
            </tr>`;

        const phones = [school.phone_number, school.school_phone2, school.school_phone3].filter(Boolean).join(' ; ') || '0300-7730141 ; 0308-7696430 ; 067-3366383';
        const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com").replace(/\/+$/, '');
        const logoUrl = school.school_logo_url || `${API_URL}/icon.png`;
        const schoolNameFormatted = (school.school_name || 'Falcon School System\nVehari').split('\n').join('<br>');
        const schoolAddress = school.school_address || '83/M Madina Colony Vehari';

        const logoImgHtml = logoUrl
            ? `<img src="${escStr(logoUrl)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;border-radius:1.5mm;display:block;" />`
            : '';

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Fee Receipt</title>
<style>
  @page { margin: 0; size: auto; }
  html, body {
    margin: 0; padding: 0; width: 72mm; box-sizing: border-box;
    font-family: 'Times New Roman', Times, serif; color: #000; background: #fff;
  }
  .voucher {
    width: 100%; padding: 3mm; display: flex; flex-direction: column; box-sizing: border-box;
    border: 2px solid #000; border-radius: 4mm; position: relative; background: #fff;
  }
  .voucher::before {
    content: ""; position: absolute; inset: 2px; border: 1px solid #000; border-radius: 3.3mm; pointer-events: none;
  }

  .header { display: flex; align-items: center; gap: 2mm; margin-bottom: 2mm; }
  .logo-box {
    width: 16mm; height: 16mm; border: none; background: transparent;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .school-name { font-size: 11pt; font-weight: bold; line-height: 1.25; text-transform: uppercase; color: #000; }

  .address-block { text-align: center; font-size: 8pt; margin-bottom: 1mm; line-height: 1.3; color: #000; }
  .address-block p { margin: 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
  .voucher-title { text-align: center; font-size: 10.5pt; font-weight: bold; text-transform: uppercase; margin: 1mm 0; color: #000; }

  .info { font-size: 8pt; margin-bottom: 2mm; line-height: 1.4; color: #000; }
  .info-row { display: flex; align-items: baseline; gap: 2mm; white-space: nowrap; margin-bottom: 0.5mm; }
  .info-row .voucher-no { flex-shrink: 0; }
  .info-row .family-id { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: right; }
  .info-row2 { margin-bottom: 0.5mm; }

  .section-label { font-size: 9.5pt; font-weight: bold; margin: 3mm 0 1mm; color: #000; }

  table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 3mm; table-layout: fixed; word-wrap: break-word; color: #000; }
  th, td { border: 1px solid #000; padding: 1.2mm 0.8mm; text-align: center; }
  th { font-weight: bold; background: #e9e9e9; }

  .students th:nth-child(1), .students td:nth-child(1) { text-align: left; }
  .students th:nth-child(2), .students td:nth-child(2) { text-align: left; }

  .details th:nth-child(1), .details td:nth-child(1) { width: 12%; }
  .details th:nth-child(2), .details td:nth-child(2) { text-align: left; }
  .details th:nth-child(3), .details td:nth-child(3) { text-align: right; }
  .details tr.subtotal-row td { font-weight: bold; background: #e9e9e9; }
  .details tr.divider-row td { font-weight: bold; border-top: 2px solid #000; }
  .details tr.bold-row td { font-weight: bold; }
  .details tr.divider-row td:first-child,
  .details tr.bold-row td:first-child { text-align: left; }

  .thank-you { text-align: center; font-size: 9.5pt; font-weight: bold; margin-top: 3mm; margin-bottom: 2mm; color: #000; }
  .spacer { flex-grow: 1; }

  .print-btn {
    display: block; width: 100%; margin-top: 4mm; padding: 8px; font-size: 10pt; font-weight: bold;
    background: #215E61; color: #fff; border: none; border-radius: 4px; cursor: pointer; text-align: center;
  }
  @media print {
    .print-btn { display: none !important; }
    body { width: 72mm !important; }
  }
</style>
</head>
<body>
  <div class="voucher">
    <div class="header">
      <div class="logo-box">${logoImgHtml}</div>
      <div class="school-name">${schoolNameFormatted}</div>
    </div>
    <div class="address-block">
      <p>${escStr(schoolAddress)}</p>
      <p>${escStr(phones)}</p>
    </div>
    <hr><div class="voucher-title">Fee Receipt</div><hr>
    <div class="info">
      <div class="info-row">
        <div class="voucher-no">Voucher No: <strong><u>${zeroPad(slip.slip_id)}</u></strong></div>
        <div class="family-id">Family ID: <strong><u>${escStr(slip.family_id || '—')}</u></strong></div>
      </div>
      <div class="info-row2">Fee Submission Date: <strong><u>${fmtD(submissionDate)}</u></strong></div>
    </div>

    <div class="section-label">Students Details</div>
    <table class="students">
      <thead><tr><th>Student Name</th><th>Father Name</th><th>Class (Sec)</th></tr></thead>
      <tbody>${studentRows}</tbody>
    </table>

    <div class="section-label">Fee Details</div>
    <table class="details">
      <thead><tr><th>Sr.#</th><th>Fee Description</th><th>Amount</th></tr></thead>
      <tbody>${feeRows}</tbody>
    </table>

    <div class="thank-you">Thank You</div>
    <div class="spacer"></div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨️ Print Receipt</button>
  <script>
    window.onload = function() {
      var img = document.querySelector('.logo-box img');
      if (img && !img.complete) {
        img.onload = function() { window.print(); };
        img.onerror = function() { window.print(); };
      } else {
        window.print();
      }
    };
  </script>
</body>
</html>`;

        const w = window.open('', '_blank', 'width=420,height=680,toolbar=0,menubar=0,scrollbars=1');
        if (w) {
            w.document.write(html);
            w.document.close();
            w.focus();
        }
    };

    const deletePayment = async (paymentId: number) => {
        if (!window.confirm('Reverse this payment? The collection will be removed and slip balance recalculated.')) return;
        setDeletingPaymentId(paymentId);
        try {
            const r = await fetch(`${API}/fee-slips/payments/${paymentId}`, { method: 'DELETE' });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            // Refresh payments list
            const rh = await fetch(`${API}/fee-slips/${activeSlip!.slip_id}`);
            const dh = await rh.json();
            setSlipPayments(dh.payments || []);
            // Update slip in list + active slip
            setSlips(prev => prev.map(s => s.slip_id === activeSlip!.slip_id
                ? { ...s, paid_amount: d.slip.paid_amount, status: d.slip.status } : s));
            setActiveSlip(prev => prev ? { ...prev, paid_amount: d.slip.paid_amount, status: d.slip.status } : null);
            // Re-fetch all slips silently OPB reversal may have updated older slips in DB
            silentReload();
        } catch (e: any) { alert('Error: ' + e.message); }
        finally { setDeletingPaymentId(null); }
    };

    const handlePay = async (shouldPrint = false) => {
        const activeVals = { ...headPayVals };
        waivedItemIds.forEach(id => {
            delete activeVals[id.toString()];
        });

        const receivingSnap = Object.values(activeVals).reduce((sum, v) => sum + (parseFloat(v as string) || 0), 0);
        if (receivingSnap <= 0 && waivedItemIds.length === 0) { notify.error('Enter a valid amount or waive fine.'); return; }
        
        // Snapshot before state changes (needed for receipt after async updates)
        const prevPaidSnap = parseFloat(activeSlip!.paid_amount as any);
        const slipSnap = { ...activeSlip! };
        const payDateSnap = payDate;
        setPaying(true);
        try {
            const r = await fetch(`${API}/fee-slips/${activeSlip!.slip_id}/pay`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount_paid: receivingSnap,
                    head_breakdown: activeVals,
                    payment_method: payMethod,
                    payment_date: payDateSnap,
                    received_by: receivedBy,
                    reference_no: refNo,
                    notes,
                    is_printed: shouldPrint,
                    waived_item_ids: waivedItemIds
                })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            notify.success(waivedItemIds.length > 0 ? 'Payment & fine waiver recorded successfully!' : 'Payment recorded successfully!');
            // Refresh history
            const rh = await fetch(`${API}/fee-slips/${activeSlip!.slip_id}`);
            const dh = await rh.json(); setSlipPayments(dh.payments || []);
            // Update slip in list
            setSlips(prev => prev.map(s => s.slip_id === activeSlip!.slip_id ? { ...s, total_amount: d.slip.total_amount, paid_amount: d.slip.paid_amount, status: d.slip.status } : s));
            setStats(prev => prev ? {
                ...prev,
                paid_amount: (prev.paid_amount || 0) + receivingSnap,
                paid_count: ['paid', 'satteled'].includes(d.slip.status) ? (prev.paid_count + 1) : prev.paid_count,
                unpaid_count: d.slip.status !== 'unpaid' && activeSlip?.status === 'unpaid' ? prev.unpaid_count - 1 : prev.unpaid_count,
                partial_count: d.slip.status === 'partial' ? (activeSlip?.status === 'unpaid' ? prev.partial_count + 1 : prev.partial_count) :
                    ['paid', 'satteled'].includes(d.slip.status) && (activeSlip?.status === 'partial') ? prev.partial_count - 1 : prev.partial_count
            } : null);
            setActiveSlip(prev => prev ? { ...prev, total_amount: d.slip.total_amount, paid_amount: d.slip.paid_amount, status: d.slip.status, line_items: dh.line_items || prev.line_items } : null);
            setHeadPayVals({});
            setWaivedItemIds([]);
            // Open receipt in new window after successful payment
            if (shouldPrint && receivingSnap > 0) openReceiptWindow(slipSnap, receivingSnap, payDateSnap, prevPaidSnap);
            // Re-fetch all slips silently waterfall may have updated older slips in DB
            silentReload();
        } catch (e: any) { notify.error(e.message); }
        finally { setPaying(false); }
    };

    // Filtered slips
    const filtered = slips.filter(s => {
        if (statusFilter !== 'all') {
            const st = (s.status || '').toLowerCase();
            if (statusFilter === 'satteled' || statusFilter === 'settled') {
                if (!['satteled', 'settled'].includes(st)) return false;
            } else if (st !== statusFilter) {
                return false;
            }
        }
        if (search.trim()) {
            const q = search.toLowerCase().trim();
            const name = `${s.first_name} ${s.last_name}`.toLowerCase();
            const admno = (s.admission_no || '').toLowerCase();
            const famId = (s.family_id || '').toLowerCase();
            const fName = (s.father_name || '').toLowerCase();
            const fPhone = (s.father_phone || '').toLowerCase();
            const members = (s.family_members || []).map(m => `${m.first_name} ${m.last_name}`.toLowerCase()).join(' ');
            return name.includes(q) || admno.includes(q) || famId.includes(q) || fName.includes(q) || fPhone.includes(q) || members.includes(q);
        }
        return true;
    });

    // Group filtered slips by student/family one row per student
    // NOTE: Each slip already embeds previous months' unpaid balance as "Previous Balance" line item.
    //       So we NEVER sum across slips we only look at the LATEST slip per student.
    const groupedFiltered = (() => {
        const map = new Map<string, {
            key: string; student_id: number; first_name: string; last_name: string;
            admission_no: string; father_name: string | null; father_phone: string | null;
            class_name: string; section_name?: string; family_id: string | null; is_family_slip: boolean;
            family_members?: any[];
            latest_slip: SlipRow;      // the most recent slip (highest year then month)
            latest_unpaid: SlipRow;    // most recent unpaid/partial slip collect THIS one
            latest_paid: SlipRow | null;  // most recent slip with paid_amount > 0 (for Reverse)
            has_payments: boolean;     // any slip in this group has been paid at least partially
            balance: number;           // balance from latest_unpaid only
            is_trusted: boolean;
            slips: SlipRow[]; status: 'paid' | 'partial' | 'unpaid' | 'satteled';
        }>();
        filtered.forEach(slip => {
            const key = (slip.is_family_slip && slip.family_id) ? `fam_${slip.family_id}` : `stu_${slip.student_id}`;
            if (!map.has(key)) {
                map.set(key, {
                    key, student_id: slip.student_id,
                    first_name: slip.first_name, last_name: slip.last_name,
                    admission_no: slip.admission_no, father_name: slip.father_name,
                    father_phone: slip.father_phone, class_name: slip.class_name, section_name: slip.section_name,
                    family_id: slip.family_id, is_family_slip: slip.is_family_slip,
                    family_members: slip.family_members,
                    latest_slip: slip, latest_unpaid: slip,
                    latest_paid: null, has_payments: false,
                    balance: 0, is_trusted: false, slips: [], status: 'paid',
                });
            }
            const g = map.get(key)!;
            // Track latest slip (highest year, then highest month)
            const isNewer = slip.year > g.latest_slip.year ||
                (slip.year === g.latest_slip.year && slip.month > g.latest_slip.month);
            if (isNewer) g.latest_slip = slip;
            // Track latest slip with payments (paid_amount > 0)
            if (parseFloat(slip.paid_amount as any) > 0) {
                g.has_payments = true;
                if (!g.latest_paid ||
                    slip.year > g.latest_paid.year ||
                    (slip.year === g.latest_paid.year && slip.month > g.latest_paid.month)) {
                    g.latest_paid = slip;
                }
            }
            g.slips.push(slip);
        });
        // After collecting all slips, find the latest unpaid/partial per group
        map.forEach(g => {
            // For family groups, ensure primary student info reflects the ACTIVE family lead
            if (g.is_family_slip && g.family_members && g.family_members.length > 0) {
                const activeMembers = g.family_members.filter((m: any) => (m.status || 'Active').toLowerCase() === 'active');
                const activeLead = activeMembers.length > 0 ? activeMembers[0] : null;
                if (activeLead) {
                    g.first_name = activeLead.first_name;
                    g.last_name = activeLead.last_name;
                    g.admission_no = activeLead.admission_no;
                    g.class_name = activeLead.class_name;
                    g.student_id = activeLead.student_id;
                    if (activeLead.section_name) g.section_name = activeLead.section_name;
                    if (activeLead.father_name) g.father_name = activeLead.father_name;
                }
            }

            const isTrustedGroup = Boolean(
                (g.family_members && g.family_members.length > 0 && g.family_members.every((m: any) => (m.category || '').toLowerCase() === 'trusted')) ||
                ((g.latest_slip?.category || '').toLowerCase() === 'trusted') ||
                ((g.latest_unpaid as any)?.is_trusted)
            );
            g.is_trusted = isTrustedGroup;

            // Find any slip with a positive unpaid balance
            const unpaid = g.slips
                .filter(s => {
                    const tot = parseFloat(s.total_amount as any || 0);
                    const paid = parseFloat(s.paid_amount as any || 0);
                    return (tot - paid) > 0;
                })
                .sort((a, b) => (b.year - a.year) || (b.month - a.month));
            
            if (unpaid.length > 0) {
                g.latest_unpaid = unpaid[0];
                const tot = parseFloat(g.latest_unpaid.total_amount as any || 0);
                const paid = parseFloat(g.latest_unpaid.paid_amount as any || 0);
                g.balance = Math.max(0, tot - paid);
                g.status = g.balance <= 0 ? (isTrustedGroup ? 'satteled' : 'paid') : (paid > 0 ? 'partial' : 'unpaid');
            } else {
                g.latest_unpaid = g.latest_slip;
                const tot = parseFloat(g.latest_slip.total_amount as any || 0);
                const paid = parseFloat(g.latest_slip.paid_amount as any || 0);
                g.balance = Math.max(0, tot - paid);
                if (g.balance > 0) {
                    g.status = paid > 0 ? 'partial' : 'unpaid';
                } else {
                    g.status = isTrustedGroup ? 'satteled' : (['satteled', 'settled'].includes((g.latest_slip.status || '').toLowerCase()) ? 'satteled' : 'paid');
                }
            }
        });
        return Array.from(map.values());
    })();

    const totalDue = stats ? stats.total_amount - stats.paid_amount : 0;
    const collectionPct = stats && stats.total_amount > 0 ? Math.round((stats.paid_amount / stats.total_amount) * 100) : 0;

    const isModalSlipSettled = activeSlip ? (
        parseFloat(activeSlip.total_amount as any || 0) <= 0
    ) : false;
    const modalSlipBalance = isModalSlipSettled ? 0 : (activeSlip ? Math.max(0, parseFloat(activeSlip.total_amount as any || 0) - parseFloat(activeSlip.paid_amount as any || 0)) : 0);

    return (
        <div className="page-wrap" style={{ backgroundColor: 'var(--bg-main)', minHeight: '100vh' }}>
            {/* Page Header */}
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center align-items-start gap-3 mb-4">
                <div className="d-flex align-items-center gap-3">
                    <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--primary-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="bi bi-cash-coin" style={{ fontSize: 22, color: '#fff' }}></i>
                    </div>
                    <div>
                        <h4 className="mb-0 fw-bold d-flex align-items-center flex-wrap gap-2" style={{ color: 'var(--primary-dark)' }}>
                            Collect Fee
                            <span className="badge rounded-pill bg-light text-dark border ms-2" style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                                Academic Year: {activeYear?.year_name || '—'}
                            </span>
                        </h4>
                        <div className="text-muted small">Record fee payments against monthly vouchers</div>
                    </div>
                </div>
            </div>

            {/* ── Filter Card ── */}
            <div className="card border-0 shadow-sm mb-4">
                <div className="card-header bg-white border-bottom py-3" style={{ borderLeft: '4px solid var(--primary-teal)' }}>
                    <h6 className="mb-0 fw-bold" style={{ color: 'var(--primary-dark)' }}>
                        <i className="bi bi-funnel me-2"></i>Search Vouchers
                    </h6>
                </div>
                <div className="card-body p-4">
                    {/* Row 1: Search bar always visible */}
                    <div className="mb-3">
                        <div className="input-group">
                            <span className="input-group-text bg-white">
                                <i className="bi bi-search text-muted"></i>
                            </span>
                            <input
                                type="text"
                                className="form-control border-start-0"
                                placeholder="Search student name, father name, phone, family ID, admission no..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ fontSize: '0.875rem' }}
                            />
                            {search && (
                                <button className="btn btn-outline-secondary" onClick={() => setSearch('')} title="Clear">
                                    <i className="bi bi-x-lg"></i>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Row 2: Class (optional), Year, Status, Load button */}
                    <div className="row g-3 align-items-end">
                        <div className="col-md-3">
                            <label className="form-label fw-bold small text-muted">
                                <i className="bi bi-mortarboard me-1"></i>Class
                                <span className="text-muted fw-normal ms-1" style={{ fontSize: '0.7rem' }}>(optional)</span>
                            </label>
                            <select className="form-select" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
                                <option value="">All Classes</option>
                                {classes.map(c => <option key={c.class_id} value={c.class_id}>{c.class_name}</option>)}
                            </select>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-bold small text-muted">
                                <i className="bi bi-calendar3 me-1"></i>Year <span className="text-danger">*</span>
                            </label>
                            <input
                                type="text"
                                className="form-control bg-light text-dark fw-semibold"
                                value={activeYear?.year_name || year}
                                readOnly
                                disabled
                                style={{ cursor: 'not-allowed' }}
                            />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-bold small text-muted">
                                <i className="bi bi-circle-half me-1"></i>Status
                            </label>
                            <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                                <option value="all">All Statuses</option>
                                <option value="unpaid">Unpaid</option>
                                <option value="partial">Partial</option>
                                <option value="paid">Paid</option>
                                <option value="satteled">Settled</option>
                            </select>
                        </div>
                        <div className="col-md-3">
                            <button className="btn w-100 fw-bold" onClick={loadSlips} disabled={loading}
                                style={{ backgroundColor: 'var(--primary-teal)', color: '#fff', borderRadius: 8, height: 38 }}>
                                {loading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-search me-1"></i>}
                                {loading ? 'Loading...' : 'Load Slips'}
                            </button>
                        </div>
                    </div>

                    {/* Result count hint when loaded */}
                    {loaded && (
                        <div className="mt-2" style={{ fontSize: '0.8rem', color: '#888' }}>
                            <i className="bi bi-info-circle me-1"></i>
                            {filtered.length} voucher{filtered.length !== 1 ? 's' : ''} shown
                            {search ? ` matching "${search}"` : ''}
                            {selectedClass ? ` · ${classes.find(c => c.class_id.toString() === selectedClass)?.class_name || ''}` : ' · All Classes'}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Stats Cards ── */}
            {stats && loaded && (
                <div className="row g-3 mb-4">
                    {[
                        { label: 'Total Vouchers', value: slips.length, icon: 'bi-receipt', color: 'var(--primary-teal)', sub: `All months · ${year}` },
                        { label: 'Total Amount', value: fmt(stats.total_amount), icon: 'bi-currency-exchange', color: 'var(--primary-dark)', sub: `${stats.total_students} student(s)` },
                        { label: 'Collected', value: fmt(stats.paid_amount), icon: 'bi-check-circle-fill', color: '#198754', sub: `${collectionPct}% of total` },
                        { label: 'Pending', value: fmt(totalDue), icon: 'bi-hourglass-split', color: '#dc3545', sub: `${stats.unpaid_count} unpaid · ${stats.partial_count} partial` },
                    ].map((s, i) => (
                        <div className="col-md-3" key={i}>
                            <div className="card border-0 shadow-sm h-100" style={{ borderLeft: `4px solid ${s.color}` }}>
                                <div className="card-body py-3 px-3">
                                    <div className="d-flex align-items-center gap-3">
                                        <div style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: `${s.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <i className={`bi ${s.icon}`} style={{ fontSize: 20, color: s.color }}></i>
                                        </div>
                                        <div>
                                            <div className="text-muted small">{s.label}</div>
                                            <div className="fw-bold fs-6" style={{ color: 'var(--primary-dark)' }}>{s.value}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#888' }}>{s.sub}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {/* Progress bar row */}
                    <div className="col-12">
                        <div className="card border-0 shadow-sm">
                            <div className="card-body py-2 px-4">
                                <div className="d-flex justify-content-between small text-muted mb-1">
                                    <span>Collection Progress</span>
                                    <span className="fw-bold" style={{ color: 'var(--primary-teal)' }}>{collectionPct}%</span>
                                </div>
                                <div className="progress" style={{ height: 8, borderRadius: 8 }}>
                                    <div className="progress-bar" style={{ width: `${collectionPct}%`, backgroundColor: 'var(--primary-teal)', borderRadius: 8 }} />
                                </div>
                                <div className="d-flex gap-3 mt-2" style={{ fontSize: '0.72rem', color: '#888' }}>
                                    <span><span className="badge bg-success me-1">●</span>{stats.paid_count} Paid</span>
                                    <span><span className="badge me-1" style={{ backgroundColor: '#fd7e14' }}>●</span>{stats.partial_count} Partial</span>
                                    <span><span className="badge bg-danger me-1">●</span>{stats.unpaid_count} Unpaid</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Slips Table ── */}
            {loaded && (
                <div className="card border-0 shadow-sm">
                    <div className="card-header bg-white border-bottom py-3 d-flex align-items-center justify-content-between flex-wrap gap-2"
                        style={{ borderLeft: '4px solid var(--accent-orange)' }}>
                        <h6 className="mb-0 fw-bold" style={{ color: 'var(--primary-dark)' }}>
                            <i className="bi bi-list-ul me-2"></i>Fee Vouchers
                            <span className="badge rounded-pill ms-2" style={{ backgroundColor: 'var(--primary-teal)', fontSize: '0.7rem' }}>
                                {groupedFiltered.length}
                            </span>
                            {groupedFiltered.length !== filtered.length && (
                                <span className="text-muted ms-2" style={{ fontSize: '0.7rem', fontWeight: 400 }}>
                                    ({filtered.length} slips)
                                </span>
                            )}
                        </h6>
                        <div style={{ width: 240 }}>
                            <div className="input-group input-group-sm">
                                <span className="input-group-text bg-white"><i className="bi bi-search text-muted"></i></span>
                                <input type="text" className="form-control border-start-0"
                                    placeholder="Search by name or adm no..."
                                    value={search} onChange={e => setSearch(e.target.value)} />
                                {search && <button className="btn btn-outline-secondary btn-sm" onClick={() => setSearch('')}><i className="bi bi-x"></i></button>}
                            </div>
                        </div>
                    </div>
                    <div className="card-body p-0">
                        {groupedFiltered.length === 0 ? (
                            <div className="text-center py-5 text-muted">
                                <i className="bi bi-inbox fs-1 d-block mb-2"></i>
                                No vouchers found{search ? ` for "${search}"` : ''}.
                            </div>
                        ) : (
                            <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.875rem' }}>
                                    <thead style={{ backgroundColor: '#f0f9f9', color: 'var(--primary-dark)' }}>
                                        <tr>
                                            <th className="py-3 px-3" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>#</th>
                                            <th className="py-3 px-2" style={{ fontWeight: 600 }}>Student / Family</th>
                                            <th className="py-3 px-2" style={{ fontWeight: 600 }}>Class</th>
                                            <th className="py-3 px-2 text-center" style={{ fontWeight: 600 }}>Slips</th>
                                            <th className="py-3 px-2 text-end" style={{ fontWeight: 600 }}>Voucher Bill</th>
                                            <th className="py-3 px-2 text-end" style={{ fontWeight: 600 }}>Paid</th>
                                            <th className="py-3 px-2 text-end" style={{ fontWeight: 600 }}>Pending</th>
                                            <th className="py-3 px-2 text-center" style={{ fontWeight: 600 }}>Status</th>
                                            <th className="py-3 px-2 text-center" style={{ fontWeight: 600 }}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groupedFiltered.map((g, idx) => {
                                            const isFam = g.is_family_slip;
                                            const isTrustedGroup = g.is_trusted;
                                            const members = g.family_members || [];
                                            const groupTotalPaid = g.slips.reduce((sum, s) => sum + parseFloat(s.paid_amount as any || 0), 0);
                                            return (
                                                <tr key={g.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                    <td className="px-3 text-muted" style={{ fontSize: '0.78rem' }}>{idx + 1}</td>
                                                    <td className="px-2">
                                                        <div className="d-flex align-items-start gap-2">
                                                            <div style={{
                                                                width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                backgroundColor: isFam ? '#e8f5f5' : '#fff3ea'
                                                            }}>
                                                                <i className={`bi ${isFam ? 'bi-people-fill' : 'bi-person-fill'}`}
                                                                    style={{ color: isFam ? 'var(--primary-teal)' : 'var(--accent-orange)', fontSize: 16 }}></i>
                                                            </div>
                                                            <div>
                                                                <div className="fw-bold" style={{ color: 'var(--primary-dark)', lineHeight: 1.3 }}>
                                                                    {g.first_name} {g.last_name}
                                                                    {isFam && <span className="badge ms-1 rounded-pill" style={{ backgroundColor: 'var(--primary-teal)', fontSize: '0.65rem' }}>Family</span>}
                                                                    {isTrustedGroup && <span className="badge ms-1 rounded-pill" style={{ backgroundColor: '#0891b2', fontSize: '0.65rem' }}>Trusted</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.72rem', color: '#888' }}>Adm: {g.admission_no}</div>
                                                                {g.father_name && (
                                                                    <div style={{ fontSize: '0.72rem', color: '#666' }}>
                                                                        <i className="bi bi-person-lines-fill me-1" style={{ color: 'var(--primary-teal)', opacity: 0.7 }}></i>
                                                                        {g.father_name}{g.father_phone ? <span className="ms-2 text-muted">{g.father_phone}</span> : null}
                                                                    </div>
                                                                )}
                                                                {isFam && members.length > 0 && (
                                                                    <div className="d-flex flex-wrap gap-1 mt-1">
                                                                        {members.map((m, mi) => {
                                                                            const isMInactive = (m.status || 'Active').toLowerCase() !== 'active';
                                                                            return (
                                                                                <span key={mi} style={{
                                                                                    fontSize: '0.7rem',
                                                                                    backgroundColor: isMInactive ? '#f8d7da' : '#f0f9f9',
                                                                                    color: isMInactive ? '#842029' : 'var(--primary-teal)',
                                                                                    border: `1px solid ${isMInactive ? '#f5c2c7' : '#c5e8e8'}`,
                                                                                    borderRadius: 4,
                                                                                    padding: '1px 5px'
                                                                                }}>
                                                                                    {m.first_name} {m.last_name}{isMInactive ? ' (Inactive)' : ''}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-2">
                                                        <span className="badge bg-light text-dark border" style={{ fontSize: '0.72rem' }}>{g.class_name} {g.section_name ? g.section_name : ''}</span>
                                                    </td>
                                                    <td className="px-2 text-center">
                                                        {g.slips.length === 1 ? (
                                                            <button className="btn btn-sm py-1 px-2 fw-semibold" title="Click to view full fee breakdown"
                                                                style={{ backgroundColor: '#e8f5f5', color: 'var(--primary-teal)', border: '1px solid #c5e8e8', fontSize: '0.72rem', borderRadius: 6 }}
                                                                onClick={() => setSlipPickerGroup({ first_name: g.first_name, last_name: g.last_name, admission_no: g.admission_no, class_name: g.class_name, slips: g.slips })}>
                                                                {MONTHS[(g.slips[0].month ?? 1) - 1]?.slice(0, 3)} {g.slips[0].year}
                                                            </button>
                                                        ) : (
                                                            <button className="btn btn-sm fw-bold" title="Click to view all months breakdown"
                                                                style={{ fontSize: '0.72rem', backgroundColor: '#e8f5f5', color: 'var(--primary-teal)', border: '1.5px solid #215E61', borderRadius: 6 }}
                                                                onClick={() => setSlipPickerGroup({ first_name: g.first_name, last_name: g.last_name, admission_no: g.admission_no, class_name: g.class_name, slips: g.slips })}>
                                                                <i className="bi bi-calendar3 me-1"></i>{g.slips.length} months
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-2 text-end" style={{ color: 'var(--primary-dark)' }}>
                                                        <div className="fw-bold">{fmt(parseFloat(g.latest_unpaid.total_amount as any))}</div>
                                                        <div style={{ fontSize: '0.68rem', color: isTrustedGroup ? '#0891b2' : '#888' }}>
                                                            {isTrustedGroup && parseFloat(g.latest_unpaid.total_amount as any) <= 0 ? 'Free Tuition • ' : ''}
                                                            {MONTHS[(g.latest_unpaid.month ?? 1) - 1]?.slice(0, 3)} {g.latest_unpaid.year} Slip
                                                        </div>
                                                        {g.latest_unpaid.class_collected_amount && g.latest_unpaid.class_collected_amount > 0 ? (
                                                            <div className="mt-0.5">
                                                                <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle py-0.5 px-1" style={{ fontSize: '0.62rem' }} title={`PKR ${g.latest_unpaid.class_collected_amount} Exam Fee collected by teacher in class`}>
                                                                    <i className="bi bi-mortarboard-fill me-1"></i>PKR {g.latest_unpaid.class_collected_amount.toLocaleString('en-PK')} in Class
                                                                </span>
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                    <td className="px-2 text-end fw-bold" style={{ color: '#198754' }}>
                                                        {groupTotalPaid > 0
                                                            ? fmt(groupTotalPaid)
                                                            : <span className="text-muted">—</span>}
                                                    </td>
                                                    <td className="px-2 text-end fw-bold" style={{ color: ['satteled', 'settled'].includes((g.status || '').toLowerCase()) ? '#0891b2' : g.balance > 0 ? '#dc3545' : '#198754' }}>
                                                        {['satteled', 'settled'].includes((g.status || '').toLowerCase()) ? (
                                                            <span className="badge rounded-pill px-2 py-0.5" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '0.72rem' }}>
                                                                ✓ Settled (Nill)
                                                            </span>
                                                        ) : g.balance > 0 ? (
                                                            fmt(g.balance)
                                                        ) : (
                                                            <span className="text-success">✓ Clear</span>
                                                        )}
                                                    </td>
                                                    <td className="px-2 text-center">
                                                        <div className="d-flex flex-column align-items-center gap-1">
                                                            <StatusBadge status={g.status} />
                                                            {g.latest_unpaid.is_active_year === false && (
                                                                <span className="badge bg-secondary" style={{ fontSize: '0.62rem' }}>
                                                                    <i className="bi bi-lock-fill me-1"></i>Closed Session
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-2 text-center">
                                                        {g.balance <= 0 || g.latest_unpaid.is_active_year === false ? (
                                                            <button className="btn btn-sm" style={{ fontSize: '0.72rem', backgroundColor: '#e8f5e9', color: '#198754', border: '1px solid #c3e6cb', borderRadius: 6 }}
                                                                onClick={() => openPayModal(g.latest_paid || g.latest_slip)}>
                                                                <i className="bi bi-eye me-1"></i>{g.latest_unpaid.is_active_year === false ? 'View Slip' : 'History'}
                                                            </button>
                                                        ) : (
                                                            <div className="d-flex gap-1 justify-content-center">
                                                                <button className="btn btn-sm fw-bold" style={{ fontSize: '0.72rem', backgroundColor: 'var(--accent-orange)', color: '#fff', borderRadius: 6, border: 'none' }}
                                                                    onClick={() => openPayModal(g.latest_unpaid)}>
                                                                    <i className="bi bi-cash me-1"></i>Collect
                                                                </button>
                                                                {g.has_payments && (
                                                                    <button className="btn btn-sm" title="Reverse a payment" style={{ fontSize: '0.72rem', backgroundColor: '#fff0f0', color: '#dc3545', border: '1px solid #f5c2c7', borderRadius: 6 }}
                                                                        onClick={() => openPayModal(g.latest_paid || g.latest_slip)}>
                                                                        <i className="bi bi-arrow-counterclockwise"></i>
                                                                    </button>
                                                                )}
                                                            </div>
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
                </div>
            )}

            {/* ── Monthly Breakdown Modal ── */}
            {slipPickerGroup && (
                <>
                    <div className="modal-backdrop fade show" style={{ zIndex: 1040 }} onClick={() => setSlipPickerGroup(null)} />
                    <div className="modal fade show d-block" style={{ zIndex: 1045 }} tabIndex={-1}>
                        <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
                                <div className="modal-header border-0 px-4 pt-4 pb-3"
                                    style={{ background: 'linear-gradient(135deg, var(--primary-dark) 0%, var(--primary-teal) 100%)', borderRadius: '16px 16px 0 0' }}>
                                    <div className="text-white">
                                        <h5 className="mb-1 fw-bold d-flex align-items-center gap-2">
                                            <i className="bi bi-receipt-cutoff"></i>
                                            Monthly Fee Breakdown
                                        </h5>
                                        <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                                            <span className="fw-semibold">{slipPickerGroup.first_name} {slipPickerGroup.last_name}</span>
                                            {slipPickerGroup.admission_no && <span className="ms-2 badge bg-light text-dark">Adm: {slipPickerGroup.admission_no}</span>}
                                            {slipPickerGroup.class_name && <span className="ms-2 badge bg-light text-dark">{slipPickerGroup.class_name}</span>}
                                            <span className="ms-2 badge bg-info text-dark">{slipPickerGroup.slips.length} {slipPickerGroup.slips.length === 1 ? 'Month' : 'Months'}</span>
                                        </div>
                                    </div>
                                    <button className="btn-close btn-close-white ms-auto" onClick={() => setSlipPickerGroup(null)} />
                                </div>

                                <div className="modal-body px-4 py-3 bg-light">
                                    {/* Overall Totals Summary Banner if multi-month */}
                                    {slipPickerGroup.slips.length > 1 && (() => {
                                        const sortedSlips = [...slipPickerGroup.slips].sort((a, b) => (a.year - b.year) || (a.month - b.month));
                                        const latestSlip = sortedSlips[sortedSlips.length - 1];
                                        const isSettled = sortedSlips.some(s => ['satteled', 'settled'].includes((s.status || '').toLowerCase())) ||
                                            ['satteled', 'settled'].includes((latestSlip.status || '').toLowerCase());

                                        const totalPaid = slipPickerGroup.slips.reduce((s, sl) => s + parseFloat(sl.paid_amount as any || 0), 0);
                                        const totalPending = isSettled ? 0 : Math.max(0, parseFloat(latestSlip.total_amount as any || 0) - parseFloat(latestSlip.paid_amount as any || 0));
                                        const totalBilled = totalPaid + totalPending;

                                        return (
                                            <div className="card border-0 shadow-sm mb-3 bg-white">
                                                <div className="card-body p-3">
                                                    <div className="row text-center g-2">
                                                        <div className="col-4 border-end">
                                                            <div className="text-muted small fw-bold">TOTAL BILLED</div>
                                                            <div className="fw-bold fs-6" style={{ color: 'var(--primary-dark)' }}>{fmt(totalBilled)}</div>
                                                            <div style={{ fontSize: '0.68rem', color: '#888' }}>Session Net Dues</div>
                                                        </div>
                                                        <div className="col-4 border-end">
                                                            <div className="text-muted small fw-bold">TOTAL PAID</div>
                                                            <div className="fw-bold fs-6 text-success">{fmt(totalPaid)}</div>
                                                            <div style={{ fontSize: '0.68rem', color: '#888' }}>All Months Paid</div>
                                                        </div>
                                                        <div className="col-4">
                                                            <div className="text-muted small fw-bold">TOTAL BALANCE</div>
                                                            <div className="fw-bold fs-6" style={{ color: totalPending > 0 ? '#dc3545' : '#198754' }}>
                                                                {totalPending > 0 ? fmt(totalPending) : '✓ Cleared'}
                                                            </div>
                                                            <div style={{ fontSize: '0.68rem', color: '#888' }}>Latest Active Dues</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Month by Month Cards */}
                                    <div className="d-flex flex-column gap-3">
                                        {slipPickerGroup.slips.map((slip) => {
                                            const slipTotal = parseFloat(slip.total_amount as any || 0);
                                            const slipPaid = parseFloat(slip.paid_amount as any || 0);
                                            const slipBal = Math.max(0, slipTotal - slipPaid);
                                            const isPaidOrSatteled = ['paid', 'satteled'].includes(slip.status) || slipBal === 0;

                                            return (
                                                <div key={slip.slip_id} className="card border-0 shadow-sm bg-white overflow-hidden"
                                                    style={{ borderLeft: `4px solid ${isPaidOrSatteled ? '#198754' : slipPaid > 0 ? '#fd7e14' : '#dc3545'}` }}>
                                                    {/* Month Header */}
                                                    <div className="card-header bg-white py-2 px-3 d-flex justify-content-between align-items-center border-bottom">
                                                        <div className="d-flex align-items-center gap-2">
                                                            <div style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'var(--primary-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>
                                                                <i className="bi bi-calendar-event"></i>
                                                            </div>
                                                            <div>
                                                                <span className="fw-bold" style={{ color: 'var(--primary-dark)', fontSize: '0.95rem' }}>
                                                                    {MONTHS[(slip.month ?? 1) - 1]} {slip.year}
                                                                </span>
                                                                {slip.is_family_slip && (
                                                                    <span className="badge rounded-pill ms-2" style={{ backgroundColor: 'var(--primary-teal)', fontSize: '0.65rem' }}>
                                                                        Family Slip
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <StatusBadge status={slip.status} />
                                                            {slip.due_date && (
                                                                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                                    Due: {fmtDate(slip.due_date)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Line Items Breakdown */}
                                                    <div className="card-body p-3">
                                                        <div className="table-responsive">
                                                            <table className="table table-sm table-borderless align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                                                                <thead className="border-bottom text-muted" style={{ fontSize: '0.75rem' }}>
                                                                    <tr>
                                                                        <th className="py-1">FEE HEAD / DESCRIPTION</th>
                                                                        <th className="py-1 text-end">BILLED AMOUNT</th>
                                                                        <th className="py-1 text-end">PAID</th>
                                                                        <th className="py-1 text-end">REMAINING</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(!slip.line_items || slip.line_items.length === 0) ? (
                                                                        <tr>
                                                                            <td colSpan={4} className="text-muted py-2 text-center">
                                                                                Tuition / General Fee: {fmt(slipTotal)}
                                                                            </td>
                                                                        </tr>
                                                                    ) : (
                                                                        slip.line_items.map((item, itemIdx) => {
                                                                            const itemAmt = parseFloat(item.amount as any || 0);
                                                                            const itemPaid = parseFloat(item.paid_amount as any || 0);
                                                                            const itemRem = Math.max(0, itemAmt - itemPaid);
                                                                            const isTuition = item.head_name.toLowerCase().includes('tuition') || item.head_name.toLowerCase().includes('family');
                                                                            const isPB = item.head_name.toLowerCase().includes('previous') || item.head_name.toLowerCase().includes('opening');

                                                                            return (
                                                                                <tr key={itemIdx} className="border-bottom border-light">
                                                                                    <td className="py-1 text-dark">
                                                                                        <div className="fw-semibold">
                                                                                            {isTuition && <i className="bi bi-mortarboard me-1 text-primary"></i>}
                                                                                            {isPB && <i className="bi bi-clock-history me-1 text-warning"></i>}
                                                                                            {!isTuition && !isPB && <i className="bi bi-tag me-1 text-secondary"></i>}
                                                                                            {item.head_name}
                                                                                        </div>
                                                                                        {item.note && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{item.note}</div>}
                                                                                        {item.class_collected_amount && item.class_collected_amount > 0 ? (
                                                                                            <div className="text-warning-emphasis fw-semibold mt-0.5" style={{ fontSize: '0.7rem' }}>
                                                                                                <i className="bi bi-mortarboard-fill text-warning me-1"></i>
                                                                                                PKR {item.class_collected_amount.toLocaleString('en-PK')} collected in class
                                                                                                {item.class_collected_students && item.class_collected_students.length > 0 && (
                                                                                                    <span className="text-muted ms-1">
                                                                                                        ({item.class_collected_students.map((st: any) => `${st.name}${st.class_name ? ` - ${st.class_name}` : ''}`).join(', ')})
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        ) : null}
                                                                                    </td>
                                                                                    <td className="py-1 text-end fw-semibold" style={{ color: 'var(--primary-dark)' }}>
                                                                                        {fmt(itemAmt)}
                                                                                    </td>
                                                                                    <td className="py-1 text-end text-success fw-semibold">
                                                                                        {itemPaid > 0 ? fmt(itemPaid) : '—'}
                                                                                    </td>
                                                                                    <td className="py-1 text-end fw-bold" style={{ color: itemRem > 0 ? '#dc3545' : '#198754' }}>
                                                                                        {itemRem > 0 ? fmt(itemRem) : '✓'}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        {/* Month Summary & Action Footer */}
                                                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top">
                                                            <div className="d-flex gap-3 align-items-center">
                                                                <div>
                                                                    <span className="text-muted small">Total: </span>
                                                                    <span className="fw-bold" style={{ color: 'var(--primary-dark)' }}>{fmt(slipTotal)}</span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-muted small">Paid: </span>
                                                                    <span className="fw-bold text-success">{fmt(slipPaid)}</span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-muted small">Balance: </span>
                                                                    <span className="fw-bold" style={{ color: slipBal > 0 ? '#dc3545' : '#198754' }}>
                                                                        {slipBal > 0 ? fmt(slipBal) : '✓ Clear'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {/* <div>
                                                                {slip.is_active_year === false ? (
                                                                    <button className="btn btn-sm btn-outline-secondary"
                                                                        onClick={() => { setSlipPickerGroup(null); openPayModal(slip); }}>
                                                                        <i className="bi bi-eye me-1"></i>View Payment Details
                                                                    </button>
                                                                ) : isPaidOrSatteled ? (
                                                                    <button className="btn btn-sm btn-outline-success"
                                                                        onClick={() => { setSlipPickerGroup(null); openPayModal(slip); }}>
                                                                        <i className="bi bi-clock-history me-1"></i>Payment History
                                                                    </button>
                                                                ) : (
                                                                    <button className="btn btn-sm fw-bold"
                                                                        style={{ backgroundColor: 'var(--accent-orange)', color: '#fff', border: 'none', borderRadius: 6 }}
                                                                        onClick={() => { setSlipPickerGroup(null); openPayModal(slip); }}>
                                                                        <i className="bi bi-cash me-1"></i>Collect {MONTHS[(slip.month ?? 1) - 1]?.slice(0, 3)} Fee
                                                                    </button>
                                                                )}
                                                            </div> */}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="modal-footer border-0 px-4 py-3 bg-white" style={{ borderRadius: '0 0 16px 16px' }}>
                                    <button className="btn btn-secondary px-4" onClick={() => setSlipPickerGroup(null)}>
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* ── Payment Modal ── */}
            {payModal && activeSlip && (
                <>
                    <div className="modal-backdrop fade show" style={{ zIndex: 1040 }} onClick={() => setPayModal(false)} />
                    <div className="modal fade show d-block" style={{ zIndex: 1045 }} tabIndex={-1}>
                        <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
                                {/* Modal Header */}
                                <div className="modal-header border-0 pb-0 px-4 pt-4" style={{ background: 'linear-gradient(135deg, var(--primary-dark) 0%, var(--primary-teal) 100%)', borderRadius: '16px 16px 0 0' }}>
                                    <div className="text-white">
                                        <h5 className="modal-title fw-bold mb-1">
                                            <i className="bi bi-cash-coin me-2"></i>
                                            {activeSlip.is_active_year === false ? 'Voucher Details (Closed Session)' : ['paid', 'satteled'].includes(activeSlip.status) ? 'Payment History' : 'Collect Fee Payment'}
                                        </h5>
                                        <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                                            {activeSlip.is_family_slip ? (
                                                <><i className="bi bi-people-fill me-1"></i>Family Voucher · {activeSlip.first_name} {activeSlip.last_name}</>
                                            ) : (
                                                <><i className="bi bi-person me-1"></i>{activeSlip.first_name} {activeSlip.last_name} · Adm# {activeSlip.admission_no}</>
                                            )}
                                            <span className="ms-3">· {activeSlip.class_name}</span>
                                            {activeSlip.academic_year_name && (
                                                <span className="badge bg-light text-dark ms-2" style={{ fontSize: '0.7rem' }}>
                                                    <i className="bi bi-calendar3 me-1"></i>{activeSlip.academic_year_name}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button className="btn-close btn-close-white ms-auto" onClick={() => setPayModal(false)} />
                                </div>

                                <div className="modal-body px-4 py-3">
                                    {/* Closed Fiscal Year Alert */}
                                    {activeSlip.is_active_year === false && (
                                        <div className="alert alert-warning border-0 shadow-sm d-flex align-items-center gap-2 mb-3 py-2">
                                            <i className="bi bi-lock-fill fs-5"></i>
                                            <div className="small">
                                                <strong>Fiscal Year Closed (Read-Only):</strong> This voucher belongs to a closed academic session ({activeSlip.academic_year_name || 'Closed'}). Payment collection and reversals are locked.
                                            </div>
                                        </div>
                                    )}
                                    {/* Slip summary bar */}
                                    <div className="row g-2 mb-3">
                                        {[
                                            { label: 'Total Amount', value: fmt(parseFloat(activeSlip.total_amount as any)), color: 'var(--primary-dark)' },
                                            { label: 'Paid So Far', value: fmt(parseFloat(activeSlip.paid_amount as any)), color: '#198754' },
                                            { label: 'Balance Due', value: isModalSlipSettled ? 'PKR 0 (Settled)' : fmt(modalSlipBalance), color: isModalSlipSettled ? '#0891b2' : (modalSlipBalance > 0 ? '#dc3545' : '#198754') },
                                        ].map((s, i) => (
                                            <div className="col-4" key={i}>
                                                <div className="text-center py-2 px-1 rounded" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}>
                                                    <div style={{ fontSize: '0.68rem', color: '#888', fontWeight: 600 }}>{s.label}</div>
                                                    <div className="fw-bold" style={{ fontSize: '0.9rem', color: s.color }}>{s.value}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Family members list */}
                                    {activeSlip.is_family_slip && (activeSlip.family_members || []).length > 0 && (
                                        <div className="mb-3 p-2 rounded" style={{ backgroundColor: '#e8f5f5', border: '1px solid #c5e8e8' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-teal)', marginBottom: 4 }}>
                                                <i className="bi bi-people-fill me-1"></i>Students Covered ({activeSlip.family_members!.length})
                                            </div>
                                            <div className="d-flex flex-wrap gap-1">
                                                {activeSlip.family_members!.map((m, i) => (
                                                    <span key={i} style={{ fontSize: '0.72rem', backgroundColor: '#fff', color: 'var(--primary-dark)', border: '1px solid #b8dede', borderRadius: 5, padding: '2px 7px' }}>
                                                        {m.first_name} {m.last_name} <span style={{ color: '#888' }}>({m.class_name})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Fee breakdown (Hidden as per request)
                                    {activeSlip.line_items && activeSlip.line_items.length > 0 && (
                                        <div className="mb-3">
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>Fee Breakdown</div>
                                            <div className="rounded overflow-hidden" style={{ border: '1px solid #e9ecef' }}>
                                                {activeSlip.line_items.map((li, i) => (
                                                    <div key={i} className="d-flex justify-content-between align-items-center px-3 py-1"
                                                        style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8f9fa', fontSize: '0.78rem' }}>
                                                        <span style={{ color: '#555' }}>{li.head_name}{li.note ? <span className="text-muted ms-1">({li.note})</span> : ''}</span>
                                                        <span className="fw-bold" style={{ color: 'var(--primary-dark)' }}>{fmt(parseFloat(li.amount as any))}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )} 
                                    */}

                                    {/* Payment history always visible so Delete button is always accessible */}
                                    <div className="mb-3">
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>
                                            <i className="bi bi-clock-history me-1"></i>Payment History
                                        </div>
                                        {loadingHistory ? (
                                            <div className="text-center py-2"><div className="spinner-border spinner-border-sm text-secondary" /></div>
                                        ) : slipPayments.length === 0 ? (
                                            <div className="text-muted small py-2 px-3 rounded" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}>
                                                <i className="bi bi-info-circle me-1"></i>No payments recorded yet for this slip.
                                            </div>
                                        ) : (
                                            <div className="rounded overflow-hidden" style={{ border: '1px solid #e9ecef' }}>
                                                {slipPayments.map((p, i) => (
                                                    <div key={p.payment_id} className="d-flex justify-content-between align-items-center px-3 py-2"
                                                        style={{ backgroundColor: i % 2 === 0 ? '#f0fff7' : '#f8f9fa', fontSize: '0.78rem', borderBottom: i < slipPayments.length - 1 ? '1px solid #e9ecef' : 'none' }}>
                                                        <div className="flex-grow-1">
                                                            <span className="fw-bold" style={{ color: '#198754' }}>{fmt(parseFloat(p.amount_paid as any))}</span>
                                                            <span className="text-muted ms-2">via {p.payment_method}</span>
                                                            {p.received_by && <span className="text-muted ms-2">· {p.received_by}</span>}
                                                            {p.reference_no && <span className="text-muted ms-2">· Ref: {p.reference_no}</span>}
                                                            <span className={`ms-2 px-1 rounded text-white ${p.is_printed ? 'bg-success' : 'bg-warning text-dark'}`} style={{ fontSize: '0.65rem' }}>{p.is_printed ? 'Printed' : 'Not Printed'}</span>
                                                            {p.notes && <div style={{ fontSize: '0.7rem', color: '#888' }}>{p.notes}</div>}
                                                        </div>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <span style={{ fontSize: '0.72rem', color: '#888' }}>{fmtDate(p.payment_date)}</span>
                                                            <button
                                                                className="btn btn-sm"
                                                                title="Print Receipt"
                                                                onClick={() => {
                                                                    const prevPaid = parseFloat(activeSlip!.paid_amount as any) - parseFloat(p.amount_paid as any);
                                                                    openReceiptWindow(activeSlip!, parseFloat(p.amount_paid as any), p.payment_date, prevPaid);
                                                                    if (!p.is_printed) {
                                                                        fetch(`${API}/fee-slips/payments/${p.payment_id}/print`, { method: 'PUT' })
                                                                            .then((res) => {
                                                                                setSlipPayments(prev => prev.map(x => x.payment_id === p.payment_id ? { ...x, is_printed: true } : x));
                                                                            });
                                                                    }
                                                                }}
                                                                style={{ fontSize: '0.7rem', backgroundColor: '#e8f5e9', color: '#198754', border: '1px solid #c3e6cb', borderRadius: 6, padding: '2px 7px' }}>
                                                                <i className="bi bi-printer"></i>
                                                            </button>
                                                            {/* <button
                                                                className="btn btn-sm"
                                                                title="Print Receipt"
                                                                onClick={() => {
                                                                    openReceiptWindow(activeSlip!, parseFloat(p.amount_paid as any), p.payment_date, parseFloat(activeSlip!.paid_amount as any) - parseFloat(p.amount_paid as any));
                                                                    if (!p.is_printed) {
                                                                        fetch(`${API}/fee-slips/payments/${p.payment_id}/print`, { method: 'PUT' })
                                                                           .then((res) => {
                                                                               setSlipPayments(prev => prev.map(x => x.payment_id === p.payment_id ? { ...x, is_printed: true } : x));
                                                                           });
                                                                    }
                                                                }}
                                                                style={{ fontSize: '0.7rem', backgroundColor: '#e8f5e9', color: '#198754', border: '1px solid #c3e6cb', borderRadius: 6, padding: '2px 7px' }}>
                                                                <i className="bi bi-printer"></i>
                                                            </button>
                                                            <button
                                                                className="btn btn-sm"
                                                                title="Print Receipt"
                                                                onClick={() => {
                                                                    openReceiptWindow(activeSlip!, parseFloat(p.amount_paid as any), p.payment_date, parseFloat(activeSlip!.paid_amount as any) - parseFloat(p.amount_paid as any));
                                                                    if (!p.is_printed) {
                                                                        fetch(`${API}/fee-slips/payments/${p.payment_id}/print`, { method: 'PUT' })
                                                                           .then((res) => {
                                                                               setSlipPayments(prev => prev.map(x => x.payment_id === p.payment_id ? { ...x, is_printed: true } : x));
                                                                           });
                                                                    }
                                                                }}
                                                                style={{ fontSize: '0.7rem', backgroundColor: '#e8f5e9', color: '#198754', border: '1px solid #c3e6cb', borderRadius: 6, padding: '2px 7px' }}>
                                                                <i className="bi bi-printer"></i>
                                                            </button>

                                                              <button
                                                                  className="btn btn-sm"
                                                                  title="Print Receipt"
                                                                  onClick={() => {
                                                                      openReceiptWindow(activeSlip!, parseFloat(p.amount_paid as any), p.payment_date, parseFloat(activeSlip!.paid_amount as any) - parseFloat(p.amount_paid as any));
                                                                      if (!p.is_printed) {
                                                                          fetch(`${API}/fee-slips/payments/${p.payment_id}/print`, { method: 'PUT' });
                                                                          setSlipPayments(prev => prev.map(x => x.payment_id === p.payment_id ? { ...x, is_printed: true } : x));
                                                                      }
                                                                  }}
                                                                  style={{ fontSize: '0.7rem', backgroundColor: '#e8f5e9', color: '#198754', border: '1px solid #c3e6cb', borderRadius: 6, padding: '2px 7px' }}>
                                                                  <i className="bi bi-printer"></i>
                                                              </button> */}
                                                            {hasPermission('fees', 'delete') && activeSlip.is_active_year !== false && (
                                                                <button
                                                                    className="btn btn-sm"
                                                                    title="Reverse this payment"
                                                                    disabled={deletingPaymentId === p.payment_id}
                                                                    onClick={() => deletePayment(p.payment_id)}
                                                                    style={{ fontSize: '0.7rem', backgroundColor: '#fff0f0', color: '#dc3545', border: '1px solid #f5c2c7', borderRadius: 6, padding: '2px 7px' }}>
                                                                    {deletingPaymentId === p.payment_id
                                                                        ? <span className="spinner-border spinner-border-sm" />
                                                                        : <><i className="bi bi-arrow-counterclockwise me-1"></i>Reverse</>}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Payment Form */}
                                    {!isModalSlipSettled && activeSlip.status !== 'paid' && activeSlip.is_active_year !== false && (
                                        <div className="rounded p-3" style={{ backgroundColor: '#fffbf5', border: '1px solid #ffe5cc' }}>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-orange)', marginBottom: 10 }}>
                                                <i className="bi bi-plus-circle me-1"></i>Record New Payment
                                            </div>

                                            <div className="row g-2 mt-2">
                                                <div className="col-12 w-100 mb-2">
                                                    <label className="form-label small fw-bold text-muted mb-2">Amount Breakdown <span className="text-danger">*</span></label>
                                                    <div className="d-flex flex-column gap-2 p-2 bg-light border rounded" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                                        {(!activeSlip.line_items || activeSlip.line_items.length === 0) ? (
                                                            <div className="d-flex flex-wrap justify-content-between align-items-center bg-white p-2.5 rounded-3 border shadow-sm gap-2">
                                                                <span className="small fw-bold text-dark">Total Balance</span>
                                                                <div className="input-group input-group-sm w-auto" style={{ width: '130px', maxWidth: '140px' }}>
                                                                    <span className="input-group-text bg-light text-muted small px-2 fw-bold" style={{ fontSize: '0.78rem' }}>PKR</span>
                                                                    <input type="number" className="form-control form-control-sm text-end fw-bold no-spinner" placeholder="0"
                                                                        onKeyDown={e => ['e', 'E', '+', '-', '.', 'ArrowUp', 'ArrowDown'].includes(e.key) && e.preventDefault()}
                                                                        onWheel={e => (e.target as HTMLElement).blur()}
                                                                        value={headPayVals['fallback'] || ''}
                                                                        onChange={(e) => {
                                                                            const vStr = e.target.value;
                                                                            if (vStr === '') { setHeadPayVals({ ...headPayVals, fallback: '' }); return; }
                                                                            let val = Math.max(0, parseFloat(vStr) || 0);
                                                                            const totBal = Math.max(0, parseFloat(activeSlip.total_amount as any) - parseFloat(activeSlip.paid_amount as any));
                                                                            if (totBal > 0 && val > totBal) val = totBal;
                                                                            setHeadPayVals({ ...headPayVals, fallback: val > 0 ? val.toString() : '' });
                                                                        }}
                                                                        style={{ fontSize: '0.9rem', fontWeight: 600, padding: '4px 8px' }}
                                                                        min="0" />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            (() => {
                                                                const isTuition = (name: string) => (name || '').toLowerCase().includes('tuition') || (name || '').toLowerCase().includes('family monthly fee');
                                                                const isPrevBal = (name: string) => !name || (name || '').toLowerCase().includes('previous balance') || (name || '').toLowerCase().includes('opening balance');

                                                                let tItem: any = null, pbItem: any = null;
                                                                const others: any[] = [];

                                                                activeSlip.line_items.forEach((item: any) => {
                                                                    if (isTuition(item.head_name)) tItem = item;
                                                                    else if (isPrevBal(item.head_name)) pbItem = item;
                                                                    else others.push(item);
                                                                });

                                                                const elements: any[] = [];
                                                                let keyIdx = 0;
                                                                const isTrustedSlip = Boolean(
                                                                    (activeSlip as any).is_trusted ||
                                                                    (activeSlip.category && activeSlip.category.trim().toLowerCase() === 'trusted') ||
                                                                    (activeSlip.family_members && activeSlip.family_members.length > 0 && activeSlip.family_members.every((m: any) => (m.category || '').toLowerCase() === 'trusted'))
                                                                );

                                                                if (tItem || pbItem) {
                                                                    const tAmtB = parseFloat(tItem?.amount || 0);
                                                                    const tPaid = parseFloat(tItem?.paid_amount || 0);
                                                                    const tRem = +(tAmtB - tPaid).toFixed(2);
                                                                    const tId = tItem ? (tItem.item_id ? tItem.item_id.toString() : tItem.head_name) : null;

                                                                    const pbAmtB = parseFloat(pbItem?.amount || 0);
                                                                    const pbPaid = parseFloat(pbItem?.paid_amount || 0);
                                                                    const pbRem = +(pbAmtB - pbPaid).toFixed(2);
                                                                    const pbId = pbItem ? (pbItem.item_id ? pbItem.item_id.toString() : pbItem.head_name || 'Previous Balance') : null;

                                                                    const combAmtB = tAmtB + pbAmtB;
                                                                    const combPaid = tPaid + pbPaid;
                                                                    const combRem = (combAmtB - combPaid).toFixed(2);

                                                                    const currentTVal = parseFloat(headPayVals[tId as string] || '0');
                                                                    const currentPbVal = parseFloat(headPayVals[pbId as string] || '0');
                                                                    const combInputVal = currentTVal + currentPbVal;

                                                                    const dsDis = parseFloat(combRem) <= 0 && combPaid > 0;

                                                                    if (isTrustedSlip) {
                                                                        elements.push(
                                                                            <div key={'comb-' + (keyIdx++)} className="d-flex flex-wrap justify-content-between align-items-center bg-white p-2.5 rounded-3 border shadow-sm gap-2">
                                                                                <div className="d-flex flex-column flex-grow-1 min-w-0 me-2" style={{ maxWidth: '100%' }}>
                                                                                    <span className="text-dark fw-bold text-truncate" style={{ fontSize: '0.88rem' }}>
                                                                                        {tItem ? (tItem.head_name || 'Tuition Fee') : 'Tuition Fee'}
                                                                                    </span>
                                                                                    <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                                                        Regular Fee: PKR {combAmtB.toLocaleString('en-PK')} • <span className="text-info fw-semibold">100% Concession (Trusted)</span>
                                                                                    </span>
                                                                                </div>
                                                                                <div className="d-flex align-items-center gap-2 flex-wrap ms-auto">
                                                                                    <span className="badge rounded-pill" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '0.75rem', padding: '4px 8px' }}>
                                                                                        ✓ Free Tuition (Nill)
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    } else {
                                                                        elements.push(
                                                                            <div key={'comb-' + (keyIdx++)} className="d-flex flex-wrap justify-content-between align-items-center bg-white p-2.5 rounded-3 border shadow-sm gap-2">
                                                                                <div className="d-flex flex-column flex-grow-1 min-w-0 me-2" style={{ maxWidth: '100%' }}>
                                                                                    <span className="text-dark fw-bold text-truncate" style={{ fontSize: '0.88rem' }}>
                                                                                        {(tItem && pbItem) ? 'Tuition Fee + Prev. Balance' : (tItem ? (tItem.head_name || 'Tuition Fee') : (pbItem?.head_name || 'Previous Balance'))}
                                                                                    </span>
                                                                                    <span className="text-muted" style={{ fontSize: '0.72rem' }}>Billed: {combAmtB.toLocaleString('en-PK')} {combPaid > 0 ? ' • Paid: ' + combPaid.toLocaleString('en-PK') : ''}</span>
                                                                                    {(tItem && pbItem) && (
                                                                                        <span className="text-muted fw-semibold" style={{ fontSize: '0.68rem' }}>
                                                                                            (Remaining Tuition: {tRem.toLocaleString('en-PK')} | Prev: {pbRem.toLocaleString('en-PK')})
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="d-flex align-items-center gap-2 flex-wrap ms-auto">
                                                                                    {combAmtB > 0 && (
                                                                                        <span className="badge bg-danger-subtle text-danger border border-danger-subtle fw-bold py-1.5 px-2" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                                                                            Bal: {combRem}
                                                                                        </span>
                                                                                    )}
                                                                                    <div className="input-group input-group-sm w-auto" style={{ width: '130px', maxWidth: '140px' }}>
                                                                                        <span className="input-group-text bg-light text-muted small px-2 fw-bold" style={{ fontSize: '0.78rem' }}>PKR</span>
                                                                                        <input type="number" className="form-control form-control-sm text-end fw-bold no-spinner" placeholder="0"
                                                                                            onKeyDown={e => ['e', 'E', '+', '-', '.', 'ArrowUp', 'ArrowDown'].includes(e.key) && e.preventDefault()}
                                                                                            onWheel={e => (e.target as HTMLElement).blur()}
                                                                                            value={combInputVal > 0 ? combInputVal : ''}
                                                                                            onChange={(e) => {
                                                                                                const vStr = e.target.value;
                                                                                                if (vStr === '') {
                                                                                                    setHeadPayVals({ ...headPayVals, ...(pbId ? { [pbId]: '' } : {}), ...(tId ? { [tId]: '' } : {}) });
                                                                                                    return;
                                                                                                }
                                                                                                let val = Math.max(0, parseFloat(vStr) || 0);
                                                                                                const maxComb = parseFloat(combRem) || 0;
                                                                                                if (maxComb > 0 && val > maxComb) {
                                                                                                    val = maxComb; // Cap at remaining balance
                                                                                                }
                                                                                                let newPb = 0, newT = 0;
                                                                                                if (val <= pbRem) {
                                                                                                    newPb = Math.max(0, val);
                                                                                                } else {
                                                                                                    newPb = Math.max(0, pbRem);
                                                                                                    newT = Math.max(0, val - pbRem);
                                                                                                }
                                                                                                if (pbRem <= 0) { newPb = 0; newT = Math.max(0, val); }

                                                                                                setHeadPayVals({
                                                                                                    ...headPayVals,
                                                                                                    ...(pbId ? { [pbId]: newPb > 0 ? newPb.toString() : '' } : {}),
                                                                                                    ...(tId ? { [tId]: newT > 0 ? newT.toString() : '' } : {})
                                                                                                });
                                                                                            }}
                                                                                            style={{ fontSize: '0.9rem', fontWeight: 600, padding: '4px 8px' }}
                                                                                            disabled={dsDis} min="0" />
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                }

                                                                others.forEach((item: any) => {
                                                                    const headId = item.item_id ? item.item_id.toString() : item.head_name;
                                                                    const amtB = parseFloat(item.amount || 0);
                                                                    const paid = parseFloat(item.paid_amount || 0);
                                                                    const rem = (amtB - paid).toFixed(2);
                                                                    const remNum = Math.max(0, parseFloat(rem) || 0);

                                                                    const isLateFine = (item.head_name || '').toLowerCase().includes('late') || (item.head_name || '').toLowerCase().includes('fine');
                                                                    const isWaived = item.item_id ? waivedItemIds.includes(item.item_id) : false;

                                                                    let isFineDatePassed = true;
                                                                    if (isLateFine && activeSlip.due_date) {
                                                                        let cutoff = new Date(activeSlip.due_date);
                                                                        if (item.fine_after_day && parseInt(item.fine_after_day) > 0) {
                                                                            cutoff.setDate(parseInt(item.fine_after_day));
                                                                        }
                                                                        const pDate = new Date(payDate || new Date().toISOString().split('T')[0]);
                                                                        if (pDate <= cutoff) {
                                                                            isFineDatePassed = false;
                                                                        }
                                                                    }

                                                                    const toggleWaive = (itemId: number) => {
                                                                        if (waivedItemIds.includes(itemId)) {
                                                                            setWaivedItemIds(waivedItemIds.filter(id => id !== itemId));
                                                                            setHeadPayVals(prev => ({ ...prev, [itemId.toString()]: remNum > 0 ? remNum.toString() : '' }));
                                                                        } else {
                                                                            setWaivedItemIds([...waivedItemIds, itemId]);
                                                                            setHeadPayVals(prev => ({ ...prev, [itemId.toString()]: '' }));
                                                                        }
                                                                    };

                                                                    elements.push(
                                                                        <div key={'other-' + (keyIdx++)} className="d-flex flex-wrap justify-content-between align-items-center bg-white p-2.5 rounded-3 border shadow-sm gap-2">
                                                                            <div className="d-flex flex-column flex-grow-1 min-w-0 me-2" style={{ maxWidth: '100%' }}>
                                                                                <span className="text-dark fw-bold text-truncate" style={{ fontSize: '0.88rem' }}>
                                                                                    {item.head_name || 'Previous Balance'}
                                                                                </span>
                                                                                <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                                                    Billed: {amtB.toLocaleString('en-PK')} {paid > 0 ? ' • Paid: ' + paid.toLocaleString('en-PK') : ''}
                                                                                    {item.is_waived ? ' • Waived off' : ''}
                                                                                </span>
                                                                                {item.class_collected_amount && item.class_collected_amount > 0 ? (
                                                                                    <div className="mt-1.5 p-2 rounded-2 border border-warning-subtle bg-warning-subtle text-dark" style={{ fontSize: '0.74rem', maxWidth: '100%' }}>
                                                                                        <div className="d-flex align-items-center gap-1 fw-bold text-warning-emphasis">
                                                                                            <i className="bi bi-mortarboard-fill text-warning"></i>
                                                                                            <span>Collected in Class (PKR {item.class_collected_amount.toLocaleString('en-PK')} deducted):</span>
                                                                                        </div>
                                                                                        {item.class_collected_students && item.class_collected_students.length > 0 && (
                                                                                            <div className="d-flex flex-wrap gap-1 mt-1">
                                                                                                {item.class_collected_students.map((st: any, sIdx: number) => (
                                                                                                    <span key={sIdx} className="badge bg-white text-dark border border-warning-subtle py-1 px-1.5 fw-semibold" style={{ fontSize: '0.68rem' }}>
                                                                                                        <i className="bi bi-person-check text-success me-1"></i>
                                                                                                        {st.name} {st.class_name ? `(${st.class_name})` : ''} — PKR {st.amount.toLocaleString('en-PK')}
                                                                                                    </span>
                                                                                                ))}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                ) : null}
                                                                            </div>
                                                                            <div className="d-flex align-items-center gap-2 flex-wrap ms-auto">
                                                                                {isLateFine && (
                                                                                    <>
                                                                                        {!isFineDatePassed ? (
                                                                                            <span className="badge bg-success-subtle text-success border border-success-subtle fw-bold py-1.5 px-2" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                                                                                Within Due Date (Fine Not Charged)
                                                                                            </span>
                                                                                        ) : (
                                                                                            <button
                                                                                                type="button"
                                                                                                className={`btn btn-sm fw-bold ${isWaived ? 'btn-success' : 'btn-outline-danger'}`}
                                                                                                style={{ fontSize: '0.75rem', padding: '3px 8px', whiteSpace: 'nowrap', borderRadius: 6 }}
                                                                                                title={isWaived ? "Click to cancel waiver" : "Click to waive off late fine (Maaf karein)"}
                                                                                                onClick={() => item.item_id && toggleWaive(item.item_id)}
                                                                                            >
                                                                                                {isWaived ? (
                                                                                                    <><i className="bi bi-check-circle-fill me-1"></i>Waived (معاف)</>
                                                                                                ) : (
                                                                                                    <><i className="bi bi-slash-circle me-1"></i>Waive Fine (معاف کریں)</>
                                                                                                )}
                                                                                            </button>
                                                                                        )}
                                                                                    </>
                                                                                )}

                                                                                {amtB > 0 && !isWaived && isFineDatePassed && (
                                                                                    <span className="badge bg-danger-subtle text-danger border border-danger-subtle fw-bold py-1.5 px-2" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                                                                        Bal: {rem}
                                                                                    </span>
                                                                                )}

                                                                                {remNum <= 0 && item.class_collected_amount && item.class_collected_amount > 0 && (
                                                                                    <span className="badge bg-success-subtle text-success border border-success-subtle fw-bold py-1.5 px-2" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                                                                        <i className="bi bi-check-circle-fill me-1"></i>Class Paid
                                                                                    </span>
                                                                                )}

                                                                                <div className="input-group input-group-sm w-auto" style={{ width: '130px', maxWidth: '140px' }}>
                                                                                    <span className="input-group-text bg-light text-muted small px-2 fw-bold" style={{ fontSize: '0.78rem' }}>PKR</span>
                                                                                    <input type="number" className="form-control form-control-sm text-end fw-bold no-spinner" placeholder="0"
                                                                                        onKeyDown={e => ['e', 'E', '+', '-', '.', 'ArrowUp', 'ArrowDown'].includes(e.key) && e.preventDefault()}
                                                                                        onWheel={e => (e.target as HTMLElement).blur()}
                                                                                        value={isWaived || (!isFineDatePassed && isLateFine) ? '' : (headPayVals[headId] || '')}
                                                                                        onChange={(e) => {
                                                                                            const vStr = e.target.value;
                                                                                            if (vStr === '') {
                                                                                                setHeadPayVals({ ...headPayVals, [headId]: '' });
                                                                                                return;
                                                                                            }
                                                                                            let val = Math.max(0, parseFloat(vStr) || 0);
                                                                                            if (remNum > 0 && val > remNum) {
                                                                                                val = remNum; // Cap at remaining balance
                                                                                            }
                                                                                            setHeadPayVals({ ...headPayVals, [headId]: val > 0 ? val.toString() : '' });
                                                                                        }}
                                                                                        style={{ fontSize: '0.9rem', fontWeight: 600, padding: '4px 8px' }}
                                                                                        disabled={(remNum <= 0) || isWaived || (!isFineDatePassed && isLateFine)}
                                                                                        min="0" />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                });

                                                                return elements;
                                                            })()
                                                        )}
                                                    </div>
                                                    <div className="d-flex justify-content-between fw-bold text-dark mt-2 mb-1 px-1 small">
                                                        <span>Grand Total:</span>
                                                        <span>PKR {Object.entries(headPayVals).filter(([k]) => !waivedItemIds.map(String).includes(k)).reduce((sum, [, v]) => sum + (parseFloat(v as string) || 0), 0).toLocaleString('en-PK')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="row g-2 mt-0">
                                                <div className="col-md-4">
                                                    <label className="form-label small fw-bold text-muted mb-1">Payment Method</label>
                                                    <select className="form-select form-select-sm" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                                        <option value="cash">Cash</option>
                                                        <option value="bank_transfer">Bank Transfer</option>
                                                        <option value="cheque">Cheque</option>
                                                        <option value="online">Online</option>
                                                    </select>
                                                </div>
                                                <div className="col-md-4">
                                                    <label className="form-label small fw-bold text-muted mb-1">Payment Date</label>
                                                    <input type="date" className="form-control form-control-sm"
                                                        value={payDate} onChange={e => {
                                                            const newDate = e.target.value;
                                                            setPayDate(newDate);
                                                            // Re-evaluate fine cutoff for all items
                                                            if (activeSlip && activeSlip.line_items) {
                                                                const updatedHeads = { ...headPayVals };
                                                                activeSlip.line_items.forEach((item: any) => {
                                                                    const headId = item.item_id ? item.item_id.toString() : item.head_name;
                                                                    const isLateFine = (item.head_name || '').toLowerCase().includes('late') || (item.head_name || '').toLowerCase().includes('fine');
                                                                    if (isLateFine && activeSlip.due_date) {
                                                                        let cutoff = new Date(activeSlip.due_date);
                                                                        if (item.fine_after_day && parseInt(item.fine_after_day) > 0) {
                                                                            cutoff.setDate(parseInt(item.fine_after_day));
                                                                        }
                                                                        const pDate = new Date(newDate);
                                                                        const rem = Math.max(0, parseFloat(item.amount as any || 0) - parseFloat(item.paid_amount as any || 0));
                                                                        if (pDate <= cutoff) {
                                                                            updatedHeads[headId] = '';
                                                                        } else if (!waivedItemIds.includes(item.item_id) && rem > 0) {
                                                                            updatedHeads[headId] = rem.toString();
                                                                        }
                                                                    }
                                                                });
                                                                setHeadPayVals(updatedHeads);
                                                            }
                                                        }} />
                                                </div>
                                                <div className="col-md-6">
                                                    <label className="form-label small fw-bold text-muted mb-1">Received By</label>
                                                    <input type="text" className="form-control form-control-sm" placeholder="Staff name"
                                                        value={receivedBy} onChange={e => setReceivedBy(e.target.value)} />
                                                </div>
                                                <div className="col-md-6">
                                                    <label className="form-label small fw-bold text-muted mb-1">Reference No.</label>
                                                    <input type="text" className="form-control form-control-sm" placeholder="Cheque / TXN No."
                                                        value={refNo} onChange={e => setRefNo(e.target.value)} />
                                                </div>
                                                <div className="col-12">
                                                    <label className="form-label small fw-bold text-muted mb-1">Notes</label>
                                                    <textarea className="form-control form-control-sm" rows={2} placeholder="Optional remarks..."
                                                        value={notes} onChange={e => setNotes(e.target.value)} />
                                                </div>
                                                <div className="col-12 mt-1">
                                                    <div className="d-flex gap-2">
                                                        {hasPermission('fees', 'write') && (
                                                            <>
                                                                <button className="btn fw-bold" style={{ flex: 1, backgroundColor: '#e8f5f5', color: 'var(--primary-teal)', border: '1.5px solid var(--primary-teal)', borderRadius: 8 }}
                                                                    disabled={paying || (Object.entries(headPayVals).filter(([k]) => !waivedItemIds.map(String).includes(k)).reduce((sum, [, v]) => sum + (parseFloat(v as string) || 0), 0) <= 0 && waivedItemIds.length === 0)}
                                                                    onClick={() => handlePay(false)}>
                                                                    {paying ? <><span className="spinner-border spinner-border-sm me-1" />...</> : <><i className="bi bi-check-circle me-1"></i>Confirm</>}
                                                                </button>
                                                                <button className="btn fw-bold" onClick={() => handlePay(true)} disabled={paying || (Object.entries(headPayVals).filter(([k]) => !waivedItemIds.map(String).includes(k)).reduce((sum, [, v]) => sum + (parseFloat(v as string) || 0), 0) <= 0 && waivedItemIds.length === 0)}
                                                                    style={{ flex: 2, backgroundColor: 'var(--accent-orange)', color: '#fff', borderRadius: 8, border: 'none' }}>
                                                                    {paying ? <><span className="spinner-border spinner-border-sm me-2" />Processing...</> : <><i className="bi bi-check-lg me-1" />Confirm &amp; Print</>}
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {isModalSlipSettled ? (
                                        <div className="text-center py-2">
                                            <div className="rounded-3 p-3 border" style={{ backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }}>
                                                <i className="bi bi-shield-check text-info d-block mb-1" style={{ fontSize: 30 }}></i>
                                                <div className="fw-bold fs-6 mb-1" style={{ color: '#0369a1' }}>Voucher Settled (Trusted Category)</div>
                                                <div className="text-muted small">
                                                    Yeh voucher trusted category ka hai aur settled consider kiya gaya hai. Is voucher par new payment entry locked hai.
                                                </div>
                                            </div>
                                        </div>
                                    ) : activeSlip.status === 'paid' ? (
                                        <div className="text-center py-2">
                                            <div className="rounded p-3" style={{ backgroundColor: '#e8f5e9', border: '1px solid #c3e6cb' }}>
                                                <i className="bi bi-patch-check-fill text-success d-block mb-1" style={{ fontSize: 28 }}></i>
                                                <div className="fw-bold text-success mb-1">Fee Fully Paid</div>
                                                <div className="text-muted small mb-2">This voucher has been cleared.</div>
                                                <button className="btn btn-sm fw-bold" style={{ backgroundColor: 'var(--primary-teal)', color: '#fff', borderRadius: 6, border: 'none' }}
                                                    onClick={() => {
                                                        const lastP = slipPayments[0];
                                                        openReceiptWindow(
                                                            activeSlip,
                                                            lastP ? parseFloat(lastP.amount_paid as any) : parseFloat(activeSlip.paid_amount as any),
                                                            lastP ? lastP.payment_date : new Date().toISOString().split('T')[0],
                                                            lastP ? parseFloat(activeSlip.paid_amount as any) - parseFloat(lastP.amount_paid as any) : 0
                                                        );
                                                    }}>
                                                    <i className="bi bi-printer me-1"></i>Print Last Receipt
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="modal-footer border-0 px-4 py-3">
                                    {/* <button className="btn btn-sm btn-outline-secondary" onClick={() => setPayModal(false)}>
                                        <i className="bi bi-x me-1"></i>Close
                                    </button> */}
                                </div>
                            </div>
                        </div>
                    </div>
                    <style jsx global>{`
                        /* Hide spinner arrows for Chrome, Safari, Edge, Opera */
                        input.no-spinner::-webkit-outer-spin-button,
                        input.no-spinner::-webkit-inner-spin-button {
                            -webkit-appearance: none !important;
                            margin: 0 !important;
                        }
                        /* Hide spinner arrows for Firefox */
                        input.no-spinner[type=number] {
                            -moz-appearance: textfield !important;
                        }
                    `}</style>
                </>
            )}
        </div>
    );
}











