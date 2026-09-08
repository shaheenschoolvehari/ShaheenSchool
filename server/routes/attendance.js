const express = require('express');
const router = express.Router();
const pool = require('../db');

function parseUserId(input) {
    const value = Number(input);
    return Number.isInteger(value) && value > 0 ? value : null;
}

async function getUserContext(client, userId) {
    const userRes = await client.query(
        `SELECT u.id, u.is_active, r.role_name, r.role_level
         FROM app_users u
         LEFT JOIN app_roles r ON r.id = u.role_id
         WHERE u.id = $1`,
        [userId]
    );

    if (userRes.rows.length === 0) {
        return { error: { status: 404, message: 'User not found' } };
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
        return { error: { status: 403, message: 'User is inactive' } };
    }

    // Role hierarchy: Admin(90+) can do anything, Supervisor(65+) can supervise/manage teachers
    const isAdmin = (user.role_level || 0) >= 90;
    const isSupervisor = (user.role_level || 0) >= 65;

    const empRes = await client.query(
        `SELECT employee_id
         FROM employees
         WHERE app_user_id = $1
         ORDER BY employee_id ASC
         LIMIT 1`,
        [userId]
    );

    return {
        user,
        isAdmin,
        isSupervisor,
        employeeId: empRes.rows[0]?.employee_id || null
    };
}

async function canTeacherAccessClassTeacher(client, employeeId, classId, sectionId) {
    if (!employeeId) return false;

    const accessRes = await client.query(
        `SELECT 1
         FROM teacher_class_assignment
         WHERE employee_id = $1
           AND class_id = $2
           AND section_id = $3
           AND is_class_teacher = TRUE
         UNION
         SELECT 1
         FROM attendance_coordinator_assignments
         WHERE employee_id = $1
           AND class_id = $2
           AND section_id = $3
         LIMIT 1`,
        [employeeId, classId, sectionId]
    );

    return accessRes.rows.length > 0;
}

// ═══════════════════════════════════════════════
//  STUDENT ATTENDANCE
// ═══════════════════════════════════════════════

