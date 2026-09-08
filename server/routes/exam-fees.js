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

// GET /students - Get students with payment status for specific collection
router.get('/students', async (req, res) => {
    try {
        const { class_id, section_id, collection_name, academic_year_id } = req.query;
        if (!class_id || !section_id) return res.status(400).send("Class and Section ID required");

        let yearId = academic_year_id;
        if (!yearId) {
            const activeYearRes = await pool.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            yearId = activeYearRes.rows[0]?.id;
        }

        // Check if student has section_id
        const checkCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='students' AND column_name='section_id'");
        const hasSection = checkCols.rows.length > 0;

        let query = `
            SELECT 
                s.student_id, 
                s.first_name, 
                s.last_name, 
                s.roll_no,
                CASE WHEN efc.id IS NOT NULL THEN TRUE ELSE FALSE END as is_paid,
                efc.amount as paid_amount,
                efc.remarks as paid_remarks,
                efc.collection_date
            FROM students s
            LEFT JOIN exam_fee_collections efc 
                ON efc.student_id = s.student_id 
                AND efc.class_id = s.class_id 
                AND efc.section_id = $2
                AND efc.collection_name = $3
                ${yearId ? `AND (efc.academic_year_id = $4 OR efc.academic_year_id IS NULL)` : ''}
            WHERE s.class_id = $1
        `;

        if (hasSection) {
            query += ` AND s.section_id = $2`;
        }
        
        query += ` ORDER BY s.first_name ASC`;
        
        const params = [class_id, section_id, collection_name || ''];
        if (yearId) params.push(yearId);

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// POST /collect - Save collection
router.post('/collect', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, class_id, section_id, collection_name, students, academic_year_id } = req.body;
        // students: [{ student_id, amount, remarks }] (Only the ones to be saved/paid)

        if (!collection_name) return res.status(400).json({message: "Collection Name required"});
        if (!students || students.length === 0) return res.json({message: "No students to save"});

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

        for (const st of students) {
            // Insert. If exists, do nothing (already frozen).
            await client.query(`
                INSERT INTO exam_fee_collections 
                (collection_name, student_id, class_id, section_id, amount, remarks, collected_by, collection_date, academic_year_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8)
                ON CONFLICT (collection_name, student_id) DO NOTHING
            `, [collection_name, st.student_id, class_id, section_id, st.amount, st.remarks, user_id, yearId]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: "Collections saved successfully" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send("Server Error");
    } finally {
        client.release();
    }
});

module.exports = router;
