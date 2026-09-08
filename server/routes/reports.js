const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─── 1. Student Report (class & section wise) ───────────────────────────────
router.get('/students', async (req, res) => {
    try {
        const { class_id, section_id } = req.query;

        let query = `
            SELECT
                s.student_id,
                s.admission_no,
                s.roll_no,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                s.gender,
                s.father_name,
                s.father_phone,
                LOWER(s.status) AS status,
                c.class_name,
                sec.section_name,
                s.admission_date,
                s.monthly_fee
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE 1=1
        `;
        const params = [];
        let idx = 1;

        if (class_id) { query += ` AND s.class_id = $${idx++}`; params.push(class_id); }
        if (section_id) { query += ` AND s.section_id = $${idx++}`; params.push(section_id); }

        query += ` ORDER BY c.class_name, sec.section_name, s.first_name, s.last_name`;

        const result = await pool.query(query, params);

        // Summary counts
        const total = result.rows.length;
        const active = result.rows.filter(r => r.status === 'active').length;
        const inactive = total - active;

        res.json({ students: result.rows, summary: { total, active, inactive } });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 2. Results Report (class & section wise) ────────────────────────────────
router.get('/results', async (req, res) => {
    try {
        const { class_id, section_id, academic_year_id, term_id } = req.query;

        if (!academic_year_id) {
            return res.status(400).json({ error: 'academic_year_id is required' });
        }

        const params = [academic_year_id];
        let idx = 2;

        // Build the JOIN condition for exam_marks
        let emJoinCondition = `em.academic_year_id = $1 AND em.status = 'published'`;
        if (term_id) {
            emJoinCondition += ` AND em.term_id = $${idx}`;
            params.push(term_id);
            idx++;
        }

        let query = `
            SELECT
                s.student_id,
                s.admission_no,
                s.roll_no,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                c.class_name,
                sec.section_name,
                COALESCE(SUM(em.obtained_marks), 0) AS obtained_marks,
                COALESCE(SUM(em.total_marks), 0) AS total_marks,
                CASE
                    WHEN COALESCE(SUM(em.total_marks), 0) > 0
                    THEN ROUND((COALESCE(SUM(em.obtained_marks), 0) * 100.0 / COALESCE(SUM(em.total_marks), 0)), 2)
                    ELSE 0
                END AS percentage,
                CASE
                    WHEN COALESCE(SUM(em.total_marks), 0) = 0 THEN 'N/A'
                    WHEN ROUND((COALESCE(SUM(em.obtained_marks), 0) * 100.0 / COALESCE(SUM(em.total_marks), 0)), 2) >= 80 THEN 'A+'
                    WHEN ROUND((COALESCE(SUM(em.obtained_marks), 0) * 100.0 / COALESCE(SUM(em.total_marks), 0)), 2) >= 70 THEN 'A'
                    WHEN ROUND((COALESCE(SUM(em.obtained_marks), 0) * 100.0 / COALESCE(SUM(em.total_marks), 0)), 2) >= 60 THEN 'B'
                    WHEN ROUND((COALESCE(SUM(em.obtained_marks), 0) * 100.0 / COALESCE(SUM(em.total_marks), 0)), 2) >= 50 THEN 'C'
                    WHEN ROUND((COALESCE(SUM(em.obtained_marks), 0) * 100.0 / COALESCE(SUM(em.total_marks), 0)), 2) >= 40 THEN 'D'
                    ELSE 'F'
                END AS grade
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN exam_marks em ON em.student_id = s.student_id AND ${emJoinCondition}
            WHERE LOWER(s.status) = 'active'
        `;

        if (class_id)   { query += ` AND s.class_id = $${idx++}`;   params.push(class_id); }
        if (section_id) { query += ` AND s.section_id = $${idx++}`; params.push(section_id); }

        query += ` GROUP BY s.student_id, s.admission_no, s.roll_no, s.first_name, s.last_name, c.class_name, sec.section_name`;
        query += ` ORDER BY c.class_name, sec.section_name, s.first_name`;

        const result = await pool.query(query, params);
        res.json({ results: result.rows });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 3. Expense Report ───────────────────────────────────────────────────────
router.get('/expenses', async (req, res) => {
    try {
        const { from_date, to_date, category_id, academic_year_id } = req.query;

        let query = `
            SELECT
                e.expense_id,
                e.expense_title,
                e.amount,
                e.expense_date,
                e.payment_method,
                e.paid_to,
                e.status,
                ec.category_name,
                e.academic_year_id,
                ay.year_name AS academic_year_name
            FROM expenses e
            LEFT JOIN expense_categories ec ON e.category_id = ec.category_id
            LEFT JOIN academic_years ay ON e.academic_year_id = ay.id
            WHERE 1=1
        `;
        const params = [];
        let idx = 1;

        if (from_date) {
            query += ` AND e.expense_date::date >= $${idx++}::date`;
            params.push(from_date);
        }
        if (to_date) {
            query += ` AND e.expense_date::date <= $${idx++}::date`;
            params.push(to_date);
        }
        if (category_id) {
            query += ` AND e.category_id = $${idx++}`;
            params.push(category_id);
        }
        if (academic_year_id && academic_year_id !== 'all') {
            query += ` AND (e.academic_year_id = $${idx++} OR e.academic_year_id IS NULL)`;
            params.push(parseInt(academic_year_id, 10));
        }

        query += ` ORDER BY e.expense_date DESC, e.expense_id DESC`;

        const result = await pool.query(query, params);

        // Category-wise summary & stats
        const summaryMap = {};
        let grandTotal = 0;
        let approvedTotal = 0;
        let pendingTotal = 0;

        result.rows.forEach(r => {
            const cat = r.category_name || 'Uncategorized';
            const amt = parseFloat(r.amount || 0);
            if (!summaryMap[cat]) summaryMap[cat] = { category: cat, total: 0, count: 0 };
            summaryMap[cat].total += amt;
            summaryMap[cat].count += 1;
            grandTotal += amt;

            const st = (r.status || '').toLowerCase();
            if (st === 'approved' || st === 'paid' || st === 'completed') {
                approvedTotal += amt;
            } else if (st === 'pending') {
                pendingTotal += amt;
            }
        });

        const categorySummary = Object.values(summaryMap).map(c => ({
            category: c.category,
            total: c.total,
            count: c.count,
            percentage: grandTotal > 0 ? Math.round((c.total / grandTotal) * 100) : 0
        })).sort((a, b) => b.total - a.total);

        res.json({
            expenses: result.rows,
            categorySummary,
            grandTotal,
            approvedTotal,
            pendingTotal,
            totalCount: result.rows.length
        });
    } catch (err) {
        console.error('Expense report error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 4. Fee Heads (for family-fee filter dropdown) ──────────────────────────
router.get('/fee-heads', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT head_id, head_name, head_type FROM fee_heads WHERE is_active = true ORDER BY head_name`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── 5. Expense Categories (for filter dropdown) ─────────────────────────────
router.get('/expense-categories', async (req, res) => {
    try {
        const result = await pool.query(`SELECT category_id, category_name FROM expense_categories WHERE is_active = true ORDER BY category_name`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── 6. Family Fee Report (monthly, head-wise & collective) ──────────────────
router.get('/family-fee', async (req, res) => {
    try {
        const { month, year, class_id, section_id, status, head_id, academic_year_id, as_of_date } = req.query;

        const monthArr = month ? month.toString().split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n)) : [];
        const yearNum = year ? parseInt(year.toString(), 10) : null;

        let slipQuery = `
            SELECT DISTINCT
                ms.slip_id,
                ms.student_id,
                ms.family_id,
                ms.month,
                ms.year,
                ms.total_amount,
                ms.paid_amount,
                ms.status,
                ms.due_date,
                ms.issue_date,
                ms.academic_year_id,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                s.admission_no,
                s.roll_no,
                s.father_name,
                s.father_phone,
                f.family_name,
                c.class_name,
                sec.section_name
            FROM monthly_fee_slips ms
            LEFT JOIN students s ON ms.student_id = s.student_id
            LEFT JOIN families f ON ms.family_id = f.family_id
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE 1=1
        `;
        const params = [];
        let idx = 1;

        if (monthArr.length > 0) {
            slipQuery += ` AND (ms.month = ANY($${idx++}::int[]) OR (ms.months_list IS NOT NULL AND ms.months_list && $${idx - 1}::int[]))`;
            params.push(monthArr);
        }
        if (yearNum) {
            slipQuery += ` AND ms.year = $${idx++}`;
            params.push(yearNum);
        }
        if (academic_year_id && academic_year_id !== 'all') {
            slipQuery += ` AND (ms.academic_year_id = $${idx++} OR ms.academic_year_id IS NULL)`;
            params.push(parseInt(academic_year_id, 10));
        }
        if (class_id)  { slipQuery += ` AND s.class_id = $${idx++}`;   params.push(class_id); }
        if (section_id){ slipQuery += ` AND s.section_id = $${idx++}`; params.push(section_id); }

        if (head_id) {
            slipQuery += ` AND EXISTS (
                SELECT 1 FROM slip_line_items sli2
                WHERE sli2.slip_id = ms.slip_id AND sli2.head_id = $${idx++}
            )`;
            params.push(parseInt(head_id, 10));
        }

        slipQuery += ` ORDER BY class_name, section_name, student_name`;

        const slipsResult = await pool.query(slipQuery, params);
        let rawSlips = slipsResult.rows;

        if (rawSlips.length === 0) {
            return res.json({
                slips: [],
                headSummary: [],
                collective: { total_billed: 0, total_collected: 0, total_pending: 0, total_students: 0, paid_count: 0, partial_count: 0, unpaid_count: 0 },
                timeline: [],
                weeklySummary: [],
                selectedHeadInfo: null
            });
        }

        const slipIds = rawSlips.map(s => s.slip_id);

        // Fetch line items for matching slips
        const lineQuery = `
            SELECT
                sli.slip_id,
                sli.head_id,
                sli.head_name,
                sli.amount,
                COALESCE(sli.paid_amount, 0) AS paid_amount
            FROM slip_line_items sli
            WHERE sli.slip_id = ANY($1::int[])
            ORDER BY sli.item_id ASC
        `;
        const lineResult = await pool.query(lineQuery, [slipIds]);

        // Attach line items to slips
        const lineMap = {};
        lineResult.rows.forEach(li => {
            if (!lineMap[li.slip_id]) lineMap[li.slip_id] = [];
            lineMap[li.slip_id].push({
                ...li,
                amount: parseFloat(li.amount || 0),
                paid_amount: parseFloat(li.paid_amount || 0)
            });
        });

        // Fetch all payment transactions for timeline analysis
        const paymentsQuery = `
            SELECT
                fp.payment_id,
                fp.slip_id,
                fp.amount_paid,
                fp.payment_date::date AS payment_date,
                fp.payment_method
            FROM fee_payments fp
            WHERE fp.slip_id = ANY($1::int[])
            ORDER BY fp.payment_date ASC
        `;
        const paymentsRes = await pool.query(paymentsQuery, [slipIds]);
        const payments = paymentsRes.rows.map(p => ({
            ...p,
            amount_paid: parseFloat(p.amount_paid || 0),
            payment_date: p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : null
        }));

        // Filter payments by as_of_date if specified
        const validPayments = as_of_date 
            ? payments.filter(p => p.payment_date && p.payment_date <= as_of_date)
            : payments;

        // Group payments by slip if as_of_date is used
        const slipPaymentAsOf = {};
        if (as_of_date) {
            validPayments.forEach(p => {
                slipPaymentAsOf[p.slip_id] = (slipPaymentAsOf[p.slip_id] || 0) + p.amount_paid;
            });
        }

        // Process slips & calculate specific head vs overall values
        const selectedHeadIdNum = head_id ? parseInt(head_id, 10) : null;
        let processedSlips = rawSlips.map(s => {
            const items = lineMap[s.slip_id] || [];
            s.line_items = items;

            if (selectedHeadIdNum) {
                // Individual Head Mode: Only count and display this selected head
                const matchingItem = items.find(li => li.head_id === selectedHeadIdNum);
                const billed = matchingItem ? matchingItem.amount : 0;
                const paid = matchingItem ? matchingItem.paid_amount : 0;
                const balance = Math.max(0, billed - paid);
                let st = 'unpaid';
                if (paid >= billed && billed > 0) st = 'paid';
                else if (paid > 0) st = 'partial';

                return {
                    ...s,
                    total_amount: billed,
                    paid_amount: paid,
                    balance: balance,
                    status: st,
                    line_items: matchingItem ? [matchingItem] : []
                };
            } else {
                // All Heads Mode
                const billed = parseFloat(s.total_amount || 0);
                const paid = as_of_date ? (slipPaymentAsOf[s.slip_id] || 0) : parseFloat(s.paid_amount || 0);
                const balance = Math.max(0, billed - paid);
                let st = s.status;
                if (as_of_date) {
                    if (paid >= billed && billed > 0) st = 'paid';
                    else if (paid > 0) st = 'partial';
                    else st = 'unpaid';
                }

                return {
                    ...s,
                    total_amount: billed,
                    paid_amount: paid,
                    balance: balance,
                    status: st
                };
            }
        });

        // Filter by status if requested
        if (status && status !== 'all') {
            processedSlips = processedSlips.filter(s => s.status === status);
        }

        // Head-wise Summary Calculation
        const headMap = {};
        lineResult.rows.forEach(li => {
            if (selectedHeadIdNum && li.head_id !== selectedHeadIdNum) return;
            if (!headMap[li.head_name]) {
                headMap[li.head_name] = {
                    head_id: li.head_id,
                    head_name: li.head_name,
                    total: 0,
                    collected: 0,
                    pending: 0,
                    students_count: 0
                };
            }
            headMap[li.head_name].total += parseFloat(li.amount || 0);
            headMap[li.head_name].collected += parseFloat(li.paid_amount || 0);
            headMap[li.head_name].students_count += 1;
        });

        const total_billed = processedSlips.reduce((sum, s) => sum + s.total_amount, 0);
        const total_collected = processedSlips.reduce((sum, s) => sum + s.paid_amount, 0);
        const total_pending = Math.max(0, total_billed - total_collected);

        const headSummary = Object.values(headMap).map(h => {
            h.pending = Math.max(0, h.total - h.collected);
            h.collection_rate = h.total > 0 ? Math.round((h.collected / h.total) * 100) : 0;
            h.percentage = total_billed > 0 ? Math.round((h.total / total_billed) * 100) : 0;
            return h;
        }).sort((a, b) => b.total - a.total);

        // Collective Stats
        const paid_count = processedSlips.filter(s => s.status === 'paid').length;
        const partial_count = processedSlips.filter(s => s.status === 'partial').length;
        const unpaid_count = processedSlips.filter(s => s.status === 'unpaid').length;

        const collective = {
            total_billed,
            total_collected,
            total_pending,
            total_students: processedSlips.length,
            paid_count,
            partial_count,
            unpaid_count,
            collection_rate: total_billed > 0 ? Math.round((total_collected / total_billed) * 100) : 0
        };

        // ── Daily & Weekly Timeline Trend Generation ──
        const targetYear = yearNum || new Date().getFullYear();
        const primaryMonth = monthArr[0] || (new Date().getMonth() + 1);
        const daysInMonth = new Date(targetYear, primaryMonth, 0).getDate();

        const dailyMap = {};
        validPayments.forEach(p => {
            if (p.payment_date) {
                dailyMap[p.payment_date] = (dailyMap[p.payment_date] || 0) + p.amount_paid;
            }
        });

        const timeline = [];
        let runningCollected = 0;
        const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mLabel = MONTH_NAMES[primaryMonth - 1] || 'Month';

        for (let day = 1; day <= daysInMonth; day++) {
            const dayStr = String(day).padStart(2, '0');
            const mStr = String(primaryMonth).padStart(2, '0');
            const fullDate = `${targetYear}-${mStr}-${dayStr}`;
            const dayCollected = dailyMap[fullDate] || 0;
            runningCollected += dayCollected;
            const remainingAtDay = Math.max(0, total_billed - runningCollected);

            timeline.push({
                date: fullDate,
                day: `${day} ${mLabel}`,
                day_num: day,
                daily_collected: dayCollected,
                cumulative_collected: runningCollected,
                target_billed: total_billed,
                remaining_dues: remainingAtDay,
                collection_rate: total_billed > 0 ? Math.round((runningCollected / total_billed) * 100) : 0
            });
        }

        // Weekly Summary
        const weeklySummary = [
            { week: 'Week 1 (1-7)', days: [1, 7], collected: 0 },
            { week: 'Week 2 (8-14)', days: [8, 14], collected: 0 },
            { week: 'Week 3 (15-21)', days: [15, 21], collected: 0 },
            { week: 'Week 4 (22-28)', days: [22, 28], collected: 0 },
            { week: `Week 5 (29-${daysInMonth})`, days: [29, daysInMonth], collected: 0 }
        ];

        timeline.forEach(t => {
            const w = weeklySummary.find(ws => t.day_num >= ws.days[0] && t.day_num <= ws.days[1]);
            if (w) w.collected += t.daily_collected;
        });

        weeklySummary.forEach(w => {
            w.percentage = total_collected > 0 ? Math.round((w.collected / total_collected) * 100) : 0;
        });

        let selectedHeadInfo = null;
        if (selectedHeadIdNum && headSummary.length > 0) {
            selectedHeadInfo = headSummary[0];
        }

        res.json({
            slips: processedSlips,
            headSummary,
            collective,
            timeline,
            weeklySummary,
            selectedHeadInfo,
            dateRange: {
                start: `${targetYear}-${String(primaryMonth).padStart(2, '0')}-01`,
                end: `${targetYear}-${String(primaryMonth).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
            }
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 7. Admission Fee Report ────────────────────────────────────────────────
router.get('/admission-fee', async (req, res) => {
    try {
        const { from_date, to_date, status, academic_year_id } = req.query;

        let query = `
            SELECT
                afl.ledger_id as ledger_id,
                afl.student_id,
                afl.total_amount,
                afl.paid_amount,
                (afl.total_amount - afl.paid_amount - COALESCE(afl.discount_amount, 0)) AS remaining_amount,
                COALESCE(afl.discount_amount, 0) AS discount_amount,
                afl.status,
                afl.academic_year_id,
                s.admission_no,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name,      
                s.admission_date,
                c.class_name,
                sec.section_name
            FROM admission_fee_ledger afl
            JOIN students s ON afl.student_id = s.student_id
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE 1=1
        `;
        const params = [];
        let idx = 1;

        if (from_date) { query += ` AND s.admission_date >= $${idx++}`; params.push(from_date); }
        if (to_date)   { query += ` AND s.admission_date <= $${idx++}`; params.push(to_date); }
        if (status)    { query += ` AND afl.status = $${idx++}`; params.push(status); }
        if (academic_year_id && academic_year_id !== 'all') {
            query += ` AND (afl.academic_year_id = $${idx++} OR afl.academic_year_id IS NULL)`;
            params.push(parseInt(academic_year_id, 10));
        }

        query += ` ORDER BY s.admission_date DESC`;

        const result = await pool.query(query, params);
        
        // Month Summary
        const monthlySummary = {};
        result.rows.forEach(r => {
            if (!r.admission_date) return;
            const dateObj = new Date(r.admission_date);
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
            
            if (!monthlySummary[monthKey]) {
                monthlySummary[monthKey] = {
                    month: monthKey,
                    admissions: 0,
                    total_amount: 0,
                    paid_amount: 0,
                    discount_amount: 0,
                    remaining_amount: 0
                };
            }
            monthlySummary[monthKey].admissions++;
            monthlySummary[monthKey].total_amount += parseFloat(r.total_amount) || 0;
            monthlySummary[monthKey].paid_amount += parseFloat(r.paid_amount) || 0;
            monthlySummary[monthKey].discount_amount += parseFloat(r.discount_amount) || 0;
            monthlySummary[monthKey].remaining_amount += parseFloat(r.remaining_amount) || 0;
        });

        const monthlyStats = Object.values(monthlySummary).sort((a,b) => b.month.localeCompare(a.month));

        // Grand Totals
        const summary = {
            total_admissions: result.rows.length,
            total_billed: result.rows.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0),
            total_collected: result.rows.reduce((sum, r) => sum + parseFloat(r.paid_amount || 0), 0),
            total_discount: result.rows.reduce((sum, r) => sum + parseFloat(r.discount_amount || 0), 0),
            total_pending: result.rows.reduce((sum, r) => sum + parseFloat(r.remaining_amount || 0), 0)
        };

        res.json({ admission_fees: result.rows, monthlyStats, summary });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 8. Monthly Tuition & Financial Summary Report ────────────────────────
router.get('/monthly-tuition', async (req, res) => {
    try {
        const { month, year, class_id, section_id, status, academic_year_id } = req.query;

        if (!month || !year) {
            return res.status(400).json({ error: 'month and year are required' });
        }

        const monthArr = month.toString().split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
        const yearNum = parseInt(year.toString(), 10);

        if (monthArr.length === 0) {
            return res.status(400).json({ error: 'valid month is required' });
        }

        // 1. Get Slips with Tuition Fee calculation & student/family metadata
        let slipQuery = `
            SELECT DISTINCT
                ms.slip_id,
                ms.student_id,
                ms.family_id,
                ms.month,
                ms.year,
                ms.academic_year_id,
                ms.total_amount AS slip_total_amount,
                ms.paid_amount AS slip_paid_amount,
                ms.status AS slip_status,
                ms.due_date,
                ms.issue_date,
                s.admission_no,
                s.roll_no,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name,
                s.father_name,
                s.father_phone,
                f.family_name,
                c.class_name,
                sec.section_name,
                -- Tuition Fee Billed (From line items or slip total)
                COALESCE((
                    SELECT SUM(sli.amount)
                    FROM slip_line_items sli
                    WHERE sli.slip_id = ms.slip_id 
                      AND (LOWER(sli.head_name) LIKE '%tuition%' OR LOWER(sli.head_name) LIKE '%tution%' OR sli.head_id = 1)
                ), ms.total_amount) AS tuition_billed,
                -- Tuition Fee Paid (From line items or proportional slip paid)
                COALESCE((
                    SELECT SUM(COALESCE(sli.paid_amount, 0))
                    FROM slip_line_items sli
                    WHERE sli.slip_id = ms.slip_id 
                      AND (LOWER(sli.head_name) LIKE '%tuition%' OR LOWER(sli.head_name) LIKE '%tution%' OR sli.head_id = 1)
                ), ms.paid_amount) AS tuition_paid
            FROM monthly_fee_slips ms
            LEFT JOIN students s ON ms.student_id = s.student_id
            LEFT JOIN families f ON ms.family_id = f.family_id
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE (ms.month = ANY($1::int[]) OR (ms.months_list IS NOT NULL AND ms.months_list && $1::int[])) AND ms.year = $2
              AND (s.category IS NULL OR LOWER(TRIM(s.category)) != 'trusted')
        `;
        const params = [monthArr, yearNum];
        let idx = 3;

        if (academic_year_id && academic_year_id !== 'all') {
            slipQuery += ` AND (ms.academic_year_id = $${idx++} OR ms.academic_year_id IS NULL)`;
            params.push(parseInt(academic_year_id.toString(), 10));
        }

        if (class_id && class_id !== '') {
            slipQuery += ` AND s.class_id = $${idx++}`;
            params.push(parseInt(class_id.toString(), 10));
        }
        if (section_id && section_id !== '') {
            slipQuery += ` AND s.section_id = $${idx++}`;
            params.push(parseInt(section_id.toString(), 10));
        }

        slipQuery += ` ORDER BY c.class_name, sec.section_name, student_name`;

        const slipsRes = await pool.query(slipQuery, params);
        let families = slipsRes.rows.map(r => {
            const billed = parseFloat(r.tuition_billed || 0);
            const paid = parseFloat(r.tuition_paid || 0);
            const remaining = Math.max(0, billed - paid);
            let pStatus = 'unpaid';
            if (paid >= billed && billed > 0) pStatus = 'paid';
            else if (paid > 0) pStatus = 'partial';
            return {
                ...r,
                tuition_billed: billed,
                tuition_paid: paid,
                tuition_remaining: remaining,
                payment_status: pStatus
            };
        });

        // Filter by payment status if requested
        if (status && status !== 'all') {
            families = families.filter(f => f.payment_status === status);
        }

        // 2. Calculate Expenses for selected Month & Year
        let expenseQuery = `
            SELECT COALESCE(SUM(amount), 0) as total_expense
            FROM expenses
            WHERE EXTRACT(MONTH FROM expense_date) = ANY($1::int[]) 
              AND EXTRACT(YEAR FROM expense_date) = $2
              AND (status IS NULL OR LOWER(status) != 'cancelled')
        `;
        const expParams = [monthArr, yearNum];
        if (academic_year_id && academic_year_id !== 'all') {
            expenseQuery += ` AND (academic_year_id = $3 OR academic_year_id IS NULL)`;
            expParams.push(parseInt(academic_year_id.toString(), 10));
        }
        const expenseRes = await pool.query(expenseQuery, expParams);
        const totalExpenses = parseFloat(expenseRes.rows[0]?.total_expense || 0);

        // 3. Compute Financial Summary Statistics
        const totalBilled = families.reduce((sum, f) => sum + f.tuition_billed, 0);
        const totalCollected = families.reduce((sum, f) => sum + f.tuition_paid, 0);
        const totalRemaining = totalBilled - totalCollected;

        const expectedSurplus = totalBilled - totalExpenses; // Tuition Billed - Expenses
        const netCashBalance = totalCollected - totalExpenses; // Tuition Collected - Expenses
        const collectionRate = totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : 0;

        res.json({
            month: monthArr.length === 1 ? monthArr[0] : monthArr.join(','),
            year: yearNum,
            summary: {
                total_billed: totalBilled,
                total_collected: totalCollected,
                total_remaining: totalRemaining,
                total_expenses: totalExpenses,
                expected_surplus: expectedSurplus,
                net_cash_balance: netCashBalance,
                collection_rate: parseFloat(collectionRate),
                total_families_count: families.length,
                paid_count: families.filter(f => f.payment_status === 'paid').length,
                partial_count: families.filter(f => f.payment_status === 'partial').length,
                unpaid_count: families.filter(f => f.payment_status === 'unpaid').length
            },
            families
        });

    } catch (err) {
        console.error("Error in GET /reports/monthly-tuition:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
