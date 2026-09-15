const router = require('express').Router();
const pool = require('../db');

// Reuse getUserContext logic (simplified)
async function getUserContext(client, userId) {
    if (!userId) return null;
    
    const userRes = await client.query(
        `SELECT u.id, u.is_active, r.role_name, r.role_level
         FROM app_users u
         LEFT JOIN app_roles r ON r.id = u.role_id
         WHERE u.id = $1`,
        [userId]
    );

    if (userRes.rows.length === 0) return null;
    const user = userRes.rows[0];
    
    // Check if employee (teacher)
    const empRes = await client.query(
        `SELECT employee_id FROM employees WHERE app_user_id = $1`,
        [userId]
    );

    const roleLevel = user.role_level || 0;
    return {
        user,
        isAdmin: roleLevel >= 90,
        isSupervisor: roleLevel >= 65,
        isTeacher: roleLevel >= 50,
        employeeId: empRes.rows[0]?.employee_id || null
    };
}

// GET /classes - Filter based on current user (Admin vs Teacher)
router.get('/classes', async (req, res) => {
    try {
        const { user_id } = req.query;
        const ctx = await getUserContext(pool, user_id);
        
        if (!ctx) return res.status(401).json({ message: 'Unauthorized' });

        let query = `SELECT * FROM classes ORDER BY class_name ASC`;
        let params = [];

        // If not admin, check if employee and filter assignments
        if (!ctx.isAdmin && ctx.employeeId) {
            // Join with teacher_class_assignment to find assigned classes WHERE is_class_teacher = true
            query = `
                SELECT DISTINCT c.* 
                FROM classes c
                JOIN teacher_class_assignment tca ON tca.class_id = c.class_id
                WHERE tca.employee_id = $1 AND tca.is_class_teacher = true
                ORDER BY c.class_name ASC
            `;
            params = [ctx.employeeId];
        } else if (!ctx.isAdmin) {
             // If neither admin nor employee found (but user exists), technically access denied or show nothing
             // Unless 'Academic' permission allows viewing all classes?
             // For safety, show nothing if not admin and not assigned.
             // But maybe 'Accountant' needs access? 
             // Fee module usually requires Accountant access.
             // Accountant should see ALL classes.
             // So if role is NOT teacher, show all?
             // "teaches ka pass nahi hon ga... jo teacher jis class jiss section ko assign howa ha asko wohi classes show hon"
             // Implies: Teachers -> Restricted. Everyone else (Admin/Accountant) -> All?
             // Let's check role name.
             // If role is 'Teacher' (and not supervisor), restrict. Else show all.
            if (ctx.isTeacher && !ctx.isSupervisor) {
                return res.json([]); // No assignment found if logic reached here without employeeId
            }
             // Fallback for Accountant/Admin/Supervisor -> Show All
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// GET /sections
router.get('/sections', async (req, res) => {
    try {
        const { class_id, user_id } = req.query;
        if (!class_id) return res.status(400).send("Class ID required");

        const ctx = await getUserContext(pool, user_id);
        if (!ctx) return res.status(401).json({ message: 'Unauthorized' });

        let query = `SELECT * FROM sections WHERE class_id = $1 ORDER BY section_name ASC`;
        let params = [class_id];

        if (!ctx.isAdmin && ctx.employeeId && ctx.isTeacher && !ctx.isSupervisor) {
             query = `
                SELECT DISTINCT s.* 
                FROM sections s
                JOIN teacher_class_assignment tca ON tca.section_id = s.section_id
                WHERE s.class_id = $1 AND tca.employee_id = $2 AND tca.is_class_teacher = true
                ORDER BY s.section_name ASC
            `;
            params = [class_id, ctx.employeeId];
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// GET /collection-names - Get existing collection names for class/section
router.get('/collection-names', async (req, res) => {
    try {
        const { class_id, section_id, academic_year_id } = req.query;
        if (!class_id || !section_id) {
            return res.status(400).json({ message: 'Class and Section ID required' });
        }

        let yearId = academic_year_id;
        if (!yearId) {
            const activeYearRes = await pool.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            yearId = activeYearRes.rows[0]?.id;
        }

        let query = `
            SELECT DISTINCT collection_name
            FROM exam_fee_collections
            WHERE class_id = $1 AND section_id = $2
        `;
        const params = [class_id, section_id];
        if (yearId) {
            query += ` AND (academic_year_id = $3 OR academic_year_id IS NULL)`;
            params.push(yearId);
        }
        query += ` ORDER BY collection_name ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => r.collection_name));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /months - Return fee slip generated months that include an exam fee head for this class
router.get('/months', async (req, res) => {
    try {
        const { class_id, academic_year_id } = req.query;
        const classId = class_id ? parseInt(class_id, 10) : null;
        let yearId = academic_year_id ? parseInt(academic_year_id, 10) : null;

        if (!yearId) {
            const activeYearRes = await pool.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            yearId = activeYearRes.rows[0]?.id || null;
        }

        const MONTH_NAMES = [
            '', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        // 1. Query fee slips that contain exam fee heads (either in line items or fee_heads)
        // Note: For family slips, line items may have multiplied amounts (e.g. 300 * 9 = 2700).
        // We resolve the base per-student head amount using fee_plan_heads or individual slips (is_family_slip = false) or MIN(amount).
        const slipsQuery = `
            SELECT 
                m.month,
                m.year,
                m.academic_year_id,
                m.head_name,
                ROUND(
                    COALESCE(
                        (
                            SELECT fph.amount 
                            FROM fee_plan_heads fph
                            JOIN fee_plans fp ON fp.plan_id = fph.plan_id
                            JOIN fee_heads fh ON fh.head_id = fph.head_id
                            WHERE (fp.class_id = $1 OR fp.applies_to_all = TRUE)
                              AND (fh.head_name ILIKE m.head_name OR fh.head_type = 'exam' OR fh.head_name ILIKE '%exam%')
                              AND fp.is_active = TRUE
                            ORDER BY (fp.class_id = $1) DESC, fph.id DESC
                            LIMIT 1
                        ),
                        (
                            SELECT MIN(sli2.amount)
                            FROM monthly_fee_slips mfs2
                            JOIN slip_line_items sli2 ON sli2.slip_id = mfs2.slip_id
                            WHERE ($1::int IS NULL OR mfs2.class_id = $1)
                              AND (mfs2.month = m.month OR m.month = ANY(mfs2.months_list))
                              AND sli2.head_name = m.head_name
                              AND mfs2.is_family_slip = FALSE
                        ),
                        MIN(m.amount)
                    ), 2
                ) AS amount
            FROM (
                SELECT 
                    unnest(COALESCE(mfs.months_list, ARRAY[mfs.month])) AS month,
                    mfs.year,
                    mfs.academic_year_id,
                    sli.head_name,
                    sli.amount
                FROM monthly_fee_slips mfs
                JOIN slip_line_items sli ON sli.slip_id = mfs.slip_id
                LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
                WHERE (sli.head_name ILIKE '%exam%' OR fh.head_type = 'exam' OR sli.head_name ILIKE '%paper fund%')
                  AND ($1::int IS NULL OR mfs.class_id = $1)
                  AND ($2::int IS NULL OR mfs.academic_year_id = $2 OR mfs.academic_year_id IS NULL)
            ) m
            WHERE m.month BETWEEN 1 AND 12
            GROUP BY m.month, m.year, m.academic_year_id, m.head_name
            ORDER BY m.year DESC, m.month DESC, m.head_name ASC
        `;

        const slipsRes = await pool.query(slipsQuery, [classId, yearId]);

        // 2. Also retrieve any existing distinct collection names from exam_fee_collections for fallback/compatibility
        const existingQuery = `
            SELECT DISTINCT
                COALESCE(month, 0) AS month,
                COALESCE(year, 0) AS year,
                academic_year_id,
                collection_name,
                ROUND(MAX(amount), 2) AS amount
            FROM exam_fee_collections
            WHERE ($1::int IS NULL OR class_id = $1)
              AND ($2::int IS NULL OR academic_year_id = $2 OR academic_year_id IS NULL)
            GROUP BY month, year, academic_year_id, collection_name
            ORDER BY collection_name ASC
        `;
        const existingRes = await pool.query(existingQuery, [classId, yearId]);

        const map = new Map();

        // Populate from generated fee slips
        slipsRes.rows.forEach(r => {
            const m = parseInt(r.month, 10);
            const y = parseInt(r.year, 10);
            const mName = MONTH_NAMES[m] || `Month ${m}`;
            const headName = r.head_name || 'Exam Fee';
            const collectionName = `${mName} ${y} - ${headName}`;
            const key = `${m}-${y}-${headName.toLowerCase()}`;

            map.set(key, {
                key,
                month: m,
                year: y,
                month_name: mName,
                head_name: headName,
                amount: parseFloat(r.amount) || 0,
                collection_name: collectionName,
                label: `${mName} ${y} — ${headName} (Rs. ${parseFloat(r.amount) || 0})`,
                source: 'fee_slip'
            });
        });

        // Add any existing collection from exam_fee_collections that might not have a direct key match
        existingRes.rows.forEach(r => {
            const cName = r.collection_name;
            const existingKey = r.month && r.year ? `${r.month}-${r.year}-${cName.toLowerCase()}` : cName.toLowerCase();
            if (!map.has(existingKey)) {
                const m = parseInt(r.month, 10) || 0;
                const y = parseInt(r.year, 10) || 0;
                const mName = MONTH_NAMES[m] || '';
                map.set(existingKey, {
                    key: existingKey,
                    month: m,
                    year: y,
                    month_name: mName,
                    head_name: cName,
                    amount: parseFloat(r.amount) || 0,
                    collection_name: cName,
                    label: `${cName} (Rs. ${parseFloat(r.amount) || 0})`,
                    source: 'history'
                });
            }
        });

        const list = Array.from(map.values());
        res.json(list);
    } catch (err) {
        console.error("Error in GET /exam-fees/months:", err.message);
        res.status(500).json({ error: "Failed to fetch exam months" });
    }
});

// GET /students - Get students with payment status and source (Class vs Office)
router.get('/students', async (req, res) => {
    try {
        const { class_id, section_id, collection_name, month, year, academic_year_id } = req.query;
        if (!class_id) return res.status(400).json({ message: "Class ID required" });

        const classId = parseInt(class_id, 10);
        const sectionId = section_id ? parseInt(section_id, 10) : null;
        const targetMonth = month ? parseInt(month, 10) : null;
        const targetYear = year ? parseInt(year, 10) : null;
        const collectionStr = (collection_name || '').trim();

        let yearId = academic_year_id ? parseInt(academic_year_id, 10) : null;
        if (!yearId) {
            const activeYearRes = await pool.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            yearId = activeYearRes.rows[0]?.id || null;
        }

        // Query students with Lateral Joins to both exam_fee_collections (Class) and monthly_fee_slips (Office)
        const query = `
            SELECT 
                s.student_id, 
                s.admission_no,
                s.first_name, 
                s.last_name, 
                s.roll_no,
                s.family_id,
                
                -- Status computation: True if paid via Class or Office
                CASE 
                    WHEN efc.id IS NOT NULL THEN TRUE
                    WHEN off.slip_id IS NOT NULL THEN TRUE
                    ELSE FALSE
                END AS is_paid,

                -- Source of collection: 'Class' or 'Office'
                CASE 
                    WHEN efc.id IS NOT NULL THEN COALESCE(efc.collection_source, 'Class')
                    WHEN off.slip_id IS NOT NULL THEN 'Office'
                    ELSE NULL
                END AS collection_source,

                -- Amount
                CASE 
                    WHEN efc.id IS NOT NULL THEN efc.amount
                    WHEN off.slip_id IS NOT NULL THEN off.exam_amount
                    ELSE 0
                END AS paid_amount,

                -- Remarks
                CASE 
                    WHEN efc.id IS NOT NULL THEN efc.remarks
                    WHEN off.slip_id IS NOT NULL THEN 'Paid at Office (Fee Slip #' || off.slip_id || ')'
                    ELSE NULL
                END AS paid_remarks,

                -- Collection Date
                CASE 
                    WHEN efc.id IS NOT NULL THEN efc.collection_date
                    WHEN off.slip_id IS NOT NULL THEN off.paid_date
                    ELSE NULL
                END AS collection_date,

                efc.collector_name,

                -- Can modify: FALSE if paid anywhere (locked to avoid double-collection)
                CASE 
                    WHEN efc.id IS NOT NULL OR off.slip_id IS NOT NULL THEN FALSE
                    ELSE TRUE
                END AS can_modify

            FROM students s

            -- 1. Check Teacher / Class Collection from exam_fee_collections
            LEFT JOIN LATERAL (
                SELECT 
                    e.id, 
                    e.amount, 
                    e.remarks, 
                    e.collection_date, 
                    COALESCE(e.collection_source, 'Class') AS collection_source,
                    COALESCE(u.full_name, u.username) AS collector_name
                FROM exam_fee_collections e
                LEFT JOIN app_users u ON u.id = e.collected_by
                WHERE e.student_id = s.student_id
                  AND (
                      ($3::text != '' AND e.collection_name = $3)
                      OR ($4::int IS NOT NULL AND $5::int IS NOT NULL AND e.month = $4 AND e.year = $5)
                  )
                  AND ($6::int IS NULL OR e.academic_year_id = $6 OR e.academic_year_id IS NULL)
                ORDER BY e.id DESC
                LIMIT 1
            ) efc ON TRUE

            -- 2. Check Office Payment from monthly_fee_slips and slip_line_items
            LEFT JOIN LATERAL (
                SELECT 
                    mfs.slip_id,
                    sli.amount AS exam_amount,
                    COALESCE(mfs.generated_at::date, CURRENT_DATE) AS paid_date
                FROM monthly_fee_slips mfs
                JOIN slip_line_items sli ON sli.slip_id = mfs.slip_id
                LEFT JOIN fee_heads fh ON fh.head_id = sli.head_id
                WHERE (
                    mfs.student_id = s.student_id 
                    OR (mfs.is_family_slip = TRUE AND mfs.family_id IS NOT NULL AND mfs.family_id = s.family_id)
                )
                  AND (sli.head_name ILIKE '%exam%' OR fh.head_type = 'exam' OR sli.head_name ILIKE '%paper fund%')
                  AND (
                      $4::int IS NULL 
                      OR mfs.month = $4 
                      OR (mfs.has_multi_months = TRUE AND $4 = ANY(mfs.months_list))
                  )
                  AND (
                      $5::int IS NULL 
                      OR mfs.year = $5 
                      OR ($6::int IS NOT NULL AND mfs.academic_year_id = $6)
                  )
                  AND (
                      mfs.status IN ('paid', 'satteled')
                      OR sli.paid_amount >= sli.amount
                  )
                ORDER BY mfs.slip_id DESC
                LIMIT 1
            ) off ON TRUE

            WHERE s.class_id = $1
              AND ($2::int IS NULL OR s.section_id = $2)
              AND (s.status = 'Active' OR s.status IS NULL)
            ORDER BY 
                CASE WHEN s.roll_no ~ '^[0-9]+$' THEN CAST(s.roll_no AS INTEGER) ELSE 999999 END ASC,
                s.first_name ASC
        `;

        const params = [
            classId,
            sectionId,
            collectionStr,
            targetMonth,
            targetYear,
            yearId
        ];

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (err) {
        console.error("Error in GET /exam-fees/students:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// POST /collect - Save collection & dispatch real-time dual in-app and native mobile notifications
router.post('/collect', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, class_id, section_id, collection_name, month, year, students, academic_year_id } = req.body;
        // students: [{ student_id, amount, remarks }]

        if (!collection_name) return res.status(400).json({ message: "Collection Name required" });
        if (!students || students.length === 0) return res.json({ message: "No students to save" });

        const parsedMonth = month ? parseInt(month, 10) : null;
        const parsedYear = year ? parseInt(year, 10) : new Date().getFullYear();

        let yearId = academic_year_id;
        if (!yearId) {
            const activeYearRes = await client.query("SELECT id, is_active FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            if (activeYearRes.rows.length === 0) {
                return res.status(400).json({ message: "No active academic year found" });
            }
            yearId = activeYearRes.rows[0].id;
        } else {
            const yearCheck = await client.query("SELECT id, is_active FROM academic_years WHERE id = $1", [yearId]);
            if (yearCheck.rows.length > 0 && !yearCheck.rows[0].is_active) {
                return res.status(403).json({ message: "This academic session is closed. Exam fee collection is locked." });
            }
        }

        await client.query('BEGIN');

        let savedCount = 0;
        for (const st of students) {
            // 1. Look up matching fee slip if one exists
            const slipLookup = await client.query(`
                SELECT mfs.slip_id
                FROM monthly_fee_slips mfs
                JOIN students s ON (mfs.student_id = s.student_id OR (mfs.is_family_slip = TRUE AND mfs.family_id IS NOT NULL AND mfs.family_id = s.family_id))
                WHERE s.student_id = $1
                  AND ($2::int IS NULL OR mfs.month = $2 OR (mfs.has_multi_months = TRUE AND $2 = ANY(mfs.months_list)))
                  AND ($3::int IS NULL OR mfs.year = $3 OR ($4::int IS NOT NULL AND mfs.academic_year_id = $4))
                ORDER BY mfs.slip_id DESC
                LIMIT 1
            `, [st.student_id, parsedMonth, parsedYear, yearId]);

            const slipId = slipLookup.rows[0]?.slip_id || null;

            const resInsert = await client.query(`
                INSERT INTO exam_fee_collections 
                (collection_name, student_id, class_id, section_id, amount, remarks, collected_by, collection_date, academic_year_id, collection_source, month, year, fee_slip_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, 'Class', $9, $10, $11)
                ON CONFLICT (collection_name, student_id) DO UPDATE
                SET amount = EXCLUDED.amount,
                    remarks = EXCLUDED.remarks,
                    fee_slip_id = COALESCE(EXCLUDED.fee_slip_id, exam_fee_collections.fee_slip_id)
                RETURNING id
            `, [collection_name, st.student_id, class_id, section_id, st.amount, st.remarks, user_id, yearId, parsedMonth, parsedYear, slipId]);

            if (resInsert.rows.length > 0) {
                savedCount++;
            }
        }

        // Fetch collector and class details for notifications
        const collectorRes = await client.query(`
            SELECT COALESCE(u.full_name, u.username) AS name, r.role_name, e.first_name, e.last_name
            FROM app_users u
            LEFT JOIN app_roles r ON u.role_id = r.id
            LEFT JOIN employees e ON e.app_user_id = u.id
            WHERE u.id = $1
        `, [user_id]);
        
        const collectorName = collectorRes.rows[0]?.first_name 
            ? `${collectorRes.rows[0].first_name} ${collectorRes.rows[0].last_name || ''}`.trim() 
            : (collectorRes.rows[0]?.name || 'Class Teacher');

        const classRes = await client.query(`SELECT class_name FROM classes WHERE class_id = $1`, [class_id]);
        const secRes = section_id ? await client.query(`SELECT section_name FROM sections WHERE section_id = $1`, [section_id]) : { rows: [] };
        const className = classRes.rows[0]?.class_name || 'Class';
        const sectionName = secRes.rows[0]?.section_name || '';
        const classDisplay = `${className}${sectionName ? ' - ' + sectionName : ''}`;

        const totalCollectedAmount = students.reduce((acc, st) => acc + (parseFloat(st.amount) || 0), 0);
        const notifTitle = `Exam Fee Collected: ${classDisplay}`;
        const notifMessage = `${collectorName} collected Rs. ${totalCollectedAmount.toLocaleString()} from ${savedCount} student(s) for ${collection_name}.`;
        const notifLink = `/fees/exam-collection`;

        // Query target users for instant push/in-app notifications:
        // Coordinator, Vice Principal, Principal, Admin, Super Admin, Accountant
        const targetUsers = await client.query(`
            SELECT DISTINCT u.id, COALESCE(u.full_name, u.username) AS name, r.role_name
            FROM app_users u
            JOIN app_roles r ON u.role_id = r.id
            WHERE u.is_active = TRUE
              AND (
                  LOWER(r.role_name) LIKE '%principal%'
                  OR LOWER(r.role_name) LIKE '%coordinator%'
                  OR LOWER(r.role_name) LIKE '%admin%'
                  OR LOWER(r.role_name) LIKE '%accountant%'
                  OR r.role_level >= 70
                  OR EXISTS (
                      SELECT 1 FROM role_permissions rp 
                      WHERE rp.role_id = r.id 
                        AND rp.module_name IN ('fees.exam-collection', 'fees.collect', 'fees')
                        AND rp.can_read = TRUE
                  )
              )
        `);

        // Dispatch direct 1-to-1 notifications so user notification bell & native mobile push activate immediately
        for (const tu of targetUsers.rows) {
            if (tu.id !== parseInt(user_id, 10)) {
                await client.query(`
                    INSERT INTO notifications (user_id, role, type, title, message, link, is_read, created_at)
                    VALUES ($1, $2, 'fee_payment', $3, $4, $5, FALSE, NOW())
                `, [tu.id, tu.role_name, notifTitle, notifMessage, notifLink]);
            }
        }

        // Also add operational PBAC notice for fees module
        await client.query(`
            INSERT INTO notifications (role, required_permission, type, title, message, link, is_read, created_at)
            VALUES ('staff', 'fees.exam-collection', 'fee_payment', $1, $2, $3, FALSE, NOW())
        `, [notifTitle, notifMessage, notifLink]);

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            saved_count: savedCount,
            total_amount: totalCollectedAmount,
            message: `Exam fee collected for ${savedCount} student(s) (Total Rs. ${totalCollectedAmount.toLocaleString()}). Notifications dispatched to leadership.` 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error in POST /exam-fees/collect:", err.message);
        res.status(500).json({ error: err.message || "Server Error" });
    } finally {
        client.release();
    }
});

module.exports = router;


