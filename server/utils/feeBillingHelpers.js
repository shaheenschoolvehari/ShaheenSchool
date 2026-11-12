/**
 * Shared fee billing, family seniority, arrears snapshot, and trust evaluation helpers.
 * Keeps monthly batch generation, reactivation workflows, and ledger views consistent.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CLASS_SENIORITY_ORDER = `
    CASE
        WHEN c.class_name ~ '^[0-9]+' THEN CAST(SUBSTRING(c.class_name FROM '^[0-9]+') AS INTEGER)
        WHEN c.class_name ILIKE '%Class 10%' OR c.class_name ILIKE '%10%' THEN 10
        WHEN c.class_name ILIKE '%Class 9%' OR c.class_name ILIKE '%9%' THEN 9
        WHEN c.class_name ILIKE '%Class 8%' OR c.class_name ILIKE '%8%' THEN 8
        WHEN c.class_name ILIKE '%Class 7%' OR c.class_name ILIKE '%7%' THEN 7
        WHEN c.class_name ILIKE '%Class 6%' OR c.class_name ILIKE '%6%' THEN 6
        WHEN c.class_name ILIKE '%Class 5%' OR c.class_name ILIKE '%5%' THEN 5
        WHEN c.class_name ILIKE '%Class 4%' OR c.class_name ILIKE '%4%' THEN 4
        WHEN c.class_name ILIKE '%Class 3%' OR c.class_name ILIKE '%3%' THEN 3
        WHEN c.class_name ILIKE '%Class 2%' OR c.class_name ILIKE '%2%' THEN 2
        WHEN c.class_name ILIKE '%Class 1%' OR c.class_name ILIKE '%1%' THEN 1
        WHEN c.class_name ILIKE '%Prep%' OR c.class_name ILIKE '%KG%' THEN 0
        WHEN c.class_name ILIKE '%Nursery%' THEN -1
        WHEN c.class_name ILIKE '%Reception%' OR c.class_name ILIKE '%Play%' THEN -2
        ELSE COALESCE(c.class_id, 0)
    END DESC, c.class_id DESC, s.first_name ASC
`;

function getClassSeniorityRank(className, classId = 0) {
    if (!className) return typeof classId === 'number' ? classId : 0;
    const name = String(className).trim().toLowerCase();
    const numMatch = name.match(/^\s*(\d+)/) || name.match(/\b(\d+)(?:st|nd|rd|th)?\b/) || name.match(/(\d+)/);
    if (numMatch) return parseInt(numMatch[1], 10);
    if (name.includes('prep') || name.includes('kg') || name.includes('kindergarten')) return 0;
    if (name.includes('nursery')) return -1;
    if (name.includes('reception') || name.includes('play') || name.includes('pg') || name.includes('daycare') || name.includes('montessori')) return -2;
    return typeof classId === 'number' ? classId : 0;
}

function isTuitionHeadName(headName) {
    const hn = (headName || '').trim().toLowerCase();
    return hn.includes('tuition') || hn.includes('family monthly fee') || hn.includes('monthly fee');
}

function isTrustedExemptHead(headName) {
    const hn = (headName || '').trim().toLowerCase();
    return isTuitionHeadName(hn) || hn.includes('previous balance') || hn.includes('opening balance');
}

function isFineHeadName(headName) {
    const hn = (headName || '').trim().toLowerCase();
    return (
        hn === 'fine' ||
        hn === 'late' ||
        hn.includes('late fee') ||
        hn.includes('late fine') ||
        hn.includes('late payment') ||
        hn.includes('after due')
    );
}

/**
 * Evaluates whether a billing unit is exempt from tuition due to Trusted category.
 * Mixed families (e.g. Trusted lead + Normal sibling) are NOT trusted.
 */
