const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all fee heads
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM fee_heads ORDER BY head_type, head_name'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET active fee heads only
router.get('/active', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM fee_heads WHERE is_active = TRUE ORDER BY head_type, head_name"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE fee head
router.post('/', async (req, res) => {
    try {
        const { head_name, head_type, frequency, track_arrears, description } = req.body;
        if (!head_name) return res.status(400).json({ error: 'Head name is required' });

        const isTuitionOrPb = (head_type === 'prev_balance') || 
            head_name.toLowerCase().includes('tuition') || 
            head_name.toLowerCase().includes('family');
        const resolvedTrack = track_arrears !== undefined ? Boolean(track_arrears) : !isTuitionOrPb;

        const result = await pool.query(
            `INSERT INTO fee_heads (head_name, head_type, frequency, track_arrears, description)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [head_name, head_type || 'regular', frequency || 'monthly', resolvedTrack, description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE fee head
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { head_name, head_type, frequency, track_arrears, description, is_active } = req.body;

        const isTuitionOrPb = (head_type === 'prev_balance') || 
            (head_name && (head_name.toLowerCase().includes('tuition') || head_name.toLowerCase().includes('family')));
        const resolvedTrack = track_arrears !== undefined ? Boolean(track_arrears) : !isTuitionOrPb;

        const result = await pool.query(
            `UPDATE fee_heads SET head_name=$1, head_type=$2, frequency=$3, track_arrears=$4,
             description=$5, is_active=$6 WHERE head_id=$7 RETURNING *`,
            [head_name, head_type, frequency, resolvedTrack, description, is_active, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE fee head
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM fee_heads WHERE head_id = $1', [id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
