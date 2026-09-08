const express = require('express');
const router = express.Router();
const pool = require('../db');

// Helper to get active academic year
async function getActiveAcademicYear(clientPool) {
    let yearRes = await clientPool.query(
        `SELECT id, year_name, is_active
         FROM academic_years
         WHERE is_active = TRUE OR status = 'active'
         ORDER BY id ASC
         LIMIT 1`
    );

    if (yearRes.rows.length === 0) {
        yearRes = await clientPool.query(
            `SELECT id, year_name, is_active
             FROM academic_years
             ORDER BY id ASC
             LIMIT 1`
        );
        if (yearRes.rows.length > 0) {
            await clientPool.query(`UPDATE academic_years SET is_active = TRUE, status = 'active' WHERE id = $1`, [yearRes.rows[0].id]);
            yearRes.rows[0].is_active = true;
        }
    }

    return yearRes.rows[0] || null;
}

// Get all expenses with filters and pagination
router.get('/', async (req, res) => {
    try {
        const { 
            category_id, 
            status, 
            from_date, 
            to_date, 
            payment_method,
            search,
            academic_year_id,
            page = 1,
            limit = 50
        } = req.query;

        const activeYear = await getActiveAcademicYear(pool);
        const yearsRes = await pool.query(`SELECT id, year_name, is_active FROM academic_years ORDER BY id DESC`);
        
        let query = `
            SELECT e.*, ec.category_name, ay.year_name AS academic_year_name, COALESCE(ay.is_active, TRUE) AS is_active_year
            FROM expenses e
            LEFT JOIN expense_categories ec ON e.category_id = ec.category_id
            LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        // Apply Academic Year filter safely
        if (academic_year_id === 'active') {
            if (activeYear?.id) {
                paramCount++;
                query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
                params.push(activeYear.id);
            }
        } else if (academic_year_id && academic_year_id !== 'all') {
            const parsedYId = parseInt(academic_year_id, 10);
            if (!isNaN(parsedYId)) {
                paramCount++;
                query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
                params.push(parsedYId);
            }
        } else if (!academic_year_id && activeYear?.id) {
            paramCount++;
            query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
            params.push(activeYear.id);
        }
        
        // Apply other filters
        if (category_id) {
            paramCount++;
            query += ` AND e.category_id = $${paramCount}`;
            params.push(category_id);
        }
        
        if (status) {
            paramCount++;
            query += ` AND e.status = $${paramCount}`;
            params.push(status);
        }
        
        if (from_date) {
            paramCount++;
            query += ` AND e.expense_date::date >= $${paramCount}::date`;
            params.push(from_date);
        }
        
        if (to_date) {
            paramCount++;
            query += ` AND e.expense_date::date <= $${paramCount}::date`;
            params.push(to_date);
        }
        
        if (payment_method) {
            paramCount++;
            query += ` AND e.payment_method = $${paramCount}`;
            params.push(payment_method);
        }
        
        if (search) {
            paramCount++;
            query += ` AND (e.expense_title ILIKE $${paramCount} OR e.paid_to ILIKE $${paramCount} OR e.reference_no ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        query += ' ORDER BY e.expense_date DESC, e.created_at DESC';
        
        // Add pagination
        const offset = (page - 1) * limit;
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(limit);
        
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(offset);
        
        const result = await pool.query(query, params);
        
        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) FROM expenses e WHERE 1=1';
        const countParams = [];
        let countParamCount = 0;

        if (academic_year_id === 'active') {
            if (activeYear?.id) {
                countParamCount++;
                countQuery += ` AND (e.academic_year_id = $${countParamCount} OR e.academic_year_id IS NULL)`;
                countParams.push(activeYear.id);
            }
        } else if (academic_year_id && academic_year_id !== 'all') {
            const parsedYId = parseInt(academic_year_id, 10);
            if (!isNaN(parsedYId)) {
                countParamCount++;
                countQuery += ` AND (e.academic_year_id = $${countParamCount} OR e.academic_year_id IS NULL)`;
                countParams.push(parsedYId);
            }
        } else if (!academic_year_id && activeYear?.id) {
            countParamCount++;
            countQuery += ` AND (e.academic_year_id = $${countParamCount} OR e.academic_year_id IS NULL)`;
            countParams.push(activeYear.id);
        }
        
        if (category_id) {
            countParamCount++;
            countQuery += ` AND e.category_id = $${countParamCount}`;
            countParams.push(category_id);
        }

        if (status) {
            countParamCount++;
            countQuery += ` AND e.status = $${countParamCount}`;
            countParams.push(status);
        }
        
        if (from_date) {
            countParamCount++;
            countQuery += ` AND e.expense_date::date >= $${countParamCount}::date`;
            countParams.push(from_date);
        }
        
        if (to_date) {
            countParamCount++;
            countQuery += ` AND e.expense_date::date <= $${countParamCount}::date`;
            countParams.push(to_date);
        }
        
        if (payment_method) {
            countParamCount++;
            countQuery += ` AND e.payment_method = $${countParamCount}`;
            countParams.push(payment_method);
        }
        
        if (search) {
            countParamCount++;
            countQuery += ` AND (e.expense_title ILIKE $${countParamCount} OR e.paid_to ILIKE $${countParamCount} OR e.reference_no ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }
        
        const countResult = await pool.query(countQuery, countParams);
        
        res.json({
            expenses: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(countResult.rows[0].count / limit),
            years: yearsRes.rows,
            active_year: activeYear
        });
    } catch (err) {
        console.error('Expenses GET error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get expense statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const { from_date, to_date, category_id, academic_year_id, search, payment_method } = req.query;
        const activeYear = await getActiveAcademicYear(pool);
        
        let query = `
            SELECT 
                COUNT(*) as total_expenses,
                COALESCE(SUM(e.amount), 0) as total_amount,
                COALESCE(AVG(e.amount), 0) as avg_amount,
                COUNT(DISTINCT e.category_id) as categories_count,
                COALESCE(MAX(e.amount), 0) as highest_expense
            FROM expenses e
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        if (academic_year_id === 'active') {
            if (activeYear?.id) {
                paramCount++;
                query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
                params.push(activeYear.id);
            }
        } else if (academic_year_id && academic_year_id !== 'all') {
            const parsedYId = parseInt(academic_year_id, 10);
            if (!isNaN(parsedYId)) {
                paramCount++;
                query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
                params.push(parsedYId);
            }
        } else if (!academic_year_id && activeYear?.id) {
            paramCount++;
            query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
            params.push(activeYear.id);
        }
        
        if (from_date) {
            paramCount++;
            query += ` AND e.expense_date::date >= $${paramCount}::date`;
            params.push(from_date);
        }
        
        if (to_date) {
            paramCount++;
            query += ` AND e.expense_date::date <= $${paramCount}::date`;
            params.push(to_date);
        }
        
        if (category_id) {
            paramCount++;
            query += ` AND e.category_id = $${paramCount}`;
            params.push(category_id);
        }

        if (payment_method) {
            paramCount++;
            query += ` AND e.payment_method = $${paramCount}`;
            params.push(payment_method);
        }

        if (search) {
            paramCount++;
            query += ` AND (e.expense_title ILIKE $${paramCount} OR e.paid_to ILIKE $${paramCount} OR e.reference_no ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Expenses stats error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get expenses by category
router.get('/stats/by-category', async (req, res) => {
    try {
        const { from_date, to_date, academic_year_id } = req.query;
        const activeYear = await getActiveAcademicYear(pool);
        
        let query = `
            SELECT 
                ec.category_name,
                COUNT(e.expense_id) as expense_count,
                COALESCE(SUM(e.amount), 0) as total_amount
            FROM expense_categories ec
            LEFT JOIN expenses e ON ec.category_id = e.category_id
        `;
        const params = [];
        let paramCount = 0;
        
        query += ' WHERE 1=1';

        if (academic_year_id === 'active') {
            if (activeYear?.id) {
                paramCount++;
                query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
                params.push(activeYear.id);
            }
        } else if (academic_year_id && academic_year_id !== 'all') {
            const parsedYId = parseInt(academic_year_id, 10);
            if (!isNaN(parsedYId)) {
                paramCount++;
                query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
                params.push(parsedYId);
            }
        } else if (!academic_year_id && activeYear?.id) {
            paramCount++;
            query += ` AND (e.academic_year_id = $${paramCount} OR e.academic_year_id IS NULL)`;
            params.push(activeYear.id);
        }
        
        if (from_date) {
            paramCount++;
            query += ` AND e.expense_date::date >= $${paramCount}::date`;
            params.push(from_date);
        }
        
        if (to_date) {
            paramCount++;
            query += ` AND e.expense_date::date <= $${paramCount}::date`;
            params.push(to_date);
        }
        
        query += ' GROUP BY ec.category_name ORDER BY total_amount DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single expense
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const activeYear = await getActiveAcademicYear(pool);

        const result = await pool.query(
            `SELECT e.*, ec.category_name, ay.year_name AS academic_year_name, COALESCE(ay.is_active, TRUE) AS is_active_year
             FROM expenses e
             LEFT JOIN expense_categories ec ON e.category_id = ec.category_id
             LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
             WHERE e.expense_id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        const exp = result.rows[0];
        // If expense doesn't have an academic_year_id set, compare with active year
        if (!exp.academic_year_id && activeYear?.id) {
            exp.academic_year_id = activeYear.id;
            exp.academic_year_name = activeYear.year_name;
            exp.is_active_year = true;
        }

        res.json({ expense: exp, active_year: activeYear });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create new expense
router.post('/', async (req, res) => {
    try {
        const {
            category_id,
            expense_title,
            amount,
            expense_date,
            payment_method,
            reference_no,
            paid_to,
            description,
            status,
            academic_year_id
        } = req.body;
        
        if (!category_id || !expense_title || !amount) {
            return res.status(400).json({ 
                error: 'Category, title, and amount are required' 
            });
        }

        const activeYear = await getActiveAcademicYear(pool);
        const reqYearId = academic_year_id ? Number(academic_year_id) : (activeYear?.id || null);

        // Check if selected academic year is closed
        if (reqYearId) {
            const yearCheck = await pool.query(`SELECT id, year_name, is_active FROM academic_years WHERE id = $1`, [reqYearId]);
            if (yearCheck.rows.length > 0 && yearCheck.rows[0].is_active === false) {
                return res.status(403).json({
                    error: `Fiscal/Academic Year (${yearCheck.rows[0].year_name}) is closed. New expenses can only be created in the active Academic Year.`
                });
            }
        }
        
        const result = await pool.query(
            `INSERT INTO expenses (
                category_id, expense_title, amount, expense_date,
                payment_method, reference_no, paid_to, description, status, academic_year_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                category_id,
                expense_title,
                amount,
                expense_date || new Date(),
                payment_method || null,
                reference_no || null,
                paid_to || null,
                description || null,
                status || 'pending',
                reqYearId
            ]
        );
        
        res.status(201).json({
            message: 'Expense created successfully',
            expense: result.rows[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update expense
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            category_id,
            expense_title,
            amount,
            expense_date,
            payment_method,
            reference_no,
            paid_to,
            description,
            status
        } = req.body;

        // Check if expense exists and belongs to a closed academic year
        const checkRes = await pool.query(
            `SELECT e.expense_id, e.academic_year_id, ay.year_name, ay.is_active
             FROM expenses e
             LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
             WHERE e.expense_id = $1`,
            [id]
        );

        if (checkRes.rows.length === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        const existing = checkRes.rows[0];
        if (existing.academic_year_id && existing.is_active === false) {
            return res.status(403).json({
                error: `Fiscal/Academic Year (${existing.year_name || 'Closed'}) is closed. Expenses from previous years are read-only and cannot be modified.`
            });
        }
        
        const result = await pool.query(
            `UPDATE expenses SET
                category_id = $1,
                expense_title = $2,
                amount = $3,
                expense_date = $4,
                payment_method = $5,
                reference_no = $6,
                paid_to = $7,
                description = $8,
                status = $9,
                updated_at = CURRENT_TIMESTAMP
            WHERE expense_id = $10
            RETURNING *`,
            [
                category_id,
                expense_title,
                amount,
                expense_date,
                payment_method,
                reference_no,
                paid_to,
                description,
                status,
                id
            ]
        );
        
        res.json({
            message: 'Expense updated successfully',
            expense: result.rows[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update expense status
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // Check if expense exists and belongs to a closed academic year
        const checkRes = await pool.query(
            `SELECT e.expense_id, e.academic_year_id, ay.year_name, ay.is_active
             FROM expenses e
             LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
             WHERE e.expense_id = $1`,
            [id]
        );

        if (checkRes.rows.length === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        const existing = checkRes.rows[0];
        if (existing.academic_year_id && existing.is_active === false) {
            return res.status(403).json({
                error: `Fiscal/Academic Year (${existing.year_name || 'Closed'}) is closed. Expenses from previous years are read-only and cannot be modified.`
            });
        }
        
        const result = await pool.query(
            `UPDATE expenses SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE expense_id = $2
             RETURNING *`,
            [status, id]
        );
        
        res.json({
            message: 'Status updated successfully',
            expense: result.rows[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete expense
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if expense exists and belongs to a closed academic year
        const checkRes = await pool.query(
            `SELECT e.expense_id, e.academic_year_id, ay.year_name, ay.is_active
             FROM expenses e
             LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
             WHERE e.expense_id = $1`,
            [id]
        );

        if (checkRes.rows.length === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        const existing = checkRes.rows[0];
        if (existing.academic_year_id && existing.is_active === false) {
            return res.status(403).json({
                error: `Fiscal/Academic Year (${existing.year_name || 'Closed'}) is closed. Expenses from previous years are read-only and cannot be deleted.`
            });
        }
        
        const result = await pool.query(
            'DELETE FROM expenses WHERE expense_id = $1 RETURNING *',
            [id]
        );
        
        res.json({ message: 'Expense deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