// GET /attendance/students/daily?class_id=&date=
// Returns all students in a class with their attendance status for the given date
router.get('/students/daily', async (req, res) => {
    try {
        const { class_id, section_id, date, user_id } = req.query;
        if (!class_id || !section_id || !date) return res.status(400).json({ error: 'class_id, section_id and date required' });

        const userId = parseUserId(user_id);
        if (!userId) return res.status(400).json({ error: 'user_id is required' });

        const client = await pool.connect();
        try {
            const ctx = await getUserContext(client, userId);
            if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

            // Allow if: Admin OR Supervisor (Coordinator/Head/VP) OR Class Teacher
            if (!ctx.isAdmin && !ctx.isSupervisor) {
                const allowed = await canTeacherAccessClassTeacher(client, ctx.employeeId, Number(class_id), Number(section_id));
                if (!allowed) return res.status(403).json({ error: 'You are not the class teacher for this class/section' });
            }

            let sectionFilter = '';
            const params = [class_id, date];
            params.push(section_id);
            sectionFilter = `AND s.section_id = $3`;

            const result = await client.query(
                `SELECT s.student_id, s.first_name, s.last_name, s.admission_no, s.roll_no,
                        c.class_name, c.class_id,
                        sa.attendance_id, sa.status, sa.remarks, sa.attendance_date
                 FROM students s
                 LEFT JOIN classes c ON s.class_id = c.class_id
                 LEFT JOIN student_attendance sa ON sa.student_id = s.student_id AND sa.attendance_date = $2
                 WHERE s.class_id = $1 AND s.status = 'Active' ${sectionFilter}
                 ORDER BY s.roll_no NULLS LAST, s.first_name`,
                params
            );
            res.json(result.rows);
        } finally {
            client.release();
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /attendance/students/daily   upsert bulk attendance
// body: { class_id, date, records: [{student_id, status, remarks}] }
router.post('/students/daily', async (req, res) => {
    const client = await pool.connect();
    try {
        const { class_id, date, records, user_id } = req.body;
        const sectionId = records?.[0]?.section_id || req.body.section_id;
        if (!date || !records || !Array.isArray(records) || records.length === 0)
            return res.status(400).json({ error: 'date and records[] required' });
        if (!sectionId) return res.status(400).json({ error: 'section_id required' });

        const userId = parseUserId(user_id);
        if (!userId) return res.status(400).json({ error: 'user_id is required' });

        const ctx = await getUserContext(client, userId);
        if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

        // Allow if: Admin OR Supervisor (Coordinator/Head/VP) OR Class Teacher
        if (!ctx.isAdmin && !ctx.isSupervisor) {
            const firstStudentId = records[0]?.student_id;
            const studentRes = await client.query(
                `SELECT class_id, section_id FROM students WHERE student_id = $1`,
                [firstStudentId]
            );
            const studentRow = studentRes.rows[0];
            if (!studentRow) return res.status(400).json({ error: 'Invalid student records' });

            const allowed = await canTeacherAccessClassTeacher(client, ctx.employeeId, Number(class_id), Number(sectionId));
            if (!allowed || Number(studentRow.class_id) !== Number(class_id)) {
                return res.status(403).json({ error: 'You are not the class teacher for this class/section' });
            }
        }

        const studentIds = [...new Set(records.map(r => Number(r.student_id)).filter(v => Number.isInteger(v) && v > 0))];
        if (studentIds.length !== records.length) {
            return res.status(400).json({ error: 'Each attendance row must have a unique valid student_id' });
        }

        const validStudentsRes = await client.query(
            `SELECT student_id
             FROM students
             WHERE class_id = $1
               AND section_id = $2
               AND status = 'Active'
               AND student_id = ANY($3::int[])`,
            [class_id, sectionId, studentIds]
        );

        const validSet = new Set(validStudentsRes.rows.map(r => r.student_id));
        for (const studentId of studentIds) {
            if (!validSet.has(studentId)) {
                return res.status(400).json({ error: `Student ${studentId} does not belong to selected class/section or is not active` });
            }
        }

        await client.query('BEGIN');
        let saved = 0;
        for (const r of records) {
            await client.query(
                `INSERT INTO student_attendance (student_id, class_id, attendance_date, status, remarks)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (student_id, attendance_date)
                 DO UPDATE SET status=$4, remarks=$5, class_id=$2`,
                [r.student_id, class_id, date, r.status, r.remarks || null]
            );
            saved++;
        }
        await client.query('COMMIT');

        // Dispatch notifications for marked students to their family_ids
        try {
            const { createNotification } = require('../utils/notify');
            for (const r of records) {
                const sInfo = await pool.query(
                    `SELECT CONCAT(first_name, ' ', last_name) AS full_name, family_id FROM students WHERE student_id = $1`,
                    [r.student_id]
                );
                const sName = sInfo.rows[0]?.full_name || `Student #${r.student_id}`;
                const famId = sInfo.rows[0]?.family_id;
                const statusStr = (r.status || 'Present').toUpperCase();

                await createNotification({
                    familyId: famId,
                    studentId: r.student_id,
                    type: 'attendance',
                    title: `Attendance Update 📅`,
                    message: `${sName} was marked ${statusStr} for date ${date}.`,
                    link: `/students/profile/${r.student_id}`
                });
            }
        } catch (notifErr) {
            console.error("Attendance notification error:", notifErr.message);
        }

        res.json({ message: `${saved} attendance record(s) saved`, saved });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// GET /attendance/students/history?class_id=&month=&year=
// Returns attendance for entire class for a month
router.get('/students/history', async (req, res) => {
    try {
        const { class_id, month, year } = req.query;
        if (!class_id || !month || !year) return res.status(400).json({ error: 'class_id, month, year required' });

        // All active students in class
        const students = await pool.query(
            `SELECT s.student_id, s.first_name, s.last_name, s.roll_no, s.admission_no
             FROM students s WHERE s.class_id = $1 AND s.status = 'Active'
             ORDER BY s.roll_no NULLS LAST, s.first_name`,
            [class_id]
        );

        // All attendance records for this class in this month
        const attendance = await pool.query(
            `SELECT sa.student_id, sa.attendance_date, sa.status, sa.remarks
             FROM student_attendance sa
             WHERE sa.class_id = $1
               AND EXTRACT(MONTH FROM sa.attendance_date) = $2
               AND EXTRACT(YEAR FROM sa.attendance_date) = $3
             ORDER BY sa.attendance_date`,
            [class_id, month, year]
        );

        // Working days in that month (distinct dates that had any record)
        const datesResult = await pool.query(
            `SELECT DISTINCT attendance_date FROM student_attendance
             WHERE class_id = $1
               AND EXTRACT(MONTH FROM attendance_date) = $2
               AND EXTRACT(YEAR FROM attendance_date) = $3
             ORDER BY attendance_date`,
            [class_id, month, year]
        );
        const workingDates = datesResult.rows.map(r => r.attendance_date.toISOString().split('T')[0]);

        // Build per-student map
        const attMap = {};
        for (const a of attendance.rows) {
            const sid = a.student_id;
            const d = a.attendance_date.toISOString().split('T')[0];
            if (!attMap[sid]) attMap[sid] = {};
            attMap[sid][d] = a.status;
        }

        const rows = students.rows.map(s => {
            const rec = attMap[s.student_id] || {};
            const present = Object.values(rec).filter(v => v === 'Present').length;
            const late = Object.values(rec).filter(v => v === 'Late').length;
            const absent = Object.values(rec).filter(v => v === 'Absent').length;
            const leave = Object.values(rec).filter(v => v === 'Leave').length;
            return { ...s, daily: rec, present, late, absent, leave, total_days: workingDates.length };
        });

        res.json({ students: rows, working_dates: workingDates });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attendance/students/:student_id/history?month=&year=
// Individual student history (for profile page)
router.get('/students/:student_id/history', async (req, res) => {
    try {
        const { student_id } = req.params;
        const { month, year } = req.query;

        let whereExtra = '';
        const params = [student_id];
        if (month && year) {
            params.push(month, year);
            whereExtra = `AND EXTRACT(MONTH FROM sa.attendance_date) = $2 AND EXTRACT(YEAR FROM sa.attendance_date) = $3`;
        }

        const result = await pool.query(
            `SELECT sa.attendance_id, sa.attendance_date, sa.status, sa.remarks,
                    c.class_name
             FROM student_attendance sa
             LEFT JOIN classes c ON sa.class_id = c.class_id
             WHERE sa.student_id = $1 ${whereExtra}
             ORDER BY sa.attendance_date DESC`,
            params
        );

        const records = result.rows;
        const stats = {
            present: records.filter(r => r.status === 'Present').length,
            absent: records.filter(r => r.status === 'Absent').length,
            late: records.filter(r => r.status === 'Late').length,
            leave: records.filter(r => r.status === 'Leave').length,
            total: records.length,
        };
        res.json({ records, stats });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
//  STAFF ATTENDANCE
// ═══════════════════════════════════════════════

// GET /attendance/staff/daily?date=&department_id=
router.get('/staff/daily', async (req, res) => {
    try {
        const { date, department_id } = req.query;
        if (!date) return res.status(400).json({ error: 'date required' });

        let whereClause = 'WHERE e.status = $2';
        const params = [date, 'Active'];
        if (department_id) { params.push(department_id); whereClause += ` AND e.department_id = $${params.length}`; }

        const result = await pool.query(
            `SELECT e.employee_id, e.first_name, e.last_name, e.designation,
                    d.department_name,
                    sa.attendance_id, sa.status, sa.check_in_time, sa.check_out_time, sa.remarks, sa.attendance_date
             FROM employees e
             LEFT JOIN departments d ON e.department_id = d.department_id
             LEFT JOIN staff_attendance sa ON sa.employee_id = e.employee_id AND sa.attendance_date = $1
             ${whereClause}
             ORDER BY d.department_name NULLS LAST, e.first_name`,
            params
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /attendance/staff/daily
// body: { date, records: [{employee_id, status, check_in_time, check_out_time, remarks}] }
router.post('/staff/daily', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date, records } = req.body;
        if (!date || !records || !Array.isArray(records) || records.length === 0)
            return res.status(400).json({ error: 'date and records[] required' });

        await client.query('BEGIN');
        let saved = 0;
        for (const r of records) {
            await client.query(
                `INSERT INTO staff_attendance (employee_id, attendance_date, status, check_in_time, check_out_time, remarks)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (employee_id, attendance_date)
                 DO UPDATE SET status=$3, check_in_time=$4, check_out_time=$5, remarks=$6`,
                [r.employee_id, date, r.status, r.check_in_time || null, r.check_out_time || null, r.remarks || null]
            );
            saved++;
        }
        await client.query('COMMIT');
        res.json({ message: `${saved} staff attendance record(s) saved`, saved });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// GET /attendance/staff/history?month=&year=&department_id=
router.get('/staff/history', async (req, res) => {
    try {
        const { month, year, department_id } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        let empWhere = `WHERE e.status = 'Active'`;
        const empParams = [];
        if (department_id) { empParams.push(department_id); empWhere += ` AND e.department_id = $1`; }

        const employees = await pool.query(
            `SELECT e.employee_id, e.first_name, e.last_name, e.designation,
                    d.department_name
             FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
             ${empWhere}
             ORDER BY d.department_name NULLS LAST, e.first_name`,
            empParams
        );

        const attParams = [month, year];
        let attWhere = '';
        if (department_id) { attParams.push(department_id); attWhere = ` AND e.department_id = $3`; }

        const attendance = await pool.query(
            `SELECT sa.employee_id, sa.attendance_date, sa.status
             FROM staff_attendance sa
             JOIN employees e ON sa.employee_id = e.employee_id
             WHERE EXTRACT(MONTH FROM sa.attendance_date) = $1
               AND EXTRACT(YEAR FROM sa.attendance_date) = $2
               ${attWhere}
             ORDER BY sa.attendance_date`,
            attParams
        );

        const datesResult = await pool.query(
            `SELECT DISTINCT sa.attendance_date FROM staff_attendance sa
             JOIN employees e ON sa.employee_id = e.employee_id
             WHERE EXTRACT(MONTH FROM sa.attendance_date) = $1 AND EXTRACT(YEAR FROM sa.attendance_date) = $2
             ORDER BY sa.attendance_date`,
            [month, year]
        );
        const workingDates = datesResult.rows.map(r => r.attendance_date.toISOString().split('T')[0]);

        const attMap = {};
        for (const a of attendance.rows) {
            const eid = a.employee_id;
            const d = a.attendance_date.toISOString().split('T')[0];
            if (!attMap[eid]) attMap[eid] = {};
            attMap[eid][d] = a.status;
        }

        const rows = employees.rows.map(e => {
            const rec = attMap[e.employee_id] || {};
            const present = Object.values(rec).filter(v => v === 'Present').length;
            const late = Object.values(rec).filter(v => v === 'Late').length;
            const absent = Object.values(rec).filter(v => v === 'Absent').length;
            const leave = Object.values(rec).filter(v => v === 'Leave').length;
            return { ...e, daily: rec, present, late, absent, leave, total_days: workingDates.length };
        });

        res.json({ staff: rows, working_dates: workingDates });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attendance/staff/:employee_id/history?month=&year=
router.get('/staff/:employee_id/history', async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { month, year } = req.query;

        let whereExtra = '';
        const params = [employee_id];
        if (month && year) {
            params.push(month, year);
            whereExtra = `AND EXTRACT(MONTH FROM sa.attendance_date) = $2 AND EXTRACT(YEAR FROM sa.attendance_date) = $3`;
        }

        const result = await pool.query(
            `SELECT sa.attendance_id, sa.attendance_date, sa.status,
                    sa.check_in_time, sa.check_out_time, sa.remarks
             FROM staff_attendance sa
             WHERE sa.employee_id = $1 ${whereExtra}
             ORDER BY sa.attendance_date DESC`,
            params
        );

        const records = result.rows;
        const stats = {
            present: records.filter(r => r.status === 'Present').length,
            absent: records.filter(r => r.status === 'Absent').length,
            late: records.filter(r => r.status === 'Late').length,
            leave: records.filter(r => r.status === 'Leave').length,
            total: records.length,
        };
        res.json({ records, stats });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attendance/departments  helper for filter dropdown
router.get('/departments', async (req, res) => {
    try {
        const result = await pool.query('SELECT department_id, department_name FROM departments ORDER BY department_name');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attendance/settings - Retrieve staff & student attendance configurations
router.get('/settings', async (req, res) => {
    try {
        let setRes = await pool.query('SELECT * FROM attendance_settings WHERE id = 1');
        if (setRes.rows.length === 0) {
            await pool.query(`
                INSERT INTO attendance_settings (id, staff_in_time, staff_out_time, staff_grace_minutes)
                VALUES (1, '08:00', '14:00', 15)
                ON CONFLICT (id) DO NOTHING;
            `);
            setRes = await pool.query('SELECT * FROM attendance_settings WHERE id = 1');
        }

        const holidayCountRes = await pool.query('SELECT COUNT(*)::int as count FROM attendance_holidays');
        const coordCountRes = await pool.query('SELECT COUNT(DISTINCT employee_id)::int as count FROM attendance_coordinator_assignments');

        res.json({
            settings: setRes.rows[0],
            holidays_count: holidayCountRes.rows[0]?.count || 0,
            coordinators_count: coordCountRes.rows[0]?.count || 0
        });
    } catch (err) {
        console.error('Error fetching attendance settings:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /attendance/settings - Update staff & student attendance settings
router.put('/settings', async (req, res) => {
    try {
        const {
            staff_in_time,
            staff_out_time,
            staff_grace_minutes,
            staff_auto_absent_enabled,
            staff_notify_in_out,
            staff_notify_holidays,
            student_notify_parents,
            student_notify_holidays,
            student_auto_absent_enabled,
            family_notify_each_child,
            consecutive_absent_alert_days
        } = req.body;

        const updateRes = await pool.query(`
            UPDATE attendance_settings
            SET staff_in_time = COALESCE($1, staff_in_time),
                staff_out_time = COALESCE($2, staff_out_time),
                staff_grace_minutes = COALESCE($3, staff_grace_minutes),
                staff_auto_absent_enabled = COALESCE($4, staff_auto_absent_enabled),
                staff_notify_in_out = COALESCE($5, staff_notify_in_out),
                staff_notify_holidays = COALESCE($6, staff_notify_holidays),
                student_notify_parents = COALESCE($7, student_notify_parents),
                student_notify_holidays = COALESCE($8, student_notify_holidays),
                student_auto_absent_enabled = COALESCE($9, student_auto_absent_enabled),
                family_notify_each_child = COALESCE($10, family_notify_each_child),
                consecutive_absent_alert_days = COALESCE($11, consecutive_absent_alert_days),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
            RETURNING *;
        `, [
            staff_in_time || null,
            staff_out_time || null,
            staff_grace_minutes !== undefined ? Number(staff_grace_minutes) : null,
            staff_auto_absent_enabled !== undefined ? Boolean(staff_auto_absent_enabled) : null,
            staff_notify_in_out !== undefined ? Boolean(staff_notify_in_out) : null,
            staff_notify_holidays !== undefined ? Boolean(staff_notify_holidays) : null,
            student_notify_parents !== undefined ? Boolean(student_notify_parents) : null,
            student_notify_holidays !== undefined ? Boolean(student_notify_holidays) : null,
            student_auto_absent_enabled !== undefined ? Boolean(student_auto_absent_enabled) : null,
            family_notify_each_child !== undefined ? Boolean(family_notify_each_child) : null,
            consecutive_absent_alert_days !== undefined ? Number(consecutive_absent_alert_days) : null
        ]);

        res.json({ message: 'Attendance settings updated successfully', settings: updateRes.rows[0] });
    } catch (err) {
        console.error('Error updating attendance settings:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /attendance/holidays
router.get('/holidays', async (req, res) => {
    try {
        const { holiday_type } = req.query;
        let query = 'SELECT * FROM attendance_holidays';
        const params = [];
        if (holiday_type) {
            params.push(holiday_type);
            query += ' WHERE holiday_type = $1 OR holiday_type = \'staff_and_students\'';
        }
        query += ' ORDER BY start_date ASC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching holidays:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /attendance/holidays
router.post('/holidays', async (req, res) => {
    try {
        const { title, holiday_type, start_date, end_date, is_recurring_weekly, recurring_day_of_week, description, notify_broadcast } = req.body;
        if (!title || !start_date) {
            return res.status(400).json({ error: 'Title and start date are required' });
        }

        const endDateVal = end_date || start_date;
        const result = await pool.query(`
            INSERT INTO attendance_holidays (title, holiday_type, start_date, end_date, is_recurring_weekly, recurring_day_of_week, description)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `, [
            title.trim(),
            holiday_type || 'staff_and_students',
            start_date,
            endDateVal,
            Boolean(is_recurring_weekly),
            recurring_day_of_week !== undefined ? Number(recurring_day_of_week) : 0,
            description || null
        ]);

        const holiday = result.rows[0];

        if (notify_broadcast) {
            try {
                const { createNotification } = require('../utils/notify');
                const targetRole = holiday_type === 'staff_only' ? 'staff' : (holiday_type === 'students_only' ? 'student' : 'all');
                await createNotification({
                    role: targetRole,
                    type: 'general',
                    title: `School Holiday: ${title} 🏖️`,
                    message: `Official Notice: School will remain closed on ${start_date}${endDateVal !== start_date ? ` to ${endDateVal}` : ''} on account of ${title}. ${description || ''}`.trim(),
                    link: '/dashboard'
                });
            } catch (ne) {
                console.error("Holiday broadcast error:", ne.message);
            }
        }

        res.json({ message: 'Holiday created successfully', holiday });
    } catch (err) {
        console.error('Error creating holiday:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /attendance/holidays/:id
router.delete('/holidays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM attendance_holidays WHERE id = $1', [id]);
        res.json({ message: 'Holiday deleted successfully' });
    } catch (err) {
        console.error('Error deleting holiday:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════
//  COORDINATOR & TEACHER CLASS ASSIGNMENTS
// ═══════════════════════════════════════════════

// GET /attendance/coordinators - List staff and their attendance assigned classes/sections
router.get('/coordinators', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.employee_id, e.first_name, e.last_name, e.designation, e.email, e.phone,
                   d.department_name,
                   COALESCE(
                       json_agg(
                           DISTINCT jsonb_build_object(
                               'assignment_id', aca.id,
                               'class_id', aca.class_id,
                               'class_name', c.class_name,
                               'section_id', aca.section_id,
                               'section_name', s.section_name
                           )
                       ) FILTER (WHERE aca.id IS NOT NULL), '[]'
                   ) AS assigned_sections
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN attendance_coordinator_assignments aca ON e.employee_id = aca.employee_id
            LEFT JOIN classes c ON aca.class_id = c.class_id
            LEFT JOIN sections s ON aca.section_id = s.section_id
            WHERE e.status = 'Active'
            GROUP BY e.employee_id, d.department_name
            ORDER BY e.first_name ASC;
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('Error listing coordinators:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /attendance/coordinators/assign - Assign classes and sections to a coordinator/teacher
router.post('/coordinators/assign', async (req, res) => {
    const client = await pool.connect();
    try {
        const { employee_id, assignments } = req.body;
        const empId = parseUserId(employee_id);
        if (!empId) {
            return res.status(400).json({ error: 'Valid employee_id is required' });
        }

        await client.query('BEGIN');

        // Remove old assignments for this employee
        await client.query('DELETE FROM attendance_coordinator_assignments WHERE employee_id = $1', [empId]);

        let inserted = 0;
        if (Array.isArray(assignments) && assignments.length > 0) {
            for (const a of assignments) {
                const cId = parseUserId(a.class_id);
                const sId = parseUserId(a.section_id);
                if (cId && sId) {
                    await client.query(`
                        INSERT INTO attendance_coordinator_assignments (employee_id, class_id, section_id)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (employee_id, class_id, section_id) DO NOTHING;
                    `, [empId, cId, sId]);
                    inserted++;
                }
            }
        }

        await client.query('COMMIT');
        res.json({ message: `Successfully assigned ${inserted} section(s) to staff member`, assigned_count: inserted });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error assigning classes to coordinator:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET /attendance/my-classes?user_id=&employee_id= - Returns filtered classes/sections for user
router.get('/my-classes', async (req, res) => {
    try {
        const { user_id, employee_id } = req.query;
        const client = await pool.connect();
        try {
            const ctx = await getUserContext(client, user_id, employee_id);
            if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

            // If Admin or Supervisor with broad access, return all classes and sections
            if (ctx.isAdmin || ctx.isSupervisor) {
                const allClasses = await client.query('SELECT class_id, class_name FROM classes ORDER BY class_id ASC');
                const allSections = await client.query('SELECT section_id, section_name, class_id FROM sections ORDER BY class_id ASC, section_name ASC');
                return res.json({
                    is_restricted: false,
                    classes: allClasses.rows,
                    sections: allSections.rows
                });
            }

            if (!ctx.employeeId) {
                return res.json({ is_restricted: true, classes: [], sections: [] });
            }

            // Check Coordinator assignments + Class Teacher assignments + Subject Teacher assignments
            const assignedRes = await client.query(`
                WITH user_assignments AS (
                    SELECT aca.class_id, aca.section_id
                    FROM attendance_coordinator_assignments aca
                    WHERE aca.employee_id = $1

                    UNION

                    SELECT tca.class_id, COALESCE(tca.section_id, sec.section_id) as section_id
                    FROM teacher_class_assignment tca
                    LEFT JOIN sections sec ON tca.class_id = sec.class_id AND tca.section_id IS NULL
                    WHERE tca.employee_id = $1

                    UNION

                    SELECT sec.class_id, sec.section_id
                    FROM teacher_subject_assignment tsa
                    JOIN subjects sub ON tsa.subject_id = sub.subject_id
                    JOIN sections sec ON sub.section_id = sec.section_id
                    WHERE tsa.employee_id = $1
                )
                SELECT DISTINCT c.class_id, c.class_name, s.section_id, s.section_name
                FROM user_assignments ua
                JOIN classes c ON ua.class_id = c.class_id
                JOIN sections s ON ua.section_id = s.section_id
                ORDER BY c.class_id ASC, s.section_name ASC;
            `, [ctx.employeeId]);

            const classMap = new Map();
            const sectionsList = [];
            const seenSectionKeys = new Set();

            for (const row of assignedRes.rows) {
                if (!classMap.has(row.class_id)) {
                    classMap.set(row.class_id, { class_id: row.class_id, class_name: row.class_name });
                }
                const secKey = `${row.class_id}-${row.section_id}`;
                if (!seenSectionKeys.has(secKey)) {
                    seenSectionKeys.add(secKey);
                    sectionsList.push({
                        section_id: row.section_id,
                        section_name: row.section_name,
                        class_id: row.class_id
                    });
                }
            }

            res.json({
                is_restricted: true,
                classes: Array.from(classMap.values()),
                sections: sectionsList
            });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error fetching my classes:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
