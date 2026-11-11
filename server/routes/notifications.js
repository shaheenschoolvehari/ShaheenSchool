const express = require('express');
const router = express.Router();
const pool = require('../db');
const { createNotification } = require('../utils/notify');

// Helper to build strict audience-partitioned & permission-based query conditions
async function buildNotificationFilter(query) {
    const { user_id, family_id, student_id, role } = query;
    const normalizedRole = (role || '').trim().toLowerCase();
    const parsedUserId = user_id && !isNaN(parseInt(user_id, 10)) ? parseInt(user_id, 10) : null;

    let effectiveFamilyId = family_id ? String(family_id).trim() : null;
    let effectiveStudentId = student_id && !isNaN(parseInt(student_id, 10)) ? parseInt(student_id, 10) : null;

    // If user_id is provided and family_id or student_id are missing, auto-resolve from students table
    if (parsedUserId && (!effectiveFamilyId || !effectiveStudentId)) {
        try {
            const sRow = await pool.query(
                `SELECT student_id, family_id FROM students WHERE user_id = $1 LIMIT 1`,
                [parsedUserId]
            );
            if (sRow.rows.length > 0) {
                if (!effectiveFamilyId) effectiveFamilyId = sRow.rows[0].family_id;
                if (!effectiveStudentId) effectiveStudentId = sRow.rows[0].student_id;
            }
        } catch (e) {
            console.error("Error auto-resolving student/family in notifications:", e.message);
        }
    }

    const isFamilyTargeted = Boolean(effectiveFamilyId || effectiveStudentId || ['student', 'parent'].includes(normalizedRole));

    let conditions = [];
    let params = [];
    let paramIdx = 1;

    if (isFamilyTargeted) {
        // ── Family Portal / Student View ──
        // Only fetch notifications addressed to this family, student, or broadcast to students/parents.
        // MUST NEVER return staff/operational notices (e.g. exam approvals, staff attendance, fee collection totals).
        let famSubConditions = [];
        if (effectiveFamilyId) {
            famSubConditions.push(`n.family_id = $${paramIdx++}`);
            params.push(effectiveFamilyId);
        }
        if (effectiveStudentId) {
            famSubConditions.push(`n.student_id = $${paramIdx++}`);
            params.push(effectiveStudentId);
        }
        if (parsedUserId) {
            famSubConditions.push(`n.user_id = $${paramIdx++}`);
            params.push(parsedUserId);
        }
        // General circulars broadcast feature for students/parents is currently pending per user requirement
        // famSubConditions.push(`(LOWER(COALESCE(n.role, '')) IN ('student', 'parent', 'all') AND n.family_id IS NULL AND n.student_id IS NULL AND n.required_permission IS NULL)`);
        if (famSubConditions.length === 0) {
            famSubConditions.push('1 = 0');
        }

        conditions.push(`(${famSubConditions.join(' OR ')})`);
        conditions.push(`(n.required_permission IS NULL)`);
        conditions.push(`(n.type NOT IN ('exam_approval', 'staff_attendance', 'admission', 'expense', 'fee_generation', 'student_status', 'general'))`);
    } else {
        // ── Staff / Administration / PBAC View ──
        // SECURITY GUARD: Never leak staff or admin notifications if no valid user_id is present
        if (!parsedUserId) {
            conditions.push('1 = 0');
            return { whereClause: `WHERE ${conditions.join(' AND ')}`, params, paramIdx };
        }

        // Deliver alerts based on:
        // 1. Direct user notices (n.user_id = parsedUserId)
        // 2. General staff broadcasts (n.user_id IS NULL, n.required_permission IS NULL, safe role match)
        // 3. Permission-gated operational notices (n.user_id IS NULL, exact or root-module permission match)
        let staffSubConditions = [];

        let roleId = null;
        let roleLevel = 0;
        let dbRoleName = '';
        let userModules = new Set();
        let isSuperAdmin = false;
        let isActiveUser = false;

        // Fetch user's role, active status, and role level
        try {
            const userRes = await pool.query(`
                SELECT u.id, u.is_active, u.role_id, r.role_name, COALESCE(r.role_level, 50) AS role_level
                FROM app_users u
                LEFT JOIN app_roles r ON u.role_id = r.id
                WHERE u.id = $1
            `, [parsedUserId]);

            if (userRes.rows.length > 0 && userRes.rows[0].is_active) {
                const uRow = userRes.rows[0];
                isActiveUser = true;
                roleId = uRow.role_id;
                roleLevel = parseInt(uRow.role_level, 10) || 50;
                dbRoleName = (uRow.role_name || '').trim().toLowerCase();
                if (roleLevel >= 90 || ['admin', 'administrator', 'superadmin', 'root'].includes(dbRoleName)) {
                    isSuperAdmin = true;
                }
            }
        } catch (e) {
            console.error("Error checking user role in buildNotificationFilter:", e.message);
        }

        if (!isActiveUser) {
            conditions.push('1 = 0');
            return { whereClause: `WHERE ${conditions.join(' AND ')}`, params, paramIdx };
        }

        // 1. Direct 1-to-1 alert to this specific user
        staffSubConditions.push(`n.user_id = $${paramIdx++}`);
        params.push(parsedUserId);

        // Fetch active permissions for this role/user if not superadmin
        if (!isSuperAdmin && (roleId || parsedUserId)) {
            try {
                const permRes = await pool.query(`
                    SELECT DISTINCT LOWER(module_name) AS module_name
                    FROM (
                        SELECT module_name FROM role_permissions WHERE role_id = $1 AND can_read = TRUE
                        ${parsedUserId ? `UNION SELECT module_name FROM user_direct_permissions WHERE user_id = $2 AND can_read = TRUE` : ''}
                    ) perms
                `, parsedUserId ? [roleId, parsedUserId] : [roleId]);

                permRes.rows.forEach(r => {
                    if (r.module_name) userModules.add(r.module_name.trim().toLowerCase());
                });
            } catch (e) {
                console.error("Error fetching user active permissions:", e.message);
            }
        }

        // 2. Public/Role broadcasts (only when user_id IS NULL and required_permission IS NULL)
        // Strictly restrict 'admin', 'principal', 'vice_principal', 'coordinator' broadcasts from leaking to teachers!
        if (isSuperAdmin) {
            staffSubConditions.push(`(
                n.required_permission IS NULL
                AND n.family_id IS NULL
                AND n.student_id IS NULL
                AND n.user_id IS NULL
                AND LOWER(COALESCE(n.role, 'all')) IN ('all', 'staff', 'admin', 'administrator', 'superadmin', 'principal', 'vice_principal', 'vice principal', 'coordinator')
            )`);
        } else {
            const allowedBroadcastRoles = ['all', 'staff'];
            const normalizedRoleKey = dbRoleName.replace(/\s+/g, '_');
            if (dbRoleName && !['admin', 'administrator', 'superadmin', 'root', 'principal', 'vice_principal', 'vice principal'].includes(dbRoleName)) {
                allowedBroadcastRoles.push(dbRoleName);
                if (normalizedRoleKey !== dbRoleName) allowedBroadcastRoles.push(normalizedRoleKey);
            }
            const broadcastRolesIdx = paramIdx++;
            params.push(allowedBroadcastRoles);

            staffSubConditions.push(`(
                n.required_permission IS NULL
                AND n.family_id IS NULL
                AND n.student_id IS NULL
                AND n.user_id IS NULL
                AND LOWER(COALESCE(n.role, 'all')) = ANY($${broadcastRolesIdx}::text[])
                AND n.type NOT IN ('exam_approval', 'exam_published', 'test_marks')
            )`);
        }

        // 3. Permission-gated operational notifications (strictly when user_id IS NULL)
        if (isSuperAdmin) {
            // Superadmin has wildcard access to all operational staff notifications (never private 1-to-1 user_id alerts)
            staffSubConditions.push(`(
                n.family_id IS NULL
                AND n.student_id IS NULL
                AND n.user_id IS NULL
                AND n.required_permission IS NOT NULL
            )`);
        } else if (userModules.size > 0) {
            const modulesArray = Array.from(userModules);
            const permParamIdx = paramIdx++;
            params.push(modulesArray);

            // STRICT PBAC CHECK:
            // Match exact permission key OR top-level root module (e.g. 'fees' -> 'fees.collect').
            // Do NOT use `LIKE (user_perm || '.%')` so leaf permission 'academic.examination' never unlocks 'academic.examination.approvals'!
            staffSubConditions.push(`(
                n.family_id IS NULL
                AND n.student_id IS NULL
                AND n.user_id IS NULL
                AND n.required_permission IS NOT NULL
                AND (
                    LOWER(n.required_permission) = ANY($${permParamIdx})
                    OR split_part(LOWER(n.required_permission), '.', 1) = ANY($${permParamIdx})
                )
            )`);
        }

        conditions.push(`(${staffSubConditions.join(' OR ')})`);
        // Strictly partition out family-specific notices from staff view
        conditions.push(`n.family_id IS NULL`);
        conditions.push(`n.student_id IS NULL`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params, paramIdx };
}

// GET /notifications - Fetch notifications with unread count
router.get('/', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const { whereClause, params, paramIdx } = await buildNotificationFilter(req.query);

        const query = `
            SELECT n.* FROM notifications n
            ${whereClause}
            ORDER BY n.created_at DESC 
            LIMIT $${paramIdx}
        `;
        const queryParams = [...params, parseInt(limit, 10)];

        const result = await pool.query(query, queryParams);

        const unreadCountRes = await pool.query(`
            SELECT COUNT(*) AS unread_count 
            FROM notifications n
            ${whereClause} ${whereClause ? 'AND' : 'WHERE'} n.is_read = FALSE
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
        const { whereClause, params } = await buildNotificationFilter(req.body);

        // Update target notifications using subquery to match PBAC filter safely
        const updateQuery = `
            UPDATE notifications 
            SET is_read = TRUE 
            WHERE id IN (
                SELECT n.id FROM notifications n
                ${whereClause}
            )
        `;

        await pool.query(updateQuery, params);
        res.json({ message: "All notifications marked as read" });
    } catch (err) {
        console.error("Error marking notifications read:", err.message);
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
        const { userId, familyId, studentId, role, requiredPermission, type = 'general', title, message, link } = req.body;
        const notification = await createNotification({
            userId, familyId, studentId, role, requiredPermission, type, title, message, link
        });
        res.json({ notification });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

