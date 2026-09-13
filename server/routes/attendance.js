const express = require('express');
const router = express.Router();
const pool = require('../db');
const { computeBiometricSimilarity } = require('../utils/biometricMatch');

function parseUserId(input) {
    const value = Number(input);
    return Number.isInteger(value) && value > 0 ? value : null;
}

async function getUserContext(client, userId, employeeIdParam = null) {
    let empId = parseUserId(employeeIdParam);
    let user = null;
    let isAdmin = false;
    let isSupervisor = false;

    const parsedUid = parseUserId(userId);

    if (parsedUid) {
        const userRes = await client.query(
            `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.role_id,
                    r.role_name, r.role_level
             FROM app_users u
             LEFT JOIN app_roles r ON r.id = u.role_id
             WHERE u.id = $1`,
            [parsedUid]
        );

        if (userRes.rows.length > 0) {
            user = userRes.rows[0];
            if (!user.is_active) {
                return { error: { status: 403, message: 'User is inactive' } };
            }
            isAdmin = (user.role_level || 0) >= 90;
            isSupervisor = (user.role_level || 0) >= 65;

            // Find associated employee with fallback matching
            if (!empId) {
                const empRes = await client.query(
                    `SELECT employee_id
                     FROM employees
                     WHERE app_user_id = $1
                        OR (email IS NOT NULL AND email <> '' AND LOWER(email) = LOWER($2))
                        OR (employee_id = $1)
                        OR (LOWER(TRIM(first_name || ' ' || COALESCE(last_name, ''))) = LOWER(TRIM($3)))
                     ORDER BY 
                        CASE 
                            WHEN app_user_id = $1 THEN 1
                            WHEN email IS NOT NULL AND LOWER(email) = LOWER($2) THEN 2
                            WHEN employee_id = $1 THEN 3
                            ELSE 4
                        END ASC
                     LIMIT 1`,
                    [parsedUid, user.email || '', user.full_name || '']
                );
                if (empRes.rows.length > 0) {
                    empId = empRes.rows[0].employee_id;
                }
            }
        }
    }

    // If no app_user matched by userId, check if userId itself is an employee_id
    if (!user && parsedUid) {
        const directEmp = await client.query(
            `SELECT e.employee_id, e.app_user_id, e.first_name, e.last_name, e.email,
                    u.is_active, r.role_name, r.role_level
             FROM employees e
             LEFT JOIN app_users u ON e.app_user_id = u.id
             LEFT JOIN app_roles r ON u.role_id = r.id
             WHERE e.employee_id = $1`,
            [parsedUid]
        );
        if (directEmp.rows.length > 0) {
            const de = directEmp.rows[0];
            empId = de.employee_id;
            isAdmin = (de.role_level || 0) >= 90;
            isSupervisor = (de.role_level || 0) >= 65;
            user = {
                id: de.app_user_id || parsedUid,
                full_name: `${de.first_name || ''} ${de.last_name || ''}`.trim(),
                email: de.email,
                role_name: de.role_name || 'Staff',
                role_level: de.role_level || 0
            };
        }
    }

    // If only employeeIdParam was provided
    if (!user && empId) {
        const empOnly = await client.query(
            `SELECT e.employee_id, e.app_user_id, e.first_name, e.last_name, e.email,
                    u.is_active, r.role_name, r.role_level
             FROM employees e
             LEFT JOIN app_users u ON e.app_user_id = u.id
             LEFT JOIN app_roles r ON u.role_id = r.id
             WHERE e.employee_id = $1`,
            [empId]
        );
        if (empOnly.rows.length > 0) {
            const de = empOnly.rows[0];
            isAdmin = (de.role_level || 0) >= 90;
            isSupervisor = (de.role_level || 0) >= 65;
            user = {
                id: de.app_user_id || empId,
                full_name: `${de.first_name || ''} ${de.last_name || ''}`.trim(),
                email: de.email,
                role_name: de.role_name || 'Staff',
                role_level: de.role_level || 0
            };
        }
    }

    if (!user && !empId) {
        return { error: { status: 404, message: 'User or employee record not found' } };
    }

    return {
        user: user || { id: parsedUid || empId, role_name: 'Staff', role_level: 0 },
        isAdmin,
        isSupervisor,
        employeeId: empId
    };
}

async function canUserAccessClassAttendance(client, ctx, classId, sectionId) {
    if (ctx.isAdmin || ctx.isSupervisor) return true;
    if (!ctx.employeeId) return false;

    // 1. Check if assigned in coordinator assignments
    const coordRes = await client.query(
        `SELECT 1 FROM attendance_coordinator_assignments 
         WHERE employee_id = $1 AND class_id = $2 AND (section_id = $3 OR section_id IS NULL)
         LIMIT 1`,
        [ctx.employeeId, classId, sectionId]
    );
    if (coordRes.rows.length > 0) return true;

    // 2. Check if assigned in teacher_class_assignment (class teacher or assigned class)
    const ctRes = await client.query(
        `SELECT 1 FROM teacher_class_assignment
         WHERE employee_id = $1 AND class_id = $2 AND (section_id = $3 OR section_id IS NULL)
         LIMIT 1`,
        [ctx.employeeId, classId, sectionId]
    );
    if (ctRes.rows.length > 0) return true;

    // 3. Check if assigned via teacher_subject_assignment
    const tsaRes = await client.query(
        `SELECT 1 FROM teacher_subject_assignment tsa
         JOIN subjects sub ON tsa.subject_id = sub.subject_id
         WHERE tsa.employee_id = $1 AND (sub.section_id = $2 OR sub.section_id IS NULL)
         LIMIT 1`,
        [ctx.employeeId, sectionId]
    );
    return tsaRes.rows.length > 0;
}

async function checkHolidayForDate(db, dateStr, targetType = 'staff_and_students') {
    try {
        const res = await db.query(`
            SELECT id, title, holiday_type, start_date, end_date, description
            FROM attendance_holidays
            WHERE (
                ($1::date >= start_date AND $1::date <= end_date)
                OR (is_recurring_weekly = TRUE AND EXTRACT(DOW FROM $1::date) = recurring_day_of_week)
            )
            AND (holiday_type = $2 OR holiday_type = 'staff_and_students')
            ORDER BY id ASC
            LIMIT 1;
        `, [dateStr, targetType]);

        if (res.rows.length > 0) {
            const h = res.rows[0];
            return {
                is_holiday: true,
                id: h.id,
                title: h.title,
                holiday_type: h.holiday_type,
                start_date: h.start_date,
                end_date: h.end_date,
                description: h.description
            };
        }
        return null;
    } catch (e) {
        console.error('checkHolidayForDate error:', e.message);
        return null;
    }
}

