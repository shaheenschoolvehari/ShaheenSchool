const {
    MONTH_NAMES,
    CLASS_SENIORITY_ORDER,
    getClassSeniorityRank,
    isTuitionHeadName,
    isFineHeadName,
    evaluateMembersTrusted,
    computeSlipTotalAndStatus,
    getActiveAcademicYear,
    buildAcademicMonthsMap,
    getClassFeePlan,
    determineFamilyLead,
    shiftFamilySlipsLead,
    getArrearsAndAdvanceSnapshot,
    applyArrearsSettlementOnReactivation
} = require('./feeBillingHelpers');

function createAppError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function parseIntList(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : String(raw).split(',');
    return [...new Set(arr.map(v => parseInt(v, 10)).filter(n => !isNaN(n) && n > 0))];
}

/**
 * Generates a read-only smart preview for reactivating an inactive student (and optional inactive siblings),
 * detecting Case 1 (Solo), Case 2 (Whole Family), Case 3A (Existing Unpaid/Partial Slip), or Case 3B (Existing Paid Slip).
 */
async function getReactivationPreview(clientOrPool, studentId, opts = {}) {
    const targetId = parseInt(studentId, 10);
    if (isNaN(targetId)) throw createAppError('Invalid student ID', 400);

    const stuRes = await clientOrPool.query(
        `SELECT s.*, c.class_name, sec.section_name,
                f.family_name,
                COALESCE(f.family_fee, 0) AS family_fee,
                COALESCE(f.opening_balance, 0) AS opening_balance,
                COALESCE(f.opening_balance_paid, 0) AS opening_balance_paid,
                COALESCE(f.advance_balance, 0) AS family_advance_balance,
                f.opb_notes
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN sections sec ON s.section_id = sec.section_id
         LEFT JOIN families f ON s.family_id = f.family_id
         WHERE s.student_id = $1`,
        [targetId]
    );
    if (stuRes.rows.length === 0) throw createAppError('Student not found', 404);
    const targetStudent = stuRes.rows[0];

    const activeYear = await getActiveAcademicYear(clientOrPool);
    const sessionMonths = buildAcademicMonthsMap(activeYear);
    const targetMonth = opts.month ? parseInt(opts.month, 10) : sessionMonths.defaultMonth;

    if (activeYear && activeYear.start_date && activeYear.end_date && !sessionMonths.validMonthMap.has(targetMonth)) {
        throw createAppError('Selected billing month falls outside the active academic year duration.', 400);
    }
    const targetYear = sessionMonths.validMonthMap.get(targetMonth)
        || (opts.year ? parseInt(opts.year, 10) : sessionMonths.defaultYear);

    const monthIdx = sessionMonths.monthsList.findIndex(m => m.month === targetMonth && m.year === targetYear);
    const nextMonthInSession = monthIdx >= 0 && monthIdx + 1 < sessionMonths.monthsList.length
        ? sessionMonths.monthsList[monthIdx + 1]
        : null;

    // Fetch all family members if part of a family
    let allFamilyMembers = [targetStudent];
    if (targetStudent.family_id) {
        const famRes = await clientOrPool.query(
            `SELECT s.*, c.class_name, sec.section_name
             FROM students s
             LEFT JOIN classes c ON s.class_id = c.class_id
             LEFT JOIN sections sec ON s.section_id = sec.section_id
             WHERE s.family_id = $1
             ORDER BY ${CLASS_SENIORITY_ORDER}`,
            [targetStudent.family_id]
        );
        if (famRes.rows.length > 0) allFamilyMembers = famRes.rows;
    }

    const activeSiblings = allFamilyMembers.filter(m => (m.status || 'Active').trim().toLowerCase() === 'active');
    const inactiveSiblings = allFamilyMembers.filter(m => (m.status || '').trim().toLowerCase() !== 'active');

    // Determine which inactive IDs are currently simulated as checked
    let selectedInactiveIds = parseIntList(opts.selected_ids);
    if (!selectedInactiveIds.includes(targetId)) {
        selectedInactiveIds.unshift(targetId);
    }
    const validInactiveSet = new Set(inactiveSiblings.map(m => m.student_id));
    selectedInactiveIds = selectedInactiveIds.filter(id => id === targetId || validInactiveSet.has(id));

    // Apply optional class override on target student for simulation
    const classesRes = await clientOrPool.query(`SELECT class_id, class_name FROM classes ORDER BY class_id ASC`);
    const sectionsRes = await clientOrPool.query(`SELECT section_id, section_name, class_id FROM sections ORDER BY section_name ASC`);
    const overrideClassId = opts.class_id ? parseInt(opts.class_id, 10) : targetStudent.class_id;
    const overrideClassRow = classesRes.rows.find(c => c.class_id === overrideClassId);

    const mapMemberSummary = (m, isSelected = false) => {
        const effectiveClassId = m.student_id === targetId && overrideClassRow ? overrideClassRow.class_id : m.class_id;
        const effectiveClassName = m.student_id === targetId && overrideClassRow ? overrideClassRow.class_name : m.class_name;
        return {
            student_id: m.student_id,
            first_name: m.first_name || '',
            last_name: m.last_name || '',
            full_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
            admission_no: m.admission_no,
            status: m.status,
            category: m.category || 'Normal',
            is_trusted: (m.category || '').trim().toLowerCase().includes('trust'),
            class_id: effectiveClassId,
            class_name: effectiveClassName || 'N/A',
            section_id: m.section_id,
            section_name: m.section_name || 'N/A',
            monthly_fee: parseFloat(m.monthly_fee || 0),
            is_target: m.student_id === targetId,
            is_selected: isSelected,
            seniority_rank: getClassSeniorityRank(effectiveClassName, effectiveClassId)
        };
    };

    const selectedInactiveMembers = inactiveSiblings
        .filter(m => selectedInactiveIds.includes(m.student_id))
        .map(m => mapMemberSummary(m, true));
    const activeSiblingSummaries = activeSiblings.map(m => mapMemberSummary(m, true));

    const simulatedCohort = [...activeSiblingSummaries, ...selectedInactiveMembers]
        .sort((a, b) => {
            if (b.seniority_rank !== a.seniority_rank) return b.seniority_rank - a.seniority_rank;
            if ((b.class_id || 0) !== (a.class_id || 0)) return (b.class_id || 0) - (a.class_id || 0);
            return a.full_name.localeCompare(b.full_name);
        });

    const simulatedLead = simulatedCohort[0] || mapMemberSummary(targetStudent, true);
    const currentActiveLead = [...activeSiblingSummaries].sort((a, b) => b.seniority_rank - a.seniority_rank)[0] || null;
    const leadWillChange = Boolean(currentActiveLead && currentActiveLead.student_id !== simulatedLead.student_id);

    const isTrustedAfter = evaluateMembersTrusted(
        simulatedCohort.map(m => ({ ...m, status: 'Active' })),
        targetStudent.category
    );
    const hasTrustedMembers = simulatedCohort.some(m => m.is_trusted);
    const mixedTrustedWarning = hasTrustedMembers && !isTrustedAfter;

    // Inspect existing slips in the target billing month/year
    const activeYearId = activeYear ? activeYear.id : null;
    const checkIds = allFamilyMembers.map(m => m.student_id);
    const existingSlipsRes = await clientOrPool.query(
        `SELECT mfs.*, s.first_name AS lead_first_name, s.last_name AS lead_last_name,
                s.admission_no AS lead_admission_no, c.class_name AS lead_class_name
         FROM monthly_fee_slips mfs
         JOIN students s ON s.student_id = mfs.student_id
         LEFT JOIN classes c ON c.class_id = mfs.class_id
         WHERE (
             ($1::varchar IS NOT NULL AND mfs.family_id = $1)
             OR mfs.student_id = ANY($2::int[])
         )
         AND (mfs.month = $3 OR $3 = ANY(COALESCE(mfs.months_list, ARRAY[]::int[])))
         AND (mfs.year = $4 OR ($5::int IS NOT NULL AND mfs.academic_year_id = $5))
         ORDER BY mfs.is_family_slip DESC, mfs.slip_id ASC`,
        [targetStudent.family_id || null, checkIds, targetMonth, targetYear, activeYearId]
    );

    const existingSlip = existingSlipsRes.rows[0] || null;
    let existingLineItems = [];
    let existingPayments = [];
    let existingTuitionItem = null;
    let existingPbOnSlip = 0;
    let wasExistingSlipTuitionFree = false;

    if (existingSlip) {
        const liRes = await clientOrPool.query(
            `SELECT * FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC`,
            [existingSlip.slip_id]
        );
        existingLineItems = liRes.rows;
        existingTuitionItem = existingLineItems.find(li => isTuitionHeadName(li.head_name)) || null;
        wasExistingSlipTuitionFree = Boolean(
            existingTuitionItem &&
            (existingTuitionItem.note || '').toLowerCase().includes('trusted') &&
            parseFloat(existingTuitionItem.paid_amount || 0) === 0
        );
        existingPbOnSlip = existingLineItems
            .filter(li => {
                const hn = (li.head_name || '').toLowerCase();
                return hn.includes('previous balance') || hn.includes('opening balance');
            })
            .reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);

        const payRes = await clientOrPool.query(
            `SELECT * FROM fee_payments WHERE slip_id = $1 ORDER BY payment_date DESC, payment_id DESC`,
            [existingSlip.slip_id]
        );
        existingPayments = payRes.rows;
    }

    // Batch generation awareness for the selected month & lead class
    const batchStatsRes = await clientOrPool.query(
        `SELECT
            COUNT(*)::int AS total_month_slips,
            COUNT(*) FILTER (WHERE class_id = $3)::int AS class_month_slips
         FROM monthly_fee_slips
         WHERE (month = $1 OR $1 = ANY(COALESCE(months_list, ARRAY[]::int[])))
           AND (year = $2 OR ($4::int IS NOT NULL AND academic_year_id = $4))`,
        [targetMonth, targetYear, simulatedLead.class_id, activeYearId]
    );

    // Determine exact Case: CASE_1_SOLO, CASE_2_WHOLE_FAMILY, CASE_3A_UNPAID_EXISTING, CASE_3B_PAID_EXISTING
    let billingCase = 'CASE_1_SOLO';
    if (existingSlip) {
        const slipStat = (existingSlip.status || '').toLowerCase();
        const slipPaidAmt = parseFloat(existingSlip.paid_amount || 0);
        if (slipStat === 'paid' || (slipStat === 'satteled' && slipPaidAmt > 0)) {
            billingCase = 'CASE_3B_PAID_EXISTING';
        } else {
            billingCase = 'CASE_3A_UNPAID_EXISTING';
        }
    } else if (
        targetStudent.family_id &&
        (inactiveSiblings.length > 1 || parseFloat(targetStudent.family_fee || 0) > 0)
    ) {
        billingCase = 'CASE_2_WHOLE_FAMILY';
    }

    // Fetch Fee Plan for Lead Class
    const { plan: leadPlan, heads: planHeadsRaw } = await getClassFeePlan(clientOrPool, simulatedLead.class_id);
    const planHeads = planHeadsRaw
        .filter(h => h.head_type !== 'prev_balance')
        .map(h => {
            const isTuition = isTuitionHeadName(h.head_name);
            const isFine = isFineHeadName(h.head_name);
            const unitAmount = parseFloat(h.amount || 0);
            const multiplier = (!isTuition && simulatedCohort.length > 1) ? simulatedCohort.length : 1;
            return {
                head_id: h.head_id,
                head_name: h.head_name,
                head_type: h.head_type,
                unit_amount: unitAmount,
                multiplier,
                default_amount: parseFloat((unitAmount * multiplier).toFixed(2)),
                is_tuition: isTuition,
                is_fine: isFine,
                recommended_checked: !isTuition && !isFine
            };
        });

    const planTuitionAmt = planHeads.find(h => h.is_tuition)?.unit_amount || 0;

    // Lookup last billed tuition for reference
    const lastTuitionRes = await clientOrPool.query(
        `SELECT mfs.month, mfs.year, sli.head_name, sli.amount
         FROM monthly_fee_slips mfs
         JOIN slip_line_items sli ON sli.slip_id = mfs.slip_id
         WHERE (${targetStudent.family_id ? 'mfs.family_id = $1' : 'mfs.student_id = $1'})
           AND (sli.head_name ILIKE '%tuition%' OR sli.head_name ILIKE '%family monthly fee%' OR sli.head_name ILIKE '%monthly fee%')
         ORDER BY mfs.year DESC, mfs.month DESC, mfs.slip_id DESC
         LIMIT 1`,
        [targetStudent.family_id || targetId]
    );
    const lastBilledTuition = lastTuitionRes.rows[0] ? parseFloat(lastTuitionRes.rows[0].amount || 0) : 0;

    // Suggest sensible default tuition and increment
    const savedFamilyFee = parseFloat(targetStudent.family_fee || 0);
    const targetPersonalFee = parseFloat(targetStudent.monthly_fee || 0);
    const selectedInactiveIndividualSum = selectedInactiveMembers.reduce((s, m) => s + (m.monthly_fee || 0), 0);
    const cohortIndividualSum = simulatedCohort.reduce((s, m) => s + (m.monthly_fee || 0), 0);

    let suggestedTuition = 0;
    let suggestedIncrement = 0;

    if (billingCase === 'CASE_1_SOLO') {
        suggestedTuition = targetPersonalFee > 0 ? targetPersonalFee : (savedFamilyFee > 0 ? savedFamilyFee : (lastBilledTuition > 0 ? lastBilledTuition : planTuitionAmt));
    } else if (billingCase === 'CASE_2_WHOLE_FAMILY') {
        if (simulatedCohort.length <= 1) {
            suggestedTuition = selectedInactiveIndividualSum > 0 ? selectedInactiveIndividualSum : (savedFamilyFee > 0 ? savedFamilyFee : (lastBilledTuition > 0 ? lastBilledTuition : planTuitionAmt));
        } else {
            suggestedTuition = savedFamilyFee > 0 ? savedFamilyFee : (lastBilledTuition > 0 ? lastBilledTuition : (cohortIndividualSum > 0 ? cohortIndividualSum : planTuitionAmt));
        }
    } else {
        const existingTuitionAmt = (existingTuitionItem && !wasExistingSlipTuitionFree)
            ? parseFloat(existingTuitionItem.amount || 0)
            : 0;
        suggestedIncrement = selectedInactiveIndividualSum > 0
            ? selectedInactiveIndividualSum
            : (savedFamilyFee > existingTuitionAmt ? parseFloat((savedFamilyFee - existingTuitionAmt).toFixed(2)) : 0);
        suggestedTuition = parseFloat((existingTuitionAmt + suggestedIncrement).toFixed(2));
    }

    // Arrears & Advance Snapshot
    const arrears = await getArrearsAndAdvanceSnapshot(clientOrPool, {
        familyId: targetStudent.family_id || null,
        studentIds: selectedInactiveIds,
        academicYearId: activeYearId,
        beforeMonth: targetMonth,
        beforeYear: targetYear
    });

    // All non-prev_balance, non-tuition saved fee heads + detect extra heads applied in target billing month
    const feeHeadsRes = await clientOrPool.query(
        `SELECT head_id, head_name, head_type, frequency, track_arrears
         FROM fee_heads
         WHERE is_active = TRUE AND head_type != 'prev_balance'
         ORDER BY head_name ASC`
    );

    const monthAppliedRes = await clientOrPool.query(
        `SELECT sli.head_id,
                TRIM(sli.head_name) AS head_name,
                COUNT(DISTINCT CASE WHEN mfs.class_id = $3 THEN mfs.slip_id END)::int AS lead_class_slip_count,
                COUNT(DISTINCT mfs.slip_id)::int AS month_slip_count,
                ARRAY_AGG(sli.amount::float8) FILTER (WHERE mfs.class_id = $3 AND sli.amount > 0) AS lead_class_amounts,
                ARRAY_AGG(sli.amount::float8) FILTER (WHERE sli.amount > 0) AS school_amounts
         FROM slip_line_items sli
         JOIN monthly_fee_slips mfs ON mfs.slip_id = sli.slip_id
         WHERE (mfs.month = $1 OR $1 = ANY(COALESCE(mfs.months_list, ARRAY[]::int[])))
           AND (mfs.year = $2 OR ($4::int IS NOT NULL AND mfs.academic_year_id = $4))
           AND COALESCE(sli.is_carried_forward, FALSE) = FALSE
           AND COALESCE(sli.is_waived, FALSE) = FALSE
           AND sli.amount > 0
           AND LOWER(sli.head_name) NOT LIKE '%tuition%'
           AND LOWER(sli.head_name) NOT LIKE '%family monthly%'
           AND LOWER(sli.head_name) NOT LIKE '%previous balance%'
           AND LOWER(sli.head_name) NOT LIKE '%opening balance%'
           AND LOWER(sli.head_name) NOT LIKE '%advance%'
           AND LOWER(sli.head_name) NOT LIKE '%re-admission%'
           AND LOWER(sli.head_name) NOT LIKE '%readmission%'
         GROUP BY sli.head_id, TRIM(sli.head_name)`,
        [targetMonth, targetYear, simulatedLead?.class_id || null, activeYearId]
    );

    const pickModeAmount = (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return 0;
        const freq = new Map();
        let bestAmt = arr[0];
        let bestCount = 0;
        for (const raw of arr) {
            const val = parseFloat(raw);
            if (!isFinite(val) || val <= 0) continue;
            const key = val.toFixed(2);
            const c = (freq.get(key) || 0) + 1;
            freq.set(key, c);
            if (c > bestCount) {
                bestCount = c;
                bestAmt = val;
            }
        }
        return parseFloat((bestAmt || 0).toFixed(2));
    };

    const appliedByHeadId = new Map();
    const appliedByName = new Map();
    const monthAppliedExtrasList = [];

    for (const row of monthAppliedRes.rows) {
        const entry = {
            head_id: row.head_id || null,
            head_name: row.head_name,
            lead_class_slip_count: row.lead_class_slip_count || 0,
            month_slip_count: row.month_slip_count || 0,
            applied_in_month: (row.month_slip_count || 0) > 0,
            applied_in_lead_class: (row.lead_class_slip_count || 0) > 0,
            suggested_amount: pickModeAmount(
                (row.lead_class_amounts && row.lead_class_amounts.length > 0)
                    ? row.lead_class_amounts
                    : row.school_amounts
            ),
            already_on_existing_slip: existingLineItems.some(
                li => (row.head_id && li.head_id === row.head_id) ||
                      (li.head_name || '').trim().toLowerCase() === (row.head_name || '').trim().toLowerCase()
            )
        };
        if (entry.head_id && !appliedByHeadId.has(entry.head_id)) {
            appliedByHeadId.set(entry.head_id, entry);
        }
        const nKey = (entry.head_name || '').trim().toLowerCase();
        if (nKey && !appliedByName.has(nKey)) {
            appliedByName.set(nKey, entry);
        }
        monthAppliedExtrasList.push(entry);
    }

    const enrichedAvailableHeads = feeHeadsRes.rows
        .filter(fh => !isTuitionHeadName(fh.head_name))
        .map(fh => {
            const m = appliedByHeadId.get(fh.head_id) || appliedByName.get((fh.head_name || '').trim().toLowerCase()) || null;
            const existingOnSlip = existingLineItems.some(
                li => (li.head_id && li.head_id === fh.head_id) ||
                      (li.head_name || '').trim().toLowerCase() === (fh.head_name || '').trim().toLowerCase()
            );
            return {
                ...fh,
                applied_in_month: Boolean(m),
                applied_in_lead_class: Boolean(m && m.applied_in_lead_class),
                lead_class_slip_count: m ? m.lead_class_slip_count : 0,
                month_slip_count: m ? m.month_slip_count : 0,
                suggested_amount: m ? m.suggested_amount : 0,
                already_on_existing_slip: existingOnSlip
            };
        })
        .sort((a, b) => {
            if (a.applied_in_lead_class !== b.applied_in_lead_class) return a.applied_in_lead_class ? -1 : 1;
            if (a.applied_in_month !== b.applied_in_month) return a.applied_in_month ? -1 : 1;
            return (a.head_name || '').localeCompare(b.head_name || '');
        });

    monthAppliedExtrasList.sort((a, b) => {
        if (a.applied_in_lead_class !== b.applied_in_lead_class) return a.applied_in_lead_class ? -1 : 1;
        if (b.month_slip_count !== a.month_slip_count) return b.month_slip_count - a.month_slip_count;
        return (a.head_name || '').localeCompare(b.head_name || '');
    });

    const pendingAdjRes = await clientOrPool.query(
        `SELECT * FROM pending_family_adjustments
         WHERE status = 'pending'
           AND ((family_id IS NOT NULL AND family_id = $1) OR student_id = ANY($2::int[]))
         ORDER BY adjustment_id ASC`,
        [targetStudent.family_id || null, checkIds]
    );

    return {
        target_student: mapMemberSummary(targetStudent, true),
        already_active: (targetStudent.status || '').trim().toLowerCase() === 'active',
        family_id: targetStudent.family_id || null,
        family_name: targetStudent.family_name || null,
        saved_family_fee: savedFamilyFee,
        active_year: activeYear,
        billing_period: {
            month: targetMonth,
            year: targetYear,
            month_name: MONTH_NAMES[targetMonth - 1] || String(targetMonth),
            label: `${MONTH_NAMES[targetMonth - 1] || targetMonth} ${targetYear}`,
            available_months: sessionMonths.monthsList,
            next_month_in_session: nextMonthInSession,
            has_next_month_in_session: Boolean(nextMonthInSession),
            batch_slips_in_month: batchStatsRes.rows[0]?.total_month_slips || 0,
            batch_slips_in_lead_class: batchStatsRes.rows[0]?.class_month_slips || 0
        },
        billing_case: billingCase,
        siblings: {
            active: activeSiblingSummaries,
            inactive: inactiveSiblings.map(m => mapMemberSummary(m, selectedInactiveIds.includes(m.student_id)))
        },
        cohort: {
            selected_inactive_ids: selectedInactiveIds,
            simulated_active_members: simulatedCohort,
            simulated_lead: simulatedLead,
            current_active_lead: currentActiveLead,
            lead_will_change: leadWillChange,
            is_trusted_after: isTrustedAfter,
            mixed_trusted_warning: mixedTrustedWarning
        },
        existing_slip: existingSlip ? {
            slip_id: existingSlip.slip_id,
            student_id: existingSlip.student_id,
            lead_name: `${existingSlip.lead_first_name || ''} ${existingSlip.lead_last_name || ''}`.trim(),
            lead_admission_no: existingSlip.lead_admission_no,
            lead_class_name: existingSlip.lead_class_name,
            month: existingSlip.month,
            year: existingSlip.year,
            total_amount: parseFloat(existingSlip.total_amount || 0),
            paid_amount: parseFloat(existingSlip.paid_amount || 0),
            status: existingSlip.status,
            is_family_slip: Boolean(existingSlip.is_family_slip),
            is_printed: Boolean(existingSlip.is_printed),
            existing_tuition_amount: wasExistingSlipTuitionFree ? 0 : (existingTuitionItem ? parseFloat(existingTuitionItem.amount || 0) : 0),
            existing_tuition_paid: existingTuitionItem ? parseFloat(existingTuitionItem.paid_amount || 0) : 0,
            was_tuition_free_trusted: wasExistingSlipTuitionFree,
            existing_pb_on_slip: existingPbOnSlip,
            line_items: existingLineItems,
            payments: existingPayments
        } : null,
        fee_suggestion: {
            plan: leadPlan,
            plan_heads: planHeads,
            plan_tuition_amount: planTuitionAmt,
            last_billed_tuition: lastBilledTuition,
            last_billed_month_label: lastTuitionRes.rows[0]
                ? `${MONTH_NAMES[lastTuitionRes.rows[0].month - 1]} ${lastTuitionRes.rows[0].year}`
                : null,
            suggested_tuition: suggestedTuition,
            suggested_increment: suggestedIncrement
        },
        arrears,
        pending_adjustments: pendingAdjRes.rows,
        available_fee_heads: enrichedAvailableHeads,
        month_applied_extra_heads: monthAppliedExtrasList,
        classes: classesRes.rows,
        sections: sectionsRes.rows
    };
}

