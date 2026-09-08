const express = require('express');
const router = express.Router();
const pool = require('../db');
const { createNotification } = require('../utils/notify');

// Helper to build strict audience-partitioned query conditions
function buildNotificationFilter(query) {
    const { user_id, family_id, student_id, role } = query;
    const normalizedRole = (role || '').trim().toLowerCase();
    const isFamilyTargeted = Boolean(family_id || student_id || ['student', 'parent'].includes(normalizedRole));

    let conditions = [];
    let params = [];
    let paramIdx = 1;

    if (isFamilyTargeted) {
        // ── Family Portal / Student View ──
        // Only fetch notifications addressed to this family, student, or broadcast to students/parents.
        // MUST NEVER return administration-only notices (e.g. exam approvals, staff attendance).
        let famSubConditions = [];
        if (family_id && String(family_id).trim()) {
            famSubConditions.push(`family_id = $${paramIdx++}`);
            params.push(String(family_id).trim());
        }
        if (student_id && !isNaN(parseInt(student_id, 10))) {
            famSubConditions.push(`student_id = $${paramIdx++}`);
            params.push(parseInt(student_id, 10));
        }
        if (famSubConditions.length === 0) {
            famSubConditions.push(`LOWER(role) IN ('student', 'parent')`);
        } else {
            famSubConditions.push(`(LOWER(role) IN ('student', 'parent') AND family_id IS NULL AND student_id IS NULL)`);
        }

        conditions.push(`(${famSubConditions.join(' OR ')}) AND (type NOT IN ('exam_approval', 'staff_attendance')) AND (LOWER(COALESCE(role, '')) NOT IN ('admin', 'principal', 'coordinator', 'vice_principal', 'teacher', 'staff', 'clerk', 'accountant'))`);
    } else {
        // ── Staff / Administration / Teacher View ──
        // Only fetch administrative or teacher alerts.
        // MUST NEVER return family-specific attendance arrivals, parent fee reminders, or student test marks.
        let staffSubConditions = [];

        if (user_id && !isNaN(parseInt(user_id, 10))) {
            staffSubConditions.push(`user_id = $${paramIdx++}`);
            params.push(parseInt(user_id, 10));
        }

        if (['admin', 'principal', 'coordinator', 'vice_principal', 'clerk', 'accountant', 'superadmin', 'root'].includes(normalizedRole)) {
            staffSubConditions.push(`(LOWER(role) IN ('admin', 'principal', 'coordinator', 'vice_principal', 'clerk', 'accountant', 'staff', 'all') AND family_id IS NULL AND student_id IS NULL)`);
        } else if (normalizedRole === 'teacher') {
            staffSubConditions.push(`(LOWER(role) IN ('teacher', 'all') AND family_id IS NULL AND student_id IS NULL)`);
        } else if (normalizedRole === 'staff') {
            staffSubConditions.push(`(LOWER(role) IN ('staff', 'all') AND family_id IS NULL AND student_id IS NULL)`);
        } else if (normalizedRole && normalizedRole !== 'all') {
            staffSubConditions.push(`(LOWER(role) = $${paramIdx++} AND family_id IS NULL AND student_id IS NULL)`);
            params.push(normalizedRole);
        } else {
            staffSubConditions.push(`(LOWER(role) IN ('admin', 'principal', 'all') AND family_id IS NULL AND student_id IS NULL)`);
        }

        conditions.push(`(${staffSubConditions.join(' OR ')}) AND (family_id IS NULL) AND (student_id IS NULL) AND (type NOT IN ('attendance', 'fee_reminder', 'fee_urgent', 'fee_payment', 'test_marks') OR user_id IS NOT NULL)`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    return { whereClause, params, paramIdx };
}

// GET /notifications - Fetch notifications with unread count
router.get('/', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const { whereClause, params, paramIdx } = buildNotificationFilter(req.query);

        const query = `
            SELECT * FROM notifications 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramIdx}
        `;
        const queryParams = [...params, parseInt(limit, 10)];

        const result = await pool.query(query, queryParams);

        const unreadCountRes = await pool.query(`
            SELECT COUNT(*) AS unread_count 
            FROM notifications 
            ${whereClause} AND is_read = FALSE
        `, params);

        const unreadCount = parseInt(unreadCountRes.rows[0]?.unread_count || '0', 10);

        res.json({
            notifications: result.rows,
            unread_count: unreadCount
        });
    } catch (err) {
        console.error("Error fetching notifications:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /notifications/:id/read - Mark single notification as read
router.put('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING *`,
            [id]
        );
        res.json({ notification: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /notifications/mark-all-read - Mark all as read for user/family/role
router.put('/mark-all-read', async (req, res) => {
    try {
        const { whereClause, params } = buildNotificationFilter(req.body);

        await pool.query(`UPDATE notifications SET is_read = TRUE ${whereClause}`, params);
        res.json({ message: "All notifications marked as read" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /notifications/:id - Delete single notification
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM notifications WHERE id = $1`, [id]);
        res.json({ message: "Notification deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /notifications/create - Manually create custom announcement
router.post('/create', async (req, res) => {
    try {
        const { userId, familyId, studentId, role, type = 'general', title, message, link } = req.body;
        const notification = await createNotification({
            userId, familyId, studentId, role, type, title, message, link
        });
        res.json({ notification });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