// ═══════════════════════════════════════════════
//  ACADEMIC YEAR HELPERS FOR ATTENDANCE
// ═══════════════════════════════════════════════

function formatAcademicYearDates(ay) {
    if (!ay) return null;
    let sDate = null;
    let eDate = null;
    if (ay.start_date) {
        sDate = typeof ay.start_date === 'string' ? ay.start_date.split('T')[0] : ay.start_date.toISOString().split('T')[0];
    }
    if (ay.end_date) {
        eDate = typeof ay.end_date === 'string' ? ay.end_date.split('T')[0] : ay.end_date.toISOString().split('T')[0];
    }
    if (!sDate && ay.year_name) {
        const parts = String(ay.year_name).split('-');
        const startY = parseInt(parts[0], 10) || new Date().getFullYear();
        const endY = parts[1] ? (parseInt(parts[1], 10) || (startY + 1)) : (startY + 1);
        sDate = `${startY}-03-01`;
        eDate = `${endY}-02-28`;
    }
    return {
        id: ay.id,
        year_name: ay.year_name,
        is_active: Boolean(ay.is_active || ay.status === 'active'),
        status: ay.status || (ay.is_active ? 'active' : 'upcoming'),
        start_date: sDate,
        end_date: eDate
    };
}

async function getAcademicYearContext(clientOrPool, yearId = null) {
    let year = null;
    if (yearId && yearId !== 'active') {
        const res = await clientOrPool.query(
            "SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years WHERE id = $1",
            [yearId]
        );
        if (res.rows.length > 0) year = res.rows[0];
    }
    if (!year) {
        const res = await clientOrPool.query(
            "SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years WHERE is_active = TRUE OR status = 'active' ORDER BY id ASC LIMIT 1"
        );
        if (res.rows.length > 0) year = res.rows[0];
        else {
            const fallback = await clientOrPool.query(
                "SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC LIMIT 1"
            );
            year = fallback.rows[0] || null;
        }
    }
    return formatAcademicYearDates(year);
}

function getSessionMonths(startDateStr, endDateStr) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (!startDateStr || !endDateStr) {
        const curY = new Date().getFullYear();
        return monthNames.map((name, i) => ({
            month: String(i + 1).padStart(2, '0'),
            month_number: i + 1,
            month_name: name,
            year: String(curY),
            label: `${name} ${curY}`
        }));
    }
    const s = new Date(startDateStr + 'T00:00:00');
    const e = new Date(endDateStr + 'T00:00:00');
    
    const months = [];
    let cur = new Date(s.getFullYear(), s.getMonth(), 1);
    const end = new Date(e.getFullYear(), e.getMonth(), 1);

    while (cur <= end) {
        const mNum = cur.getMonth() + 1;
        const yNum = cur.getFullYear();
        months.push({
            month: String(mNum).padStart(2, '0'),
            month_number: mNum,
            month_name: monthNames[cur.getMonth()],
            year: String(yNum),
            label: `${monthNames[cur.getMonth()]} ${yNum}`
        });
        cur.setMonth(cur.getMonth() + 1);
    }
    return months.length > 0 ? months : monthNames.map((name, i) => ({
        month: String(i + 1).padStart(2, '0'),
        month_number: i + 1,
        month_name: name,
        year: String(new Date().getFullYear()),
        label: `${name} ${new Date().getFullYear()}`
    }));
}