/**
 * Executes atomic reactivation + mid-month billing (Cases 1, 2, 3A, 3B Modes B1 & B2) inside an active transaction.
 */
async function executeStudentReactivation(client, studentId, payload = {}) {
    const targetId = parseInt(studentId, 10);
    if (isNaN(targetId)) throw createAppError('Invalid student ID', 400);

    // 1. Lock and verify target student
    const primaryRes = await client.query(`SELECT * FROM students WHERE student_id = $1 FOR UPDATE`, [targetId]);
    if (primaryRes.rows.length === 0) throw createAppError('Student not found', 404);
    const primaryStudent = primaryRes.rows[0];
    const familyId = primaryStudent.family_id || null;

    let selectedIds = parseIntList(payload.student_ids);
    if (!selectedIds.includes(targetId)) selectedIds.unshift(targetId);

    const selectedStudentsRes = await client.query(
        `SELECT * FROM students WHERE student_id = ANY($1::int[]) FOR UPDATE`,
        [selectedIds]
    );
    if (selectedStudentsRes.rows.length !== selectedIds.length) {
        throw createAppError('One or more selected student IDs do not exist.', 400);
    }
    if (familyId) {
        const alien = selectedStudentsRes.rows.find(s => s.family_id !== familyId);
        if (alien) throw createAppError('Selected siblings must belong to the same family.', 400);
    } else if (selectedIds.length > 1) {
        throw createAppError('Solo student cannot activate unrelated students.', 400);
    }

    const inactiveTargets = selectedStudentsRes.rows.filter(s => (s.status || '').trim().toLowerCase() !== 'active');
    if (inactiveTargets.length === 0) {
        throw createAppError('Selected student(s) are already Active.', 400);
    }

    // 2. Validate academic year & billing period
    const activeYear = await getActiveAcademicYear(client);
    const activeYearId = activeYear ? activeYear.id : null;
    if (activeYear && activeYear.is_active === false) {
        throw createAppError(`Academic year (${activeYear.year_name}) is closed.`, 403);
    }
    const sessionMonths = buildAcademicMonthsMap(activeYear);
    const month = payload.month ? parseInt(payload.month, 10) : sessionMonths.defaultMonth;

    if (payload.charge_current_month !== false && activeYear?.start_date && activeYear?.end_date && !sessionMonths.validMonthMap.has(month)) {
        throw createAppError('Selected billing month falls outside the active academic year duration.', 400);
    }
    const year = sessionMonths.validMonthMap.get(month) || (payload.year ? parseInt(payload.year, 10) : sessionMonths.defaultYear);

    // 3. Optional class / section update on primary student
    if (payload.target_class_id || payload.target_section_id) {
        const newClassId = payload.target_class_id ? parseInt(payload.target_class_id, 10) : primaryStudent.class_id;
        const newSectionId = payload.target_section_id ? parseInt(payload.target_section_id, 10) : primaryStudent.section_id;
        await client.query(
            `UPDATE students SET class_id = $1, section_id = $2 WHERE student_id = $3`,
            [newClassId, newSectionId, targetId]
        );
    }

    // 4. Activate all selected students and their portal logins
    await client.query(`UPDATE students SET status = 'Active' WHERE student_id = ANY($1::int[])`, [selectedIds]);
    const userIds = selectedStudentsRes.rows.map(s => s.user_id).filter(Boolean);
    if (userIds.length > 0) {
        await client.query(`UPDATE app_users SET is_active = TRUE WHERE id = ANY($1::int[])`, [userIds]);
    }

    // Update permanent monthly/family fee if requested
    if (payload.save_permanent_fee) {
        const permRaw = payload.permanent_fee_amount !== undefined && payload.permanent_fee_amount !== null && payload.permanent_fee_amount !== ''
            ? payload.permanent_fee_amount
            : payload.tuition_amount;
        const permFee = Math.max(0, parseFloat(permRaw) || 0);

        if (familyId) {
            await client.query(`UPDATE families SET family_fee = $1 WHERE family_id = $2`, [permFee, familyId]);
            // Keep inactive/zero-fee siblings or sole active member synchronized without wiping distinct custom fees
            await client.query(
                `UPDATE students
                 SET monthly_fee = $1
                 WHERE family_id = $2
                   AND (
                       COALESCE(monthly_fee, 0) <= 0
                       OR (SELECT COUNT(*) FROM students sub WHERE sub.family_id = $2 AND LOWER(COALESCE(sub.status, 'Active')) = 'active') = 1
                   )`,
                [permFee, familyId]
            );
        } else {
            await client.query(`UPDATE students SET monthly_fee = $1 WHERE student_id = $2`, [permFee, targetId]);
        }
    }

    // 5. Recompute active family lead, trust state, and shift prior unpaid/partial slips cleanly
    let activeLead;
    let allActiveMembers;
    let savedFamilyFee = 0;

    if (familyId) {
        const leadInfo = await determineFamilyLead(client, familyId);
        activeLead = leadInfo.lead;
        allActiveMembers = leadInfo.members;
        const famFeeRes = await client.query(`SELECT COALESCE(family_fee, 0) AS family_fee FROM families WHERE family_id = $1`, [familyId]);
        savedFamilyFee = parseFloat(famFeeRes.rows[0]?.family_fee || 0);

        if (activeLead) {
            await shiftFamilySlipsLead(client, {
                familyId,
                newLeadStudentId: activeLead.student_id,
                newLeadClassId: activeLead.class_id,
                statuses: ['unpaid', 'partial']
            });
        }
    } else {
        const refreshed = await client.query(
            `SELECT s.*, c.class_name, sec.section_name
             FROM students s
             LEFT JOIN classes c ON s.class_id = c.class_id
             LEFT JOIN sections sec ON s.section_id = sec.section_id
             WHERE s.student_id = $1`,
            [targetId]
        );
        activeLead = refreshed.rows[0];
        allActiveMembers = [activeLead];
    }

    const isFamilySlip = Boolean(familyId && (allActiveMembers.length > 1 || savedFamilyFee > 0));
    const isCohortTrusted = evaluateMembersTrusted(allActiveMembers, activeLead?.category || primaryStudent.category);

    const oldBalanceAction = payload.old_balance_action || 'carry_all'; // 'carry_all' | 'waive_all' | 'partial'
    const carriedBalanceAmount = payload.carried_balance_amount !== undefined ? parseFloat(payload.carried_balance_amount) : null;
    const oldBalanceReason = payload.old_balance_reason || payload.notes || 'Mid-month reactivation';

    const activatedNames = selectedStudentsRes.rows
        .map(s => `${s.first_name || ''} ${s.last_name || ''}`.trim())
        .filter(Boolean)
        .join(', ');

    // 6. Activate-only path (skip charging current month)
    if (payload.charge_current_month === false) {
        if (oldBalanceAction !== 'carry_all') {
            await applyArrearsSettlementOnReactivation(client, {
                familyId,
                studentIds: selectedIds,
                academicYearId: activeYearId,
                beforeMonth: month,
                beforeYear: year,
                mode: oldBalanceAction,
                carriedAmount: carriedBalanceAmount,
                reason: oldBalanceReason,
                isTrustedAfterReactivation: isCohortTrusted
            });
        }

        return {
            success: true,
            billing_case: 'ACTIVATE_ONLY',
            activated_students: selectedIds,
            activated_names: activatedNames,
            lead_student: activeLead,
            family_id: familyId,
            slip: null,
            pending_adjustments_created: 0
        };
    }

    // 7. Lock any existing current-month slips to safely branch Cases 1/2 vs Case 3A vs Case 3B
    const checkMemberIds = [...new Set([...allActiveMembers.map(m => m.student_id), ...selectedIds])];
    const existingSlipsRes = await client.query(
        `SELECT * FROM monthly_fee_slips
         WHERE (
             ($1::varchar IS NOT NULL AND family_id = $1)
             OR student_id = ANY($2::int[])
         )
         AND (month = $3 OR $3 = ANY(COALESCE(months_list, ARRAY[]::int[])))
         AND (year = $4 OR ($5::int IS NOT NULL AND academic_year_id = $5))
         ORDER BY is_family_slip DESC, slip_id ASC
         FOR UPDATE`,
        [familyId, checkMemberIds, month, year, activeYearId]
    );

    const existingSlip = existingSlipsRes.rows[0] || null;
    const extraHeads = Array.isArray(payload.extra_heads)
        ? payload.extra_heads.filter(h => h && h.head_name && String(h.head_name).trim() !== '' && parseFloat(h.amount) > 0)
        : [];
    const planHeadItems = Array.isArray(payload.plan_head_items)
        ? payload.plan_head_items.filter(h => h && h.head_name && parseFloat(h.amount) > 0)
        : [];
    const applyAdvance = payload.apply_advance !== false;
    const todayStr = new Date().toISOString().split('T')[0];
    const defaultDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const issueDate = payload.issue_date || todayStr;
    const dueDate = payload.due_date || defaultDue;

    let resultSlip = null;
    let resolvedCase = 'CASE_1_2_FRESH_SLIP';
    let createdAdjustmentsCount = 0;
    let advanceDeducted = 0;

    if (!existingSlip) {
        // ─── CASE 1 (SOLO) OR CASE 2 (WHOLE FAMILY) — FRESH SLIP ──────────────
        resolvedCase = (familyId && (selectedIds.length > 1 || savedFamilyFee > 0)) ? 'CASE_2_WHOLE_FAMILY' : 'CASE_1_SOLO';

        const arrearsResult = await applyArrearsSettlementOnReactivation(client, {
            familyId,
            studentIds: selectedIds,
            academicYearId: activeYearId,
            beforeMonth: month,
            beforeYear: year,
            mode: oldBalanceAction,
            carriedAmount: carriedBalanceAmount,
            reason: oldBalanceReason,
            isTrustedAfterReactivation: isCohortTrusted
        });

        const { heads: leadPlanHeads } = await getClassFeePlan(client, activeLead.class_id);
        const pbPlanHead = leadPlanHeads.find(h => h.head_type === 'prev_balance');
        const tuitionPlanHead = leadPlanHeads.find(h => isTuitionHeadName(h.head_name));
        let fallbackTuitionHeadId = tuitionPlanHead?.head_id || null;
        if (!fallbackTuitionHeadId) {
            const fhTRes = await client.query(`SELECT head_id FROM fee_heads WHERE head_name ILIKE '%tuition%' LIMIT 1`);
            fallbackTuitionHeadId = fhTRes.rows[0]?.head_id || null;
        }

        const lineItems = [];
        const tuitionAmt = Math.max(0, parseFloat(payload.tuition_amount) || 0);
        lineItems.push({
            head_id: fallbackTuitionHeadId,
            head_name: isFamilySlip ? 'Family Monthly Fee' : 'Tuition Fee',
            amount: tuitionAmt,
            is_carried_forward: false,
            note: isCohortTrusted ? 'Trusted Category - Free Tuition' : (payload.tuition_note || 'Mid-month reactivation')
        });

        for (const ph of planHeadItems) {
            if (isTuitionHeadName(ph.head_name)) continue;
            lineItems.push({
                head_id: ph.head_id || null,
                head_name: ph.head_name,
                amount: parseFloat(ph.amount),
                is_carried_forward: false,
                note: ph.note || null
            });
        }

        // Previous Balance (Tuition Arrears + OPB + orphan unlinked prior dues)
        const pbTotalToBill = (!isCohortTrusted)
            ? parseFloat(((arrearsResult.include_previous_balance || 0) + (arrearsResult.orphan_individual_dues || 0)).toFixed(2))
            : 0;
        if (pbTotalToBill > 0) {
            let pbHeadId = pbPlanHead?.head_id || null;
            if (!pbHeadId) {
                const pbRes = await client.query(`SELECT head_id FROM fee_heads WHERE head_type = 'prev_balance' LIMIT 1`);
                pbHeadId = pbRes.rows[0]?.head_id || null;
            }
            lineItems.push({
                head_id: pbHeadId,
                head_name: 'Previous Balance',
                amount: pbTotalToBill,
                is_carried_forward: false
            });
        }

        // Cumulative Tracked Arrears Heads
        for (const ch of (arrearsResult.carried_tracked_heads || [])) {
            const existingPlanLi = lineItems.find(li => li.head_id && ch.head_id && li.head_id === ch.head_id && !li.is_carried_forward);
            if (existingPlanLi) {
                existingPlanLi.amount += ch.pending_amount;
                existingPlanLi.note = (existingPlanLi.note ? existingPlanLi.note + '; ' : '') + `Includes PKR ${ch.pending_amount} past arrears`;
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

        // Extra Custom Heads (e.g. Re-Admission Fee — never overwrites admission_fee_ledger)
        for (const eh of extraHeads) {
            lineItems.push({
                head_id: eh.head_id ? parseInt(eh.head_id, 10) : null,
                head_name: String(eh.head_name).trim(),
                amount: parseFloat(eh.amount),
                is_carried_forward: false,
                note: eh.note ? String(eh.note).trim() : 'Reactivation charge'
            });
        }

        // Also consume any pre-existing queued pending adjustments targeting this family/students
        const queuedRes = await client.query(
            `SELECT * FROM pending_family_adjustments
             WHERE status = 'pending'
               AND ((family_id IS NOT NULL AND family_id = $1) OR student_id = ANY($2::int[]))
               AND (target_month IS NULL OR target_month = $3)
               AND (target_year IS NULL OR target_year = $4)
             ORDER BY adjustment_id ASC FOR UPDATE`,
            [familyId, selectedIds, month, year]
        );
        for (const adj of queuedRes.rows) {
            lineItems.push({
                head_id: adj.head_id || null,
                head_name: adj.head_name,
                amount: parseFloat(adj.amount),
                is_carried_forward: true,
                note: adj.reason || 'Deferred mid-month adjustment'
            });
        }

        const preAdv = computeSlipTotalAndStatus({ lineItems, paidAmount: 0, isTrusted: isCohortTrusted });
        if (applyAdvance && preAdv.totalAmount > 0) {
            let availableAdv = 0;
            if (familyId) {
                const advR = await client.query(`SELECT COALESCE(advance_balance, 0) AS adv FROM families WHERE family_id = $1 FOR UPDATE`, [familyId]);
                availableAdv = parseFloat(advR.rows[0]?.adv || 0);
            } else {
                const advR = await client.query(`SELECT COALESCE(advance_balance, 0) AS adv FROM students WHERE student_id = $1 FOR UPDATE`, [targetId]);
                availableAdv = parseFloat(advR.rows[0]?.adv || 0);
            }
            if (availableAdv > 0) {
                advanceDeducted = parseFloat(Math.min(availableAdv, preAdv.totalAmount).toFixed(2));
                if (advanceDeducted > 0) {
                    lineItems.push({
                        head_id: null,
                        head_name: 'Advance Fee Adjusted',
                        amount: -advanceDeducted,
                        is_carried_forward: false,
                        note: 'Adjusted from previous advance deposit (پیشگی فیس کٹوتی)'
                    });
                    if (familyId) {
                        await client.query(`UPDATE families SET advance_balance = GREATEST(0, advance_balance - $1) WHERE family_id = $2`, [advanceDeducted, familyId]);
                    } else {
                        await client.query(`UPDATE students SET advance_balance = GREATEST(0, advance_balance - $1) WHERE student_id = $2`, [advanceDeducted, targetId]);
                    }
                }
            }
        }

        const finalCalc = computeSlipTotalAndStatus({ lineItems, paidAmount: 0, isTrusted: isCohortTrusted });
        const insSlip = await client.query(
            `INSERT INTO monthly_fee_slips
                (student_id, family_id, class_id, month, year, due_date, issue_date, total_amount, paid_amount, status,
                 is_family_slip, has_multi_months, months_list, is_printed, printed_at, academic_year_id, advance_adjusted, generation_source, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, FALSE, ARRAY[$4]::int[], FALSE, NULL, $11, $12, 'reactivation', $13)
             RETURNING *`,
            [
                activeLead.student_id,
                familyId,
                activeLead.class_id,
                month,
                year,
                dueDate,
                issueDate,
                finalCalc.totalAmount,
                finalCalc.status,
                isFamilySlip,
                activeYearId,
                advanceDeducted,
                payload.notes || `Reactivated: ${activatedNames}`
            ]
        );
        resultSlip = insSlip.rows[0];

        for (const li of lineItems) {
            await client.query(
                `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, is_carried_forward, arrears_head_id, note)
                 VALUES ($1, $2, $3, $4, 0, $5, $6, $7)`,
                [resultSlip.slip_id, li.head_id || null, li.head_name, li.amount, !!li.is_carried_forward, li.arrears_head_id || null, li.note || null]
            );
        }

        if (queuedRes.rows.length > 0) {
            await client.query(
                `UPDATE pending_family_adjustments SET status = 'applied', applied_slip_id = $1, applied_at = NOW() WHERE adjustment_id = ANY($2::int[])`,
                [resultSlip.slip_id, queuedRes.rows.map(r => r.adjustment_id)]
            );
        }
    } else {
        // ─── EXISTING CURRENT-MONTH SLIP FOUND (CASE 3A OR CASE 3B) ───────────
        const curStat = (existingSlip.status || '').toLowerCase();
        const curPaid = parseFloat(existingSlip.paid_amount || 0);
        const isExistingPaid = curStat === 'paid' || (curStat === 'satteled' && curPaid > 0);

        if (existingSlip.academic_year_id) {
            const yrCheck = await client.query(`SELECT is_active FROM academic_years WHERE id = $1`, [existingSlip.academic_year_id]);
            if (yrCheck.rows[0]?.is_active === false) {
                throw createAppError('Cannot modify a slip belonging to a closed academic year.', 403);
            }
        }

        const existingItemsRes = await client.query(
            `SELECT * FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC FOR UPDATE`,
            [existingSlip.slip_id]
        );
        const existingItems = existingItemsRes.rows;
        const tuitionItem = existingItems.find(li => isTuitionHeadName(li.head_name)) || null;
        const wasExistingSlipTuitionFree = Boolean(
            tuitionItem &&
            (tuitionItem.note || '').toLowerCase().includes('trusted') &&
            parseFloat(tuitionItem.paid_amount || 0) === 0
        );
        const existingTuitionAmt = (tuitionItem && !wasExistingSlipTuitionFree)
            ? parseFloat(tuitionItem.amount || 0)
            : 0;

        if (!isExistingPaid) {
            // ─── CASE 3A: UNPAID / PARTIAL EXISTING SLIP ────────────────────
            resolvedCase = 'CASE_3A_UNPAID_EXISTING';

            // Shift lead cleanly if needed and ensure it's marked as a consolidated family slip
            if (activeLead && existingSlip.student_id !== activeLead.student_id) {
                await client.query(
                    `UPDATE monthly_fee_slips mfs
                     SET student_id = $1, class_id = $2, is_family_slip = TRUE
                     WHERE mfs.slip_id = $3
                       AND NOT EXISTS (
                           SELECT 1 FROM monthly_fee_slips dup
                           WHERE dup.student_id = $1 AND dup.month = mfs.month AND dup.year = mfs.year AND dup.slip_id != mfs.slip_id
                       )`,
                    [activeLead.student_id, activeLead.class_id, existingSlip.slip_id]
                );
            } else {
                await client.query(`UPDATE monthly_fee_slips SET is_family_slip = TRUE WHERE slip_id = $1`, [existingSlip.slip_id]);
            }

            // Apply waiver/partial carry across prior slips AND the existing Previous Balance line on this slip
            let orphanDues = 0;
            if (oldBalanceAction !== 'carry_all') {
                await applyArrearsSettlementOnReactivation(client, {
                    familyId,
                    studentIds: selectedIds,
                    academicYearId: activeYearId,
                    beforeMonth: month,
                    beforeYear: year,
                    mode: oldBalanceAction,
                    carriedAmount: carriedBalanceAmount,
                    reason: oldBalanceReason,
                    existingCurrentSlipId: existingSlip.slip_id,
                    isTrustedAfterReactivation: isCohortTrusted
                });
            } else {
                const snap = await getArrearsAndAdvanceSnapshot(client, {
                    familyId,
                    studentIds: selectedIds,
                    academicYearId: activeYearId,
                    beforeMonth: month,
                    beforeYear: year
                });
                orphanDues = snap.orphan_individual_dues || 0;
            }

            // Update or insert tuition line item
            const tuitionMode = payload.tuition_mode || 'set_total';
            const inputTuition = Math.max(0, parseFloat(payload.tuition_amount) || 0);
            const newTuitionAmt = tuitionMode === 'increment'
                ? parseFloat((existingTuitionAmt + inputTuition).toFixed(2))
                : inputTuition;

            if (tuitionItem) {
                const tPaid = parseFloat(tuitionItem.paid_amount || 0);
                if (newTuitionAmt < tPaid) {
                    throw createAppError(`Cannot set tuition to PKR ${newTuitionAmt.toLocaleString('en-PK')} because PKR ${tPaid.toLocaleString('en-PK')} is already paid on tuition.`, 400);
                }
                const updatedNote = isCohortTrusted
                    ? 'Trusted Category - Free Tuition'
                    : (tuitionItem.note && tuitionItem.note.includes('Trusted')
                        ? `Updated on reactivation (${activatedNames})`
                        : (tuitionItem.note ? `${tuitionItem.note}; Updated (${activatedNames})` : `Updated on reactivation (${activatedNames})`));

                await client.query(
                    `UPDATE slip_line_items SET head_name = 'Family Monthly Fee', amount = $1, note = $2 WHERE item_id = $3`,
                    [newTuitionAmt, updatedNote, tuitionItem.item_id]
                );
            } else if (newTuitionAmt > 0 || isCohortTrusted) {
                await client.query(
                    `INSERT INTO slip_line_items (slip_id, head_name, amount, paid_amount, note)
                     VALUES ($1, 'Family Monthly Fee', $2, 0, $3)`,
                    [existingSlip.slip_id, newTuitionAmt, isCohortTrusted ? 'Trusted Category - Free Tuition' : `Reactivation (${activatedNames})`]
                );
            }

            if (orphanDues > 0 && !isCohortTrusted) {
                await client.query(
                    `INSERT INTO slip_line_items (slip_id, head_name, amount, paid_amount, is_carried_forward, note)
                     VALUES ($1, 'Previous Balance (Returned Member)', $2, 0, TRUE, $3)`,
                    [existingSlip.slip_id, orphanDues, `Prior unlinked balance (${activatedNames})`]
                );
            }

            // Insert newly selected non-tuition plan heads & extra heads (never mutating paid lines)
            for (const ph of planHeadItems) {
                if (isTuitionHeadName(ph.head_name)) continue;
                await client.query(
                    `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                     VALUES ($1, $2, $3, $4, 0, $5)`,
                    [existingSlip.slip_id, ph.head_id || null, ph.head_name, parseFloat(ph.amount), ph.note || `Added on reactivation (${activatedNames})`]
                );
            }
            for (const eh of extraHeads) {
                await client.query(
                    `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                     VALUES ($1, $2, $3, $4, 0, $5)`,
                    [existingSlip.slip_id, eh.head_id ? parseInt(eh.head_id, 10) : null, String(eh.head_name).trim(), parseFloat(eh.amount), eh.note ? String(eh.note).trim() : `Reactivation (${activatedNames})`]
                );
            }

            // Recompute total & check remaining advance wallet credit
            let refreshedItems = (await client.query(`SELECT * FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC`, [existingSlip.slip_id])).rows;
            let preAdv = computeSlipTotalAndStatus({ lineItems: refreshedItems, paidAmount: curPaid, isTrusted: isCohortTrusted });
            const dueBeforeAdv = Math.max(0, preAdv.totalAmount - curPaid);

            if (applyAdvance && dueBeforeAdv > 0 && familyId) {
                const advR = await client.query(`SELECT COALESCE(advance_balance, 0) AS adv FROM families WHERE family_id = $1 FOR UPDATE`, [familyId]);
                const availableAdv = parseFloat(advR.rows[0]?.adv || 0);
                if (availableAdv > 0) {
                    advanceDeducted = parseFloat(Math.min(availableAdv, dueBeforeAdv).toFixed(2));
                    if (advanceDeducted > 0) {
                        await client.query(`UPDATE families SET advance_balance = GREATEST(0, advance_balance - $1) WHERE family_id = $2`, [advanceDeducted, familyId]);
                        await client.query(
                            `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, is_carried_forward, note)
                             VALUES ($1, NULL, 'Advance Fee Adjusted', $2, 0, FALSE, 'Adjusted from advance wallet on reactivation')`,
                            [existingSlip.slip_id, -advanceDeducted]
                        );
                        refreshedItems = (await client.query(`SELECT * FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC`, [existingSlip.slip_id])).rows;
                    }
                }
            }

            const finalCalc = computeSlipTotalAndStatus({ lineItems: refreshedItems, paidAmount: curPaid, isTrusted: isCohortTrusted });
            const newNotes = existingSlip.notes
                ? `${existingSlip.notes}; Updated on reactivation (${activatedNames})`
                : `Updated on reactivation (${activatedNames})`;

            const upd = await client.query(
                `UPDATE monthly_fee_slips
                 SET total_amount = $1,
                     status = $2,
                     is_printed = FALSE,
                     printed_at = NULL,
                     advance_adjusted = COALESCE(advance_adjusted, 0) + $3,
                     generation_source = CASE WHEN generation_source = 'batch' THEN 'batch+reactivation' ELSE COALESCE(generation_source, 'reactivation') END,
                     notes = $4
                 WHERE slip_id = $5
                 RETURNING *`,
                [finalCalc.totalAmount, finalCalc.status, advanceDeducted, newNotes, existingSlip.slip_id]
            );
            resultSlip = upd.rows[0];
        } else {
            // ─── CASE 3B: EXISTING PAID SLIP — MODE B1 OR MODE B2 ───────────
            const strategy = payload.billing_strategy || 'reopen_supplement';
            const rawInputTuition = Math.max(0, parseFloat(payload.tuition_amount) || 0);
            const tuitionMode = payload.tuition_mode || 'increment';
            const supTuition = tuitionMode === 'set_total'
                ? Math.max(0, parseFloat((rawInputTuition - existingTuitionAmt).toFixed(2)))
                : rawInputTuition;

            if (strategy === 'defer_next_month') {
                resolvedCase = 'CASE_3B_DEFER_NEXT_MONTH';

                // Pick next valid month in active academic session
                const mIdx = sessionMonths.monthsList.findIndex(m => m.month === month && m.year === year);
                const autoNext = (mIdx >= 0 && mIdx + 1 < sessionMonths.monthsList.length)
                    ? sessionMonths.monthsList[mIdx + 1]
                    : null;

                const deferMonth = payload.defer_target_month ? parseInt(payload.defer_target_month, 10) : (autoNext?.month || null);
                const deferYear = deferMonth
                    ? (sessionMonths.validMonthMap.get(deferMonth) || (payload.defer_target_year ? parseInt(payload.defer_target_year, 10) : autoNext?.year))
                    : null;

                if (!deferMonth || !deferYear) {
                    throw createAppError('No remaining month exists in the active academic session to defer charges. Please use Re-Open Slip & Issue Balance Voucher instead.', 400);
                }

                // Queue supplementary charges into pending_family_adjustments; paid slip remains untouched
                const deferredItems = [];
                if (supTuition > 0 && !isCohortTrusted) {
                    deferredItems.push({
                        head_id: tuitionItem?.head_id || null,
                        head_name: `Sibling Tuition Addition (${activatedNames})`,
                        amount: supTuition,
                        reason: payload.notes || `Mid-month return (${MONTH_NAMES[month - 1]} ${year}) deferred from paid Slip #${existingSlip.slip_id}`
                    });
                }
                for (const ph of planHeadItems) {
                    if (isTuitionHeadName(ph.head_name)) continue;
                    deferredItems.push({
                        head_id: ph.head_id || null,
                        head_name: `${ph.head_name} (${activatedNames})`,
                        amount: parseFloat(ph.amount),
                        reason: ph.note || `Deferred head from ${MONTH_NAMES[month - 1]} ${year} reactivation`
                    });
                }
                for (const eh of extraHeads) {
                    deferredItems.push({
                        head_id: eh.head_id ? parseInt(eh.head_id, 10) : null,
                        head_name: String(eh.head_name).trim(),
                        amount: parseFloat(eh.amount),
                        reason: eh.note ? String(eh.note).trim() : `Deferred charge (${activatedNames})`
                    });
                }

                for (const d of deferredItems) {
                    await client.query(
                        `INSERT INTO pending_family_adjustments
                            (family_id, student_id, academic_year_id, target_month, target_year, head_id, head_name, amount, reason, source_slip_id, status)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
                        [familyId, targetId, activeYearId, deferMonth, deferYear, d.head_id, d.head_name, d.amount, d.reason, existingSlip.slip_id]
                    );
                    createdAdjustmentsCount++;
                }

                resultSlip = existingSlip;
            } else {
                // ─── MODE B1: RE-OPEN PAID SLIP & APPEND SUPPLEMENTARY HEADS ─
                resolvedCase = 'CASE_3B_REOPEN_SUPPLEMENT';

                if (activeLead && existingSlip.student_id !== activeLead.student_id) {
                    await client.query(
                        `UPDATE monthly_fee_slips mfs
                         SET student_id = $1, class_id = $2, is_family_slip = TRUE
                         WHERE mfs.slip_id = $3
                           AND NOT EXISTS (
                               SELECT 1 FROM monthly_fee_slips dup
                               WHERE dup.student_id = $1 AND dup.month = mfs.month AND dup.year = mfs.year AND dup.slip_id != mfs.slip_id
                           )`,
                        [activeLead.student_id, activeLead.class_id, existingSlip.slip_id]
                    );
                } else {
                    await client.query(`UPDATE monthly_fee_slips SET is_family_slip = TRUE WHERE slip_id = $1`, [existingSlip.slip_id]);
                }

                if (wasExistingSlipTuitionFree && !isCohortTrusted && tuitionItem) {
                    await client.query(
                        `UPDATE slip_line_items SET amount = 0, note = 'Cleared - Transitioned from Trusted to Mixed/Normal' WHERE item_id = $1`,
                        [tuitionItem.item_id]
                    );
                }

                if (supTuition > 0) {
                    await client.query(
                        `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                         VALUES ($1, $2, $3, $4, 0, $5)`,
                        [
                            existingSlip.slip_id,
                            tuitionItem?.head_id || null,
                            `Sibling Tuition Addition (${activatedNames})`,
                            supTuition,
                            isCohortTrusted ? 'Trusted Category - Free Tuition' : (payload.tuition_note || 'Mid-month sibling addition')
                        ]
                    );
                }

                for (const ph of planHeadItems) {
                    if (isTuitionHeadName(ph.head_name)) continue;
                    await client.query(
                        `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                         VALUES ($1, $2, $3, $4, 0, $5)`,
                        [existingSlip.slip_id, ph.head_id || null, `${ph.head_name} (${activatedNames})`, parseFloat(ph.amount), ph.note || 'Mid-month addition']
                    );
                }

                for (const eh of extraHeads) {
                    await client.query(
                        `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, note)
                         VALUES ($1, $2, $3, $4, 0, $5)`,
                        [existingSlip.slip_id, eh.head_id ? parseInt(eh.head_id, 10) : null, String(eh.head_name).trim(), parseFloat(eh.amount), eh.note ? String(eh.note).trim() : `Reactivation (${activatedNames})`]
                    );
                }

                let refreshedItems = (await client.query(`SELECT * FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC`, [existingSlip.slip_id])).rows;
                let preAdv = computeSlipTotalAndStatus({ lineItems: refreshedItems, paidAmount: curPaid, isTrusted: isCohortTrusted });
                const remAfterPaid = Math.max(0, preAdv.totalAmount - curPaid);

                if (applyAdvance && remAfterPaid > 0 && familyId) {
                    const advR = await client.query(`SELECT COALESCE(advance_balance, 0) AS adv FROM families WHERE family_id = $1 FOR UPDATE`, [familyId]);
                    const availableAdv = parseFloat(advR.rows[0]?.adv || 0);
                    if (availableAdv > 0) {
                        advanceDeducted = parseFloat(Math.min(availableAdv, remAfterPaid).toFixed(2));
                        if (advanceDeducted > 0) {
                            await client.query(`UPDATE families SET advance_balance = GREATEST(0, advance_balance - $1) WHERE family_id = $2`, [advanceDeducted, familyId]);
                            await client.query(
                                `INSERT INTO slip_line_items (slip_id, head_id, head_name, amount, paid_amount, is_carried_forward, note)
                                 VALUES ($1, NULL, 'Advance Fee Adjusted', $2, 0, FALSE, 'Adjusted from advance wallet on supplementary charge')`,
                                [existingSlip.slip_id, -advanceDeducted]
                            );
                            refreshedItems = (await client.query(`SELECT * FROM slip_line_items WHERE slip_id = $1 ORDER BY item_id ASC`, [existingSlip.slip_id])).rows;
                        }
                    }
                }

                const finalCalc = computeSlipTotalAndStatus({ lineItems: refreshedItems, paidAmount: curPaid, isTrusted: isCohortTrusted });
                const newNotes = existingSlip.notes
                    ? `${existingSlip.notes}; Supplement added on reactivation (${activatedNames})`
                    : `Supplement added on reactivation (${activatedNames})`;

                const upd = await client.query(
                    `UPDATE monthly_fee_slips
                     SET total_amount = $1,
                         status = $2,
                         is_printed = FALSE,
                         printed_at = NULL,
                         advance_adjusted = COALESCE(advance_adjusted, 0) + $3,
                         generation_source = 'batch+supplement',
                         notes = $4
                     WHERE slip_id = $5
                     RETURNING *`,
                    [finalCalc.totalAmount, finalCalc.status, advanceDeducted, newNotes, existingSlip.slip_id]
                );
                resultSlip = upd.rows[0];
            }
        }
    }

    return {
        success: true,
        billing_case: resolvedCase,
        activated_students: selectedIds,
        activated_names: activatedNames,
        lead_student: activeLead,
        family_id: familyId,
        month,
        year,
        is_trusted_after: isCohortTrusted,
        advance_adjusted: advanceDeducted,
        pending_adjustments_created: createdAdjustmentsCount,
        slip: resultSlip
    };
}

module.exports = {
    getReactivationPreview,
    executeStudentReactivation
};