function evaluateMembersTrusted(members = [], fallbackCategory = '') {
    if (Array.isArray(members) && members.length > 0) {
        const activeMembers = members.filter(m => (m.status || 'Active').trim().toLowerCase() === 'active');
        const cohort = activeMembers.length > 0 ? activeMembers : members;
        return cohort.every(m => (m.category || '').trim().toLowerCase().includes('trust'));
    }
    return (fallbackCategory || '').trim().toLowerCase().includes('trust');
}

/**
 * Computes slip status cleanly respecting Trusted category rules.
 */
function computeSlipTotalAndStatus({ lineItems = [], paidAmount = 0, isTrusted = false }) {
    const paid = Math.max(0, parseFloat(paidAmount) || 0);
    const total = lineItems.reduce((sum, li) => {
        const amt = parseFloat(li.amount || 0);
        if (isTrusted && isTrustedExemptHead(li.head_name)) {
            return sum;
        }
        return sum + amt;
    }, 0);
    const roundedTotal = Math.max(0, parseFloat(total.toFixed(2)));
    let status = 'unpaid';
    if (roundedTotal <= 0) {
        status = 'satteled';
    } else if (paid >= roundedTotal) {
        status = 'paid';
    } else if (paid > 0) {
        status = 'partial';
    }
    return { totalAmount: roundedTotal, status };
}

/**
 * Retrieves the currently active academic year (auto-activating first year if none set).
 */
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

/**
 * Builds valid billing months within an academic year along with exact calendar years.
 */
function buildAcademicMonthsMap(yearRow, referenceDate = new Date()) {
    const validMonthMap = new Map();
    const monthsList = [];

    if (yearRow && yearRow.start_date && yearRow.end_date) {
        const startD = new Date(yearRow.start_date);
        const endD = new Date(yearRow.end_date);
        let cY = startD.getFullYear();
        let cM = startD.getMonth() + 1;
        const eY = endD.getFullYear();
        const eM = endD.getMonth() + 1;

        let iter = 0;
        while ((cY < eY || (cY === eY && cM <= eM)) && iter < 24) {
            validMonthMap.set(cM, cY);
            monthsList.push({
                month: cM,
                year: cY,
                short_label: MONTH_NAMES[cM - 1],
                label: `${MONTH_NAMES[cM - 1]} ${cY}`
            });
            cM++;
            if (cM > 12) {
                cM = 1;
                cY++;
            }
            iter++;
        }
    } else {
        const yr = referenceDate.getFullYear();
        for (let m = 1; m <= 12; m++) {
            validMonthMap.set(m, yr);
            monthsList.push({
                month: m,
                year: yr,
                short_label: MONTH_NAMES[m - 1],
                label: `${MONTH_NAMES[m - 1]} ${yr}`
            });
        }
    }

    const curMonth = referenceDate.getMonth() + 1;
    const curYear = referenceDate.getFullYear();
    const currentMatch = monthsList.find(m => m.month === curMonth && m.year === curYear)
        || monthsList.find(m => m.month === curMonth)
        || monthsList[monthsList.length - 1];

    return {
        validMonthMap,
        monthsList,
        defaultMonth: currentMatch ? currentMatch.month : curMonth,
        defaultYear: currentMatch ? currentMatch.year : curYear
    };
}

/**
 * Fetches active fee plan and heads for a class.
 */
async function getClassFeePlan(clientOrPool, classId, explicitPlanId = null) {
    let planResult;
    if (explicitPlanId) {
        planResult = await clientOrPool.query(
            `SELECT fp.plan_id, fp.plan_name, fp.academic_year
             FROM fee_plans fp
             WHERE fp.plan_id = $1 AND fp.is_active = TRUE`,
            [explicitPlanId]
        );
    } else {
        planResult = await clientOrPool.query(
            `SELECT fp.plan_id, fp.plan_name, fp.academic_year
             FROM fee_plans fp
             LEFT JOIN fee_plan_classes fpc ON fpc.plan_id = fp.plan_id
             WHERE (fp.class_id = $1 OR fpc.class_id = $1 OR fp.applies_to_all = TRUE)
               AND fp.is_active = TRUE
             ORDER BY fp.academic_year DESC, fp.plan_name ASC
             LIMIT 1`,
            [classId]
        );
    }

    if (planResult.rows.length === 0) {
        return { plan: null, heads: [] };
    }

    const plan = planResult.rows[0];
    const headsRes = await clientOrPool.query(
        `SELECT fph.amount, fph.fine_after_day, fh.head_id, fh.head_name, fh.head_type, COALESCE(fh.track_arrears, TRUE) AS track_arrears
         FROM fee_plan_heads fph
         JOIN fee_heads fh ON fph.head_id = fh.head_id
         WHERE fph.plan_id = $1
         ORDER BY fh.head_id ASC`,
        [plan.plan_id]
    );

    return { plan, heads: headsRes.rows };
}