// GET /attendance/academic-years
router.get('/academic-years', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC"
        );
        const formattedYears = result.rows.map(formatAcademicYearDates);
        const activeYear = formattedYears.find(r => r.is_active || r.status === 'active') || formattedYears[0] || null;
        const sessionMonths = activeYear ? getSessionMonths(activeYear.start_date, activeYear.end_date) : [];
        res.json({
            years: formattedYears,
            active_year: activeYear,
            session_months: sessionMonths
        });
    } catch (err) {
        console.error('attendance/academic-years error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════
//  STUDENT ATTENDANCE
// ═══════════════════════════════════════════════

// GET /attendance/students/daily?class_id=&date=&academic_year_id=
// Returns all students in a class with their attendance status for the given date and holiday info
router.get('/students/daily', async (req, res) => {
    try {
        const { class_id, section_id, date, user_id, employee_id, academic_year_id } = req.query;
        if (!class_id || !section_id || !date) return res.status(400).json({ error: 'class_id, section_id and date required' });

        const client = await pool.connect();
        try {
            const ctx = await getUserContext(client, user_id, employee_id);
            if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

            // Allow if: Admin OR Supervisor OR Coordinator OR Class Teacher
            if (!ctx.isAdmin && !ctx.isSupervisor) {
                const allowed = await canUserAccessClassAttendance(client, ctx, Number(class_id), Number(section_id));
                if (!allowed) return res.status(403).json({ error: 'You are not assigned to manage attendance for this class/section' });
            }

            let sectionFilter = '';
            const params = [class_id, date];
            params.push(section_id);
            sectionFilter = `AND s.section_id = $3`;

            const result = await client.query(
                `SELECT s.student_id, s.first_name, s.last_name, s.father_name, s.admission_no, s.roll_no,
                        c.class_name, c.class_id, sec.section_name, s.section_id,
                        sa.attendance_id, sa.status, sa.remarks, sa.attendance_date
                 FROM students s
                 LEFT JOIN classes c ON s.class_id = c.class_id
                 LEFT JOIN sections sec ON s.section_id = sec.section_id
                 LEFT JOIN student_attendance sa ON sa.student_id = s.student_id AND sa.attendance_date = $2
                 WHERE s.class_id = $1 AND s.status = 'Active' ${sectionFilter}
                 ORDER BY s.roll_no NULLS LAST, s.first_name`,
                params
            );

            const holidayInfo = await checkHolidayForDate(client, date, 'students_only');
            const targetYear = await getAcademicYearContext(client, academic_year_id);
            const sessionMonths = targetYear ? getSessionMonths(targetYear.start_date, targetYear.end_date) : [];

            res.json({
                records: result.rows,
                holiday: holidayInfo,
                active_year: targetYear,
                session_months: sessionMonths
            });
        } finally {
            client.release();
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /attendance/students/daily   upsert bulk attendance
// body: { class_id, date, records: [{student_id, status, remarks}], user_id, employee_id }
router.post('/students/daily', async (req, res) => {
    const client = await pool.connect();
    try {
        const { class_id, date, records, user_id, employee_id } = req.body;
        const sectionId = records?.[0]?.section_id || req.body.section_id;
        if (!date || !records || !Array.isArray(records) || records.length === 0)
            return res.status(400).json({ error: 'date and records[] required' });
        if (!sectionId) return res.status(400).json({ error: 'section_id required' });

        const ctx = await getUserContext(client, user_id, employee_id);
        if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

        // Allow if: Admin OR Supervisor OR Coordinator OR Class Teacher
        if (!ctx.isAdmin && !ctx.isSupervisor) {
            const firstStudentId = records[0]?.student_id;
            const studentRes = await client.query(
                `SELECT class_id, section_id FROM students WHERE student_id = $1`,
                [firstStudentId]
            );
            const studentRow = studentRes.rows[0];
            if (!studentRow) return res.status(400).json({ error: 'Invalid student records' });

            const allowed = await canUserAccessClassAttendance(client, ctx, Number(class_id), Number(sectionId));
            if (!allowed || Number(studentRow.class_id) !== Number(class_id)) {
                return res.status(403).json({ error: 'You are not assigned to manage attendance for this class/section' });
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

        // Dispatch personalized notifications for marked students to their parents/families
        try {
            const { createNotification } = require('../utils/notify');
            for (const r of records) {
                const sInfo = await pool.query(
                    `SELECT s.first_name, s.last_name, s.father_name, s.family_id,
                            c.class_name, sec.section_name
                     FROM students s
                     LEFT JOIN classes c ON s.class_id = c.class_id
                     LEFT JOIN sections sec ON s.section_id = sec.section_id
                     WHERE s.student_id = $1`,
                    [r.student_id]
                );

                const sRow = sInfo.rows[0];
                if (!sRow) continue;

                const sName = `${sRow.first_name || ''} ${sRow.last_name || ''}`.trim() || `Student #${r.student_id}`;
                const guardianName = sRow.father_name ? `Mr. ${sRow.father_name}` : 'Respected Parent/Guardian';
                const className = sRow.class_name || 'Class';
                const secName = sRow.section_name ? `(${sRow.section_name})` : '';
                const famId = sRow.family_id;
                const status = r.status || 'Present';

                let notifTitle = `Attendance: ${status}`;
                let notifMessage = `Dear ${guardianName}, your child ${sName} ${className} ${secName} is marked ${status} for ${date}.`;

                if (status === 'Absent') {
                    // Check for consecutive absents
                    const recentAtt = await pool.query(
                        `SELECT status FROM student_attendance 
                         WHERE student_id = $1 
                         ORDER BY attendance_date DESC 
                         LIMIT 3`,
                        [r.student_id]
                    );
                    const absentStreak = recentAtt.rows.filter(row => row.status === 'Absent').length;

                    if (absentStreak >= 3) {
                        notifTitle = `⚠️ Urgent: 3 Days Consecutive Absent Alert`;
                        notifMessage = `Dear ${guardianName}, your child ${sName} ${className} ${secName} has been absent for 3 consecutive days. Please contact the school administration immediately to provide a valid reason or medical certificate to avoid fines/disciplinary action.`;
                    } else {
                        notifTitle = `Attendance Notice: Absent ❌`;
                        notifMessage = `Dear ${guardianName}, your child ${sName} ${className} ${secName} is marked Absent today (${date}). Please inform the school regarding the reason for absence.`;
                    }
                } else if (status === 'Present') {
                    notifTitle = `Attendance Update: Present ✓`;
                    notifMessage = `Dear ${guardianName}, your child ${sName} ${className} ${secName} has arrived at school and is marked Present for ${date}.`;
                } else if (status === 'Leave') {
                    notifTitle = `Attendance Notice: On Leave ℹ️`;
                    notifMessage = `Dear ${guardianName}, your child ${sName} ${className} ${secName} is marked On Leave for ${date}.`;
                }

                await createNotification({
                    familyId: famId,
                    studentId: r.student_id,
                    role: 'student',
                    type: 'attendance',
                    title: notifTitle,
                    message: notifMessage,
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

// GET /attendance/students/history?class_id=&month=&year=&academic_year_id=
// Returns attendance for entire class for a month with holidays marked and academic year session metadata
router.get('/students/history', async (req, res) => {
    try {
        const { class_id, month, year, academic_year_id } = req.query;
        if (!class_id) return res.status(400).json({ error: 'class_id required' });

        const targetYear = await getAcademicYearContext(pool, academic_year_id);
        const allYearsRes = await pool.query("SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC");
        const availableYears = allYearsRes.rows.map(formatAcademicYearDates);
        const sessionMonths = targetYear ? getSessionMonths(targetYear.start_date, targetYear.end_date) : [];

        let targetMonth = month;
        let targetYearNum = year;
        if ((!targetMonth || !targetYearNum) && sessionMonths.length > 0) {
            const now = new Date();
            const nowM = String(now.getMonth() + 1).padStart(2, '0');
            const nowY = String(now.getFullYear());
            const matchedCurrent = sessionMonths.find(m => m.month === nowM && m.year === nowY);
            if (matchedCurrent) {
                targetMonth = matchedCurrent.month;
                targetYearNum = matchedCurrent.year;
            } else {
                targetMonth = sessionMonths[0].month;
                targetYearNum = sessionMonths[0].year;
            }
        }

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
            [class_id, targetMonth, targetYearNum]
        );

        // All student holidays in that month
        const holidaysRes = await pool.query(`
            SELECT id, title, start_date, end_date, is_recurring_weekly, recurring_day_of_week
            FROM attendance_holidays
            WHERE (holiday_type = 'students_only' OR holiday_type = 'staff_and_students')
        `);

        const holidayDateMap = {};
        const daysInMonth = new Date(Number(targetYearNum), Number(targetMonth), 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${targetYearNum}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dObj = new Date(dateStr);
            const dow = dObj.getDay();

            for (const h of holidaysRes.rows) {
                const sDate = typeof h.start_date === 'string' ? h.start_date : h.start_date.toISOString().split('T')[0];
                const eDate = typeof h.end_date === 'string' ? h.end_date : h.end_date.toISOString().split('T')[0];
                if ((dateStr >= sDate && dateStr <= eDate) || (h.is_recurring_weekly && h.recurring_day_of_week === dow)) {
                    holidayDateMap[dateStr] = h.title;
                    break;
                }
            }
        }

        // Distinct attendance dates from DB
        const datesResult = await pool.query(
            `SELECT DISTINCT attendance_date FROM student_attendance
             WHERE class_id = $1
               AND EXTRACT(MONTH FROM attendance_date) = $2
               AND EXTRACT(YEAR FROM attendance_date) = $3
             ORDER BY attendance_date`,
            [class_id, targetMonth, targetYearNum]
        );
        const recordedDates = datesResult.rows.map(r => r.attendance_date.toISOString().split('T')[0]);
        const allUniqueDates = Array.from(new Set([...recordedDates, ...Object.keys(holidayDateMap)])).sort();

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
            // Inject holiday if no attendance or if holiday
            for (const hDate of Object.keys(holidayDateMap)) {
                if (!rec[hDate]) {
                    rec[hDate] = 'Holiday';
                }
            }

            const present = Object.values(rec).filter(v => v === 'Present').length;
            const late = Object.values(rec).filter(v => v === 'Late').length;
            const absent = Object.values(rec).filter(v => v === 'Absent').length;
            const leave = Object.values(rec).filter(v => v === 'Leave').length;
            const holiday = Object.values(rec).filter(v => v === 'Holiday').length;
            return { ...s, daily: rec, present, late, absent, leave, holiday, total_days: allUniqueDates.length };
        });

        res.json({
            students: rows,
            working_dates: allUniqueDates,
            holidays: holidayDateMap,
            academic_year: targetYear,
            available_years: availableYears,
            session_months: sessionMonths,
            selected_month: targetMonth,
            selected_year: targetYearNum
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attendance/students/:student_id/history?month=&year=&academic_year_id=
// Individual student history (for profile page & student dashboard)
router.get('/students/:student_id/history', async (req, res) => {
    try {
        const { student_id } = req.params;
        const { month, year, academic_year_id } = req.query;

        const targetYear = await getAcademicYearContext(pool, academic_year_id);
        const allYearsRes = await pool.query("SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC");
        const availableYears = allYearsRes.rows.map(formatAcademicYearDates);
        const sessionMonths = targetYear ? getSessionMonths(targetYear.start_date, targetYear.end_date) : [];

        // 1. Compute Full Academic Year Stats (bounded by academic year start_date & end_date)
        let ayWhere = '';
        const ayParams = [student_id];
        if (targetYear?.start_date && targetYear?.end_date) {
            ayParams.push(targetYear.start_date, targetYear.end_date);
            ayWhere = `AND sa.attendance_date >= $2 AND sa.attendance_date <= $3`;
        }

        const ayRes = await pool.query(
            `SELECT sa.status
             FROM student_attendance sa
             WHERE sa.student_id = $1 ${ayWhere}`,
            ayParams
        );
        const ayRecords = ayRes.rows;
        const ayPresent = ayRecords.filter(r => r.status === 'Present').length;
        const ayLate = ayRecords.filter(r => r.status === 'Late').length;
        const ayAbsent = ayRecords.filter(r => r.status === 'Absent').length;
        const ayLeave = ayRecords.filter(r => r.status === 'Leave').length;
        const ayTotal = ayRecords.length;
        const ayPct = ayTotal > 0 ? Math.round(((ayPresent + ayLate) / ayTotal) * 100) : 0;

        const academicYearStats = {
            present: ayPresent,
            absent: ayAbsent,
            late: ayLate,
            leave: ayLeave,
            total: ayTotal,
            percentage: ayPct
        };

        // 2. Fetch specific records (filtered by month/year if provided, or full academic year if month === 'all' or omitted)
        let whereExtra = '';
        const params = [student_id];
        if (month && month !== 'all' && year) {
            params.push(month, year);
            whereExtra = `AND EXTRACT(MONTH FROM sa.attendance_date) = $2 AND EXTRACT(YEAR FROM sa.attendance_date) = $3`;
        } else if (targetYear?.start_date && targetYear?.end_date) {
            params.push(targetYear.start_date, targetYear.end_date);
            whereExtra = `AND sa.attendance_date >= $2 AND sa.attendance_date <= $3`;
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
            percentage: records.length > 0 ? Math.round(((records.filter(r => r.status === 'Present' || r.status === 'Late').length) / records.length) * 100) : 0
        };

        res.json({
            records,
            stats,
            academic_year_stats: academicYearStats,
            academic_year: targetYear,
            available_years: availableYears,
            session_months: sessionMonths
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper: Convert "HH:MM" or "HH:MM:SS" to minutes from midnight
function timeStringToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = String(timeStr).split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours * 60 + minutes;
}

// Helper: Get Current Time in Pakistan Timezone (Asia/Karachi - UTC+5) in "HH:MM:SS" (24-hour format)
function getPKTTimeString(d = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Karachi',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(d);
    } catch {
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const pktDate = new Date(utc + (3600000 * 5));
        return pktDate.toTimeString().split(' ')[0];
    }
}

// Helper: Get Current Date in Pakistan Timezone (Asia/Karachi) in "YYYY-MM-DD"
function getPKTDateString(d = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Karachi',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(d);
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const day = parts.find(p => p.type === 'day').value;
        return `${y}-${m}-${day}`;
    } catch {
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const pktDate = new Date(utc + (3600000 * 5));
        return pktDate.toISOString().split('T')[0];
    }
}

// ═══════════════════════════════════════════════
//  STAFF ATTENDANCE (IN / OUT & BIOMETRICS)
// ═══════════════════════════════════════════════

// GET /attendance/staff/daily?date=&department_id=&session_type=&academic_year_id=
router.get('/staff/daily', async (req, res) => {
    try {
        const { date, department_id, session_type = 'in', academic_year_id } = req.query;
        if (!date) return res.status(400).json({ error: 'date required' });

        let whereClause = 'WHERE e.status = $2';
        const params = [date, 'Active'];
        if (department_id) {
            params.push(department_id);
            whereClause += ` AND e.department_id = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT e.employee_id, e.first_name, e.last_name, e.designation, e.app_user_id,
                    d.department_name, d.department_id,
                    sa.attendance_id, sa.status, sa.check_in_time, sa.check_out_time, sa.remarks, sa.attendance_date,
                    sa.in_verified, sa.out_verified, sa.in_verification_mode, sa.out_verification_mode,
                    sa.is_in_late, sa.is_out_early,
                    (SELECT COUNT(*)::int FROM user_webauthn_credentials uwc WHERE uwc.user_id = e.app_user_id) as enrolled_biometrics_count
             FROM employees e
             LEFT JOIN departments d ON e.department_id = d.department_id
             LEFT JOIN staff_attendance sa ON sa.employee_id = e.employee_id AND sa.attendance_date = $1
             ${whereClause}
             ORDER BY d.department_name NULLS LAST, e.first_name`,
            params
        );

        // Fetch settings
        let setRes = await pool.query('SELECT * FROM attendance_settings WHERE id = 1');
        const settings = setRes.rows[0] || {
            staff_in_time: '08:00',
            staff_out_time: '14:00',
            staff_grace_minutes: 15,
            staff_biometric_mode: 'both'
        };

        const holidayInfo = await checkHolidayForDate(pool, date, 'staff_only');
        const targetYear = await getAcademicYearContext(pool, academic_year_id);
        const sessionMonths = targetYear ? getSessionMonths(targetYear.start_date, targetYear.end_date) : [];

        res.json({
            records: result.rows,
            settings,
            holiday: holidayInfo,
            session_type,
            active_year: targetYear,
            session_months: sessionMonths
        });
    } catch (err) {
        console.error('staff/daily error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /attendance/staff/verify-biometric
// Real-time single staff member biometric verification (Fingerprint / Retina / Facial scan)
router.post('/staff/verify-biometric', async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            employee_id,
            date,
            session_type = 'in',
            verification_mode = 'fingerprint',
            biometric_data,
            user_id,
            manual_override = false,
            status_override
        } = req.body;

        const empId = parseUserId(employee_id);
        if (!empId) return res.status(400).json({ error: 'Valid employee_id is required' });
        if (!date) return res.status(400).json({ error: 'date is required' });

        await client.query('BEGIN');

        // 1. Get employee info
        const empRes = await client.query(
            `SELECT employee_id, first_name, last_name, app_user_id, email, phone FROM employees WHERE employee_id = $1`,
            [empId]
        );
        if (empRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Employee not found' });
        }
        const emp = empRes.rows[0];

        // 2. Fetch settings
        const setRes = await client.query('SELECT * FROM attendance_settings WHERE id = 1');
        const settings = setRes.rows[0] || {
            staff_in_time: '08:00:00',
            staff_out_time: '14:00:00',
            staff_grace_minutes: 15,
            staff_biometric_mode: 'both'
        };

        // 3. Strict Biometric Verification NO ghost verification allowed
        // Applies to both retina_face and fingerprint modes when biometric_data is provided
        if (!manual_override && Array.isArray(biometric_data) && biometric_data.length > 0) {
            // 3a. Resolve the app_user_id for this employee
            let userTargetId = emp.app_user_id;
            if (!userTargetId && emp.email) {
                const uRes = await client.query(
                    `SELECT id FROM app_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
                    [emp.email]
                );
                userTargetId = uRes.rows[0]?.id || null;
            }

            // 3b. No linked app account → cannot verify biometrics → REJECT
            if (!userTargetId) {
                await client.query('ROLLBACK');
                return res.status(401).json({
                    success: false,
                    error: 'This employee does not have a linked system account. Biometric verification is not possible. Please contact the administrator.'
                });
            }

            // 3c. Determine credential_type to look up based on verification_mode
            const credType = (verification_mode === 'fingerprint') ? 'fingerprint' : 'retina_face';

            // 3d. Fetch enrolled biometric template from DB
            const credRes = await client.query(
                `SELECT public_key FROM user_webauthn_credentials
                 WHERE user_id = $1 AND credential_type = $2
                 ORDER BY id DESC LIMIT 1`,
                [userTargetId, credType]
            );

            // 3e. No enrolled template → cannot match → REJECT (prevents unregistered users from passing)
            if (credRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(401).json({
                    success: false,
                    error: `No ${credType === 'fingerprint' ? 'fingerprint' : 'facial / retina'} biometric template is enrolled for this employee. Please register biometrics first in the employee profile.`
                });
            }

            // 3f. Parse stored descriptor and compute similarity
            let storedDescriptor;
            try {
                storedDescriptor = JSON.parse(credRes.rows[0].public_key);
            } catch (parseErr) {
                await client.query('ROLLBACK');
                console.error('Biometric template parse error for user', userTargetId, parseErr.message);
                return res.status(500).json({
                    success: false,
                    error: 'Stored biometric template is corrupted. Please re-enroll biometrics for this employee.'
                });
            }

            // 3g. Ensure stored descriptor is a valid numeric array
            if (!Array.isArray(storedDescriptor) || storedDescriptor.length === 0) {
                await client.query('ROLLBACK');
                return res.status(401).json({
                    success: false,
                    error: 'Stored biometric template is invalid or empty. Please re-enroll biometrics.'
                });
            }

            // 3h. Compute similarity score
            const similarity = computeBiometricSimilarity(biometric_data, storedDescriptor);
            const THRESHOLD = 0.90; // 95% required for both fingerprint and retina_face strict, no exceptions

            console.log(`[Biometric] Employee ${empId} | Mode: ${credType} | Score: ${(similarity * 100).toFixed(2)}% | Threshold: ${(THRESHOLD * 100).toFixed(0)}%`);

            // 3i. Reject if below threshold
            if (similarity < THRESHOLD) {
                await client.query('ROLLBACK');
                return res.status(401).json({
                    success: false,
                    error: `${credType === 'fingerprint' ? 'Fingerprint' : 'Facial / Retina'} scan does not match enrolled profile. Match score: ${(similarity * 100).toFixed(1)}% (required: ${(THRESHOLD * 100).toFixed(0)}%). Verification failed.`
                });
            }

            // 3j. Verified log match confidence
            console.log(`[Biometric] ✅ Employee ${empId} verified successfully. Score: ${(similarity * 100).toFixed(2)}%`);
        }

        // 4. Time calculations in Pakistan Timezone (Asia/Karachi - UTC+5)
        const currentTimeStr = getPKTTimeString(); // e.g. "11:15:30" (PKT)
        const currentMins = timeStringToMinutes(currentTimeStr);
        const inLimitMins = timeStringToMinutes(settings.staff_in_time) + (settings.staff_grace_minutes || 0);
        const outLimitMins = timeStringToMinutes(settings.staff_out_time);

        const isInLate = session_type === 'in' ? (currentMins > inLimitMins) : false;
        const isOutEarly = session_type === 'out' ? (currentMins < outLimitMins) : false;

        let finalStatus = status_override || 'Present';
        if (!status_override && session_type === 'in' && isInLate) {
            finalStatus = 'Late';
        }

        let markedById = parseUserId(user_id);

        let savedRecord;
        if (session_type === 'in') {
            const insRes = await client.query(
                `INSERT INTO staff_attendance (
                    employee_id, attendance_date, status, check_in_time,
                    in_verified, in_verification_mode, is_in_late, in_marked_by, updated_at
                ) VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, CURRENT_TIMESTAMP)
                ON CONFLICT (employee_id, attendance_date)
                DO UPDATE SET 
                    status = CASE 
                        WHEN staff_attendance.status = 'Absent' THEN $3
                        WHEN staff_attendance.status = 'Leave' THEN $3
                        ELSE COALESCE($3, staff_attendance.status)
                    END,
                    check_in_time = COALESCE(staff_attendance.check_in_time, $4),
                    in_verified = TRUE,
                    in_verification_mode = $5,
                    is_in_late = $6,
                    in_marked_by = $7,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *`,
                [empId, date, finalStatus, currentTimeStr, verification_mode, isInLate, markedById]
            );
            savedRecord = insRes.rows[0];
        } else {
            const outRes = await client.query(
                `INSERT INTO staff_attendance (
                    employee_id, attendance_date, status, check_out_time,
                    out_verified, out_verification_mode, is_out_early, out_marked_by, updated_at
                ) VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, CURRENT_TIMESTAMP)
                ON CONFLICT (employee_id, attendance_date)
                DO UPDATE SET 
                    status = CASE 
                        WHEN staff_attendance.status = 'Absent' THEN $3
                        ELSE staff_attendance.status
                    END,
                    check_out_time = $4,
                    out_verified = TRUE,
                    out_verification_mode = $5,
                    is_out_early = $6,
                    out_marked_by = $7,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *`,
                [empId, date, finalStatus, currentTimeStr, verification_mode, isOutEarly, markedById]
            );
            savedRecord = outRes.rows[0];
        }

        await client.query('COMMIT');

        // Realtime notification dispatch
        try {
            const { notifyUser, notifyPermission } = require('../utils/notify');
            if (emp.app_user_id) {
                await notifyUser(emp.app_user_id, {
                    type: 'staff_attendance',
                    title: `Staff ${session_type.toUpperCase()} Attendance Verified`,
                    message: `${emp.first_name} ${emp.last_name || ''}, your ${session_type.toUpperCase()} attendance was recorded at ${currentTimeStr} (${savedRecord.status}${isInLate ? ' - Late Entry' : ''}${isOutEarly ? ' - Early Exit' : ''}).`,
                    link: '/attendance/staff'
                });
            }

            // If staff arrived late or exited early, notify supervisors with attendance.staff permission
            if (isInLate || isOutEarly) {
                await notifyPermission('attendance.staff', {
                    type: 'staff_attendance',
                    title: `Staff ${isInLate ? 'Late Arrival' : 'Early Exit'} Alert ⏰`,
                    message: `${emp.first_name} ${emp.last_name || ''} punched ${session_type.toUpperCase()} at ${currentTimeStr} (${isInLate ? 'Late Entry' : 'Early Exit'}).`,
                    link: '/attendance/staff/history'
                });
            }
        } catch (ne) {
            console.error('Notification error:', ne.message);
        }

        res.json({
            success: true,
            message: `Staff ${session_type.toUpperCase()} attendance verified & saved successfully`,
            record: savedRecord,
            time: currentTimeStr,
            is_in_late: isInLate,
            is_out_early: isOutEarly
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('verify-biometric error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// POST /attendance/staff/daily
// body: { date, records: [{employee_id, status, check_in_time, check_out_time, remarks, in_verified, out_verified}], session_type, user_id }
router.post('/staff/daily', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date, records, session_type = 'in', user_id } = req.body;
        if (!date || !records || !Array.isArray(records) || records.length === 0)
            return res.status(400).json({ error: 'date and records[] required' });

        const markedById = parseUserId(user_id);

        // Fetch settings for late/early calculations
        const setRes = await client.query('SELECT * FROM attendance_settings WHERE id = 1');
        const settings = setRes.rows[0] || {
            staff_in_time: '08:00:00',
            staff_out_time: '14:00:00',
            staff_grace_minutes: 15,
            staff_biometric_mode: 'both'
        };

        const currentTimeStr = getPKTTimeString(); // "HH:MM:SS" in Pakistan Timezone (Asia/Karachi)

        await client.query('BEGIN');
        let saved = 0;
        for (const r of records) {
            const empId = parseUserId(r.employee_id);
            if (!empId) continue;

            let status = r.status || 'Present';
            let checkIn = r.check_in_time || null;
            let checkOut = r.check_out_time || null;
            const remarks = r.remarks || null;
            const inVerified = r.in_verified === true;
            const outVerified = r.out_verified === true;

            // If session is IN and status is Present/Late, ensure checkIn time is set to actual time if missing
            if (session_type === 'in' && ['Present', 'Late'].includes(status) && !checkIn) {
                checkIn = currentTimeStr;
            }

            // If session is OUT and status is Present, ensure checkOut time is set to actual time if missing
            if (session_type === 'out' && ['Present'].includes(status) && !checkOut) {
                checkOut = currentTimeStr;
            }

            // Calculate is_in_late and is_out_early based on actual recorded times
            let isInLate = null;
            if (checkIn) {
                const checkInMins = timeStringToMinutes(checkIn);
                const inLimitMins = timeStringToMinutes(settings.staff_in_time) + (settings.staff_grace_minutes || 0);
                isInLate = checkInMins > inLimitMins;
                if (isInLate && status === 'Present') {
                    status = 'Late';
                }
            }

            let isOutEarly = null;
            if (checkOut) {
                const checkOutMins = timeStringToMinutes(checkOut);
                const outLimitMins = timeStringToMinutes(settings.staff_out_time);
                isOutEarly = checkOutMins < outLimitMins;
            }

            await client.query(
                `INSERT INTO staff_attendance (
                    employee_id, attendance_date, status, check_in_time, check_out_time, 
                    remarks, in_verified, out_verified, is_in_late, is_out_early, in_marked_by, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, 
                    $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
                )
                ON CONFLICT (employee_id, attendance_date)
                DO UPDATE SET 
                    status = $3, 
                    check_in_time = COALESCE($4, staff_attendance.check_in_time), 
                    check_out_time = COALESCE($5, staff_attendance.check_out_time), 
                    remarks = COALESCE($6, staff_attendance.remarks),
                    in_verified = CASE WHEN $7 = TRUE THEN TRUE ELSE staff_attendance.in_verified END,
                    out_verified = CASE WHEN $8 = TRUE THEN TRUE ELSE staff_attendance.out_verified END,
                    is_in_late = CASE WHEN $9::boolean IS NOT NULL THEN $9 ELSE staff_attendance.is_in_late END,
                    is_out_early = CASE WHEN $10::boolean IS NOT NULL THEN $10 ELSE staff_attendance.is_out_early END,
                    updated_at = CURRENT_TIMESTAMP`,
                [empId, date, status, checkIn, checkOut, remarks, inVerified, outVerified, isInLate, isOutEarly, markedById]
            );
            saved++;
        }
        await client.query('COMMIT');
        res.json({ message: `${saved} staff attendance record(s) saved`, saved });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('staff/daily save error:', err);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// GET /attendance/staff/history?month=&year=&department_id=&academic_year_id=
router.get('/staff/history', async (req, res) => {
    try {
        const { month, year, department_id, academic_year_id } = req.query;

        const targetYear = await getAcademicYearContext(pool, academic_year_id);
        const allYearsRes = await pool.query("SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC");
        const availableYears = allYearsRes.rows.map(formatAcademicYearDates);
        const sessionMonths = targetYear ? getSessionMonths(targetYear.start_date, targetYear.end_date) : [];

        let targetMonth = month;
        let targetYearNum = year;
        if ((!targetMonth || !targetYearNum) && sessionMonths.length > 0) {
            const now = new Date();
            const nowM = String(now.getMonth() + 1).padStart(2, '0');
            const nowY = String(now.getFullYear());
            const matchedCurrent = sessionMonths.find(m => m.month === nowM && m.year === nowY);
            if (matchedCurrent) {
                targetMonth = matchedCurrent.month;
                targetYearNum = matchedCurrent.year;
            } else {
                targetMonth = sessionMonths[0].month;
                targetYearNum = sessionMonths[0].year;
            }
        }

        if (!targetMonth || !targetYearNum) return res.status(400).json({ error: 'month and year required' });

        let empWhere = `WHERE e.status = 'Active'`;
        const empParams = [];
        if (department_id) { empParams.push(department_id); empWhere += ` AND e.department_id = $1`; }

        const employees = await pool.query(
            `SELECT e.employee_id, e.first_name, e.last_name, e.designation,
                    d.department_name, d.department_id
             FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
             ${empWhere}
             ORDER BY d.department_name NULLS LAST, e.first_name`,
            empParams
        );

        const attParams = [targetMonth, targetYearNum];
        let attWhere = '';
        if (department_id) { attParams.push(department_id); attWhere = ` AND e.department_id = $3`; }

        const attendance = await pool.query(
            `SELECT sa.employee_id, sa.attendance_date, sa.status,
                    sa.check_in_time, sa.check_out_time, sa.remarks,
                    sa.in_verified, sa.out_verified, sa.is_in_late, sa.is_out_early
             FROM staff_attendance sa
             JOIN employees e ON sa.employee_id = e.employee_id
             WHERE EXTRACT(MONTH FROM sa.attendance_date) = $1
               AND EXTRACT(YEAR FROM sa.attendance_date) = $2
               ${attWhere}
             ORDER BY sa.attendance_date`,
            attParams
        );

        // Fetch settings for late/early reference
        const setRes = await pool.query('SELECT * FROM attendance_settings WHERE id = 1');
        const settings = setRes.rows[0] || {
            staff_in_time: '08:00',
            staff_out_time: '14:00',
            staff_grace_minutes: 15
        };

        // All staff holidays in that month
        const holidaysRes = await pool.query(`
            SELECT id, title, start_date, end_date, is_recurring_weekly, recurring_day_of_week
            FROM attendance_holidays
            WHERE (holiday_type = 'staff_only' OR holiday_type = 'staff_and_students')
        `);

        const holidayDateMap = {};
        const daysInMonth = new Date(Number(targetYearNum), Number(targetMonth), 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${targetYearNum}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dObj = new Date(dateStr);
            const dow = dObj.getDay();

            for (const h of holidaysRes.rows) {
                const sDate = typeof h.start_date === 'string' ? h.start_date : h.start_date.toISOString().split('T')[0];
                const eDate = typeof h.end_date === 'string' ? h.end_date : h.end_date.toISOString().split('T')[0];
                if ((dateStr >= sDate && dateStr <= eDate) || (h.is_recurring_weekly && h.recurring_day_of_week === dow)) {
                    holidayDateMap[dateStr] = h.title;
                    break;
                }
            }
        }

        const datesResult = await pool.query(
            `SELECT DISTINCT sa.attendance_date FROM staff_attendance sa
             JOIN employees e ON sa.employee_id = e.employee_id
             WHERE EXTRACT(MONTH FROM sa.attendance_date) = $1 AND EXTRACT(YEAR FROM sa.attendance_date) = $2
             ORDER BY sa.attendance_date`,
            [targetMonth, targetYearNum]
        );
        const recordedDates = datesResult.rows.map(r => r.attendance_date.toISOString().split('T')[0]);
        const allUniqueDates = Array.from(new Set([...recordedDates, ...Object.keys(holidayDateMap)])).sort();

        const attMap = {};
        for (const a of attendance.rows) {
            const eid = a.employee_id;
            const d = a.attendance_date.toISOString().split('T')[0];
            if (!attMap[eid]) attMap[eid] = {};
            attMap[eid][d] = {
                status: a.status,
                check_in_time: a.check_in_time,
                check_out_time: a.check_out_time,
                in_verified: a.in_verified,
                out_verified: a.out_verified,
                is_in_late: a.is_in_late,
                is_out_early: a.is_out_early,
                remarks: a.remarks
            };
        }

        const rows = employees.rows.map(e => {
            const rec = attMap[e.employee_id] || {};
            // Inject holiday if no attendance or if holiday
            for (const hDate of Object.keys(holidayDateMap)) {
                if (!rec[hDate]) {
                    rec[hDate] = {
                        status: 'Holiday',
                        check_in_time: null,
                        check_out_time: null,
                        holiday_name: holidayDateMap[hDate]
                    };
                }
            }

            const recValues = Object.values(rec);
            const present = recValues.filter(v => v.status === 'Present').length;
            const late_in = recValues.filter(v => v.is_in_late || v.status === 'Late').length;
            const early_out = recValues.filter(v => v.is_out_early).length;
            const absent = recValues.filter(v => v.status === 'Absent').length;
            const leave = recValues.filter(v => v.status === 'Leave').length;
            const holiday = recValues.filter(v => v.status === 'Holiday').length;
            return {
                ...e,
                daily: rec,
                present,
                late_in,
                early_out,
                absent,
                leave,
                holiday,
                total_days: allUniqueDates.length
            };
        });

        res.json({
            staff: rows,
            working_dates: allUniqueDates,
            holidays: holidayDateMap,
            settings,
            academic_year: targetYear,
            available_years: availableYears,
            session_months: sessionMonths,
            selected_month: targetMonth,
            selected_year: targetYearNum
        });
    } catch (err) {
        console.error('staff/history error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /attendance/staff/:employee_id/history?month=&year=&academic_year_id=
router.get('/staff/:employee_id/history', async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { month, year, academic_year_id } = req.query;

        const targetYear = await getAcademicYearContext(pool, academic_year_id);
        const allYearsRes = await pool.query("SELECT id, year_name, is_active, status, start_date, end_date FROM academic_years ORDER BY id DESC");
        const availableYears = allYearsRes.rows.map(formatAcademicYearDates);
        const sessionMonths = targetYear ? getSessionMonths(targetYear.start_date, targetYear.end_date) : [];

        // 1. Full Academic Year Stats (bounded by academic year start_date & end_date)
        let ayWhere = '';
        const ayParams = [employee_id];
        if (targetYear?.start_date && targetYear?.end_date) {
            ayParams.push(targetYear.start_date, targetYear.end_date);
            ayWhere = `AND sa.attendance_date >= $2 AND sa.attendance_date <= $3`;
        }

        const ayRes = await pool.query(
            `SELECT sa.status, sa.is_in_late, sa.is_out_early
             FROM staff_attendance sa
             WHERE sa.employee_id = $1 ${ayWhere}`,
            ayParams
        );
        const ayRecords = ayRes.rows;
        const ayPresent = ayRecords.filter(r => r.status === 'Present').length;
        const ayAbsent = ayRecords.filter(r => r.status === 'Absent').length;
        const ayLateIn = ayRecords.filter(r => r.is_in_late || r.status === 'Late').length;
        const ayEarlyOut = ayRecords.filter(r => r.is_out_early).length;
        const ayLeave = ayRecords.filter(r => r.status === 'Leave').length;
        const ayTotal = ayRecords.length;
        const ayPct = ayTotal > 0 ? Math.round((ayPresent / ayTotal) * 100) : 0;

        const academicYearStats = {
            present: ayPresent,
            absent: ayAbsent,
            late_in: ayLateIn,
            early_out: ayEarlyOut,
            leave: ayLeave,
            total: ayTotal,
            percentage: ayPct
        };

        // 2. Filtered records (by month/year if given, or full academic year)
        let whereExtra = '';
        const params = [employee_id];
        if (month && month !== 'all' && year) {
            params.push(month, year);
            whereExtra = `AND EXTRACT(MONTH FROM sa.attendance_date) = $2 AND EXTRACT(YEAR FROM sa.attendance_date) = $3`;
        } else if (targetYear?.start_date && targetYear?.end_date) {
            params.push(targetYear.start_date, targetYear.end_date);
            whereExtra = `AND sa.attendance_date >= $2 AND sa.attendance_date <= $3`;
        }

        const result = await pool.query(
            `SELECT sa.attendance_id, sa.attendance_date, sa.status,
                    sa.check_in_time, sa.check_out_time, sa.remarks,
                    sa.in_verified, sa.out_verified, sa.is_in_late, sa.is_out_early
             FROM staff_attendance sa
             WHERE sa.employee_id = $1 ${whereExtra}
             ORDER BY sa.attendance_date DESC`,
            params
        );

        const records = result.rows;
        const stats = {
            present: records.filter(r => r.status === 'Present').length,
            absent: records.filter(r => r.status === 'Absent').length,
            late_in: records.filter(r => r.is_in_late || r.status === 'Late').length,
            early_out: records.filter(r => r.is_out_early).length,
            leave: records.filter(r => r.status === 'Leave').length,
            total: records.length,
            percentage: records.length > 0 ? Math.round(((records.filter(r => r.status === 'Present').length) / records.length) * 100) : 0
        };

        res.json({
            records,
            stats,
            academic_year_stats: academicYearStats,
            academic_year: targetYear,
            available_years: availableYears,
            session_months: sessionMonths
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attendance/departments  helper for filter dropdown
router.get('/departments', async (req, res) => {
    try {
        const result = await pool.query('SELECT department_id, department_name FROM departments ORDER BY department_name');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
//  ATTENDANCE SETTINGS & POLICIES
// ═══════════════════════════════════════════════

// GET /attendance/settings - Get staff & student attendance settings
router.get('/settings', async (req, res) => {
    try {
        let setRes = await pool.query('SELECT * FROM attendance_settings WHERE id = 1');
        if (setRes.rows.length === 0) {
            await pool.query(`
                INSERT INTO attendance_settings (id, staff_in_time, staff_out_time, staff_grace_minutes, staff_biometric_mode)
                VALUES (1, '08:00', '14:00', 15, 'both')
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
            staff_biometric_mode,
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
                staff_biometric_mode = COALESCE($4, staff_biometric_mode),
                staff_auto_absent_enabled = COALESCE($5, staff_auto_absent_enabled),
                staff_notify_in_out = COALESCE($6, staff_notify_in_out),
                staff_notify_holidays = COALESCE($7, staff_notify_holidays),
                student_notify_parents = COALESCE($8, student_notify_parents),
                student_notify_holidays = COALESCE($9, student_notify_holidays),
                student_auto_absent_enabled = COALESCE($10, student_auto_absent_enabled),
                family_notify_each_child = COALESCE($11, family_notify_each_child),
                consecutive_absent_alert_days = COALESCE($12, consecutive_absent_alert_days),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
            RETURNING *;
        `, [
            staff_in_time || null,
            staff_out_time || null,
            staff_grace_minutes !== undefined ? Number(staff_grace_minutes) : null,
            staff_biometric_mode || null,
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

// ═══════════════════════════════════════════════
//  HOLIDAYS & NON-WORKING DAYS
// ═══════════════════════════════════════════════

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

        // Optional broadcast notification to student/staff portals
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
// Body: { employee_id, assignments: [{ class_id, section_id }] }
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
                    -- 1. Explicit Coordinator Assignments
                    SELECT aca.class_id, aca.section_id
                    FROM attendance_coordinator_assignments aca
                    WHERE aca.employee_id = $1

                    UNION

                    -- 2. Class Teacher & General Class Assignments (handles all sections if section_id is null)
                    SELECT tca.class_id, COALESCE(tca.section_id, sec.section_id) as section_id
                    FROM teacher_class_assignment tca
                    LEFT JOIN sections sec ON tca.class_id = sec.class_id AND tca.section_id IS NULL
                    WHERE tca.employee_id = $1

                    UNION

                    -- 3. Teacher Subject Assignments
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

