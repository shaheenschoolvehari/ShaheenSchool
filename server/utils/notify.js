const pool = require('../db');

/**
 * Creates and persists a new notification in the database with PBAC support.
 * 
 * @param {Object} payload
 * @param {number|null} payload.userId - Specific user ID (1-to-1 direct alert)
 * @param {string|null} payload.familyId - Specific family ID (notifies student/family unit)
 * @param {number|null} payload.studentId - Specific student ID
 * @param {string|null} payload.role - Target role/audience (e.g. 'staff', 'student', 'all')
 * @param {string|null} payload.requiredPermission - Permission key required to view this notification (e.g. 'fees.collect', 'students.admission', 'expenses.list', 'academic.examination.approvals')
 * @param {string} payload.type - Notification type ('fee_payment', 'attendance', 'exam_approval', 'test_marks', 'staff_attendance', 'admission', 'expense', 'fee_generation', 'general')
 * @param {string} payload.title - Short notification title
 * @param {string} payload.message - Notification message content
 * @param {string|null} payload.link - Optional target route link when clicked
 * @param {Object} [payload.clientOrPool] - Optional pg client or pool
 */
async function createNotification({
    userId = null,
    familyId = null,
    studentId = null,
    role = null,
    requiredPermission = null,
    type = 'general',
    title,
    message,
    link = null,
    clientOrPool = pool
}) {
    try {
        if (!title || !message) {
            console.error("⚠️ createNotification missing required title or message");
            return null;
        }

        const normalizedFamilyId = familyId ? String(familyId).trim() : null;
        const normalizedRole = role ? String(role).trim().toLowerCase() : null;
        const normalizedPerm = requiredPermission ? String(requiredPermission).trim().toLowerCase() : null;

        const res = await clientOrPool.query(
            `INSERT INTO notifications 
                (user_id, family_id, student_id, role, required_permission, type, title, message, link, is_read, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
             RETURNING *`,
            [userId, normalizedFamilyId, studentId, normalizedRole, normalizedPerm, type, title, message, link]
        );

        console.log(`🔔 Notification created [${type}]: ${title} -> (Perm: ${normalizedPerm || 'None'}, Family: ${normalizedFamilyId || 'N/A'}, Role: ${normalizedRole || 'N/A'}, User: ${userId || 'N/A'})`);
        return res.rows[0];
    } catch (err) {
        console.error("❌ Error creating notification:", err.message);
        return null;
    }
}

/**
 * Dispatches an operational notification to all staff authorized for a specific page/module permission.
 * Users with matching can_read permission (or parent module, or superadmin) will receive this alert.
 */
async function notifyPermission(requiredPermission, {
    type = 'general',
    title,
    message,
    link = null,
    fallbackRole = 'staff',
    clientOrPool = pool
}) {
    return createNotification({
        role: fallbackRole,
        requiredPermission,
        type,
        title,
        message,
        link,
        clientOrPool
    });
}

/**
 * Dispatches a direct 1-to-1 notification to a specific user.
 * (e.g. biometric check-in confirmation, teacher exam approval/rejection outcome, personal account alert)
 */
async function notifyUser(userId, {
    type = 'general',
    title,
    message,
    link = null,
    clientOrPool = pool
}) {
    return createNotification({
        userId,
        type,
        title,
        message,
        link,
        clientOrPool
    });
}

/**
 * Dispatches a notification to a specific family/student unit.
 * (e.g. fee payment receipt, monthly fee voucher ready, student absence alert, test marks)
 */
async function notifyFamily(familyId, {
    studentId = null,
    type = 'general',
    title,
    message,
    link = null,
    clientOrPool = pool
}) {
    return createNotification({
        familyId,
        studentId,
        role: 'student',
        type,
        title,
        message,
        link,
        clientOrPool
    });
}

/**
 * Dispatches a general circular/broadcast notification.
 */
async function notifyBroadcast({
    type = 'general',
    title,
    message,
    link = null,
    audience = 'all',
    clientOrPool = pool
}) {
    return createNotification({
        role: audience,
        requiredPermission: null,
        type,
        title,
        message,
        link,
        clientOrPool
    });
}

module.exports = {
    createNotification,
    notifyPermission,
    notifyUser,
    notifyFamily,
    notifyBroadcast
};