/**
 * Determines the senior-most lead student within a family according to CLASS_SENIORITY_ORDER.
 * If includeStudentIds is passed, simulates lead selection including those inactive candidates.
 */
async function determineFamilyLead(clientOrPool, familyId, includeStudentIds = null) {
    if (!familyId) return { lead: null, members: [] };

    const hasCandidates = Array.isArray(includeStudentIds) && includeStudentIds.length > 0;
    const query = `
        SELECT s.*, c.class_name, sec.section_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        LEFT JOIN sections sec ON s.section_id = sec.section_id
        WHERE s.family_id = $1
          AND (
              LOWER(COALESCE(s.status, 'Active')) = 'active'
              ${hasCandidates ? 'OR s.student_id = ANY($2::int[])' : ''}
          )
        ORDER BY ${CLASS_SENIORITY_ORDER}
    `;
    const params = hasCandidates ? [familyId, includeStudentIds] : [familyId];
    const res = await clientOrPool.query(query, params);
    return {
        lead: res.rows[0] || null,
        members: res.rows
    };
}

/**
 * Re-assigns family fee slips from an old lead to the new senior lead safely without violating UNIQUE(student_id, month, year).
 */
async function shiftFamilySlipsLead(client, { familyId, newLeadStudentId, newLeadClassId, statuses = ['unpaid', 'partial'] }) {
    if (!familyId || !newLeadStudentId) return 0;

    const res = await client.query(
        `UPDATE monthly_fee_slips mfs
         SET student_id = $1,
             class_id = COALESCE($2, mfs.class_id),
             is_family_slip = TRUE
         WHERE mfs.family_id = $3
           AND mfs.status = ANY($4::varchar[])
           AND mfs.student_id != $1
           AND NOT EXISTS (
               SELECT 1 FROM monthly_fee_slips dup
               WHERE dup.student_id = $1
                 AND dup.month = mfs.month
                 AND dup.year = mfs.year
                 AND dup.slip_id != mfs.slip_id
           )`,
        [newLeadStudentId, newLeadClassId || null, familyId, statuses]
    );
    return res.rowCount;
}

/**
 * Computes exact arrears and advance credit snapshot for a family or solo student before a target billing period.
 * Uses consolidated latest-prior-slip state (no compounding) matching POST /fee-slips/generate.
 */
