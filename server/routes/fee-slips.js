const express = require('express');
const router = express.Router();
const pool = require('../db');

// Helper to get active academic year
async function getActiveAcademicYear(clientPool) {
    let yearRes = await clientPool.query(
        `SELECT id, year_name, is_active, status, start_date, end_date
         FROM academic_years
         WHERE is_active = TRUE OR status = 'active'
         ORDER BY id ASC
         LIMIT 1`
    );

    if (yearRes.rows.length === 0) {
        yearRes = await clientPool.query(
            `SELECT id, year_name, is_active, status, start_date, end_date
             FROM academic_years
             ORDER BY id ASC
             LIMIT 1`
        );
        if (yearRes.rows.length > 0) {
            await clientPool.query(`UPDATE academic_years SET is_active = TRUE, status = 'active' WHERE id = $1`, [yearRes.rows[0].id]);
            yearRes.rows[0].is_active = true;
            yearRes.rows[0].status = 'active';
        }
    }

    return yearRes.rows[0] || null;
}

// POST /fee-slips/generate
router.post('/generate', async (req, res) => {
    const client = await pool.connect();
    try {
        const { class_id, year, due_date, issue_date, extra_heads, plan_id, academic_year_id } = req.body;
        // Accept either months[] array (new) or single month (backward compat)
        const rawMonths = req.body.months || (req.body.month ? [req.body.month] : null);
        if (!class_id || !rawMonths || rawMonths.length === 0 || !year)
            return res.status(400).json({ error: 'class_id, months (array), and year are required' });

        const activeYear = await getActiveAcademicYear(client);
        const targetYearId = academic_year_id ? parseInt(academic_year_id, 10) : (activeYear ? activeYear.id : null);
        let actualYear = parseInt(year, 10);

        if (targetYearId) {
            const yearCheck = await client.query('SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years WHERE id = $1', [targetYearId]);
            if (yearCheck.rows.length > 0) {
                const yRow = yearCheck.rows[0];
                if (yRow.is_active === false) {
                    return res.status(403).json({
                        error: `Fiscal/Academic Year (${yRow.year_name}) is closed. New fee slips cannot be generated for closed sessions.`
                    });
                }
                if (yRow.start_date && yRow.end_date) {
                    const startD = new Date(yRow.start_date);
                    const endD = new Date(yRow.end_date);
                    const validMonthMap = new Map(); // monthNumber -> calendarYear
                    let cY = startD.getFullYear();
                    let cM = startD.getMonth() + 1;
                    const eY = endD.getFullYear();
                    const eM = endD.getMonth() + 1;

                    let iter = 0;
                    while ((cY < eY || (cY === eY && cM <= eM)) && iter < 24) {
                        validMonthMap.set(cM, cY);
                        cM++;
                        if (cM > 12) {
                            cM = 1;
                            cY++;
                        }
                        iter++;
                    }

                    const invalidMonths = rawMonths.map(Number).filter(m => !validMonthMap.has(m));
                    if (invalidMonths.length > 0) {
                        const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const invalidNames = invalidMonths.map(m => MONTH_NAMES[m - 1]).join(', ');
                        return res.status(400).json({
                            error: `Selected month(s) (${invalidNames}) fall outside the active academic year duration (${MONTH_NAMES[startD.getMonth()]} ${startD.getFullYear()} – ${MONTH_NAMES[endD.getMonth()]} ${endD.getFullYear()}). Fee slips can only be generated for months within this academic session.`
                        });
                    }

                    if (validMonthMap.has(Number(rawMonths[0]))) {
                        actualYear = validMonthMap.get(Number(rawMonths[0]));
                    }
                }
            }
        }

        const monthsArray = rawMonths.map(Number).sort((a, b) => a - b); // sorted ascending

        // SECURITY CHECK: Only block if DIRECT slips already exist for students in this class.
        // Cross-class family coverage (sibling's slip in a higher class) is NOT a reason to block —
        // the generation loops handle that gracefully by checking family_id and skipping with skippedCount++.
        const checkQuery = `
            SELECT DISTINCT month, months_list
            FROM monthly_fee_slips mfs
            WHERE (year = $2 OR (academic_year_id = $4 AND $4 IS NOT NULL))
              AND (
                 month = ANY($3::int[]) 
                 OR 
                 $3::int[] && months_list
              )
              AND (
                mfs.class_id = $1
                OR mfs.student_id IN (
                    SELECT student_id FROM students 
                    WHERE class_id = $1 AND status = 'Active'
                )
              )
        `;
        const checkRes = await client.query(checkQuery, [class_id, actualYear, monthsArray, targetYearId]);
        if (checkRes.rows.length > 0) {
            await client.query('ROLLBACK');
            let conflictingSet = new Set();
            for (const r of checkRes.rows) {
                if (r.months_list && r.months_list.length > 0) {
                    r.months_list.forEach(m => conflictingSet.add(m));
                } else {
                    conflictingSet.add(r.month);
                }
            }
            const conflictingMonths = [...conflictingSet]
                .filter(m => monthsArray.includes(m))
                .sort((a, b) => a - b)
                .join(', ');
            return res.status(400).json({ error: `Cannot generate. The following month(s) are already generated for this class: ${conflictingMonths}. Please select only ungenerated months or undo the existing ones first.` });
        }

        const firstMonth = monthsArray[0];
        const lastMonth = monthsArray[monthsArray.length - 1];
        const monthsCount = monthsArray.length;

        // Build a human-readable label like "Feb 2026" or "Feb – Mar 2026"
        const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthLabel = monthsCount === 1
            ? `${MONTH_NAMES[firstMonth - 1]} ${year}`
            : `${MONTH_NAMES[firstMonth - 1]} – ${MONTH_NAMES[lastMonth - 1]} ${year}`;

        // For backward compat let month = firstMonth when needed
        const month = firstMonth;

        // Allow explicit plan specification via UI, else fallback to topmost plan
        const explicitPlanId = req.body.plan_id || null;

        await client.query('BEGIN');

        let planResult;
        if (explicitPlanId) {
            planResult = await client.query(
                `SELECT fp.plan_id
                 FROM fee_plans fp
                 WHERE fp.plan_id = $1 AND fp.is_active = TRUE`,
                [explicitPlanId]
            );
        } else {
            planResult = await client.query(
                `SELECT fp.plan_id
                 FROM fee_plans fp
                 LEFT JOIN fee_plan_classes fpc ON fpc.plan_id = fp.plan_id
                 WHERE (fp.class_id = $1 OR fpc.class_id = $1 OR fp.applies_to_all = TRUE)
                   AND fp.is_active = TRUE
                 ORDER BY fp.academic_year DESC, fp.plan_name ASC
                 LIMIT 1`,
                [class_id]
            );
        }
        if (planResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No active fee plan found for this class.' });
        }
        const planId = planResult.rows[0].plan_id;
        const planHeads = await client.query(
            `SELECT fph.amount, fph.fine_after_day, fh.head_id, fh.head_name, fh.head_type, COALESCE(fh.track_arrears, TRUE) AS track_arrears 
             FROM fee_plan_heads fph
             JOIN fee_heads fh ON fph.head_id = fh.head_id WHERE fph.plan_id = $1`, [planId]
        );

        // Get all active students in this class WITH their family_fee and total family size (across ALL classes)
        const studentsResult = await client.query(
            `SELECT s.student_id, s.family_id, s.first_name, s.last_name,
                    s.admission_no, s.monthly_fee AS personal_monthly_fee,
                    s.category,
                    COALESCE(f.family_fee, 0) AS family_fee,
                    (SELECT COUNT(*) FROM students s2
                     WHERE s2.family_id = s.family_id AND s2.status = 'Active') AS total_family_size,
                    c.class_id AS sort_class_id
             FROM students s
             LEFT JOIN families f ON f.family_id = s.family_id
             LEFT JOIN classes c ON c.class_id = s.class_id
             WHERE s.class_id = $1 AND s.status = 'Active'
             ORDER BY s.family_id NULLS LAST, c.class_id DESC NULLS LAST, s.first_name`, [class_id]
        );
        if (studentsResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No active students found in this class' });
        }

        // ─── Group students by family_id to identify multi-member families ───
        const familyGroups = {}; // family_id → [students]
        const soloStudents = [];
        for (const student of studentsResult.rows) {
            const familySize = parseInt(student.total_family_size) || 1;
            if (!student.family_id || familySize <= 1) {
                soloStudents.push(student);
            } else {
                if (!familyGroups[student.family_id]) familyGroups[student.family_id] = [];
                familyGroups[student.family_id].push(student);
            }
        }

        let generatedCount = 0, skippedCount = 0;

        // ─── Find Previous Balance plan head (if any) ─────────────────────────
        const pbPlanHead = planHeads.rows.find(h => h.head_type === 'prev_balance');

        // ─── Preload Head-Wise Arrears per family / student ───────────────────
        const allFamilyIds = [
            ...Object.keys(familyGroups),
            ...soloStudents.filter(s => s.family_id).map(s => s.family_id)
        ].filter(Boolean);
        const uniqueFamilyIds = [...new Set(allFamilyIds)];

        let familyPBMap = {}; // family_id → total pure tuition arrears + OPB (from latest prior consolidated state)
        let familyCumulativeMap = {}; // family_id → [ { head_id, head_name, pending_amount } ]

        if (uniqueFamilyIds.length > 0) {
            // 1. For each family, find their LATEST previous slip in this academic session before this billing month/year
            // The latest slip already represents the consolidated state up to that point (prevents compounding/snowballing).
            const latestSlipsRes = await client.query(
                `SELECT DISTINCT ON (mfs.family_id)
                    mfs.slip_id,
                    mfs.family_id,
                    mfs.year,
                    mfs.month,
                    mfs.total_amount,
                    mfs.paid_amount,
                    mfs.status
                 FROM monthly_fee_slips mfs
                 WHERE mfs.family_id = ANY($1::varchar[])
                   AND (mfs.year < $2 OR (mfs.year = $2 AND mfs.month < $3))
                   AND (mfs.academic_year_id = $4 OR $4 IS NULL)
                 ORDER BY mfs.family_id, mfs.year DESC, mfs.month DESC, mfs.slip_id DESC`,
                [uniqueFamilyIds, actualYear, month, targetYearId]
            );

            const latestSlipByFamily = {};
            const latestSlipIds = [];
            for (const s of latestSlipsRes.rows) {
                latestSlipByFamily[s.family_id] = s;
                latestSlipIds.push(s.slip_id);
            }

            // 2. Find tracked extra heads on the latest slips that are still pending
            let trackedHeadsBySlip = {};
            if (latestSlipIds.length > 0) {
                const cumRes = await client.query(
                    `SELECT sli.slip_id, mfs.family_id, sli.head_id, sli.head_name,
                            GREATEST(0, sli.amount - COALESCE(sli.paid_amount, 0)) AS pending_amount
                     FROM slip_line_items sli
                     JOIN monthly_fee_slips mfs ON sli.slip_id = mfs.slip_id
                     JOIN fee_heads fh ON sli.head_id = fh.head_id
                     WHERE sli.slip_id = ANY($1::int[])
                       AND fh.track_arrears = TRUE
                       AND (sli.amount - COALESCE(sli.paid_amount, 0)) > 0`,
                    [latestSlipIds]
                );
                for (const r of cumRes.rows) {
                    if (!trackedHeadsBySlip[r.slip_id]) trackedHeadsBySlip[r.slip_id] = [];
                    trackedHeadsBySlip[r.slip_id].push({
                        head_id: r.head_id,
                        head_name: r.head_name,
                        pending_amount: parseFloat(r.pending_amount) || 0
                    });
                }
            }

            // 3. OPB from families table for families with no prior slips in this session
            const opbRes = await client.query(
                `SELECT family_id, (opening_balance - COALESCE(opening_balance_paid, 0)) AS opb_remaining
                 FROM families WHERE family_id = ANY($1::varchar[]) AND (opening_balance - COALESCE(opening_balance_paid, 0)) > 0`,
                [uniqueFamilyIds]
            );
            const opbMap = {};
            for (const r of opbRes.rows) {
                opbMap[r.family_id] = parseFloat(r.opb_remaining) || 0;
            }

            for (const fid of uniqueFamilyIds) {
                const latestSlip = latestSlipByFamily[fid];
                if (latestSlip) {
                    // Family already has a previous slip in this session.
                    // Its unpaid balance already embodies all prior months and OPB (strictly non-compounding).
                    const latestUnpaid = Math.max(0, parseFloat(latestSlip.total_amount) - parseFloat(latestSlip.paid_amount));
                    
                    const trackedHeads = trackedHeadsBySlip[latestSlip.slip_id] || [];
                    const trackedSum = trackedHeads.reduce((sum, h) => sum + h.pending_amount, 0);

                    if (trackedHeads.length > 0) {
                        familyCumulativeMap[fid] = trackedHeads;
                    }

                    // Pure Previous Balance is the remaining unpaid balance minus the tracked extra heads
                    familyPBMap[fid] = Math.max(0, parseFloat((latestUnpaid - trackedSum).toFixed(2)));
                } else {
                    // Month 1 (No prior slips in this session): Use remaining OPB from families table
                    familyPBMap[fid] = opbMap[fid] || 0;
                    familyCumulativeMap[fid] = [];
                }
            }
        }

        // ─── Helper: build line items from plan heads (skips prev_balance handled separately) ─
        const buildLineItems = (personalFee = 0, multiplier = 1, isTrusted = false) => {
            const slipDueDate = due_date ? new Date(due_date) : null;
            if (slipDueDate) slipDueDate.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            return planHeads.rows
                .filter(head => {
                    if (head.head_type === 'prev_balance') return false; // Previous Balance added separately

                    // Late fine should NOT be pre-billed on fresh vouchers before due_date / fine_after_day
                    const isFine = head.head_name.toLowerCase().includes('late') || head.head_name.toLowerCase().includes('fine');
                    if (isFine) {
                        let fineCutoffDate = slipDueDate;
                        if (head.fine_after_day && parseInt(head.fine_after_day) > 0) {
                            const d = parseInt(head.fine_after_day);
                            fineCutoffDate = new Date(actualYear, parseInt(month) - 1, d);
                            fineCutoffDate.setHours(0, 0, 0, 0);
                        }
                        // If generating before or on the fine cutoff day, do NOT pre-bill late fine upfront on fresh voucher
                        if (fineCutoffDate && today <= fineCutoffDate) {
                            return false;
                        }
                    }
                    return true;
                })
                .map(head => {
                    const isTuition = head.head_name.toLowerCase().includes('tuition');
                    let unitAmount = (isTuition && personalFee > 0) ? personalFee : parseFloat(head.amount);
                    if (!isTuition && multiplier > 1) {
                        unitAmount = unitAmount * multiplier;
                    }
                    const finalAmount = unitAmount * monthsCount;
                    const headName = monthsCount > 1 && isTuition
                        ? `${head.head_name} (${monthLabel})`
                        : head.head_name;
                    return {
                        head_id: head.head_id,
                        head_name: headName,
                        amount: finalAmount,
                        is_carried_forward: false,
                        note: (isTuition && isTrusted) ? 'Trusted Category - Free Tuition' : undefined
                    };
                });
        };

        const insertSlip = async (student, totalAmount, lineItems, isFamilySlip, isTrusted = false) => {
            const hasMulti = monthsArray.length > 1;
            const actualClassId = student.sort_class_id || student.class_id || class_id;
            const initialStatus = totalAmount <= 0 ? (isTrusted ? 'satteled' : 'paid') : 'unpaid';
            const slip = await client.query(
                `INSERT INTO monthly_fee_slips
                    (student_id, family_id, class_id, month, year, due_date, issue_date, total_amount, paid_amount, status, is_family_slip, has_multi_months, months_list, academic_year_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13) RETURNING slip_id`,
                [student.student_id, student.family_id, actualClassId,
                    month, actualYear, due_date || null, issue_date || null, totalAmount, initialStatus, isFamilySlip, hasMulti, monthsArray, targetYearId]
            );
            const slipId = slip.rows[0].slip_id;
            for (const item of lineItems)
                await client.query(
                    `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, is_carried_forward, arrears_head_id, note)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [slipId, item.head_id || null, item.head_name, item.amount, !!item.is_carried_forward, item.arrears_head_id || null, item.note || null]
                );
            if (extra_heads && extra_heads.length > 0)
                for (const extra of extra_heads)
                    if (extra.amount && parseFloat(extra.amount) > 0)
                        await client.query(
                            `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, is_carried_forward, arrears_head_id, note)
                             VALUES ($1, $2, $3, $4, FALSE, NULL, $5)`,
                            [slipId, extra.head_id || null, extra.head_name, extra.amount, extra.note || null]
                        );
            return slipId;
        };

        // ─── FAMILY SLIPS: One slip per family (using family_fee) ─────────────
        for (const [fid, members] of Object.entries(familyGroups)) {
            const existing = await client.query(
                `SELECT slip_id FROM monthly_fee_slips
                 WHERE family_id = $1 AND (year = $2 OR (academic_year_id = $4 AND $4 IS NOT NULL))
                   AND (month = ANY($3::int[]) OR $3::int[] && months_list)`,
                [fid, actualYear, monthsArray, targetYearId]
            );
            if (existing.rows.length > 0) { skippedCount++; continue; }

            const famPrimaryRes = await client.query(
                `SELECT s.*, COALESCE(f.family_fee, 0) AS family_fee,
                        (SELECT COUNT(*) FROM students s2 WHERE s2.family_id = s.family_id AND s2.status = 'Active') AS total_family_size,
                        c.class_id AS sort_class_id
                 FROM students s
                 LEFT JOIN families f ON f.family_id = s.family_id
                 LEFT JOIN classes c ON c.class_id = s.class_id
                 WHERE s.family_id = $1 AND s.status = 'Active'
                 ORDER BY c.class_id DESC NULLS LAST, s.first_name LIMIT 1`,
                [fid]
            );
            const primary = famPrimaryRes.rows.length > 0 ? famPrimaryRes.rows[0] : members[0];
            
            // Check if all active family members are in Trusted category
            const isFamTrusted = members.length > 0 && members.every(m => (m.category || '').trim().toLowerCase() === 'trusted');

            const familyFee = parseFloat(primary.family_fee) || 0;
            const familySize = parseInt(primary.total_family_size) || 1;

            const lineItems = buildLineItems(familyFee, familySize, isFamTrusted);

            lineItems.forEach(h => {
                if (h.head_name.toLowerCase().includes('tuition')) {
                    h.head_name = monthsCount > 1 ? `Family Monthly Fee (${monthLabel})` : 'Family Monthly Fee';
                }
            });

            if (!lineItems.some(h => h.head_name.includes('Family Monthly Fee')) && familyFee > 0) {
                lineItems.unshift({ head_id: null, head_name: monthsCount > 1 ? `Family Monthly Fee (${monthLabel})` : 'Family Monthly Fee', amount: familyFee * monthsCount, is_carried_forward: false, note: isFamTrusted ? 'Trusted Category - Free Tuition' : undefined });
            }

            // ── 1. Add Pure Previous Balance (Tuition Arrears + OPB) ───────────
            // Trusted families do NOT accumulate pure tuition arrears
            const famPB = (!isFamTrusted && pbPlanHead && fid && familyPBMap[fid]) ? familyPBMap[fid] : 0;
            if (famPB > 0) {
                lineItems.push({ head_id: pbPlanHead.head_id, head_name: 'Previous Balance', amount: famPB, is_carried_forward: false });
            }

            // ── 2. Add / Stack Cumulative Tracked Heads (Annual Fee, Exam Fee...) ─
            const cumHeads = familyCumulativeMap[fid] || [];
            for (const ch of cumHeads) {
                const existingPlanHead = lineItems.find(li => li.head_id && li.head_id === ch.head_id && !li.is_carried_forward);
                if (existingPlanHead) {
                    existingPlanHead.amount += ch.pending_amount;
                    existingPlanHead.note = (existingPlanHead.note ? existingPlanHead.note + '; ' : '') + `Includes PKR ${ch.pending_amount} past arrears`;
                } else {
                    lineItems.push({
                        head_id: ch.head_id,
                        head_name: ch.head_name,
                        amount: ch.pending_amount,
                        is_carried_forward: true,
                        arrears_head_id: ch.head_id,
                        note: 'Carried forward arrears'
                    });
                }
            }

            // For Trusted families, tuition is 100% exempt from payable total_amount
            let totalAmount = isFamTrusted
                ? lineItems.filter(h => {
                    const hn = (h.head_name || '').toLowerCase();
                    return !hn.includes('tuition') && !hn.includes('family monthly fee') && !hn.includes('monthly fee') && !hn.includes('previous balance');
                }).reduce((s, h) => s + h.amount, 0)
                : lineItems.reduce((s, h) => s + h.amount, 0);

            if (extra_heads && extra_heads.length > 0)
                totalAmount += extra_heads.filter(h => h.amount && parseFloat(h.amount) > 0)
                    .reduce((s, h) => s + parseFloat(h.amount), 0);

            await insertSlip(primary, totalAmount, lineItems, true, isFamTrusted);
            generatedCount++;
        }

        // ─── INDIVIDUAL SLIPS: Solo students ──
        for (const student of soloStudents) {
            const existing = await client.query(
                `SELECT slip_id FROM monthly_fee_slips 
                 WHERE student_id=$1 AND (year=$2 OR (academic_year_id=$4 AND $4 IS NOT NULL))
                   AND (month = ANY($3::int[]) OR $3::int[] && months_list)`,
                [student.student_id, actualYear, monthsArray, targetYearId]
            );
            if (existing.rows.length > 0) { skippedCount++; continue; }

            const isSoloTrusted = (student.category || '').trim().toLowerCase() === 'trusted';
            const personalFee = parseFloat(student.personal_monthly_fee) || 0;
            const lineItems = buildLineItems(personalFee, 1, isSoloTrusted);

            // ── 1. Add Pure Previous Balance (Tuition Arrears + OPB) ───────────
            // Trusted students do NOT accumulate pure tuition arrears
            const indivPB = (!isSoloTrusted && pbPlanHead && student.family_id && familyPBMap[student.family_id])
                ? familyPBMap[student.family_id] : 0;
            if (indivPB > 0) {
                lineItems.push({ head_id: pbPlanHead.head_id, head_name: 'Previous Balance', amount: indivPB, is_carried_forward: false });
            }

            // ── 2. Add / Stack Cumulative Tracked Heads (Annual Fee, Exam Fee...) ─
            const cumHeads = (student.family_id && familyCumulativeMap[student.family_id]) ? familyCumulativeMap[student.family_id] : [];
            for (const ch of cumHeads) {
                const existingPlanHead = lineItems.find(li => li.head_id && li.head_id === ch.head_id && !li.is_carried_forward);
                if (existingPlanHead) {
                    existingPlanHead.amount += ch.pending_amount;
                    existingPlanHead.note = (existingPlanHead.note ? existingPlanHead.note + '; ' : '') + `Includes PKR ${ch.pending_amount} past arrears`;
                } else {
                    lineItems.push({
                        head_id: ch.head_id,
                        head_name: ch.head_name,
                        amount: ch.pending_amount,
                        is_carried_forward: true,
                        arrears_head_id: ch.head_id,
                        note: 'Carried forward arrears'
                    });
                }
            }

            // For Trusted students, tuition is 100% exempt from payable total_amount
            let totalAmount = isSoloTrusted
                ? lineItems.filter(h => {
                    const hn = (h.head_name || '').toLowerCase();
                    return !hn.includes('tuition') && !hn.includes('monthly fee') && !hn.includes('previous balance');
                }).reduce((s, h) => s + h.amount, 0)
                : lineItems.reduce((s, h) => s + h.amount, 0);

            if (extra_heads && extra_heads.length > 0)
                totalAmount += extra_heads.filter(h => h.amount && parseFloat(h.amount) > 0)
                    .reduce((s, h) => s + parseFloat(h.amount), 0);

            await insertSlip(student, totalAmount, lineItems, false, isSoloTrusted);
            generatedCount++;
        }

        const coveredByFamilySlips = Object.values(familyGroups).reduce((s, m) => s + m.length, 0);
        const coveredByIndividual = soloStudents.length;

        await client.query('COMMIT');

        // Trigger instant initial fee notification delivery to families
        try {
            const { dispatchFeeReminderNotifications } = require('../scheduler');
            dispatchFeeReminderNotifications(false);
        } catch (schedErr) {
            console.error("Initial fee reminder trigger error:", schedErr.message);
        }

        res.status(201).json({
            message: 'Fee slips generated',
            generated: generatedCount,
            skipped: skippedCount,
            total_students: studentsResult.rows.length,
            total_covered: coveredByFamilySlips + coveredByIndividual,
            family_slips: Object.keys(familyGroups).length,
            family_covered_students: coveredByFamilySlips,
            individual_slips: soloStudents.length
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// GET /fee-slips/available-months
router.get('/available-months', async (req, res) => {
    try {
        const { year, class_id, academic_year_id } = req.query;
        const activeYear = await getActiveAcademicYear(pool);
        let query = 'SELECT DISTINCT COALESCE(months_list, ARRAY[month]) AS months_array FROM monthly_fee_slips WHERE 1=1';
        let params = [];
        if (year) {
            params.push(year);
            query += ` AND year = $${params.length}`;
        }
        if (class_id) {
            params.push(class_id);
            query += ` AND class_id = $${params.length}`;
        }
        if (academic_year_id && academic_year_id !== 'all') {
            params.push(academic_year_id);
            query += ` AND academic_year_id = $${params.length}`;
        } else if (!academic_year_id && !year && activeYear) {
            params.push(activeYear.id);
            query += ` AND (academic_year_id = $${params.length} OR academic_year_id IS NULL)`;
        }
        const result = await pool.query(query, params);

        const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const data = result.rows.map(r => {
            const arr = r.months_array.map(Number).sort((a, b) => a - b);
            const val = arr.join(',');
            let lbl = arr.length === 1
                ? MONTH_NAMES[arr[0] - 1]
                : `${MONTH_NAMES[arr[0] - 1]} - ${MONTH_NAMES[arr[arr.length - 1] - 1]}`;
            return { value: val, label: lbl, months: arr };
        });

        data.sort((a, b) => a.months[0] - b.months[0]);

        res.json({ months: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const cleanupCorruptLineItems = async () => {
    try {
        await pool.query(`
            UPDATE slip_line_items 
            SET paid_amount = 0 
            WHERE slip_id IN (SELECT slip_id FROM monthly_fee_slips WHERE paid_amount <= 0 OR paid_amount IS NULL)
        `);
        await pool.query(`
            UPDATE slip_line_items 
            SET paid_amount = LEAST(paid_amount, amount) 
            WHERE paid_amount > amount
        `);
        // Synchronize total_amount with line items sum if line items exist
        await pool.query(`
            UPDATE monthly_fee_slips mfs
            SET total_amount = (
                SELECT COALESCE(SUM(amount), 0) FROM slip_line_items WHERE slip_id = mfs.slip_id
            )
            WHERE EXISTS (
                SELECT 1 FROM slip_line_items sli WHERE sli.slip_id = mfs.slip_id
                GROUP BY sli.slip_id
                HAVING ABS(SUM(sli.amount) - mfs.total_amount) > 0.01
            )
        `);

        const mismatchSlips = await pool.query(`
            SELECT mfs.slip_id, mfs.paid_amount
            FROM monthly_fee_slips mfs
            JOIN (
                SELECT slip_id, SUM(paid_amount) as sum_paid
                FROM slip_line_items
                GROUP BY slip_id
            ) sli ON sli.slip_id = mfs.slip_id
            WHERE ABS(sli.sum_paid - mfs.paid_amount) > 0.01
        `);
        for (const s of mismatchSlips.rows) {
            const slipId = s.slip_id;
            const slipPaid = parseFloat(s.paid_amount) || 0;
            await pool.query('UPDATE slip_line_items SET paid_amount = 0 WHERE slip_id = $1', [slipId]);
            if (slipPaid > 0) {
                const items = await pool.query('SELECT item_id, amount FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id', [slipId]);
                let remAlloc = slipPaid;
                for (const item of items.rows) {
                    if (remAlloc <= 0) break;
                    const itemAmt = parseFloat(item.amount) || 0;
                    const itemPaid = parseFloat(Math.min(remAlloc, itemAmt).toFixed(2));
                    await pool.query('UPDATE slip_line_items SET paid_amount = $1 WHERE item_id = $2', [itemPaid, item.item_id]);
                    remAlloc = parseFloat((remAlloc - itemPaid).toFixed(2));
                }
            }
        }
    } catch (e) { }
};

const syncTrustedSlipsState = async () => {
    try {
        const trustedSlipsRes = await pool.query(`
            SELECT mfs.slip_id, mfs.paid_amount, s.category, mfs.is_family_slip, mfs.family_id,
                   COALESCE(SUM(CASE WHEN NOT (sli.head_name ILIKE '%tuition%' OR sli.head_name ILIKE '%family monthly fee%' OR sli.head_name ILIKE '%monthly fee%' OR sli.head_name ILIKE '%previous balance%') THEN sli.amount ELSE 0 END), 0) as non_tuition_total
            FROM monthly_fee_slips mfs
            JOIN students s ON mfs.student_id = s.student_id
            LEFT JOIN slip_line_items sli ON mfs.slip_id = sli.slip_id
            WHERE s.category ILIKE '%trust%'
            GROUP BY mfs.slip_id, mfs.paid_amount, s.category, mfs.is_family_slip, mfs.family_id
        `);
        for (const r of trustedSlipsRes.rows) {
            const netTotal = parseFloat(r.non_tuition_total);
            const paid = parseFloat(r.paid_amount || 0);
            const newStatus = netTotal <= 0 ? 'satteled' : (paid >= netTotal ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'));
            await pool.query(
                'UPDATE monthly_fee_slips SET total_amount = $1, status = $2 WHERE slip_id = $3 AND (total_amount != $1 OR status != $2)',
                [netTotal, newStatus, r.slip_id]
            );
        }
    } catch (e) { }
};

// GET /fee-slips?class_id=&year=&month=&academic_year_id=
router.get('/', async (req, res) => {
    try {
        const { class_id, month, year, academic_year_id } = req.query;

        // Auto-cleanup any corrupt line item paid amounts before returning slips
        await cleanupCorruptLineItems();
        await syncTrustedSlipsState();

        const activeYear = await getActiveAcademicYear(pool);
        const yearsRes = await pool.query("SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC");

        // Build WHERE conditions dynamically
        const params = [];
        let whereClauses = [];

        if (academic_year_id && academic_year_id !== 'all') {
            params.push(academic_year_id);
            whereClauses.push(`mfs.academic_year_id = $${params.length}`);
        } else if (!academic_year_id && !year && activeYear) {
            params.push(activeYear.id);
            whereClauses.push(`(mfs.academic_year_id = $${params.length} OR mfs.academic_year_id IS NULL)`);
        }

        if (year) {
            params.push(year);
            whereClauses.push(`mfs.year = $${params.length}`);
        }

        if (month) {
            params.push(month.split(',').map(Number));
            whereClauses.push(`COALESCE(mfs.months_list, ARRAY[mfs.month]) = $${params.length}::int[]`);
        }

        if (class_id) {
            params.push(class_id);
            whereClauses.push(`(
                mfs.class_id = $${params.length}
                OR (
                  mfs.is_family_slip = TRUE
                  AND mfs.family_id IN (
                    SELECT family_id FROM students
                    WHERE class_id = $${params.length} AND status = 'Active' AND family_id IS NOT NULL
                  )
                )
            )`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const result = await pool.query(`
            SELECT mfs.*, s.first_name, s.last_name, s.admission_no, s.family_id,
                     s.father_name, s.father_phone, c.class_name, sec.section_name, s.category,
                     ay.year_name AS academic_year_name, COALESCE(ay.is_active, TRUE) AS is_active_year,
                COALESCE(JSON_AGG(JSON_BUILD_OBJECT('item_id',sli.item_id,'head_name',sli.head_name,'amount',sli.amount,'paid_amount',COALESCE(sli.paid_amount,0),'note',sli.note) ORDER BY sli.item_id) FILTER (WHERE sli.item_id IS NOT NULL),'[]') as line_items
            FROM monthly_fee_slips mfs
            JOIN students s ON mfs.student_id = s.student_id
            LEFT JOIN classes c ON mfs.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN academic_years ay ON mfs.academic_year_id = ay.id
            LEFT JOIN slip_line_items sli ON mfs.slip_id = sli.slip_id
            ${whereSql}
            GROUP BY mfs.slip_id, s.first_name, s.last_name, s.admission_no, s.family_id,
                       s.father_name, s.father_phone, c.class_name, sec.section_name, s.category,
                       ay.year_name, ay.is_active
            ORDER BY mfs.month ASC, s.first_name ASC`, params);

        // For family slips, attach all active students in this class that share the family_id
        const familySlipIds = result.rows
            .filter(r => r.is_family_slip && r.family_id)
            .map(r => r.family_id);
        const membersMap = {};
        if (familySlipIds.length > 0) {
            const membersResult = await pool.query(
                `SELECT s.student_id, s.first_name, s.last_name, s.admission_no, s.family_id, s.father_name,
                        c.class_name, c.class_id, sec.section_name, s.category
                 FROM students s
                 LEFT JOIN classes c ON s.class_id = c.class_id
                 LEFT JOIN sections sec ON s.section_id = sec.section_id
                 WHERE s.family_id = ANY($1) AND s.status = 'Active'
                 ORDER BY c.class_id DESC NULLS LAST, s.first_name`,
                [familySlipIds]
            );
            for (const m of membersResult.rows) {
                if (!membersMap[m.family_id]) membersMap[m.family_id] = [];
                membersMap[m.family_id].push(m);
            }
        }

        // Evaluate trusted category and all-trusted families
        result.rows.forEach(r => {
            if (r.is_family_slip && r.family_id) {
                r.family_members = membersMap[r.family_id] || [];
            } else {
                r.family_members = [];
            }
            const isSingleTrusted = (r.category || '').trim().toLowerCase() === 'trusted';
            const isFamilyAllTrusted = r.family_members.length > 0 && r.family_members.every(m => (m.category || '').trim().toLowerCase() === 'trusted');
            r.is_trusted = isSingleTrusted || isFamilyAllTrusted;

            if (r.is_trusted) {
                const nonTuitionHeads = (r.line_items || []).filter(item => {
                    const hn = (item.head_name || '').toLowerCase();
                    return !hn.includes('tuition') && 
                           !hn.includes('family monthly fee') && 
                           !hn.includes('monthly fee') && 
                           !hn.includes('previous balance');
                });
                const payableTotal = nonTuitionHeads.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
                r.total_amount = payableTotal;
                const slipPaid = parseFloat(r.paid_amount || 0);
                if (payableTotal <= 0) {
                    r.status = 'satteled';
                } else {
                    r.status = slipPaid >= payableTotal ? 'paid' : slipPaid > 0 ? 'partial' : 'unpaid';
                }
            }
        });

        let stats;
        if (month) {
            // Single month query
            const payableRows = result.rows.filter(r => !['satteled', 'settled'].includes((r.status || '').toLowerCase()));
            stats = {
                total_students: result.rows.length,
                total_amount: payableRows.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0),
                paid_amount: payableRows.reduce((s, r) => s + parseFloat(r.paid_amount || 0), 0),
                paid_count: result.rows.filter(r => ['paid', 'satteled', 'settled'].includes((r.status || '').toLowerCase())).length,
                unpaid_count: result.rows.filter(r => (r.status || '').toLowerCase() === 'unpaid').length,
                partial_count: result.rows.filter(r => (r.status || '').toLowerCase() === 'partial').length,
            };
        } else {
            // Multi-month / Whole year query: Group by account to prevent double-counting of Previous Balance
            const accountMap = new Map();
            result.rows.forEach(r => {
                const key = (r.is_family_slip && r.family_id) ? `fam_${r.family_id}` : `stu_${r.student_id}`;
                if (!accountMap.has(key)) {
                    accountMap.set(key, []);
                }
                accountMap.get(key).push(r);
            });

            let totalNetBilled = 0;
            let totalPaid = 0;
            let paidCount = 0;
            let unpaidCount = 0;
            let partialCount = 0;

            accountMap.forEach(slips => {
                slips.sort((a, b) => (a.year - b.year) || (a.month - b.month));
                const latestSlip = slips[slips.length - 1];
                const isSettled = ['satteled', 'settled'].includes((latestSlip.status || '').toLowerCase()) && (parseFloat(latestSlip.total_amount || 0) <= 0);

                const acctPaid = slips.reduce((sum, s) => sum + parseFloat(s.paid_amount || 0), 0);
                const acctDue = isSettled ? 0 : Math.max(0, parseFloat(latestSlip.total_amount || 0) - parseFloat(latestSlip.paid_amount || 0));
                const acctBilled = acctPaid + acctDue;

                totalPaid += acctPaid;
                totalNetBilled += acctBilled;

                if (isSettled || acctDue === 0) {
                    paidCount++;
                } else if (acctPaid > 0) {
                    partialCount++;
                } else {
                    unpaidCount++;
                }
            });

            stats = {
                total_students: accountMap.size,
                total_amount: parseFloat(totalNetBilled.toFixed(2)),
                paid_amount: parseFloat(totalPaid.toFixed(2)),
                paid_count: paidCount,
                unpaid_count: unpaidCount,
                partial_count: partialCount,
            };
        }

        res.json({ slips: result.rows, stats, active_year: activeYear, years: yearsRes.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// ADMISSION FEE LEDGER declared BEFORE /:id to avoid conflict
// ============================================================

// GET /fee-slips/admission-fees
router.get('/admission-fees', async (req, res) => {
    try {
        const { status, class_id, academic_year_id } = req.query;
        const activeYear = await getActiveAcademicYear(pool);
        const yearsRes = await pool.query("SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC");

        let whereClause = '1=1';
        const params = [];
        if (status && status !== 'all') { params.push(status); whereClause += ` AND afl.status = $${params.length}`; }
        else if (!status) { whereClause += ` AND afl.status IN ('unpaid','partial')`; }
        if (class_id) { params.push(class_id); whereClause += ` AND s.class_id = $${params.length}`; }
        if (academic_year_id && academic_year_id !== 'all') {
            params.push(academic_year_id);
            whereClause += ` AND afl.academic_year_id = $${params.length}`;
        } else if (!academic_year_id && activeYear) {
            params.push(activeYear.id);
            whereClause += ` AND (afl.academic_year_id = $${params.length} OR afl.academic_year_id IS NULL)`;
        }

        const result = await pool.query(`
            SELECT afl.ledger_id, afl.student_id, afl.total_amount, afl.paid_amount, COALESCE(afl.discount_amount, 0) AS discount_amount,
                (afl.total_amount - afl.paid_amount - COALESCE(afl.discount_amount, 0)) AS remaining_amount, afl.status, afl.admission_date,
                afl.academic_year_id, ay.year_name AS academic_year_name, COALESCE(ay.is_active, TRUE) AS is_active_year,
                s.first_name, s.last_name, s.admission_no, s.father_name, s.student_mobile, s.monthly_fee,
                c.class_name, sec.section_name
            FROM admission_fee_ledger afl
            JOIN students s ON afl.student_id = s.student_id
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN academic_years ay ON afl.academic_year_id = ay.id
            WHERE ${whereClause}
            ORDER BY CASE afl.status WHEN 'unpaid' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END, afl.admission_date DESC
        `, params);

        const statsResult = await pool.query(`
            SELECT COUNT(*) FILTER (WHERE status='unpaid') AS unpaid_count,  
                   COUNT(*) FILTER (WHERE status='partial') AS partial_count,
                   COUNT(*) FILTER (WHERE status='paid') AS paid_count,      
                   COALESCE(SUM(total_amount),0) AS total_billed,
                   COALESCE(SUM(paid_amount),0) AS total_collected,
                   COALESCE(SUM(total_amount - paid_amount - COALESCE(discount_amount, 0)),0) AS total_outstanding
            FROM admission_fee_ledger afl
            WHERE ${whereClause}`, params);

        res.json({ ledgers: result.rows, stats: statsResult.rows[0], active_year: activeYear, years: yearsRes.rows });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /fee-slips/admission-fees/student/:student_id
router.get('/admission-fees/student/:student_id', async (req, res) => {
    try {
        const { student_id } = req.params;
        const ledger = await pool.query(`
            SELECT afl.*, (afl.total_amount - afl.paid_amount - COALESCE(afl.discount_amount, 0)) AS remaining_amount,
                s.first_name, s.last_name, s.admission_no, s.monthly_fee, s.father_name,
                c.class_name, sec.section_name
            FROM admission_fee_ledger afl
            JOIN students s ON afl.student_id = s.student_id
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE afl.student_id = $1`, [student_id]);
        if (ledger.rows.length === 0) return res.json({ ledger: null, payments: [] });
        const payments = await pool.query(`SELECT * FROM admission_fee_payments WHERE ledger_id=$1 ORDER BY payment_date DESC`, [ledger.rows[0].ledger_id]);
        res.json({ ledger: ledger.rows[0], payments: payments.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /fee-slips/admission-fees/:ledger_id/pay
router.post('/admission-fees/:ledger_id/pay', async (req, res) => {
    const client = await pool.connect();
    try {
        const { ledger_id } = req.params;
        const { amount_paid, discount_amount, payment_method, received_by, reference_no, notes, payment_date, include_tuition, tuition_amount, tuition_received } = req.body;

        const payVal = parseFloat(amount_paid) || 0;
        const discVal = parseFloat(discount_amount) || 0;
        const tuitionAmt = parseFloat(tuition_amount) || 0;
        const tuitionRec = parseFloat(tuition_received) || 0;

        if (payVal < 0 || discVal < 0 || (payVal === 0 && discVal === 0 && (!include_tuition || tuitionRec <= 0)))
            return res.status(400).json({ error: 'amount_paid, discount, or tuition_received must be greater than 0' });

        await client.query('BEGIN');
        const ledger = await client.query(`
            SELECT afl.*, ay.is_active AS is_year_active, ay.year_name 
            FROM admission_fee_ledger afl
            LEFT JOIN academic_years ay ON ay.id = afl.academic_year_id
            WHERE afl.ledger_id=$1 
            FOR UPDATE OF afl
        `, [ledger_id]);
        if (ledger.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Admission fee ledger not found' }); }

        const current = ledger.rows[0];

        // Fiscal Year Lock
        if (current.academic_year_id && current.is_year_active === false) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: `Fiscal/Academic Year (${current.year_name || 'Closed'}) is closed. Payments cannot be collected on historical admission records.`
            });
        }

        const oldPaid = parseFloat(current.paid_amount) || 0;
        const oldDisc = parseFloat(current.discount_amount) || 0;
        const total = parseFloat(current.total_amount) || 0;

        const newPaid = oldPaid + payVal;
        const newDisc = oldDisc + discVal;
        const totalCleared = newPaid + newDisc;
        const remaining = total - totalCleared;

        if (remaining < 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Overpayment/overdiscount not allowed. Remaining: Rs. ${(total - oldPaid - oldDisc).toFixed(0)}` });
        }

        const newStatus = remaining <= 0 ? 'paid' : (totalCleared > 0 ? 'partial' : 'unpaid');

        const insertRes = await client.query(`
            INSERT INTO admission_fee_payments (ledger_id, amount_paid, discount_amount, payment_date, payment_method, received_by, reference_no, notes, academic_year_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING payment_id
        `, [ledger_id, payVal, discVal, payment_date || new Date(), payment_method || 'cash', received_by, reference_no, notes, current.academic_year_id || null]);

        const updated = await client.query(`
            UPDATE admission_fee_ledger 
            SET paid_amount=$1, discount_amount=$2, status=$3 
            WHERE ledger_id=$4 
            RETURNING *, (total_amount - paid_amount - discount_amount) AS remaining_amount
        `, [newPaid, newDisc, newStatus, ledger_id]);

        // Process seamlessly injected Current Month Tuition Fee into monthly slips
        if (include_tuition && tuitionAmt > 0) {
            const today = new Date();
            const currentMonth = today.getMonth() + 1;
            const currentYear = today.getFullYear();

            // Check if monthly limit already exists for this student + month
            const existingSlip = await client.query(
                `SELECT slip_id FROM monthly_fee_slips WHERE student_id = $1 AND month = $2 AND year = $3 LIMIT 1`,
                [current.student_id, currentMonth, currentYear]
            );

            let activeSlipId;

            if (existingSlip.rows.length === 0) {
                // Create a standalone tuition slip
                const newSlip = await client.query(
                    `INSERT INTO monthly_fee_slips 
                    (student_id, family_id, class_id, month, year, total_amount, paid_amount, status, months_list, academic_year_id)
                    VALUES ($1, (SELECT family_id FROM students WHERE student_id=$1), (SELECT class_id FROM students WHERE student_id=$1), $2, $3, $4, $5, $6, ARRAY[$2]::int[], $7)
                    RETURNING slip_id`,
                    [
                        current.student_id,
                        currentMonth,
                        currentYear,
                        tuitionAmt,
                        Math.min(tuitionAmt, tuitionRec),
                        tuitionRec >= tuitionAmt ? 'paid' : (tuitionRec > 0 ? 'partial' : 'unpaid'),
                        current.academic_year_id || null
                    ]
                );
                activeSlipId = newSlip.rows[0].slip_id;

                await client.query(`
                    INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                    VALUES ($1, NULL, 'Tuition Fee', $2, $3, 'Added upfront heavily during admission')
                `, [activeSlipId, tuitionAmt, Math.min(tuitionAmt, tuitionRec)]);

            } else {
                activeSlipId = existingSlip.rows[0].slip_id;
                // Append line item to existing slip
                await client.query(`
                    INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                    VALUES ($1, NULL, 'Tuition Fee', $2, $3, 'Added upfront during admission')
                `, [activeSlipId, tuitionAmt, Math.min(tuitionAmt, tuitionRec)]);

                await client.query(`
                    UPDATE monthly_fee_slips 
                    SET total_amount = total_amount + $1, 
                        paid_amount = paid_amount + $2,
                        status = CASE WHEN (paid_amount + $2) >= (total_amount + $1) THEN 'paid' 
                                      WHEN (paid_amount + $2) > 0 THEN 'partial' 
                                      ELSE 'unpaid' END
                    WHERE slip_id = $3
                `, [tuitionAmt, Math.min(tuitionAmt, tuitionRec), activeSlipId]);
            }

            // Save actual fee payment record for full tracking
            if (tuitionRec > 0) {
                await client.query(
                    `INSERT INTO fee_payments (slip_id, amount_paid, payment_date, payment_method, received_by, reference_no, notes, academic_year_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        activeSlipId,
                        Math.min(tuitionAmt, tuitionRec),
                        payment_date || new Date(),
                        payment_method || 'cash',
                        received_by,
                        reference_no,
                        'Collected upfront during Admission via Ledger',
                        current.academic_year_id || null
                    ]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Payment recorded successfully', ledger: updated.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error during admission fee payment:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});
// ============================================================
// PRINT QUEUE family-grouped vouchers with print tracking
// GET /fee-slips/print-queue?month=&year=&class_id=&academic_year_id=
// ============================================================
router.get('/print-queue', async (req, res) => {
    const { month, year, class_id, academic_year_id } = req.query;
    if (!month || !year) return res.status(400).json({ error: 'month and year required' });
    try {
        const activeYear = await getActiveAcademicYear(pool);
        const mArr = month.split(',').map(Number);
        const params = [mArr, year];
        let yearFilter = '';
        if (academic_year_id && academic_year_id !== 'all') {
            params.push(academic_year_id);
            yearFilter = `AND mfs.academic_year_id = $${params.length}`;
        } else if (!academic_year_id && activeYear) {
            params.push(activeYear.id);
            yearFilter = `AND (mfs.academic_year_id = $${params.length} OR mfs.academic_year_id IS NULL)`;
        }

        // Fetch all slips for this month/year with student + class info + line items
        const result = await pool.query(`
            SELECT mfs.slip_id, mfs.student_id, mfs.family_id, mfs.class_id,
                   mfs.total_amount, mfs.paid_amount, mfs.status, mfs.due_date, mfs.issue_date,
                   mfs.is_printed, mfs.printed_at, mfs.is_family_slip, mfs.academic_year_id,
                   ay.year_name AS academic_year_name, COALESCE(ay.is_active, TRUE) AS is_active_year,
                   s.first_name, s.last_name, s.admission_no, s.monthly_fee, s.father_name, s.family_id AS s_family_id,
                   sc.class_name, sc.class_id AS c_class_id, sec.section_name,
                   COALESCE(JSON_AGG(
                       JSON_BUILD_OBJECT(
                           'item_id', sli.item_id,
                           'head_id', sli.head_id,
                           'head_name', sli.head_name,
                           'amount', sli.amount,
                           'note', sli.note,
                           'is_carried_forward', sli.is_carried_forward
                       )
                       ORDER BY sli.item_id
                   ) FILTER (WHERE sli.item_id IS NOT NULL), '[]') AS line_items
            FROM monthly_fee_slips mfs
            JOIN students s ON mfs.student_id = s.student_id       
            LEFT JOIN classes sc ON s.class_id = sc.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN academic_years ay ON mfs.academic_year_id = ay.id
            LEFT JOIN slip_line_items sli ON mfs.slip_id = sli.slip_id
            WHERE COALESCE(mfs.months_list, ARRAY[mfs.month]) = $1::int[] AND mfs.year = $2
              ${yearFilter}
            GROUP BY mfs.slip_id, mfs.student_id, mfs.family_id, mfs.class_id,
                     mfs.total_amount, mfs.paid_amount, mfs.status, mfs.due_date, mfs.issue_date,
                     mfs.is_printed, mfs.printed_at, mfs.is_family_slip, mfs.academic_year_id,
                     ay.year_name, ay.is_active,
                     s.first_name, s.last_name, s.admission_no, s.monthly_fee, s.father_name, s.family_id,
                     sc.class_name, sc.class_id, sec.section_name
            ORDER BY s.family_id NULLS LAST, sc.class_id DESC NULLS LAST, s.first_name
        `, params);

        const allSlips = result.rows;

        // Pre-calculate pending months count for all families and solo students in active session
        const pendingMonthsRes = await pool.query(`
            SELECT mfs.family_id, mfs.student_id, COUNT(DISTINCT mfs.month) AS pending_months_count
            FROM monthly_fee_slips mfs
            WHERE mfs.status IN ('unpaid', 'partial')
              ${academic_year_id && academic_year_id !== 'all' ? `AND mfs.academic_year_id = ${parseInt(academic_year_id)}` : (activeYear ? `AND (mfs.academic_year_id = ${activeYear.id} OR mfs.academic_year_id IS NULL)` : '')}
            GROUP BY mfs.family_id, mfs.student_id
        `);
        const famPendingMap = {};
        const stuPendingMap = {};
        for (const r of pendingMonthsRes.rows) {
            if (r.family_id) famPendingMap[r.family_id] = parseInt(r.pending_months_count) || 1;
            if (r.student_id) stuPendingMap[r.student_id] = parseInt(r.pending_months_count) || 1;
        }

        // Group by family_id
        const familyMap = {};
        const soloSlips = [];
        for (const slip of allSlips) {
            // Use is_family_slip flag a student can have family_id but still get an individual slip
            // if they were the only active family member at generation time
            if (!slip.is_family_slip) {
                soloSlips.push(slip);
            } else {
                if (!familyMap[slip.family_id]) familyMap[slip.family_id] = [];
                familyMap[slip.family_id].push(slip);
            }
        }

        const vouchers = [];

        // Individual vouchers
        for (const slip of soloSlips) {
            const pCount = (slip.family_id ? famPendingMap[slip.family_id] : stuPendingMap[slip.student_id]) || 1;
            vouchers.push({
                voucher_type: 'individual',
                primary: slip,
                siblings: [],
                family_id: slip.family_id || null,
                total_family_amount: parseFloat(slip.total_amount),
                total_paid: parseFloat(slip.paid_amount),
                is_printed: !!slip.is_printed,
                slip_ids: [slip.slip_id],
                family_members: [],
                pending_months_count: pCount
            });
        }

        // Helper to determine class seniority/rank (highest class first)
        const getClassRank = (className, classId) => {
            if (!className) return typeof classId === 'number' ? classId : 0;
            const name = className.toString().trim().toLowerCase();
            const numMatch = name.match(/\b(\d+)(?:st|nd|rd|th)?\b/) || name.match(/(\d+)/);
            if (numMatch) {
                return parseInt(numMatch[1], 10);
            }
            if (name.includes('prep') || name.includes('kg') || name.includes('kindergarten')) return 0;
            if (name.includes('nursery')) return -1;
            if (name.includes('play') || name.includes('pg') || name.includes('daycare') || name.includes('montessori')) return -2;
            return typeof classId === 'number' ? classId : 0;
        };

        const compareSections = (secA, secB) => {
            const sA = (secA || '').toString().trim().toLowerCase();
            const sB = (secB || '').toString().trim().toLowerCase();
            if (!sA && !sB) return 0;
            if (!sA) return 1;
            if (!sB) return -1;
            return sA.localeCompare(sB, undefined, { sensitivity: 'base' });
        };

        // Family vouchers primary = student in highest class, then earlier section
        for (const [fid, slips] of Object.entries(familyMap)) {
            slips.sort((a, b) => {
                const rankA = getClassRank(a.class_name, a.c_class_id || a.class_id);
                const rankB = getClassRank(b.class_name, b.c_class_id || b.class_id);
                if (rankA !== rankB) return rankB - rankA;

                const secComp = compareSections(a.section_name, b.section_name);
                if (secComp !== 0) return secComp;

                return (a.first_name || '').localeCompare(b.first_name || '');
            });
            const primary = slips[0];
            const siblings = slips.slice(1);

            // Fetch all active family members for family vouchers so the print shows all students
            const membersResult = await pool.query(
                `SELECT s.student_id, s.first_name, s.last_name, s.father_name, s.family_id,
                        c.class_name, c.class_id, sec.section_name
                 FROM students s
                 LEFT JOIN classes c ON s.class_id = c.class_id
                 LEFT JOIN sections sec ON s.section_id = sec.section_id
                 WHERE s.family_id = $1 AND s.status = 'Active'`,
                [fid]
            );

            const sortedMembers = (membersResult.rows || []).sort((a, b) => {
                const rankA = getClassRank(a.class_name, a.class_id);
                const rankB = getClassRank(b.class_name, b.class_id);
                if (rankA !== rankB) return rankB - rankA;
                const secComp = compareSections(a.section_name, b.section_name);
                if (secComp !== 0) return secComp;
                return (a.first_name || '').localeCompare(b.first_name || '');
            });

            const pCount = famPendingMap[fid] || 1;
            vouchers.push({
                voucher_type: 'family',
                family_id: fid,
                primary,
                siblings,
                total_family_amount: slips.reduce((s, x) => s + parseFloat(x.total_amount), 0),
                total_paid: slips.reduce((s, x) => s + parseFloat(x.paid_amount), 0),
                is_printed: slips.every(s => s.is_printed),
                partial_printed: slips.some(s => s.is_printed) && !slips.every(s => s.is_printed),
                slip_ids: slips.map(s => s.slip_id),
                family_members: sortedMembers,
                pending_months_count: pCount
            });
        }

        // If class_id filter: show vouchers where primary OR any family member is in this class
        // Track students in this class whose primary is in a DIFFERENT class (cross-class family)
        let filteredVouchers = vouchers;
        let coveredStudents = [];
        if (class_id) {
            filteredVouchers = vouchers.filter(v => {
                if (v.voucher_type === 'family') {
                    // Show family voucher in ANY class that has a member
                    return v.family_members?.some(
                        m => m.class_id?.toString() === class_id.toString()
                    ) || v.primary.class_id?.toString() === class_id.toString();
                }
                return v.primary.class_id?.toString() === class_id.toString();
            });
            // Covered students: family members in this class whose PRIMARY is in a different class
            for (const v of vouchers) {
                if (v.voucher_type === 'family' && v.primary.class_id?.toString() !== class_id.toString()) {
                    const inThisClass = (v.family_members || []).filter(
                        m => m.class_id?.toString() === class_id.toString()
                    );
                    for (const m of inThisClass) {
                        coveredStudents.push({ ...m, covered_by: v.primary });
                    }
                }
            }
        }

        // Sort: 1) Highest Class First -> 2) Section Alphabetical (A-Z, Blue/Green/Red) -> 3) Unprinted First -> 4) Name Alphabetical
        filteredVouchers.sort((a, b) => {
            const rankA = getClassRank(a.primary.class_name, a.primary.c_class_id || a.primary.class_id);
            const rankB = getClassRank(b.primary.class_name, b.primary.c_class_id || b.primary.class_id);
            if (rankA !== rankB) return rankB - rankA;

            const clsA = (a.primary.class_name || '').trim().toLowerCase();
            const clsB = (b.primary.class_name || '').trim().toLowerCase();
            if (clsA !== clsB) {
                const clsComp = clsA.localeCompare(clsB);
                if (clsComp !== 0) return clsComp;
            }

            const secComp = compareSections(a.primary.section_name, b.primary.section_name);
            if (secComp !== 0) return secComp;

            if (!a.is_printed && b.is_printed) return -1;
            if (a.is_printed && !b.is_printed) return 1;

            const nameA = `${a.primary.first_name || ''} ${a.primary.last_name || ''}`.trim().toLowerCase();
            const nameB = `${b.primary.first_name || ''} ${b.primary.last_name || ''}`.trim().toLowerCase();
            return nameA.localeCompare(nameB);
        });

        res.json({
            vouchers: filteredVouchers,
            covered_students: coveredStudents,
            stats: {
                total_vouchers: filteredVouchers.length,
                printed: filteredVouchers.filter(v => v.is_printed).length,
                pending: filteredVouchers.filter(v => !v.is_printed).length,
                family_vouchers: filteredVouchers.filter(v => v.voucher_type === 'family').length,
            }
        });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// POST /fee-slips/mark-printed
router.post('/mark-printed', async (req, res) => {
    try {
        const { slip_ids } = req.body;
        if (!slip_ids || slip_ids.length === 0) return res.status(400).json({ error: 'slip_ids required' });
        await pool.query(
            `UPDATE monthly_fee_slips SET is_printed = TRUE, printed_at = NOW() WHERE slip_id = ANY($1)`,
            [slip_ids]
        );
        res.json({ message: `${slip_ids.length} slip(s) marked as printed` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// MONTHLY SLIP DETAIL & PAYMENT after /admission-fees
// ============================================================

// GET /fee-slips/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const slip = await pool.query(`
            SELECT mfs.*, ay.year_name AS academic_year_name, COALESCE(ay.is_active, TRUE) AS is_active_year,
                   s.first_name, s.last_name, s.admission_no, s.father_name, s.father_phone, c.class_name, sec.section_name, s.category
            FROM monthly_fee_slips mfs
            JOIN students s ON mfs.student_id = s.student_id
            LEFT JOIN classes c ON mfs.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN academic_years ay ON mfs.academic_year_id = ay.id
            WHERE mfs.slip_id = $1`, [id]);
        if (slip.rows.length === 0) return res.status(404).json({ error: 'Slip not found' });
        const items = await pool.query('SELECT * FROM slip_line_items WHERE slip_id=$1 ORDER BY item_id', [id]);
        const payments = await pool.query('SELECT * FROM fee_payments WHERE slip_id=$1 ORDER BY payment_date DESC', [id]);
        const r = slip.rows[0];

        let familyMembers = [];
        if (r.is_family_slip && r.family_id) {
            const fmRes = await pool.query(
                `SELECT s.student_id, s.first_name, s.last_name, s.admission_no, s.category, c.class_name
                 FROM students s
                 LEFT JOIN classes c ON s.class_id = c.class_id
                 WHERE s.family_id = $1 AND s.status = 'Active'`,
                [r.family_id]
            );
            familyMembers = fmRes.rows;
        }
        const isSingleTrusted = (r.category || '').trim().toLowerCase() === 'trusted';
        const isFamilyAllTrusted = familyMembers.length > 0 && familyMembers.every(m => (m.category || '').trim().toLowerCase() === 'trusted');
        r.is_trusted = isSingleTrusted || isFamilyAllTrusted;
        r.family_members = familyMembers;

        if (r.is_trusted) {
            const nonTuitionHeads = items.rows.filter(item => {
                const hn = (item.head_name || '').toLowerCase();
                return !hn.includes('tuition') && 
                       !hn.includes('family monthly fee') && 
                       !hn.includes('monthly fee') && 
                       !hn.includes('previous balance');
            });
            const payableTotal = nonTuitionHeads.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
            r.total_amount = payableTotal;
            const slipPaid = parseFloat(r.paid_amount || 0);
            if (payableTotal <= 0) {
                r.status = 'satteled';
            } else {
                r.status = slipPaid >= payableTotal ? 'paid' : slipPaid > 0 ? 'partial' : 'unpaid';
            }
        }

        res.json({ ...r, slip: { ...r, line_items: items.rows, payments: payments.rows }, line_items: items.rows, payments: payments.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /fee-slips/:id/pay
router.post('/:id/pay', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { amount_paid, payment_method, received_by, reference_no, notes, payment_date, head_breakdown, is_printed, waived_item_ids } = req.body;
        await client.query('BEGIN');
        const slip = await client.query(`
            SELECT mfs.*, ay.year_name, ay.is_active AS is_year_active 
            FROM monthly_fee_slips mfs
            LEFT JOIN academic_years ay ON ay.id = mfs.academic_year_id
            WHERE mfs.slip_id = $1 
            FOR UPDATE OF mfs
        `, [id]);
        if (slip.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Slip not found' }); }

        const cur = slip.rows[0];

        // Fiscal Year Lock
        if (cur.academic_year_id && cur.is_year_active === false) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: `Fiscal/Academic Year (${cur.year_name || 'Closed'}) is closed. Payments cannot be collected on historical closed session slips.`
            });
        }

        // Process any waived line items (e.g. Late Fine Wave-off)
        let totalWaivedAmount = 0;
        if (waived_item_ids && Array.isArray(waived_item_ids) && waived_item_ids.length > 0) {
            for (const wId of waived_item_ids) {
                const wRes = await client.query(
                    `SELECT item_id, amount, paid_amount FROM slip_line_items WHERE item_id = $1 AND slip_id = $2 FOR UPDATE`,
                    [wId, id]
                );
                if (wRes.rows.length > 0) {
                    const row = wRes.rows[0];
                    const remaining = Math.max(0, parseFloat(row.amount) - parseFloat(row.paid_amount));
                    if (remaining > 0) {
                        totalWaivedAmount += remaining;
                        await client.query(
                            `UPDATE slip_line_items 
                             SET is_waived = TRUE, 
                                 waived_at = NOW(),
                                 amount = paid_amount,
                                 note = CASE WHEN note IS NULL OR note = '' THEN 'Waived off' ELSE note || ' (Waived off)' END
                             WHERE item_id = $1 AND slip_id = $2`,
                            [wId, id]
                        );
                    }
                }
            }
        }

        const stuCatRes = await client.query(`SELECT s.category, s.family_id FROM students s WHERE s.student_id = $1`, [cur.student_id]);
        let isTrustedSlip = (stuCatRes.rows[0]?.category || '').trim().toLowerCase() === 'trusted';
        if (!isTrustedSlip && cur.is_family_slip && cur.family_id) {
            const fmRes = await client.query(`SELECT category FROM students WHERE family_id = $1 AND status = 'Active'`, [cur.family_id]);
            isTrustedSlip = fmRes.rows.length > 0 && fmRes.rows.every(m => (m.category || '').trim().toLowerCase() === 'trusted');
        }

        let effectiveTotal = parseFloat(cur.total_amount);
        if (isTrustedSlip) {
            const itemsRes = await client.query(`SELECT head_name, amount FROM slip_line_items WHERE slip_id = $1`, [id]);
            const nonTuitionSum = itemsRes.rows.filter(item => {
                const hn = (item.head_name || '').toLowerCase();
                return !hn.includes('tuition') && !hn.includes('family monthly fee') && !hn.includes('monthly fee') && !hn.includes('previous balance');
            }).reduce((s, it) => s + parseFloat(it.amount || 0), 0);
            effectiveTotal = nonTuitionSum;
        }

        const prevPaid = parseFloat(cur.paid_amount);
        const paidNow = parseFloat(amount_paid || 0);
        const newPaid = prevPaid + paidNow;
        const total = Math.max(0, effectiveTotal - totalWaivedAmount);
        const newStatus = total <= 0 ? 'satteled' : (newPaid >= total ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid');

        // Record the payment itself with academic_year_id if money was paid
        if (paidNow > 0) {
            await client.query(
                `INSERT INTO fee_payments (slip_id,amount_paid,payment_date,payment_method,received_by,reference_no,notes,is_printed,academic_year_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [id, paidNow, payment_date || new Date(), payment_method || 'cash', received_by, reference_no, notes, is_printed ? true : false, cur.academic_year_id || null]
            );
        }
        const updated = await client.query(
            `UPDATE monthly_fee_slips SET total_amount=$1, paid_amount=$2, status=$3 WHERE slip_id=$4 RETURNING *`,
            [total, newPaid, newStatus, id]
        );

        // Dispatch notification to Family Unit
        try {
            const { createNotification } = require('../utils/notify');
            const slipObj = updated.rows[0];
            if (slipObj) {
                const stuRes = await client.query(`SELECT CONCAT(first_name, ' ', last_name) AS full_name, family_id FROM students WHERE student_id = $1`, [slipObj.student_id]);
                const stuName = stuRes.rows[0]?.full_name || 'Student';
                const famId = slipObj.family_id || stuRes.rows[0]?.family_id;

                await createNotification({
                    familyId: famId,
                    studentId: slipObj.student_id,
                    role: 'student',
                    type: 'fee_payment',
                    title: 'Fee Payment Received 💳',
                    message: `Payment of PKR ${parseFloat(paidNow).toLocaleString('en-PK')} received for ${stuName} (Family ID: ${famId || 'N/A'}). Status: ${newStatus.toUpperCase()}.`,
                    link: '/fees/collect',
                    clientOrPool: client
                });
            }
        } catch (notifErr) {
            console.error("Notification dispatch error:", notifErr.message);
        }

        // ── Auto-allocate Line Items on Current Slip if head_breakdown not supplied ─
        if (head_breakdown && typeof head_breakdown === 'object') {
            for (const [itemId, amount] of Object.entries(head_breakdown)) {
                if (parseFloat(amount) > 0) {
                    await client.query(
                        'UPDATE slip_line_items SET paid_amount = paid_amount + $1 WHERE item_id = $2 AND slip_id = $3',
                        [parseFloat(amount), itemId, id]
                    );
                }
            }
        } else {
            // Auto sequential allocation: PB -> Carried Forward Heads -> Plan Heads
            const currentLineItems = await client.query(
                `SELECT sli.*, fh.head_type, fh.track_arrears
                 FROM slip_line_items sli
                 LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
                 WHERE sli.slip_id = $1
                 ORDER BY 
                    CASE 
                        WHEN fh.head_type = 'prev_balance' OR sli.head_name ILIKE '%previous balance%' THEN 1
                        WHEN sli.is_carried_forward = TRUE THEN 2
                        ELSE 3
                    END, sli.item_id ASC`,
                [id]
            );
            let unalloc = paidNow;
            for (const item of currentLineItems.rows) {
                if (unalloc <= 0) break;
                const iAmt = parseFloat(item.amount);
                const iPaid = parseFloat(item.paid_amount);
                const iRem = Math.max(0, iAmt - iPaid);
                if (iRem > 0) {
                    const thisAlloc = parseFloat(Math.min(unalloc, iRem).toFixed(2));
                    await client.query(
                        'UPDATE slip_line_items SET paid_amount = paid_amount + $1 WHERE item_id = $2 AND slip_id = $3',
                        [thisAlloc, item.item_id, id]
                    );
                    unalloc = parseFloat((unalloc - thisAlloc).toFixed(2));
                }
            }
        }

        // ── Previous Balance Waterfall ─────────────────────────────────────────
        // When prev_balance line is paid: 1) settle OPB first, 2) then oldest slips
        const pbItems = await client.query(
            `SELECT sli.amount, mfs.family_id
             FROM slip_line_items sli
             JOIN monthly_fee_slips mfs ON mfs.slip_id = sli.slip_id
             LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
             WHERE sli.slip_id = $1 AND (
                 fh.head_type = 'prev_balance'
                 OR sli.head_name ILIKE '%previous balance%'
                 OR sli.head_name ILIKE '%opening balance%'
             )`,
            [id]
        );
        if (pbItems.rows.length > 0 && pbItems.rows[0].family_id) {
            const pbAmount = pbItems.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
            const familyId = pbItems.rows[0].family_id;
            const nonPbTotal = total - pbAmount;

            // How much of THIS payment went toward the prev_balance portion?
            const prevPbCollected = Math.max(0, prevPaid - nonPbTotal);
            const newPbCollected = Math.max(0, Math.min(newPaid - nonPbTotal, pbAmount));
            let pbThisPayment = parseFloat((newPbCollected - prevPbCollected).toFixed(2));

            if (pbThisPayment > 0) {
                // ── Step 1: Settle OPB first (oldest debt, pre-system dues) ──────
                const fam = await client.query(
                    `SELECT opening_balance, opening_balance_paid FROM families WHERE family_id = $1 FOR UPDATE`,
                    [familyId]
                );
                if (fam.rows.length > 0) {
                    const opbTotal = parseFloat(fam.rows[0].opening_balance) || 0;
                    const opbPaid = parseFloat(fam.rows[0].opening_balance_paid) || 0;
                    const opbRemain = Math.max(0, opbTotal - opbPaid);
                    const opbSettle = parseFloat(Math.min(pbThisPayment, opbRemain).toFixed(2));
                    if (opbSettle > 0) {
                        await client.query(
                            `UPDATE families SET opening_balance_paid = opening_balance_paid + $1 WHERE family_id = $2`,
                            [opbSettle, familyId]
                        );
                        await client.query(
                            `INSERT INTO family_opb_payments
                                (family_id, amount, payment_date, payment_method, received_by, reference_no, notes)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [familyId, opbSettle, payment_date || new Date(),
                                payment_method || 'cash', received_by || null,
                                reference_no || null, `Auto via fee slip #${id}`]
                        );
                        pbThisPayment = parseFloat((pbThisPayment - opbSettle).toFixed(2));
                    }
                }

                // ── Step 2: Settle oldest unpaid previous slips (waterfall) ────
                // Exclude prev_balance + admission fee line items from each old slip's
                // total so we only settle actual fee amounts (no double-counting)
                if (pbThisPayment > 0) {
                    const oldSlips = await client.query(
                        `SELECT mfs.slip_id, mfs.total_amount, mfs.paid_amount,
                                COALESCE(excl.excl_sum, 0) AS excl_sum
                         FROM monthly_fee_slips mfs
                         LEFT JOIN (
                             SELECT sli.slip_id, SUM(sli.amount) AS excl_sum
                             FROM slip_line_items sli
                             LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
                             WHERE fh.head_type = 'prev_balance'
                                OR sli.head_name ILIKE '%previous balance%'
                                OR sli.head_name ILIKE '%opening balance%'
                                OR fh.head_name  ILIKE '%admission%'
                                OR sli.head_name ILIKE '%admission%'
                             GROUP BY sli.slip_id
                         ) excl ON excl.slip_id = mfs.slip_id
                         WHERE mfs.family_id = $1
                           AND mfs.slip_id  != $2
                           AND mfs.status   != 'paid'
                           AND (mfs.year < $3 OR (mfs.year = $3 AND mfs.month < $4))
                         ORDER BY mfs.year ASC, mfs.month ASC`,
                        [familyId, id, cur.year, cur.month]
                    );
                    for (const old of oldSlips.rows) {
                        if (pbThisPayment <= 0) break;
                        const oldTotal = parseFloat(old.total_amount);
                        const oldPaid = parseFloat(old.paid_amount);
                        const oldOwed = Math.max(0, oldTotal - oldPaid);
                        if (oldOwed > 0) {
                            const settle = parseFloat(Math.min(pbThisPayment, oldOwed).toFixed(2));
                            const newOldPaid = parseFloat((oldPaid + settle).toFixed(2));
                            const newOldStat = newOldPaid >= oldTotal ? 'paid' : 'partial';
                            await client.query(
                                `UPDATE monthly_fee_slips SET paid_amount=$1, status=$2 WHERE slip_id=$3`,
                                [newOldPaid, newOldStat, old.slip_id]
                            );

                            // Also settle line items on old slip chronologically
                            const oldLines = await client.query(
                                `SELECT item_id, amount, paid_amount FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC`,
                                [old.slip_id]
                            );
                            let settleLineUnalloc = settle;
                            for (const ol of oldLines.rows) {
                                if (settleLineUnalloc <= 0) break;
                                const olAmt = parseFloat(ol.amount);
                                const olPaid = parseFloat(ol.paid_amount);
                                const olRem = Math.max(0, olAmt - olPaid);
                                if (olRem > 0) {
                                    const thisLineAlloc = parseFloat(Math.min(settleLineUnalloc, olRem).toFixed(2));
                                    await client.query(
                                        `UPDATE slip_line_items SET paid_amount = paid_amount + $1 WHERE item_id = $2`,
                                        [thisLineAlloc, ol.item_id]
                                    );
                                    settleLineUnalloc = parseFloat((settleLineUnalloc - thisLineAlloc).toFixed(2));
                                }
                            }

                            pbThisPayment = parseFloat((pbThisPayment - settle).toFixed(2));
                        }
                    }
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        await client.query('COMMIT');
        res.json({ message: 'Payment recorded', slip: updated.rows[0] });
    } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: err.message }); }
    finally { client.release(); }
});

