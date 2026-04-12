const pool = require('./db');
async function test() {
    try {
        await pool.query(\SELECT COUNT(*) AS total FROM students WHERE status = 'Active'\); console.log('1 ok');
        await pool.query(\SELECT COUNT(*) AS total FROM employees WHERE status = 'Active'\); console.log('2 ok');
        await pool.query(\SELECT COALESCE(SUM(GREATEST(0, total_amount - paid_amount)), 0) AS pending FROM monthly_fee_slips WHERE status IN ('unpaid', 'partial')\); console.log('4 ok');
        await pool.query(\SELECT COUNT(*) AS total FROM classes\); console.log('3 ok');
        await pool.query(\SELECT COALESCE(SUM(fp.amount_paid), 0) AS collected FROM fee_payments fp WHERE EXTRACT(MONTH FROM fp.payment_date) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM fp.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE)\); console.log('5 ok');
        await pool.query(\SELECT COALESCE(SUM(fp.amount_paid), 0) AS collected FROM fee_payments fp WHERE fp.payment_date::date = CURRENT_DATE\); console.log('6 ok');
        await pool.query(\SELECT COUNT(*) FILTER (WHERE status = 'Present') AS present, COUNT(*) FILTER (WHERE status = 'Absent') AS absent, COUNT(*) FILTER (WHERE status = 'Late') AS late, COUNT(*) FILTER (WHERE status = 'Leave') AS on_leave, COUNT(*) AS total FROM student_attendance WHERE attendance_date = CURRENT_DATE\); console.log('7 ok');
        await pool.query(\SELECT COUNT(*) FILTER (WHERE status = 'Present') AS present, COUNT(*) FILTER (WHERE status = 'Absent') AS absent, COUNT(*) FILTER (WHERE status = 'Late') AS late, COUNT(*) AS total FROM staff_attendance WHERE attendance_date = CURRENT_DATE\); console.log('8 ok');
        await pool.query(\SELECT fp.payment_date::date AS date, COALESCE(SUM(fp.amount_paid), 0) AS amount FROM fee_payments fp WHERE fp.payment_date::date >= CURRENT_DATE - INTERVAL '29 days' GROUP BY fp.payment_date::date ORDER BY fp.payment_date::date ASC\); console.log('9 ok');
        await pool.query(\SELECT attendance_date AS date, COUNT(*) FILTER (WHERE status = 'Present') AS present, COUNT(*) FILTER (WHERE status = 'Absent') AS absent, COUNT(*) FILTER (WHERE status = 'Late') AS late, COUNT(*) AS total FROM student_attendance WHERE attendance_date >= CURRENT_DATE - INTERVAL '29 days' GROUP BY attendance_date ORDER BY attendance_date ASC\); console.log('10 ok');
        await pool.query(\SELECT attendance_date AS date, COUNT(*) FILTER (WHERE status = 'Present') AS present, COUNT(*) FILTER (WHERE status = 'Absent') AS absent, COUNT(*) FILTER (WHERE status = 'Late') AS late, COUNT(*) AS total FROM staff_attendance WHERE attendance_date >= CURRENT_DATE - INTERVAL '29 days' GROUP BY attendance_date ORDER BY attendance_date ASC\); console.log('11 ok');
        await pool.query(\SELECT fp.payment_id, fp.amount_paid, fp.payment_date, fp.payment_method, fp.received_by, s.first_name || ' ' || s.last_name AS student_name, s.admission_no, c.class_name, mfs.month, mfs.year, mfs.status AS slip_status FROM fee_payments fp JOIN monthly_fee_slips mfs ON fp.slip_id = mfs.slip_id JOIN students s ON mfs.student_id = s.student_id LEFT JOIN classes c ON s.class_id = c.class_id ORDER BY fp.payment_date DESC, fp.payment_id DESC LIMIT 8\); console.log('12 ok');
    } catch(e){
        console.error(e.message);
    }
}
test();