async function getArrearsAndAdvanceSnapshot(clientOrPool, { familyId = null, studentIds = [], academicYearId = null, beforeMonth, beforeYear }) {
    let familyFee = 0;
    let opbTotal = 0;
    let opbPaid = 0;
    let opbRemaining = 0;
    let advanceBalance = 0;

    if (familyId) {
        const famRes = await clientOrPool.query(
            `SELECT COALESCE(family_fee, 0) AS family_fee,
                    COALESCE(opening_balance, 0) AS opening_balance,
                    COALESCE(opening_balance_paid, 0) AS opening_balance_paid,
                    COALESCE(advance_balance, 0) AS advance_balance
             FROM families WHERE family_id = $1`,
            [familyId]
        );
        if (famRes.rows.length > 0) {
            const f = famRes.rows[0];
            familyFee = parseFloat(f.family_fee) || 0;
            opbTotal = parseFloat(f.opening_balance) || 0;
            opbPaid = parseFloat(f.opening_balance_paid) || 0;
            opbRemaining = Math.max(0, parseFloat((opbTotal - opbPaid).toFixed(2)));
            advanceBalance = parseFloat(f.advance_balance) || 0;
        }
    } else if (studentIds.length > 0) {
        const stuRes = await clientOrPool.query(
            `SELECT COALESCE(SUM(advance_balance), 0) AS advance_balance
             FROM students WHERE student_id = ANY($1::int[])`,
            [studentIds]
        );
        advanceBalance = parseFloat(stuRes.rows[0]?.advance_balance || 0);
    }

    const priorFilter = `
        (mfs.year < $2 OR (mfs.year = $2 AND mfs.month < $3))
        AND ($4::int IS NULL OR mfs.academic_year_id = $4 OR mfs.academic_year_id IS NULL)
    `;

    let priorSlips = [];
    if (familyId) {
        const pRes = await clientOrPool.query(
            `SELECT mfs.slip_id, mfs.student_id, mfs.family_id, mfs.month, mfs.year,
                    mfs.total_amount, mfs.paid_amount, mfs.status
             FROM monthly_fee_slips mfs
             WHERE mfs.family_id = $1 AND ${priorFilter}
             ORDER BY mfs.year DESC, mfs.month DESC, mfs.slip_id DESC`,
            [familyId, beforeYear, beforeMonth, academicYearId]
        );
        priorSlips = pRes.rows;
    } else if (studentIds.length > 0) {
        const pRes = await clientOrPool.query(
            `SELECT mfs.slip_id, mfs.student_id, mfs.family_id, mfs.month, mfs.year,
                    mfs.total_amount, mfs.paid_amount, mfs.status
             FROM monthly_fee_slips mfs
             WHERE mfs.student_id = ANY($1::int[]) AND mfs.family_id IS NULL AND ${priorFilter}
             ORDER BY mfs.year DESC, mfs.month DESC, mfs.slip_id DESC`,
            [studentIds, beforeYear, beforeMonth, academicYearId]
        );
        priorSlips = pRes.rows;
    }

    // Check unlinked individual prior slips for returning students who later gained a family_id
    let orphanIndividualDues = 0;
    let orphanSlips = [];
    if (familyId && studentIds.length > 0) {
        const oRes = await clientOrPool.query(
            `SELECT mfs.slip_id, mfs.student_id, mfs.month, mfs.year,
                    mfs.total_amount, mfs.paid_amount, mfs.status
             FROM monthly_fee_slips mfs
             WHERE mfs.student_id = ANY($1::int[])
               AND mfs.family_id IS NULL
               AND mfs.status IN ('unpaid', 'partial')
               AND ${priorFilter}
             ORDER BY mfs.year DESC, mfs.month DESC`,
            [studentIds, beforeYear, beforeMonth, academicYearId]
        );
        orphanSlips = oRes.rows;
        orphanIndividualDues = orphanSlips.reduce(
            (sum, s) => sum + Math.max(0, (parseFloat(s.total_amount) || 0) - (parseFloat(s.paid_amount) || 0)),
            0
        );
    }

    const latestPriorSlip = priorSlips[0] || null;
    const unpaidPriorSlips = [...priorSlips, ...orphanSlips]
        .map(s => ({
            slip_id: s.slip_id,
            month: s.month,
            year: s.year,
            status: s.status,
            total_amount: parseFloat(s.total_amount) || 0,
            paid_amount: parseFloat(s.paid_amount) || 0,
            due_amount: Math.max(0, parseFloat(((parseFloat(s.total_amount) || 0) - (parseFloat(s.paid_amount) || 0)).toFixed(2)))
        }))
        .filter(s => s.due_amount > 0);

    let purePreviousBalance = 0;
    const trackedExtraHeads = [];
    let trackedExtraSum = 0;

    if (latestPriorSlip) {
        const latestUnpaid = Math.max(0, (parseFloat(latestPriorSlip.total_amount) || 0) - (parseFloat(latestPriorSlip.paid_amount) || 0));

        if (latestUnpaid > 0) {
            const liRes = await clientOrPool.query(
                `SELECT sli.head_id, sli.head_name, sli.amount, sli.paid_amount,
                        COALESCE(fh.head_type, 'regular') AS head_type,
                        COALESCE(fh.track_arrears, FALSE) AS track_arrears
                 FROM slip_line_items sli
                 LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
                 WHERE sli.slip_id = $1 AND COALESCE(sli.is_waived, FALSE) = FALSE`,
                [latestPriorSlip.slip_id]
            );

            for (const row of liRes.rows) {
                const pendingAmt = Math.max(0, (parseFloat(row.amount) || 0) - (parseFloat(row.paid_amount) || 0));
                if (pendingAmt <= 0) continue;

                const hn = (row.head_name || '').toLowerCase();
                if (isTuitionHeadName(hn) || hn.includes('previous balance') || hn.includes('opening balance') || row.head_type === 'prev_balance') {
                    continue;
                }

                if (row.track_arrears === true) {
                    const existing = trackedExtraHeads.find(
                        h => (row.head_id && h.head_id === row.head_id) || h.head_name === row.head_name
                    );
                    if (existing) {
                        existing.pending_amount = parseFloat((existing.pending_amount + pendingAmt).toFixed(2));
                    } else {
                        trackedExtraHeads.push({
                            head_id: row.head_id,
                            head_name: row.head_name,
                            pending_amount: parseFloat(pendingAmt.toFixed(2))
                        });
                    }
                    trackedExtraSum += pendingAmt;
                }
            }
        }

        purePreviousBalance = Math.max(0, parseFloat((latestUnpaid - trackedExtraSum).toFixed(2)));
    } else {
        purePreviousBalance = opbRemaining;
    }

    trackedExtraSum = parseFloat(trackedExtraSum.toFixed(2));
    orphanIndividualDues = parseFloat(orphanIndividualDues.toFixed(2));
    const totalArrearsPayable = parseFloat((purePreviousBalance + trackedExtraSum + orphanIndividualDues).toFixed(2));

    return {
        family_fee: familyFee,
        opb_total: opbTotal,
        opb_paid: opbPaid,
        opb_remaining: opbRemaining,
        advance_balance: advanceBalance,
        latest_prior_slip: latestPriorSlip,
        unpaid_prior_slips: unpaidPriorSlips,
        pure_previous_balance: purePreviousBalance,
        tracked_extra_heads: trackedExtraHeads,
        tracked_extra_sum: trackedExtraSum,
        orphan_individual_dues: orphanIndividualDues,
        total_arrears_payable: totalArrearsPayable
    };
}