// PUT /fee-slips/payments/:payment_id/print
router.put('/payments/:payment_id/print', async (req, res) => {
    try { await pool.query('UPDATE fee_payments SET is_printed = TRUE WHERE payment_id = $1', [req.params.payment_id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /fee-slips/payments/:payment_id  reverse / delete a single payment
router.delete('/payments/:payment_id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { payment_id } = req.params;
        await client.query('BEGIN');

        // Fetch the payment record
        const payment = await client.query('SELECT * FROM fee_payments WHERE payment_id=$1 FOR UPDATE', [payment_id]);
        if (payment.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Payment not found' });
        }
        const p = payment.rows[0];

        // Fetch full slip details (need family_id, month, year for OPB reversal)
        const slipRes = await client.query(`
            SELECT mfs.*, ay.is_active AS is_year_active, ay.year_name 
            FROM monthly_fee_slips mfs 
            LEFT JOIN academic_years ay ON ay.id = mfs.academic_year_id
            WHERE mfs.slip_id = $1
        `, [p.slip_id]);
        if (slipRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Slip not found' }); }
        const slipData = slipRes.rows[0];

        if (slipData.academic_year_id && slipData.is_year_active === false) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: `Fiscal/Academic Year (${slipData.year_name || 'Closed'}) is closed. Payments from closed fiscal years cannot be deleted.`
            });
        }

        // Delete the payment record
        await client.query('DELETE FROM fee_payments WHERE payment_id=$1', [payment_id]);

        // Recalculate paid_amount from remaining payments for this slip
        const remaining = await client.query(
            'SELECT COALESCE(SUM(amount_paid),0) AS total FROM fee_payments WHERE slip_id=$1',
            [p.slip_id]
        );
        const newPaid = parseFloat(remaining.rows[0].total);
        const slipTotal = parseFloat(slipData.total_amount);
        const newStatus = newPaid >= slipTotal ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

        const updated = await client.query(
            'UPDATE monthly_fee_slips SET paid_amount=$1, status=$2 WHERE slip_id=$3 RETURNING *',
            [newPaid, newStatus, p.slip_id]
        );

        // ── Re-sync slip_line_items paid_amount for this slip ─────────────
        await client.query('UPDATE slip_line_items SET paid_amount = 0 WHERE slip_id = $1', [p.slip_id]);
        if (newPaid > 0) {
            const itemsRes = await client.query('SELECT item_id, amount FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id', [p.slip_id]);
            let remAlloc = newPaid;
            for (const item of itemsRes.rows) {
                if (remAlloc <= 0) break;
                const itemAmt = parseFloat(item.amount) || 0;
                const itemPaid = parseFloat(Math.min(remAlloc, itemAmt).toFixed(2));
                await client.query('UPDATE slip_line_items SET paid_amount = $1 WHERE item_id = $2', [itemPaid, item.item_id]);
                remAlloc = parseFloat((remAlloc - itemPaid).toFixed(2));
            }
        }

        // ── Reverse OPB Waterfall ─────────────────────────────────────────────
        // When a payment was recorded, the waterfall may have:
        //   1. Updated families.opening_balance_paid  (inserted into family_opb_payments)
        //   2. Directly updated older slips' paid_amount/status (NO payment record created)
        // Both must be reversed/recomputed here so OPB page stays accurate.
        if (slipData.family_id) {
            // Check whether this slip has a prev_balance / opening-balance line item
            const pbAmtRes = await client.query(
                `SELECT COALESCE(SUM(sli.amount), 0) AS pb_total
                 FROM slip_line_items sli
                 LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
                 WHERE sli.slip_id = $1 AND (
                     fh.head_type = 'prev_balance'
                     OR sli.head_name ILIKE '%previous balance%'
                     OR sli.head_name ILIKE '%opening balance%'
                 )`, [p.slip_id]
            );
            const pbAmount = parseFloat(pbAmtRes.rows[0].pb_total) || 0;

            if (pbAmount > 0) {
                // ── Step 1: Remove all auto-OPB records created by any payment on this slip ──
                await client.query(
                    `DELETE FROM family_opb_payments
                     WHERE family_id = $1 AND notes LIKE $2`,
                    [slipData.family_id, `%Auto via fee slip #${p.slip_id}%`]
                );

                // ── Step 2: Reset opening_balance_paid to match only remaining records ──────
                // (other manual payments, other slips NOT this slip any more)
                const opbSumRes = await client.query(
                    `SELECT COALESCE(SUM(amount), 0) AS total
                     FROM family_opb_payments WHERE family_id = $1`,
                    [slipData.family_id]
                );
                const opbFromOtherSources = parseFloat(opbSumRes.rows[0].total);
                await client.query(
                    `UPDATE families SET opening_balance_paid = $1 WHERE family_id = $2`,
                    [opbFromOtherSources, slipData.family_id]
                );

                // ── Step 3: Recompute what OPB this slip covers with REMAINING payments ──
                // nonPbTotal = what covers tuition + other heads (before PB portion starts)
                const nonPbTotal = slipTotal - pbAmount;
                const opbContrib = parseFloat(Math.max(0, Math.min(newPaid - nonPbTotal, pbAmount)).toFixed(2));

                if (opbContrib > 0) {
                    // How much OPB (opening_balance) is still outstanding after other sources?
                    const famRes = await client.query(
                        `SELECT COALESCE(opening_balance, 0) AS opb_total FROM families WHERE family_id = $1`,
                        [slipData.family_id]
                    );
                    if (famRes.rows.length > 0) {
                        const opbTotal = parseFloat(famRes.rows[0].opb_total);
                        const opbRemain = Math.max(0, opbTotal - opbFromOtherSources);
                        const opbSettle = parseFloat(Math.min(opbContrib, opbRemain).toFixed(2));

                        if (opbSettle > 0) {
                            await client.query(
                                `INSERT INTO family_opb_payments
                                    (family_id, amount, payment_date, payment_method, received_by, reference_no, notes)
                                 VALUES ($1,$2,NOW(),'cash',NULL,NULL,$3)`,
                                [slipData.family_id, opbSettle, `Auto via fee slip #${p.slip_id}`]
                            );
                            await client.query(
                                `UPDATE families SET opening_balance_paid = opening_balance_paid + $1 WHERE family_id = $2`,
                                [opbSettle, slipData.family_id]
                            );
                        }
                    }
                }
                // If opbContrib = 0 (remaining payments don't reach PB portion): done.

                // ── Step 4: Reset older slips that waterfall may have marked paid/partial ───
                // The waterfall updates old slips' paid_amount directly (no fee_payments row).
                // Correct value = only what is in actual fee_payments for each old slip.
                const oldSlips = await client.query(
                    `SELECT slip_id, total_amount FROM monthly_fee_slips
                     WHERE family_id = $1
                       AND slip_id  != $2
                       AND (year < $3 OR (year = $3 AND month < $4))`,
                    [slipData.family_id, p.slip_id, slipData.year, slipData.month]
                );
                for (const old of oldSlips.rows) {
                    const actualRes = await client.query(
                        `SELECT COALESCE(SUM(amount_paid), 0) AS total FROM fee_payments WHERE slip_id = $1`,
                        [old.slip_id]
                    );
                    const correctPaid = parseFloat(actualRes.rows[0].total);
                    const oldTotal = parseFloat(old.total_amount);
                    const correctStatus = correctPaid >= oldTotal ? 'paid'
                        : correctPaid > 0 ? 'partial' : 'unpaid';
                    await client.query(
                        `UPDATE monthly_fee_slips SET paid_amount=$1, status=$2 WHERE slip_id=$3`,
                        [correctPaid, correctStatus, old.slip_id]
                    );
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        await client.query('COMMIT');
        res.json({ message: 'Payment reversed successfully', slip: updated.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// DELETE /fee-slips/class/:class_id/month/:month/year/:year
router.delete('/class/:class_id/month/:month/year/:year', async (req, res) => {
    const client = await pool.connect();
    try {
        const { class_id, month, year } = req.params;
        await client.query('BEGIN');

        const mArr = month.split(',').map(Number);

        // Fetch all slips for this class+month+year
        const all = await client.query(
            `SELECT mfs.slip_id, mfs.status, mfs.academic_year_id, ay.year_name, ay.is_active AS is_year_active
             FROM monthly_fee_slips mfs
             LEFT JOIN academic_years ay ON ay.id = mfs.academic_year_id
             WHERE mfs.class_id = $1 AND COALESCE(mfs.months_list, ARRAY[mfs.month]) = $2::int[] AND mfs.year = $3`,
            [class_id, mArr, year]
        );

        const closedSlips = all.rows.filter(r => r.academic_year_id && r.is_year_active === false);
        if (closedSlips.length > 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: `Cannot undo generation: Slips belong to a closed Academic Year (${closedSlips[0].year_name || 'Closed'}).`
            });
        }

        const paidSlips = all.rows.filter(r => r.status === 'paid');
        const deleteable = all.rows.filter(r => r.status !== 'paid');

        if (deleteable.length === 0) {
            await client.query('ROLLBACK');
            return res.json({
                deleted: 0,
                blocked_paid: paidSlips.length,
                message: paidSlips.length > 0
                    ? `Cannot undo: all ${paidSlips.length} slip(s) are already paid.`
                    : 'No slips found for this class/month/year.'
            });
        }

        const deleteIds = deleteable.map(r => r.slip_id);

        // Delete payments for partial slips first
        await client.query(
            `DELETE FROM fee_payments WHERE slip_id = ANY($1)`, [deleteIds]
        );
        // Delete line items
        await client.query(
            `DELETE FROM slip_line_items WHERE slip_id = ANY($1)`, [deleteIds]
        );
        // Delete the slips
        await client.query(
            `DELETE FROM monthly_fee_slips WHERE slip_id = ANY($1)`, [deleteIds]
        );

        await client.query('COMMIT');
        res.json({
            deleted: deleteIds.length,
            blocked_paid: paidSlips.length,
            message: paidSlips.length > 0
                ? `${deleteIds.length} slip(s) deleted. ${paidSlips.length} paid slip(s) were kept.`
                : `${deleteIds.length} slip(s) deleted successfully.`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// PUT /fee-slips/:id  edit slip line items and due date
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { line_items, due_date } = req.body;
        if (!line_items || line_items.length === 0) return res.status(400).json({ error: 'line_items required' });
        await client.query('BEGIN');
        const slip = await client.query(`
            SELECT mfs.*, ay.is_active AS is_year_active, ay.year_name 
            FROM monthly_fee_slips mfs 
            LEFT JOIN academic_years ay ON ay.id = mfs.academic_year_id
            WHERE mfs.slip_id = $1
        `, [id]);
        if (slip.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Slip not found' }); }
        if (slip.rows[0].academic_year_id && slip.rows[0].is_year_active === false) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: `Fiscal/Academic Year (${slip.rows[0].year_name || 'Closed'}) is closed. Slips from closed years cannot be edited.` });
        }
        if (slip.rows[0].status === 'paid') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot edit a paid slip' }); }
        const newTotal = line_items.reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
        await client.query('DELETE FROM slip_line_items WHERE slip_id=$1', [id]);
        for (const item of line_items) {
            await client.query(
                `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, note) VALUES ($1,$2,$3,$4,$5)`,
                [id, item.head_id || null, item.head_name, parseFloat(item.amount) || 0, item.note || null]
            );
        }
        const updated = await client.query(
            `UPDATE monthly_fee_slips SET total_amount=$1, due_date=$2 WHERE slip_id=$3 RETURNING *`,
            [newTotal, due_date || null, id]
        );
        await client.query('COMMIT');
        res.json({ message: 'Slip updated', slip: updated.rows[0] });
    } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
    finally { client.release(); }
});

// GET /fee-slips/family-summary/:student_id
router.get('/family-summary/:student_id', async (req, res) => {
    try {
        const { student_id } = req.params;
        const famRes = await pool.query('SELECT family_id FROM students WHERE student_id = $1', [student_id]);
        if (famRes.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

        const family_id = famRes.rows[0].family_id;
        if (!family_id) return res.json({ slips: [] });

        const query = `
            SELECT 
                mfs.slip_id, mfs.month, mfs.year, mfs.total_amount, mfs.paid_amount, mfs.status,
                s.first_name, s.last_name, s.admission_no, s.category,
                (
                    SELECT MAX(fp.payment_date) FROM fee_payments fp WHERE fp.slip_id = mfs.slip_id
                ) as last_payment_date,
                (
                    SELECT json_agg(json_build_object('head_name', sli.head_name, 'amount', sli.amount))
                    FROM slip_line_items sli WHERE sli.slip_id = mfs.slip_id
                ) as heads
            FROM monthly_fee_slips mfs
            JOIN students s ON mfs.student_id = s.student_id
            WHERE mfs.family_id = $1
            ORDER BY mfs.year DESC, mfs.month DESC, s.admission_no ASC
        `;

        const result = await pool.query(query, [family_id]);

        const summary = {};
        result.rows.forEach(row => {
            const myKey = row.month + '-' + row.year;
            if (!summary[myKey]) {
                summary[myKey] = {
                    month: row.month,
                    year: row.year,
                    family_total_billed: 0,
                    family_total_paid: 0,
                    status: 'unpaid',
                    last_submission_date: null,
                    students: []
                };
            }

            const isTrusted = row.category && row.category.trim().toLowerCase() === 'trusted';
            const billedAmount = Number(row.total_amount || 0);
            const paidAmount = Number(row.paid_amount || 0);
            const studentStatus = billedAmount <= 0 ? 'satteled' : paidAmount >= billedAmount ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

            summary[myKey].family_total_billed += billedAmount;
            summary[myKey].family_total_paid += paidAmount;

            if (row.last_payment_date) {
                if (!summary[myKey].last_submission_date || new Date(row.last_payment_date) > new Date(summary[myKey].last_submission_date)) {
                    summary[myKey].last_submission_date = row.last_payment_date;
                }
            }

            summary[myKey].students.push({
                slip_id: row.slip_id,
                name: row.first_name + ' ' + row.last_name,
                admission_no: row.admission_no,
                category: row.category || 'Normal',
                is_trusted: isTrusted,
                billed: billedAmount,
                raw_billed: billedAmount,
                paid: paidAmount,
                status: studentStatus,
                last_payment_date: row.last_payment_date,
                heads: row.heads || []
            });
        });

        Object.values(summary).forEach(m => {
            if (m.family_total_billed <= 0) {
                m.status = 'satteled';
            } else if (m.family_total_paid >= m.family_total_billed) {
                m.status = 'paid';
            } else if (m.family_total_paid > 0) {
                m.status = 'partial';
            } else {
                m.status = 'unpaid';
            }
        });

        const slips = Object.values(summary).sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return b.month - a.month;
        });

        res.json({ slips });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
