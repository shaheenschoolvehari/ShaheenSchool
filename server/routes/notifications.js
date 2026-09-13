const express = require('express');
const router = express.Router();
const pool = require('../db');
const { createNotification } = require('../utils/notify');

// Helper to build strict audience-partitioned & permission-based query conditions
async function buildNotificationFilter(query) {
    const { user_id, family_id, student_id, role } = query;
    const normalizedRole = (role || '').trim().toLowerCase();
    const isFamilyTargeted = Boolean(family_id || student_id || ['student', 'parent'].includes(normalizedRole));

    let conditions = [];
    let params = [];
    let paramIdx = 1;

    if (isFamilyTargeted) {
        // ── Family Portal / Student View ──
        // Only fetch notifications addressed to this family, student, or broadcast to students/parents.
        // MUST NEVER return staff/operational notices (e.g. exam approvals, staff attendance, fee collection totals).
        let famSubConditions = [];
        if (family_id && String(family_id).trim()) {
            famSubConditions.push(`n.family_id = $${paramIdx++}`);
            params.push(String(family_id).trim());
        }
        if (student_id && !isNaN(parseInt(student_id, 10))) {
            famSubConditions.push(`n.student_id = $${paramIdx++}`);
            params.push(parseInt(student_id, 10));
        }
        if (famSubConditions.length === 0) {
            famSubConditions.push(`LOWER(COALESCE(n.role, '')) IN ('student', 'parent')`);
        } else {
            famSubConditions.push(`(LOWER(COALESCE(n.role, '')) IN ('student', 'parent') AND n.family_id IS NULL AND n.student_id IS NULL)`);
        }

        conditions.push(`(${famSubConditions.join(' OR ')})`);
        conditions.push(`(n.required_permission IS NULL)`);
        conditions.push(`(n.type NOT IN ('exam_approval', 'staff_attendance', 'admission', 'expense', 'fee_generation', 'student_status'))`);
    } else {
        // ── Staff / Administration / PBAC View ──
        // Deliver alerts based on:
        // 1. Direct user notices (user_id match)
        // 2. Staff public broadcasts (required_permission IS NULL, role is staff/all)
        // 3. Permission-gated operational notices (matching user's active permissions from role_permissions + user_direct_permissions)
        let staffSubConditions = [];

        const parsedUserId = user_id && !isNaN(parseInt(user_id, 10)) ? parseInt(user_id, 10) : null;
        let roleId = null;
        let roleLevel = 0;
        let userModules = new Set();
        let isSuperAdmin = false;

        if (parsedUserId) {
            // 1. Direct 1-to-1 alert to this specific user
            staffSubConditions.push(`n.user_id = $${paramIdx++}`);
            params.push(parsedUserId);

            // Fetch user's role and role level
            try {
                const userRes = await pool.query(`
                    SELECT u.id, u.role_id, r.role_name, COALESCE(r.role_level, 50) AS role_level
                    FROM app_users u
                    LEFT JOIN app_roles r ON u.role_id = r.id
                    WHERE u.id = $1
                `, [parsedUserId]);

                if (userRes.rows.length > 0) {
                    const uRow = userRes.rows[0];
                    roleId = uRow.role_id;
                    roleLevel = parseInt(uRow.role_level, 10) || 50;
                    const rName = (uRow.role_name || '').toLowerCase();
                    if (roleLevel >= 90 || ['admin', 'administrator', 'superadmin', 'root'].includes(rName)) {
                        isSuperAdmin = true;
                    }
                }
            } catch (e) {
                console.error("Error checking user role in buildNotificationFilter:", e.message);
            }
        } else if (normalizedRole) {
            try {
                const roleRes = await pool.query(`
                    SELECT id, role_name, COALESCE(role_level, 50) AS role_level
                    FROM app_roles
                    WHERE LOWER(role_name) = $1 OR LOWER(role_name) LIKE $2
                    LIMIT 1
                `, [normalizedRole, `%${normalizedRole}%`]);
                if (roleRes.rows.length > 0) {
                    roleId = roleRes.rows[0].id;
                    roleLevel = parseInt(roleRes.rows[0].role_level, 10) || 50;
                    const rName = (roleRes.rows[0].role_name || '').toLowerCase();
                    if (roleLevel >= 90 || ['admin', 'administrator', 'superadmin', 'root'].includes(rName)) {
                        isSuperAdmin = true;
                    }
                }
            } catch (e) {
                console.error("Error checking role in buildNotificationFilter:", e.message);
            }
        }

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

        // 2. Public staff broadcasts (no required permission, role is staff/all/admin)
        staffSubConditions.push(`(n.required_permission IS NULL AND n.family_id IS NULL AND n.student_id IS NULL AND (LOWER(COALESCE(n.role, 'all')) IN ('all', 'staff', 'teacher', 'admin')) AND n.user_id IS NULL)`);

        // 3. Permission-gated operational notifications
        if (isSuperAdmin) {
            // Superadmin has wildcard access to all operational staff notifications
            staffSubConditions.push(`(n.family_id IS NULL AND n.student_id IS NULL AND n.required_permission IS NOT NULL)`);
        } else if (userModules.size > 0) {
            const modulesArray = Array.from(userModules);
            const permParamIdx = paramIdx++;
            params.push(modulesArray);

            staffSubConditions.push(`(
                n.family_id IS NULL AND n.student_id IS NULL AND n.required_permission IS NOT NULL AND (
                    LOWER(n.required_permission) = ANY($${permParamIdx})
                    OR split_part(LOWER(n.required_permission), '.', 1) = ANY($${permParamIdx})
                    OR EXISTS (
                        SELECT 1 FROM unnest($${permParamIdx}::text[]) user_perm
                        WHERE LOWER(n.required_permission) LIKE (user_perm || '.%')
                    )
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