/**
 * Helper: waives or trims unpaid line items on a single slip down to targetRemainingUnpaid.
 */
async function trimSlipUnpaidToTarget(client, slipId, targetRemainingUnpaid, reasonNote) {
    const slipRes = await client.query(
        `SELECT slip_id, total_amount, paid_amount, status, notes FROM monthly_fee_slips WHERE slip_id = $1 FOR UPDATE`,
        [slipId]
    );
    if (slipRes.rows.length === 0) return;

    const slip = slipRes.rows[0];
    const paid = parseFloat(slip.paid_amount) || 0;
    const desiredTotal = parseFloat((paid + Math.max(0, targetRemainingUnpaid)).toFixed(2));

    const itemsRes = await client.query(
        `SELECT item_id, head_name, amount, paid_amount, note
         FROM slip_line_items
         WHERE slip_id = $1
         ORDER BY
            CASE WHEN head_name ILIKE '%previous balance%' OR head_name ILIKE '%opening balance%' THEN 0 ELSE 1 END ASC,
            item_id DESC`,
        [slipId]
    );

    let currentSum = itemsRes.rows.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
    let excessToRemove = parseFloat((currentSum - desiredTotal).toFixed(2));

    for (const item of itemsRes.rows) {
        if (excessToRemove <= 0) break;
        const itemAmt = parseFloat(item.amount) || 0;
        const itemPaid = parseFloat(item.paid_amount) || 0;
        const removable = Math.max(0, itemAmt - itemPaid);
        if (removable <= 0) continue;

        const deduct = parseFloat(Math.min(excessToRemove, removable).toFixed(2));
        const newAmt = parseFloat((itemAmt - deduct).toFixed(2));
        const fullyWaived = newAmt <= itemPaid;
        const newNote = item.note ? `${item.note}; ${reasonNote}` : reasonNote;

        await client.query(
            `UPDATE slip_line_items
             SET amount = $1,
                 is_waived = CASE WHEN $2::boolean THEN TRUE ELSE is_waived END,
                 waived_at = CASE WHEN $2::boolean THEN NOW() ELSE waived_at END,
                 note = $3
             WHERE item_id = $4`,
            [newAmt, fullyWaived, newNote, item.item_id]
        );
        excessToRemove = parseFloat((excessToRemove - deduct).toFixed(2));
    }

    const newSumRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_amount FROM slip_line_items WHERE slip_id = $1`,
        [slipId]
    );
    const finalTotal = itemsRes.rows.length > 0 ? parseFloat(newSumRes.rows[0].total_amount) : desiredTotal;
    const newStatus = finalTotal <= 0 ? 'satteled' : (paid >= finalTotal ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'));
    const updatedNotes = slip.notes ? `${slip.notes}; ${reasonNote}` : reasonNote;

    await client.query(
        `UPDATE monthly_fee_slips SET total_amount = $1, status = $2, notes = $3 WHERE slip_id = $4`,
        [finalTotal, newStatus, updatedNotes, slipId]
    );
}

/**
 * Applies full waive, partial carry-forward, or carry-all policy across historical slips, OPB,
 * and an optional current-month existing slip (Case 3A) during student reactivation.
 */
async function applyArrearsSettlementOnReactivation(client, {
    familyId = null,
    studentIds = [],
    academicYearId = null,
    beforeMonth,
    beforeYear,
    mode = 'carry_all', // 'carry_all' | 'waive_all' | 'partial'
    carriedAmount = null,
    reason = 'Adjusted on student reactivation',
    existingCurrentSlipId = null,
    isTrustedAfterReactivation = false
}) {
    const snap = await getArrearsAndAdvanceSnapshot(client, {
        familyId,
        studentIds,
        academicYearId,
        beforeMonth,
        beforeYear
    });

    if (isTrustedAfterReactivation && mode === 'carry_all') {
        return {
            snapshot: snap,
            include_previous_balance: 0,
            carried_tracked_heads: snap.tracked_extra_heads
        };
    }

    if (mode === 'carry_all') {
        return {
            snapshot: snap,
            include_previous_balance: snap.pure_previous_balance,
            carried_tracked_heads: snap.tracked_extra_heads,
            orphan_individual_dues: snap.orphan_individual_dues
        };
    }

    const targetCarry = mode === 'waive_all'
        ? 0
        : Math.max(0, Math.min(parseFloat(carriedAmount) || 0, snap.total_arrears_payable));

    const noteText = mode === 'waive_all'
        ? `Waived on reactivation (${reason})`
        : `Partial carry (${targetCarry} kept) on reactivation (${reason})`;

    // 1. Update family OPB cleanly without fake payment rows
    if (familyId && snap.opb_remaining > targetCarry) {
        const keptOpb = Math.min(snap.opb_remaining, targetCarry);
        const newOpbTotal = parseFloat((snap.opb_paid + keptOpb).toFixed(2));
        await client.query(
            `UPDATE families
             SET opening_balance = $1,
                 opb_notes = TRIM(BOTH '; ' FROM CONCAT_WS('; ', opb_notes, $2::text))
             WHERE family_id = $3`,
            [newOpbTotal, noteText, familyId]
        );
    }

    // 2. Trim prior unpaid/partial slips so future waterfall/batch generation never resurrects waived debt
    for (let i = 0; i < snap.unpaid_prior_slips.length; i++) {
        const oldSlip = snap.unpaid_prior_slips[i];
        // Newest prior slip holds the remaining consolidated targetCarry; older compounded slips shouldn't exceed targetCarry
        const allowedForThisSlip = i === 0 ? targetCarry : Math.min(oldSlip.due_amount, targetCarry);
        if (oldSlip.due_amount > allowedForThisSlip) {
            await trimSlipUnpaidToTarget(client, oldSlip.slip_id, allowedForThisSlip, noteText);
        }
    }

    // 3. If an existing unpaid/partial current-month slip (Case 3A) already carries a Previous Balance item, trim/waive it too
    if (existingCurrentSlipId) {
        const curPbRes = await client.query(
            `SELECT sli.item_id, sli.amount, sli.paid_amount, sli.note
             FROM slip_line_items sli
             LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
             WHERE sli.slip_id = $1
               AND (
                   fh.head_type = 'prev_balance'
                   OR sli.is_carried_forward = TRUE
                   OR sli.head_name ILIKE '%previous balance%'
                   OR sli.head_name ILIKE '%opening balance%'
               )
             ORDER BY sli.item_id ASC`,
            [existingCurrentSlipId]
        );

        let curPbRemainingAllowed = targetCarry;
        for (const li of curPbRes.rows) {
            const amt = parseFloat(li.amount) || 0;
            const paid = parseFloat(li.paid_amount) || 0;
            const unpaidPart = Math.max(0, amt - paid);
            const keepUnpaid = Math.min(unpaidPart, curPbRemainingAllowed);
            curPbRemainingAllowed = Math.max(0, curPbRemainingAllowed - keepUnpaid);

            const targetItemAmt = parseFloat((paid + keepUnpaid).toFixed(2));
            if (targetItemAmt < amt) {
                const isWaived = targetItemAmt <= paid;
                const newNote = li.note ? `${li.note}; ${noteText}` : noteText;
                await client.query(
                    `UPDATE slip_line_items
                     SET amount = $1,
                         is_waived = CASE WHEN $2::boolean THEN TRUE ELSE is_waived END,
                         waived_at = CASE WHEN $2::boolean THEN NOW() ELSE waived_at END,
                         note = $3
                     WHERE item_id = $4`,
                    [targetItemAmt, isWaived, newNote, li.item_id]
                );
            }
        }
    }

    // 4. Split remaining targetCarry across pure Previous Balance vs tracked heads for fresh slip generation (Cases 1 & 2)
    let remCarry = targetCarry;
    const carriedTracked = [];
    for (const ch of snap.tracked_extra_heads) {
        if (remCarry <= 0) break;
        const alloc = parseFloat(Math.min(remCarry, ch.pending_amount).toFixed(2));
        if (alloc > 0) {
            carriedTracked.push({ ...ch, pending_amount: alloc });
            remCarry = parseFloat((remCarry - alloc).toFixed(2));
        }
    }

    return {
        snapshot: snap,
        include_previous_balance: parseFloat(remCarry.toFixed(2)),
        carried_tracked_heads: carriedTracked,
        orphan_individual_dues: 0
    };
}

module.exports = {
    MONTH_NAMES,
    CLASS_SENIORITY_ORDER,
    getClassSeniorityRank,
    isTuitionHeadName,
    isTrustedExemptHead,
    isFineHeadName,
    evaluateMembersTrusted,
    computeSlipTotalAndStatus,
    getActiveAcademicYear,
    buildAcademicMonthsMap,
    getClassFeePlan,
    determineFamilyLead,
    shiftFamilySlipsLead,
    getArrearsAndAdvanceSnapshot,
    trimSlipUnpaidToTarget,
    applyArrearsSettlementOnReactivation
};
