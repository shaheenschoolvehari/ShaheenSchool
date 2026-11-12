const express = require('express');
const router = require('express').Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); // Added for Password Hashing
const {
    CLASS_SENIORITY_ORDER,
    evaluateMembersTrusted,
    shiftFamilySlipsLead
} = require('../utils/feeBillingHelpers');
const {
    getReactivationPreview,
    executeStudentReactivation
} = require('../utils/studentReactivationService');

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/students';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit per file
});

// ==========================================
// FAMILY & SIBLING MANAGEMENT
// ==========================================

// Helper function to generate Family ID
async function generateFamilyId(client) {
    const year = new Date().getFullYear();
    const lastFamily = await client.query(`
        SELECT family_id FROM students 
        WHERE family_id LIKE $1 
        ORDER BY family_id DESC LIMIT 1
    `, [`FAM-${year}-%`]);

    let familyNum = 1;
    if (lastFamily.rows.length > 0) {
        const lastId = lastFamily.rows[0].family_id;
        const match = lastId.match(/FAM-\d{4}-(\d{4})/);
        if (match) {
            familyNum = parseInt(match[1]) + 1;
        }
    }

    return `FAM-${year}-${String(familyNum).padStart(4, '0')}`;
}

// Search for potential siblings
router.get('/search-siblings', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.trim().length < 2) {
            return res.json([]);
        }

        // Split query by commas to allow searching by name, class, and section together (e.g. "Ali, class 2, section A")
        const terms = query.split(',').map(t => t.trim()).filter(t => t.length > 0);
        const params = [];
        const conditions = [];

        terms.forEach((term, idx) => {
            const temp = `$${idx + 1}`;
            params.push(`%${term}%`);
            conditions.push(`(
                s.first_name ILIKE ${temp} OR
                s.last_name ILIKE ${temp} OR
                s.admission_no ILIKE ${temp} OR
                s.father_name ILIKE ${temp} OR
                CONCAT(s.first_name, ' ', s.last_name) ILIKE ${temp} OR
                c.class_name ILIKE ${temp} OR
                sec.section_name ILIKE ${temp}
            )`);
        });

        const whereLogic = conditions.length > 0 ? `AND ( ${conditions.join(' AND ')} )` : '';

        const result = await pool.query(`
            SELECT
                s.student_id,
                s.admission_no,
                s.first_name,
                s.last_name,
                s.father_name,
                s.father_phone,
                s.father_cnic,
                s.father_occupation,
                s.mother_name,
                s.mother_phone,
                s.mother_cnic,
                s.mother_occupation,
                s.gender,
                s.dob,
                s.family_id,
                COALESCE(NULLIF(s.monthly_fee, 0), f.family_fee, 0) AS monthly_fee,
                s.class_id,
                s.image_url,
                s.current_address,
                s.permanent_address,
                s.city,
                s.guardian_name,
                s.guardian_relation,
                s.guardian_phone,
                s.guardian_cnic,
                s.guardian_address,
                c.class_name,
                sec.section_name,
                COALESCE(f.family_fee, 0) AS family_fee,
                (SELECT COUNT(*) FROM students s2 WHERE s2.family_id = s.family_id AND s2.status = 'Active') AS family_size
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN families f ON f.family_id = s.family_id
            WHERE
                s.status = 'Active' ${whereLogic}
            ORDER BY s.admission_date DESC
            LIMIT 20
        `, params);

        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// Get siblings of a student
router.get('/:id/siblings', async (req, res) => {
    try {
        const { id } = req.params;

        // Get student's family_id
        const student = await pool.query(`
            SELECT family_id FROM students WHERE student_id = $1
        `, [id]);

        if (student.rows.length === 0) {
            return res.status(404).json({ error: "Student not found" });
        }

        const familyId = student.rows[0].family_id;

        if (!familyId) {
            return res.json([]);
        }

        // Get all students with same family_id and their relation_type.
        //
        // STRATEGY (3-level COALESCE):
        //   1. Forward row in student_siblings  (A → B): most authoritative
        //   2. Reverse row in student_siblings  (B → A): handles asymmetric old data
        //   3. Father-name comparison (SMART FALLBACK):
        //        • Same father_name  → 'blood'   (they are real siblings)
        //        • Different father_name → 'cousin' (different dads = cousins in same family)
        //      This correctly handles bulk-imported families and merged families where
        //      cousins share a family_id but have different fathers.
        //
        // We use correlated subqueries (not a LEFT JOIN with OR) to avoid duplicate rows.

        // First: fetch the current student's father_name for the comparison
        const currentStudentRes = await pool.query(
            `SELECT father_name FROM students WHERE student_id = $1`, [id]
        );
        const currentFatherName = (currentStudentRes.rows[0]?.father_name || '').trim().toLowerCase().replace(/\s+/g, ' ');

        const siblings = await pool.query(`
            SELECT 
                s.student_id,
                s.admission_no,
                s.first_name,
                s.last_name,
                s.father_name,
                s.mother_name,
                s.gender,
                s.dob,
                s.status,
                s.family_id,
                s.sibling_relation,
                s.class_id,
                s.image_url,
                c.class_name,
                sec.section_name,
                COALESCE(
                    -- Level 1: Forward direction (current student → this sibling)
                    (
                        SELECT ss.relation_type 
                        FROM student_siblings ss
                        WHERE ss.student_id = $1 AND ss.sibling_id = s.student_id
                        LIMIT 1
                    ),
                    -- Level 2: Reverse direction (this sibling → current student)
                    (
                        SELECT ss.relation_type 
                        FROM student_siblings ss
                        WHERE ss.student_id = s.student_id AND ss.sibling_id = $1
                        LIMIT 1
                    ),
                    -- Level 3: Father-name smart fallback
                    --   Same father → blood sibling
                    --   Different father → cousin
                    CASE
                        WHEN $3 = '' THEN 'blood'
                        WHEN LOWER(TRIM(REGEXP_REPLACE(s.father_name, '\s+', ' ', 'g'))) = $3
                            THEN 'blood'
                        ELSE 'cousin'
                    END
                ) AS relation_type
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE s.family_id = $2 AND s.student_id != $1
            ORDER BY s.dob ASC
        `, [id, familyId, currentFatherName]);

        res.json(siblings.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// ==========================================
// DATA REPAIR: Fix corrupted relation_types
// ==========================================
// This endpoint corrects entries that were wrongly set to 'blood' by the
// faulty DO UPDATE migration. It resets student_siblings rows to 'cousin'
// where the two students have DIFFERENT father_names (i.e., they are not
// true blood siblings - their shared family_id is due to a merge).
// Safe to call repeatedly (idempotent).
router.post('/repair-sibling-relations', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find all student_siblings rows marked 'blood' where the two students
        // have different father names. These were incorrectly set by the bad migration.
        // They should be 'cousin' because blood siblings must share the same father.
        const repairResult = await client.query(`
            UPDATE student_siblings ss
            SET relation_type = 'cousin'
            FROM students a, students b
            WHERE ss.student_id = a.student_id
              AND ss.sibling_id = b.student_id
              AND ss.relation_type = 'blood'
              AND COALESCE(REPLACE(LOWER(TRIM(a.father_name)), ' ', ''), '') != ''
              AND COALESCE(REPLACE(LOWER(TRIM(b.father_name)), ' ', ''), '') != ''
              AND COALESCE(REPLACE(LOWER(TRIM(a.father_name)), ' ', ''), '') 
                  != COALESCE(REPLACE(LOWER(TRIM(b.father_name)), ' ', ''), '')
        `);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Repaired ${repairResult.rowCount} incorrectly marked sibling relationships`,
            rowsFixed: repairResult.rowCount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Repair error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ==========================================
// DATA REPAIR: Backfill missing sibling rows
// ==========================================
// For every pair of students sharing the same family_id that has NO row in
// student_siblings, insert the correct relation_type based on father_name:
//   • Same father_name  → 'blood'  (real siblings)
//   • Different father_name → 'cousin' (different fathers in merged family)
// Safe to call repeatedly (idempotent DO NOTHING on conflict).
router.post('/repair-missing-blood-rows', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find all (a, b) pairs in the same family that have NO student_siblings row.
        // Use father_name comparison to assign the correct relation_type.
        const repairResult = await client.query(`
            INSERT INTO student_siblings (student_id, sibling_id, relation_type)
            SELECT
                a.student_id,
                b.student_id,
                CASE
                    WHEN LOWER(TRIM(REGEXP_REPLACE(COALESCE(a.father_name,''), '\\s+', ' ', 'g')))
                       = LOWER(TRIM(REGEXP_REPLACE(COALESCE(b.father_name,''), '\\s+', ' ', 'g')))
                       AND COALESCE(TRIM(a.father_name), '') != ''
                        THEN 'blood'
                    ELSE 'cousin'
                END AS relation_type
            FROM students a
            JOIN students b ON a.family_id = b.family_id
              AND a.student_id != b.student_id
              AND a.family_id IS NOT NULL
            WHERE NOT EXISTS (
                SELECT 1 FROM student_siblings ss
                WHERE ss.student_id = a.student_id
                  AND ss.sibling_id = b.student_id
            )
            ON CONFLICT (student_id, sibling_id) DO NOTHING
        `);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Backfilled ${repairResult.rowCount} missing sibling rows (with father-name based relation_type)`,
            rowsInserted: repairResult.rowCount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Backfill repair error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ==========================================
// PHASE 2 & 3: FAMILY MANAGEMENT ENDPOINTS
// ==========================================

// Get Potential Duplicate Families (Phase 2)
router.get('/families/potential-duplicates', async (req, res) => {
    try {
        const query = `
            WITH family_details AS (
                SELECT 
                    family_id,
                    ARRAY_AGG(student_id ORDER BY created_at) as student_ids,
                    ARRAY_AGG(first_name || ' ' || last_name ORDER BY created_at) as student_names,
                    ARRAY_AGG(admission_no ORDER BY created_at) as admission_nos,
                    ARRAY_AGG(class_name ORDER BY created_at) as classes,
                    MAX(father_name) as father_name,
                    MAX(father_phone) as father_phone,
                    MAX(father_cnic) as father_cnic,
                    MAX(permanent_address) as address,
                    COUNT(*) as family_size
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                WHERE s.family_id IS NOT NULL
                GROUP BY family_id
            )
            SELECT 
                f1.family_id as family1_id,
                f1.student_ids as family1_student_ids,
                f1.student_names as family1_students,
                f1.admission_nos as family1_admission_nos,
                f1.classes as family1_classes,
                f1.father_name as father1_name,
                f1.father_phone as father1_phone,
                f1.father_cnic as father1_cnic,
                f1.address as address1,
                f1.family_size as family1_size,
                
                f2.family_id as family2_id,
                f2.student_ids as family2_student_ids,
                f2.student_names as family2_students,
                f2.admission_nos as family2_admission_nos,
                f2.classes as family2_classes,
                f2.father_name as father2_name,
                f2.father_phone as father2_phone,
                f2.father_cnic as father2_cnic,
                f2.address as address2,
                f2.family_size as family2_size,
                
                CASE
                    WHEN LOWER(f1.father_name) = LOWER(f2.father_name) 
                         AND f1.father_phone = f2.father_phone THEN 95
                    WHEN LOWER(f1.father_name) = LOWER(f2.father_name)
                         AND RIGHT(f1.father_phone, 7) = RIGHT(f2.father_phone, 7) THEN 85
                    WHEN f1.father_phone = f2.father_phone THEN 75
                    ELSE 60
                END as match_score
                
            FROM family_details f1
            JOIN family_details f2 ON f1.family_id < f2.family_id
            WHERE (
                (LOWER(f1.father_name) = LOWER(f2.father_name) 
                 AND (f1.father_phone = f2.father_phone 
                      OR RIGHT(f1.father_phone, 7) = RIGHT(f2.father_phone, 7)))
                OR f1.father_phone = f2.father_phone
            )
            AND f1.family_id != f2.family_id
            ORDER BY match_score DESC, f1.family_id
            LIMIT 50
        `;

        const result = await pool.query(query);
        res.json(result.rows);

    } catch (err) {
        console.error('Duplicate detection error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Merge Two Families (Phase 2)
router.post('/families/merge', async (req, res) => {
    const client = await pool.connect();
    try {
        const { primaryFamilyId, secondaryFamilyId, relationType } = req.body;

        if (!primaryFamilyId || !secondaryFamilyId || !relationType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await client.query('BEGIN');

        // Get all students from both families
        const family1 = await client.query(
            'SELECT student_id FROM students WHERE family_id = $1',
            [primaryFamilyId]
        );
        const family2 = await client.query(
            'SELECT student_id FROM students WHERE family_id = $1',
            [secondaryFamilyId]
        );

        if (family2.rows.length === 0) {
            throw new Error('Secondary family not found');
        }

        // Move all secondary family members to primary family.
        // Do NOT overwrite sibling_relation blood siblings among themselves must stay 'blood'.
        await client.query(
            `UPDATE students SET family_id = $1 WHERE family_id = $2`,
            [primaryFamilyId, secondaryFamilyId]
        );

        // STEP A: Ensure all intra-primary-family blood rows exist in student_siblings.
        for (let i = 0; i < family1.rows.length; i++) {
            for (let j = i + 1; j < family1.rows.length; j++) {
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1::int, $2::int, 'blood'), ($2::int, $1::int, 'blood')
                     ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                    [family1.rows[i].student_id, family1.rows[j].student_id]
                );
            }
        }

        // STEP B: Ensure all intra-secondary-family blood rows exist in student_siblings.
        for (let i = 0; i < family2.rows.length; i++) {
            for (let j = i + 1; j < family2.rows.length; j++) {
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1::int, $2::int, 'blood'), ($2::int, $1::int, 'blood')
                     ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                    [family2.rows[i].student_id, family2.rows[j].student_id]
                );
            }
        }

        // STEP C: Create cross-family sibling relationships with the user-specified relationType.
        // Use DO UPDATE to overwrite any stale/incorrect relation_type values.
        for (let i = 0; i < family1.rows.length; i++) {
            for (let j = 0; j < family2.rows.length; j++) {
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1, $2, $3), ($2, $1, $3)
                     ON CONFLICT (student_id, sibling_id)
                     DO UPDATE SET relation_type = EXCLUDED.relation_type`,
                    [family1.rows[i].student_id, family2.rows[j].student_id, relationType]
                );
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Merged ${family2.rows.length} students into ${primaryFamilyId}`,
            mergedFamily: primaryFamilyId,
            movedStudents: family2.rows.length
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Merge error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Search Students for Manual Linking (Phase 3)
router.get('/families/search-for-link', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.length < 2) {
            return res.json([]);
        }

        const result = await pool.query(`
            SELECT 
                s.student_id,
                s.admission_no,
                s.first_name,
                s.last_name,
                s.father_name,
                s.family_id,
                c.class_name,
                sec.section_name,
                s.image_url
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            WHERE LOWER(s.first_name || ' ' || s.last_name) LIKE LOWER($1)
               OR s.admission_no LIKE $1
               OR LOWER(s.father_name) LIKE LOWER($1)
            ORDER BY s.first_name
            LIMIT 20
        `, [`%${query}%`]);

        res.json(result.rows);
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Manual Link Between Two Students (Phase 3)
router.post('/families/manual-link', async (req, res) => {
    const client = await pool.connect();
    try {
        const { student1_id, student2_id, relation_type } = req.body;

        if (!student1_id || !student2_id || !relation_type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (student1_id === student2_id) {
            return res.status(400).json({ error: 'Cannot link a student to themselves' });
        }

        await client.query('BEGIN');

        // Get both students' info
        const students = await client.query(
            `SELECT student_id, family_id, first_name, last_name 
             FROM students 
             WHERE student_id IN ($1, $2)`,
            [student1_id, student2_id]
        );

        if (students.rows.length !== 2) {
            throw new Error('One or both students not found');
        }

        const [s1, s2] = students.rows;

        // If already in same family, just create/update relationship
        if (s1.family_id === s2.family_id) {
            await client.query(
                `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                 VALUES ($1, $2, $3), ($2, $1, $3)
                 ON CONFLICT (student_id, sibling_id) 
                 DO UPDATE SET relation_type = $3`,
                [student1_id, student2_id, relation_type]
            );

            await client.query('COMMIT');
            return res.json({
                success: true,
                message: 'Sibling relationship created',
                action: 'relationship_only'
            });
        }

        // Different families - Merge them
        const primaryFamilyId = s1.family_id < s2.family_id ? s1.family_id : s2.family_id;
        const secondaryFamilyId = s1.family_id < s2.family_id ? s2.family_id : s1.family_id;

        // Get all students from primary family before update
        const primaryFamilyStudents = await client.query(
            'SELECT student_id FROM students WHERE family_id = $1',
            [primaryFamilyId]
        );

        // Get all students from secondary family before update
        const secondaryFamilyStudents = await client.query(
            'SELECT student_id FROM students WHERE family_id = $1',
            [secondaryFamilyId]
        );

        // Move all secondary family members to primary family.
        // We do NOT touch sibling_relation here blood siblings within each original
        // family must keep their 'blood' status among themselves.
        await client.query(
            `UPDATE students SET family_id = $1 WHERE family_id = $2`,
            [primaryFamilyId, secondaryFamilyId]
        );

        // STEP A: Ensure all intra-primary-family blood rows exist in student_siblings.
        // This guarantees blood siblings always have explicit rows (idempotent DO NOTHING).
        for (let i = 0; i < primaryFamilyStudents.rows.length; i++) {
            for (let j = i + 1; j < primaryFamilyStudents.rows.length; j++) {
                const pA = primaryFamilyStudents.rows[i].student_id;
                const pB = primaryFamilyStudents.rows[j].student_id;
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1::int, $2::int, 'blood'), ($2::int, $1::int, 'blood')
                     ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                    [pA, pB]
                );
            }
        }

        // STEP B: Ensure all intra-secondary-family blood rows exist in student_siblings.
        for (let i = 0; i < secondaryFamilyStudents.rows.length; i++) {
            for (let j = i + 1; j < secondaryFamilyStudents.rows.length; j++) {
                const sA = secondaryFamilyStudents.rows[i].student_id;
                const sB = secondaryFamilyStudents.rows[j].student_id;
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1::int, $2::int, 'blood'), ($2::int, $1::int, 'blood')
                     ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                    [sA, sB]
                );
            }
        }

        // STEP C: Create cross-family sibling relationships.
        // For the directly-linked pair: use the specified relation_type.
        // For all other cross-family pairs: use 'cousin'.
        // Use DO UPDATE to overwrite any stale/incorrect relation_type values.
        for (let i = 0; i < primaryFamilyStudents.rows.length; i++) {
            for (let j = 0; j < secondaryFamilyStudents.rows.length; j++) {
                const pId = primaryFamilyStudents.rows[i].student_id;
                const sId = secondaryFamilyStudents.rows[j].student_id;

                const pairRelation = (
                    (pId === student1_id && sId === student2_id) ||
                    (pId === student2_id && sId === student1_id)
                ) ? relation_type : 'cousin';

                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1, $2, $3), ($2, $1, $3)
                     ON CONFLICT (student_id, sibling_id)
                     DO UPDATE SET relation_type = EXCLUDED.relation_type`,
                    [pId, sId, pairRelation]
                );
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Linked ${s2.first_name} to ${s1.first_name}'s family as ${relation_type}`,
            primaryFamily: primaryFamilyId,
            movedStudents: secondaryFamilyStudents.rows.length,
            action: 'family_merged'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Manual link error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});


// GET /students/families-directory list all families with children, classes, sections, parents info
router.get('/families-directory', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.student_id,
                s.family_id,
                s.admission_no,
                s.first_name,
                s.last_name,
                s.father_name,
                s.father_phone,
                s.father_cnic,
                s.father_occupation,
                s.mother_name,
                s.mother_phone,
                s.mother_cnic,
                s.mother_occupation,
                s.guardian_name,
                s.guardian_phone,
                s.guardian_relation,
                s.current_address,
                s.gender,
                s.dob,
                s.status,
                s.category,
                s.monthly_fee,
                c.class_id,
                c.class_name,
                sec.section_id,
                sec.section_name,
                f.family_fee,
                f.opening_balance,
                f.opening_balance_paid,
                f.advance_balance,
                GREATEST(0, COALESCE(f.opening_balance, 0) - COALESCE(f.opening_balance_paid, 0)) AS opb_remaining
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN families f ON s.family_id = f.family_id
            WHERE s.family_id IS NOT NULL 
              AND TRIM(s.family_id) != ''
              AND LOWER(COALESCE(s.status, 'Active')) = 'active'
            ORDER BY s.family_id, c.class_id DESC NULLS LAST, s.admission_no ASC
        `);

        const familiesMap = {};

        for (const s of result.rows) {
            const fid = s.family_id.trim();
            if (!familiesMap[fid]) {
                familiesMap[fid] = {
                    family_id: fid,
                    family_fee: parseFloat(s.family_fee || 0),
                    opening_balance: parseFloat(s.opening_balance || 0),
                    opening_balance_paid: parseFloat(s.opening_balance_paid || 0),
                    advance_balance: parseFloat(s.advance_balance || 0),
                    opb_remaining: parseFloat(s.opb_remaining || 0),
                    members: []
                };
            }
            const isTrusted = (s.category || '').trim().toLowerCase() === 'trusted';
            familiesMap[fid].members.push({
                student_id: s.student_id,
                admission_no: s.admission_no,
                first_name: s.first_name || '',
                last_name: s.last_name || '',
                full_name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
                category: s.category || 'Normal',
                is_trusted: isTrusted,
                monthly_fee: parseFloat(s.monthly_fee || 0),
                father_name: (s.father_name || '').trim(),
                father_phone: (s.father_phone || '').trim(),
                father_cnic: (s.father_cnic || '').trim(),
                mother_name: (s.mother_name || '').trim(),
                mother_phone: (s.mother_phone || '').trim(),
                mother_cnic: (s.mother_cnic || '').trim(),
                guardian_name: (s.guardian_name || '').trim(),
                guardian_phone: (s.guardian_phone || '').trim(),
                current_address: (s.current_address || '').trim(),
                class_id: s.class_id,
                class_name: s.class_name || 'N/A',
                section_id: s.section_id,
                section_name: s.section_name || 'N/A',
                status: s.status || 'Active'
            });
        }

        // Query canonical fee statistics per family across generated monthly fee slips for the active session
        // NOTE: In a waterfall billing system, slips embed previous balances, so we NEVER sum total_amount across months.
        const activeYearRes = await pool.query("SELECT id, year_name FROM academic_years WHERE is_active = true LIMIT 1");
        const activeYear = activeYearRes.rows[0];
        const activeYearId = activeYear ? activeYear.id : null;

        const feeSlipsRes = await pool.query(`
            SELECT 
                ms.slip_id, ms.family_id, ms.student_id, ms.month, ms.year,
                ms.total_amount, ms.paid_amount, ms.status,
                s.family_id as stu_fam_id, s.category as stu_category
            FROM monthly_fee_slips ms
            LEFT JOIN students s ON ms.student_id = s.student_id
            WHERE ($1::int IS NULL OR ms.academic_year_id = $1 OR ms.academic_year_id IS NULL)
            ORDER BY ms.year ASC, ms.month ASC
        `, [activeYearId]);

        const familySlipsMap = new Map();
        feeSlipsRes.rows.forEach(slip => {
            const famId = (slip.family_id || slip.stu_fam_id || '').trim();
            if (!famId) return;
            if (!familySlipsMap.has(famId)) familySlipsMap.set(famId, []);
            familySlipsMap.get(famId).push(slip);
        });

        const feeStatsMap = {};
        let totalAggBilled = 0;
        let totalAggPaid = 0;
        let totalAggBalance = 0;
        let aggPaidCount = 0;
        let aggPartialCount = 0;
        let aggUnpaidCount = 0;
        let aggSettledCount = 0;

        familySlipsMap.forEach((slips, fid) => {
            slips.sort((a, b) => (a.year - b.year) || (a.month - b.month));
            const latestSlip = slips[slips.length - 1];

            const famMembers = familiesMap[fid]?.members || [];
            const isTrusted = famMembers.length > 0
                ? evaluateMembersTrusted(famMembers, latestSlip.stu_category)
                : Boolean(latestSlip.stu_category && latestSlip.stu_category.toLowerCase().includes('trust'));
            const isSettled = ['satteled', 'settled'].includes((latestSlip.status || '').toLowerCase()) || isTrusted;

            const totalPaid = slips.reduce((sum, s) => sum + parseFloat(s.paid_amount || 0), 0);
            const totalBalance = isSettled ? 0 : Math.max(0, parseFloat(latestSlip.total_amount || 0) - parseFloat(latestSlip.paid_amount || 0));
            const totalBilled = totalPaid + totalBalance;

            let feeStatus = 'paid';
            if (isSettled) {
                feeStatus = 'settled';
                aggSettledCount++;
            } else if (totalBalance <= 0) {
                feeStatus = 'paid';
                aggPaidCount++;
            } else if (totalPaid > 0) {
                feeStatus = 'partial';
                aggPartialCount++;
            } else {
                feeStatus = 'unpaid';
                aggUnpaidCount++;
            }

            totalAggBilled += totalBilled;
            totalAggPaid += totalPaid;
            totalAggBalance += totalBalance;

            feeStatsMap[fid] = {
                total_billed: totalBilled,
                total_paid: totalPaid,
                total_balance: totalBalance,
                fee_status: feeStatus
            };
        });

        const familiesList = Object.values(familiesMap)
            .filter(fam => fam.members && fam.members.length > 0)
            .map(fam => {
            const members = fam.members;

            // Distinct Fathers & Multi-Household (Cousin) Detection
            const fatherMap = new Map();
            members.forEach(m => {
                const fn = (m.father_name || '').trim();
                if (fn) {
                    if (!fatherMap.has(fn)) {
                        fatherMap.set(fn, {
                            name: fn,
                            phone: (m.father_phone || '').trim(),
                            cnic: (m.father_cnic || '').trim(),
                            count: 1
                        });
                    } else {
                        const existing = fatherMap.get(fn);
                        existing.count++;
                        if (!existing.phone && m.father_phone) existing.phone = m.father_phone.trim();
                    }
                }
            });

            const fathersList = Array.from(fatherMap.values());
            const isCousinFamily = fathersList.length > 1;

            // Majority Father Name logic:
            let primaryFatherName = '';
            let maxCount = 0;
            fathersList.forEach(f => {
                if (f.count > maxCount) {
                    maxCount = f.count;
                    primaryFatherName = f.name;
                }
            });

            if (!primaryFatherName) {
                primaryFatherName = members.find(m => m.father_name)?.father_name ||
                    members.find(m => m.guardian_name)?.guardian_name ||
                    `Family (${fam.family_id})`;
            }

            const combinedFatherNames = isCousinFamily 
                ? fathersList.map(f => f.name).join(' & ') 
                : primaryFatherName;

            // Majority Mother Name
            const motherCounts = {};
            members.forEach(m => {
                if (m.mother_name) {
                    motherCounts[m.mother_name] = (motherCounts[m.mother_name] || 0) + 1;
                }
            });
            let primaryMotherName = '';
            let maxMCount = 0;
            for (const [mn, count] of Object.entries(motherCounts)) {
                if (count > maxMCount) {
                    maxMCount = count;
                    primaryMotherName = mn;
                }
            }
            if (!primaryMotherName) {
                primaryMotherName = members.find(m => m.mother_name)?.mother_name || '—';
            }

            // Contact Phones
            const fatherPhone = members.find(m => m.father_phone)?.father_phone || '';
            const motherPhone = members.find(m => m.mother_phone)?.mother_phone || '';
            const guardianPhone = members.find(m => m.guardian_phone)?.guardian_phone || '';
            const primaryPhone = fatherPhone || motherPhone || guardianPhone || '';

            const uniquePhones = Array.from(new Set(
                fathersList.map(f => f.phone).concat([fatherPhone, motherPhone, guardianPhone]).filter(Boolean)
            ));
            const combinedPhones = uniquePhones.join(', ');

            // Children list, Classes, Sections
            const childrenNames = members.map(m => m.full_name);
            const classesList = members.map(m => m.class_name);
            const sectionsList = members.map(m => m.section_name);

            // Trusted category evaluation
            const isAllTrusted = members.length > 0 && members.every(m => m.is_trusted);
            const hasTrusted = members.some(m => m.is_trusted);

            const feeStat = feeStatsMap[fam.family_id] || { total_billed: 0, total_paid: 0, total_balance: 0, fee_status: 'paid' };

            let finalFeeStatus = feeStat.fee_status;
            let finalBilled = feeStat.total_billed;
            let finalPaid = feeStat.total_paid;
            let finalBalance = feeStat.total_balance;

            if (isAllTrusted) {
                if (finalBalance <= 0 && finalBilled <= 0) {
                    finalFeeStatus = 'settled';
                    finalBilled = 0;
                    finalPaid = 0;
                    finalBalance = 0;
                } else if (finalBalance <= 0) {
                    finalFeeStatus = 'settled';
                }
            } else if (finalBalance === 0) {
                finalFeeStatus = 'paid';
            }

            // Effective monthly tuition fee calculation
            const memberMonthlySum = members
                .filter(m => (m.status || '').toLowerCase() === 'active')
                .reduce((sum, m) => sum + (parseFloat(m.monthly_fee) || 0), 0);
            const effectiveMonthlyFee = fam.family_fee > 0 ? fam.family_fee : memberMonthlySum;

            return {
                family_id: fam.family_id,
                family_name: primaryFatherName,
                father_name: primaryFatherName,
                mother_name: primaryMotherName,
                father_phone: fatherPhone,
                mother_phone: motherPhone,
                guardian_phone: guardianPhone,
                primary_phone: primaryPhone,
                is_cousin_family: isCousinFamily,
                is_trusted_family: isAllTrusted,
                has_trusted_members: hasTrusted,
                fathers_list: fathersList,
                combined_father_names: combinedFatherNames,
                combined_phones: combinedPhones,
                total_children: members.length,
                active_children: members.length,
                lead_student: members[0] || null,
                children_names: childrenNames,
                classes_list: classesList,
                sections_list: sectionsList,
                family_fee: fam.family_fee,
                effective_monthly_fee: effectiveMonthlyFee,
                opening_balance: fam.opening_balance,
                opening_balance_paid: fam.opening_balance_paid,
                advance_balance: fam.advance_balance || 0,
                opb_remaining: fam.opb_remaining,
                total_billed: finalBilled,
                total_paid: finalPaid,
                total_balance: finalBalance,
                fee_status: finalFeeStatus,
                members: members
            };
        });

        // Sequence Sort: Unpaid (1) -> Partial (2) -> Paid (3) -> Settled (4)
        const statusPriority = { unpaid: 1, partial: 2, paid: 3, settled: 4, satteled: 4 };

        familiesList.sort((a, b) => {
            const pA = statusPriority[a.fee_status] || 3;
            const pB = statusPriority[b.fee_status] || 3;
            if (pA !== pB) return pA - pB;
            return a.family_id.localeCompare(b.family_id, undefined, { numeric: true });
        });

        const totalStudents = familiesList.reduce((sum, f) => sum + f.members.length, 0);
        const totalFamilies = familiesList.length;

        res.json({
            families: familiesList,
            stats: {
                total_families: totalFamilies,
                total_students: totalStudents,
                average_family_size: totalFamilies > 0 ? (totalStudents / totalFamilies).toFixed(1) : 0,
                total_billed: parseFloat(totalAggBilled.toFixed(2)),
                total_paid: parseFloat(totalAggPaid.toFixed(2)),
                total_balance: parseFloat(totalAggBalance.toFixed(2)),
                paid_count: aggPaidCount,
                partial_count: aggPartialCount,
                unpaid_count: aggUnpaidCount,
                settled_count: aggSettledCount
            }
        });
    } catch (err) {
        console.error('Error fetching families directory:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /students/families/:family_id get family info including family_fee and members
router.get('/families/:family_id', async (req, res) => {
    try {
        const { family_id } = req.params;
        // Get family record (upsert if missing)
        let familyResult = await pool.query(
            `SELECT * FROM families WHERE family_id = $1::varchar`, [family_id]
        );
        if (familyResult.rows.length === 0) {
            // Create a stub record for this family_id
            await pool.query(
                `INSERT INTO families (family_id, family_fee) VALUES ($1::varchar, 0) ON CONFLICT DO NOTHING`, [family_id]
            );
            familyResult = await pool.query(`SELECT * FROM families WHERE family_id = $1::varchar`, [family_id]);
        }
        // Get all members
        const members = await pool.query(`
            SELECT s.student_id, s.admission_no, s.first_name, s.last_name,
                   s.monthly_fee, c.class_name, s.status
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            WHERE s.family_id = $1::varchar AND s.status = 'Active'
            ORDER BY c.class_id DESC NULLS LAST, s.first_name
        `, [family_id]);
        res.json({
            ...familyResult.rows[0],
            members: members.rows
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /students/families/:family_id/fee update family fee
router.put('/families/:family_id/fee', async (req, res) => {
    try {
        const { family_id } = req.params;
        const { family_fee } = req.body;
        if (family_fee === undefined || family_fee === null || isNaN(parseFloat(family_fee))) {
            return res.status(400).json({ error: 'family_fee is required and must be a number' });
        }
        const parsedFee = parseFloat(family_fee);
        // Upsert families record
        const result = await pool.query(`
            INSERT INTO families (family_id, family_fee)
            VALUES ($1::varchar, $2::numeric)
            ON CONFLICT (family_id) DO UPDATE SET family_fee = EXCLUDED.family_fee
            RETURNING *
        `, [family_id, parsedFee]);

        if (parsedFee > 0) {
            // Also update any student in this family whose monthly_fee is 0 or if there is only 1 active student
            await pool.query(`
                UPDATE students
                SET monthly_fee = $2::numeric
                WHERE family_id = $1::varchar AND (
                    monthly_fee IS NULL 
                    OR monthly_fee <= 0 
                    OR (SELECT COUNT(*) FROM students s2 WHERE s2.family_id = $1::varchar AND LOWER(COALESCE(s2.status, 'Active')) = 'active') = 1
                )
            `, [family_id, parsedFee]);
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// STUDENT MANAGEMENT API
// ==========================================

// 1. New Admission (Single Student)
router.post('/', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'documents', maxCount: 5 }]), async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            // Academic
            roll_no, class_id, section_id, admission_date, category,
            // Personal
            first_name, last_name, gender, dob, cnic_bform,
            religion, blood_group, has_disability, disability_details,
            // Contact
            mobile_no, email, current_address, permanent_address, city,
            // Parents
            father_name, father_phone, father_cnic, father_occupation,
            mother_name, mother_phone, mother_cnic, mother_occupation,
            // Guardian
            is_orphan, guardian_name, guardian_relation, guardian_phone, guardian_cnic, guardian_address,
            // Fees
            monthly_fee, admission_fee, other_charges,
            // Family fee (applies to the whole family unit)
            family_fee,
            // Opening Balance (previous dues before software was installed)
            opening_balance,
            // Family & Sibling - UPDATED for multiple siblings
            siblings // JSON array: [{sibling_id, relation_type}, ...]
        } = req.body;

        // Handle Files
        let image_url = null;
        if (req.files['image'] && req.files['image'][0]) {
            image_url = req.files['image'][0].path.replace(/\\/g, "/"); // Normalize path
        }

        let documents = [];
        if (req.files['documents']) {
            documents = req.files['documents'].map(f => f.path.replace(/\\/g, "/"));
        }

        await client.query('BEGIN');

        // Automatically sync PostgreSQL primary key sequences to prevent duplicate ID collisions
        const { syncAllSequences } = require('../utils/sequenceSync');
        await syncAllSequences(client);

        const dateObj = admission_date ? new Date(admission_date) : new Date();
        const month = dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const day = String(dateObj.getDate()).padStart(2, '0');
        const year = dateObj.getFullYear();

        // Format: MMMDDYYYY (e.g., FEB052026)
        const prefix = `${month}${day}${year}`;

        // Find latest admission number with this prefix
        const lastStudent = await client.query(
            "SELECT admission_no FROM students WHERE admission_no LIKE $1 ORDER BY admission_no DESC LIMIT 1",
            [`${prefix}%`]
        );

        let sequence = '001';
        if (lastStudent.rows.length > 0) {
            const lastAdm = lastStudent.rows[0].admission_no;
            const lastSeq = parseInt(lastAdm.replace(prefix, ''));
            if (!isNaN(lastSeq)) {
                sequence = String(lastSeq + 1).padStart(3, '0');
            }
        }

        const auto_admission_no = `${prefix}${sequence}`;

        // ----------------------------------------------------
        // FAMILY ID & SIBLING HANDLING (Multiple Siblings Support)
        // ----------------------------------------------------
        let family_id = null;
        let siblingsArray = [];

        // Parse siblings JSON if provided
        if (siblings) {
            try {
                siblingsArray = typeof siblings === 'string' ? JSON.parse(siblings) : siblings;
            } catch (err) {
                console.error('Error parsing siblings JSON:', err);
                siblingsArray = [];
            }
        }

        // If student has siblings, get/assign family_id
        if (siblingsArray.length > 0) {
            // Get family_id from first sibling
            const firstSiblingId = siblingsArray[0].sibling_id;
            const siblingResult = await client.query(
                `SELECT family_id FROM students WHERE student_id = $1`,
                [firstSiblingId]
            );

            if (siblingResult.rows.length > 0) {
                family_id = siblingResult.rows[0].family_id;

                // If sibling doesn't have family_id, generate one and update all siblings
                if (!family_id) {
                    family_id = await generateFamilyId(client);
                    // Update all siblings with the new family_id
                    for (const sib of siblingsArray) {
                        await client.query(
                            `UPDATE students SET family_id = $1::varchar WHERE student_id = $2::int`,
                            [family_id, sib.sibling_id]
                        );
                    }
                }
            }
        }

        // If no siblings or sibling not found, generate new family_id
        if (!family_id) {
            family_id = await generateFamilyId(client);
        }

        // -------------------------------------------------------
        // UPSERT INTO families TABLE (ensure record always exists)
        // If family_fee is provided, update it. Otherwise keep existing.
        // If opening_balance is provided, set it on the family.
        // -------------------------------------------------------
                const familyFeeVal = parseFloat(family_fee) || 0;
        const opbVal = parseFloat(opening_balance) || 0;
        const cleanFatherName = father_name && String(father_name).trim() !== '' ? String(father_name).trim() : null;
        const cleanFatherPhone = father_phone && String(father_phone).trim() !== '' ? String(father_phone).trim() : null;
        const cleanGuardianName = guardian_name && String(guardian_name).trim() !== '' ? String(guardian_name).trim() : null;
        const cleanGuardianPhone = guardian_phone && String(guardian_phone).trim() !== '' ? String(guardian_phone).trim() : null;
        const contactName = cleanFatherName || cleanGuardianName;
        const contactPhone = cleanFatherPhone || cleanGuardianPhone;

        await client.query(`
            INSERT INTO families (family_id, family_fee, opening_balance, primary_contact_name, primary_contact_phone, created_at)
            VALUES ($1::varchar, $2::numeric, $3::numeric, $4::varchar, $5::varchar, NOW())
            ON CONFLICT (family_id) DO UPDATE
                SET family_fee = CASE 
                    WHEN $2::numeric > 0 THEN $2::numeric 
                    ELSE families.family_fee 
                END,
                opening_balance = CASE
                    WHEN $3::numeric > 0 THEN $3::numeric
                    ELSE families.opening_balance
                END,
                primary_contact_name = COALESCE(families.primary_contact_name, $4::varchar),
                primary_contact_phone = COALESCE(families.primary_contact_phone, $5::varchar)
        `, [family_id, familyFeeVal, opbVal, contactName, contactPhone]);

        // Determine primary sibling_relation for the student record
        // Use 'blood' if any sibling is blood relation, otherwise 'cousin'
        let final_sibling_relation = null;
        if (siblingsArray.length > 0) {
            const hasBloodSibling = siblingsArray.some(s => s.relation_type === 'blood');
            final_sibling_relation = hasBloodSibling ? 'blood' : 'cousin';
        }

        // ----------------------------------------------------
        // USER CREDENTIALS GENERATION
        // ----------------------------------------------------
        let username = `STU-${auto_admission_no}`;

        let uIdx = 1;
        let isUnique = false;
        while (!isUnique) {
            const uCheck = await client.query('SELECT id FROM app_users WHERE username = $1', [username]);
            if (uCheck.rows.length === 0) {
                isUnique = true;
            } else {
                username = `STU-${auto_admission_no}-${uIdx}`;
                uIdx++;
            }
        }

        // Default Password: 'student123' (Hashed)
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash('student123', salt);

        // Get Role ID for 'Student'
        let roleRes = await client.query("SELECT id FROM app_roles WHERE role_name = 'Student'");
        let role_id;
        if (roleRes.rows.length === 0) {
            const newRole = await client.query("INSERT INTO app_roles (role_name, description) VALUES ('Student', 'Standard Student Access') RETURNING id");
            role_id = newRole.rows[0].id;
        } else {
            role_id = roleRes.rows[0].id;
        }

        // Create User
        const newUser = await client.query(
            `INSERT INTO app_users (username, password_hash, plain_password, full_name, email, role_id, is_active)
             VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::int, true) RETURNING id`,
            [username, password_hash, 'student123', `${first_name} ${last_name}`, email, role_id]
        );
        const user_id = newUser.rows[0].id;

        // ----------------------------------------------------
        // STUDENT CREATION
        // ----------------------------------------------------

                const validDob = dob && String(dob).trim() !== '' ? String(dob).trim() : null;
        const validAdmDate = admission_date && String(admission_date).trim() !== '' ? String(admission_date).trim() : new Date();

        const newStudent = await client.query(
            `INSERT INTO students (
                admission_no, roll_no, class_id, section_id, admission_date, category,
                first_name, last_name, gender, dob, cnic_bform,
                religion, blood_group, has_disability, disability_details,
                student_mobile, email, current_address, permanent_address, city,
                father_name, father_phone, father_cnic, father_occupation,
                mother_name, mother_phone, mother_cnic, mother_occupation,
                is_orphan, guardian_name, guardian_relation, guardian_phone, guardian_cnic, guardian_address,
                monthly_fee, admission_fee, other_charges,
                image_url, documents, user_id,
                family_id, sibling_relation
            ) VALUES (
                $1::varchar, $2::varchar, $3::int, $4::int, $5::date, $6::varchar,
                $7::varchar, $8::varchar, $9::varchar, $10::date, $11::varchar,
                $12::varchar, $13::varchar, $14::boolean, $15::varchar,
                $16::varchar, $17::varchar, $18::varchar, $19::varchar, $20::varchar,
                $21::varchar, $22::varchar, $23::varchar, $24::varchar,
                $25::varchar, $26::varchar, $27::varchar, $28::varchar,
                $29::boolean, $30::varchar, $31::varchar, $32::varchar, $33::varchar, $34::varchar,
                $35::numeric, $36::numeric, $37::numeric,
                $38::varchar, $39::text, $40::int,
                $41::varchar, $42::varchar
            )
            RETURNING *`,
            [
                auto_admission_no,
                roll_no && String(roll_no).trim() !== '' ? String(roll_no).trim() : null,
                class_id && !isNaN(parseInt(class_id, 10)) ? parseInt(class_id, 10) : null,
                section_id && !isNaN(parseInt(section_id, 10)) ? parseInt(section_id, 10) : null,
                validAdmDate,
                category || 'Normal',
                first_name ? String(first_name).trim() : '',
                last_name && String(last_name).trim() !== '' ? String(last_name).trim() : null,
                gender && String(gender).trim() !== '' ? String(gender).trim() : null,
                validDob,
                cnic_bform && String(cnic_bform).trim() !== '' ? String(cnic_bform).trim() : null,
                religion && String(religion).trim() !== '' ? String(religion).trim() : null,
                blood_group && String(blood_group).trim() !== '' ? String(blood_group).trim() : null,
                has_disability === 'true' || has_disability === true,
                disability_details && String(disability_details).trim() !== '' ? String(disability_details).trim() : null,
                mobile_no && String(mobile_no).trim() !== '' ? String(mobile_no).trim() : null,
                email && String(email).trim() !== '' ? String(email).trim() : null,
                current_address && String(current_address).trim() !== '' ? String(current_address).trim() : null,
                permanent_address && String(permanent_address).trim() !== '' ? String(permanent_address).trim() : null,
                city && String(city).trim() !== '' ? String(city).trim() : null,
                cleanFatherName,
                cleanFatherPhone,
                father_cnic && String(father_cnic).trim() !== '' ? String(father_cnic).trim() : null,
                father_occupation && String(father_occupation).trim() !== '' ? String(father_occupation).trim() : null,
                mother_name && String(mother_name).trim() !== '' ? String(mother_name).trim() : null,
                mother_phone && String(mother_phone).trim() !== '' ? String(mother_phone).trim() : null,
                mother_cnic && String(mother_cnic).trim() !== '' ? String(mother_cnic).trim() : null,
                mother_occupation && String(mother_occupation).trim() !== '' ? String(mother_occupation).trim() : null,
                is_orphan === 'true' || is_orphan === true,
                cleanGuardianName,
                guardian_relation && String(guardian_relation).trim() !== '' ? String(guardian_relation).trim() : null,
                cleanGuardianPhone,
                guardian_cnic && String(guardian_cnic).trim() !== '' ? String(guardian_cnic).trim() : null,
                guardian_address && String(guardian_address).trim() !== '' ? String(guardian_address).trim() : null,
                (parseFloat(monthly_fee) > 0 ? parseFloat(monthly_fee) : (familyFeeVal > 0 ? familyFeeVal : 0)),
                parseFloat(admission_fee) || 0,
                parseFloat(other_charges) || 0,
                image_url,
                JSON.stringify(documents),
                user_id,
                family_id,
                final_sibling_relation
            ]
        );

        const new_student_id = newStudent.rows[0].student_id;

        // If family fee is set, ensure all siblings in this family also have positive monthly_fee
        if (familyFeeVal > 0) {
            await client.query(`
                UPDATE students
                SET monthly_fee = $2::numeric
                WHERE family_id = $1::varchar AND (monthly_fee IS NULL OR monthly_fee <= 0)
            `, [family_id, familyFeeVal]);
        }

        // Create sibling relationships for all siblings
        if (siblingsArray.length > 0) {
            for (const sibling of siblingsArray) {
                const { sibling_id, relation_type } = sibling;

                // Create forward relationship
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1::int, $2::int, $3::varchar)
                     ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                    [new_student_id, sibling_id, relation_type]
                );

                // Create reverse relationship
                await client.query(
                    `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                     VALUES ($1::int, $2::int, $3::varchar)
                     ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                    [sibling_id, new_student_id, relation_type]
                );
            }
        }

        // -------------------------------------------------------
        // AUTO-CREATE ADMISSION FEE LEDGER
        // If admission_fee > 0, create a ledger entry for this
        // student that will track outstanding balance until paid
        // -------------------------------------------------------
        const admFeeVal = parseFloat(admission_fee) || 0;
        if (admFeeVal > 0) {
            const activeYearRes = await client.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            const activeYearId = activeYearRes.rows[0]?.id || null;

            await client.query(`
                INSERT INTO admission_fee_ledger
                    (student_id, total_amount, paid_amount, status, admission_date, notes, academic_year_id)
                VALUES ($1::int, $2::numeric, 0, 'unpaid', $3::date, 'Auto-created on admission', $4::int)
                ON CONFLICT (student_id) DO UPDATE
                    SET total_amount = EXCLUDED.total_amount,
                        status = CASE WHEN EXCLUDED.total_amount = 0 THEN 'paid' ELSE 'unpaid' END,
                        academic_year_id = COALESCE(admission_fee_ledger.academic_year_id, EXCLUDED.academic_year_id)
            `, [new_student_id, admFeeVal, admission_date || new Date(), activeYearId]);
        }

        await client.query('COMMIT');

        try {
            const { notifyPermission } = require('../utils/notify');
            const sName = `${first_name || ''} ${last_name || ''}`.trim() || 'Student';
            await notifyPermission('students.admission', {
                type: 'admission',
                title: 'New Student Admitted 🎓',
                message: `New admission: ${sName} (Roll: ${roll_no || 'N/A'}) enrolled. Family ID: ${family_id || 'N/A'}.`,
                link: '/students/details',
                clientOrPool: pool
            });
        } catch (notifErr) {
            console.error("Student admission notification error:", notifErr.message);
        }

        // Return student with family_fee info
        const familyInfo = await pool.query(`SELECT family_fee FROM families WHERE family_id = $1`, [family_id]);
        const studentRow = newStudent.rows[0];
        studentRow.family_fee = familyInfo.rows[0]?.family_fee || 0;
        res.json(newStudent.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            console.log("UNIQUE CONSTRAINT VIOLATION:", err.detail);
            return res.status(400).json({ error: "System generated a duplicate Admission No or Username (" + err.detail + "). Please try again." });
        }
        console.error(err.message);
        res.status(500).json({ error: "Server Error: " + err.message });
    } finally {
        client.release();
    }
});

// 2. Bulk Import
router.post('/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
        const { students } = req.body; // Expecting array of objects
        if (!students || !Array.isArray(students)) {
            return res.status(400).json({ error: "Invalid data format. Expected array of students." });
        }

        await client.query('BEGIN');

        const results = {
            success: 0,
            failed: 0,
            errors: [],
            familyStats: {
                newFamilies: 0,
                linkedByCNIC: 0,
                linkedByNamePhone: 0,
                totalStudents: 0
            }
        };

        // 1. Pre-fetch Classes and Sections for Name-to-ID Resolution
        const allClasses = await client.query("SELECT class_id, class_name FROM classes");
        const allSections = await client.query("SELECT section_id, section_name, class_id FROM sections");

        // Helper to find ID (Case Insensitive)
        const getClassId = (name) => {
            if (!name) return null;
            // If already numeric, return it
            if (!isNaN(name)) return parseInt(name);
            const found = allClasses.rows.find(c => c.class_name.trim().toLowerCase() === String(name).trim().toLowerCase());
            return found ? found.class_id : null;
        };

        const getSectionId = (secName, clsId) => {
            if (!secName || !clsId) return null;
            if (!isNaN(secName)) return parseInt(secName);
            const found = allSections.rows.find(s =>
                s.class_id === clsId &&
                s.section_name.trim().toLowerCase() === String(secName).trim().toLowerCase()
            );
            return found ? found.section_id : null;
        };

        let studentIdx = 0;
        for (const rawS of students) {
            studentIdx++;
            const spName = "sp_student_" + studentIdx;
            try { await client.query("SAVEPOINT " + spName); } catch (e) { }

            let s = {};
            try {
                // Normalize incoming keys to handle Excel header variations
                Object.keys(rawS).forEach(key => {
                    const normKey = key.trim().toLowerCase().replace(/\s+/g, '_');
                    s[normKey] = rawS[key];
                    // Also support common variants
                    if (normKey === 'class_name' || normKey === 'class') s.class_name = rawS[key];
                    if (normKey === 'section_name' || normKey === 'section') s.section_name = rawS[key];
                    if (normKey === 'firstname' || normKey === 'first_name') s.first_name = rawS[key];
                    if (normKey === 'lastname' || normKey === 'last_name') s.last_name = rawS[key];
                });

                // Helper to parse Excel dates (which might come as epoch numbers)
                const parseDate = (d) => {
                    if (!d) return null;
                    if (!isNaN(d) && typeof d === 'number') {
                        // Excel epoch to JS Date
                        return new Date(Math.round((d - 25569) * 86400 * 1000));
                    }
                    return new Date(d);
                };

                // Resolve IDs
                let targetClassId = getClassId(s.class_name || s.class_id);
                let targetSectionId = getSectionId(s.section_name || s.section_id, targetClassId);

                if (!targetClassId) throw new Error(`Class '${s.class_name || s.class_id || 'Empty'}' not found.`);
                if (!targetSectionId) throw new Error(`Section '${s.section_name || s.section_id || 'Empty'}' not found in Class.`);

                // Parse dates properly
                s.dob = parseDate(s.dob);
                s.admission_date = parseDate(s.admission_date);

                // Auto ID Generation Logic if not provided
                let finalAdmissionNo = s.admission_no;
                if (!finalAdmissionNo || finalAdmissionNo === 'AUTO') {
                    const dateObj = s.admission_date ? new Date(s.admission_date) : new Date();
                    const month = dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase();
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    const year = dateObj.getFullYear();
                    const prefix = `${month}${day}${year}`;

                    // Check for collision in current transaction or DB
                    // Note: In high volume bulk, this sequential query might be slow. 
                    // Optimization: We could lock table or use a sequence. 
                    // For now, we trust the iterative select-insert.

                    const lastStudentResult = await client.query(
                        "SELECT admission_no FROM students WHERE admission_no LIKE $1 ORDER BY admission_no DESC LIMIT 1",
                        [`${prefix}%`]
                    );

                    let sequence = '001';
                    if (lastStudentResult.rows.length > 0) {
                        const lastAdm = lastStudentResult.rows[0].admission_no;
                        const lastSeq = parseInt(lastAdm.replace(prefix, ''));
                        if (!isNaN(lastSeq)) {
                            sequence = String(lastSeq + 1).padStart(3, '0');
                        }
                    }
                    finalAdmissionNo = `${prefix}${sequence}`;
                }

                // ============================================
                // PHASE 1: CNIC-BASED FAMILY LINKING
                // ============================================
                let family_id = null;
                let linkage_source = 'new';
                let sibling_relation = null;

                // Strategy 1: Father CNIC Match (Most Reliable)
                if (s.father_cnic && s.father_cnic.trim() !== '') {
                    const existingFamily = await client.query(
                        `SELECT family_id, student_id, first_name 
                         FROM students 
                         WHERE father_cnic = $1 
                         ORDER BY created_at DESC 
                         LIMIT 1`,
                        [s.father_cnic.trim()]
                    );

                    if (existingFamily.rows.length > 0) {
                        family_id = existingFamily.rows[0].family_id;
                        linkage_source = 'cnic_match';
                        sibling_relation = 'blood';
                        results.familyStats.linkedByCNIC++;
                    }
                }

                // Strategy 2: Father Name + Phone Match (Backup)
                if (!family_id && s.father_name && s.father_phone) {
                    const phoneMatch = await client.query(
                        `SELECT family_id, student_id 
                         FROM students 
                         WHERE LOWER(father_name) = LOWER($1) 
                           AND father_phone = $2
                         LIMIT 1`,
                        [s.father_name.trim(), s.father_phone.trim()]
                    );

                    if (phoneMatch.rows.length > 0) {
                        family_id = phoneMatch.rows[0].family_id;
                        linkage_source = 'name_phone_match';
                        sibling_relation = 'blood';
                        results.familyStats.linkedByNamePhone++;
                    }
                }

                // Strategy 3: Generate NEW Family ID
                if (!family_id) {
                    family_id = await generateFamilyId(client);
                    linkage_source = 'new_family';
                    results.familyStats.newFamilies++;
                }

                // Insert Student with Family ID
                const insertResult = await client.query(
                    `INSERT INTO students (
                        admission_no, roll_no, class_id, section_id, admission_date, category,
                        first_name, last_name, gender, dob, cnic_bform,
                        religion, blood_group, 
                        student_mobile, email, current_address, permanent_address, city,
                        father_name, father_phone, father_cnic, father_occupation,
                        mother_name, mother_phone, mother_cnic, mother_occupation,
                        guardian_name, guardian_relation, guardian_phone, guardian_cnic, guardian_address,
                        monthly_fee, admission_fee, family_id, sibling_relation
                    ) VALUES (
                        $1::varchar, $2::varchar, $3::int, $4::int, $5::date, $6::varchar,
                        $7::varchar, $8::varchar, $9::varchar, $10::date, $11::varchar,
                        $12::varchar, $13::varchar, 
                        $14::varchar, $15::varchar, $16::varchar, $17::varchar, $18::varchar,
                        $19::varchar, $20::varchar, $21::varchar, $22::varchar,
                        $23::varchar, $24::varchar, $25::varchar, $26::varchar,
                        $27::varchar, $28::varchar, $29::varchar, $30::varchar, $31::varchar,
                        $32::numeric, $33::numeric, $34::varchar, $35::varchar
                    )
                    RETURNING student_id`,
                    [
                        finalAdmissionNo, s.roll_no, targetClassId, targetSectionId, s.admission_date || new Date(), s.category || 'Normal',
                        s.first_name, s.last_name, s.gender, s.dob, s.cnic_bform,
                        s.religion, s.blood_group,
                        s.student_mobile, s.email, s.current_address, s.permanent_address, s.city,
                        s.father_name, s.father_phone, s.father_cnic, s.father_occupation,
                        s.mother_name, s.mother_phone, s.mother_cnic, s.mother_occupation,
                        s.guardian_name, s.guardian_relation, s.guardian_phone, s.guardian_cnic, s.guardian_address,
                        s.monthly_fee || 0, s.admission_fee || 0, family_id, sibling_relation
                    ]
                );

                const newStudentId = insertResult.rows[0].student_id;

                // Create Sibling Relationships if linked
                if (linkage_source === 'cnic_match' || linkage_source === 'name_phone_match') {
                    const siblings = await client.query(
                        `SELECT student_id FROM students 
                         WHERE family_id = $1 AND student_id != $2`,
                        [family_id, newStudentId]
                    );

                    for (const sibling of siblings.rows) {
                        await client.query(
                            `INSERT INTO student_siblings (student_id, sibling_id, relation_type)
                             VALUES ($1::int, $2::int, 'blood'), ($2::int, $1::int, 'blood')
                             ON CONFLICT (student_id, sibling_id) DO NOTHING`,
                            [newStudentId, sibling.student_id]
                        );
                    }
                }

                // Upsert families record (with optional opening_balance)
                const bulkFamilyFee = parseFloat(s.family_fee) || 0;
                const bulkOpb = parseFloat(s.opening_balance) || 0;
                await client.query(`
                    INSERT INTO families (family_id, family_fee, opening_balance, created_at)
                    VALUES ($1::varchar, $2::numeric, $3::numeric, NOW())
                    ON CONFLICT (family_id) DO UPDATE
                        SET family_fee = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE families.family_fee END,
                            opening_balance = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE families.opening_balance END
                `, [family_id, bulkFamilyFee, bulkOpb]);

                // Handle User Profile for Bulk Import
                let username = 'STU-' + finalAdmissionNo;
                let uIdx = 1;
                let isUnique = false;
                while (!isUnique) {
                    const existRes = await client.query('SELECT id FROM app_users WHERE username = $1', [username]);
                    if (existRes.rows.length === 0) {
                        isUnique = true;
                    } else {
                        username = 'STU-' + finalAdmissionNo + '-' + uIdx;
                        uIdx++;
                    }
                }
                const salt = await bcrypt.genSalt(10);
                const password_hash = await bcrypt.hash('student123', salt);

                let roleRes = await client.query("SELECT id FROM app_roles WHERE role_name = 'Student'");
                let role_id = roleRes.rows.length > 0 ? roleRes.rows[0].id : null;
                if (!role_id) {
                    const newRole = await client.query("INSERT INTO app_roles (role_name, description) VALUES ('Student', 'Standard Access') RETURNING id");
                    role_id = newRole.rows[0].id;
                }

                const newUser = await client.query(
                    "INSERT INTO app_users (username, password_hash, plain_password, full_name, email, role_id, is_active) VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::int, true) RETURNING id",
                    [username, password_hash, 'student123', (s.first_name + ' ' + (s.last_name || '')).trim(), s.email || '', role_id]
                );
                const user_id = newUser.rows[0].id;

                await client.query("UPDATE students SET user_id = $1::int WHERE student_id = $2::int", [user_id, newStudentId]);

                results.success++;
                results.familyStats.totalStudents++;
            } catch (err) {
                try { await client.query("ROLLBACK TO SAVEPOINT " + spName); } catch (e) { }

                // If collision on generated ID (race condition), retry logic could be added here
                results.failed++;
                results.errors.push({ name: s.first_name || rawS.first_name || rawS['First Name'] || 'Unknown Student', error: err.message });
            }
        }

        await client.query('COMMIT');
        res.json({ message: "Import processing complete", results });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Server Error during bulk import" });
    } finally {
        client.release();
    }
});

// 3. Get All Students (With Filters)
router.get('/', async (req, res) => {
    try {
        const { class_id, section_id, gender, keyword, category, status, blood_group, is_orphan, family_id, age, religion } = req.query;

        let query = `
            SELECT s.*, c.class_name, sec.section_name, u.username, u.plain_password as system_pwd
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN app_users u ON s.user_id = u.id 
            WHERE 1=1`;
        const params = [];
        let paramCount = 1;

        if (class_id && class_id.trim() !== '') {
            query += ` AND s.class_id = $${paramCount}`;
            params.push(class_id.trim());
            paramCount++;
        }

        if (section_id && section_id.trim() !== '') {
            query += ` AND s.section_id = $${paramCount}`;
            params.push(section_id.trim());
            paramCount++;
        }

        if (gender && gender.trim() !== '') {
            query += ` AND LOWER(TRIM(s.gender)) = LOWER($${paramCount})`;
            params.push(gender.trim());
            paramCount++;
        }

        if (category && category.trim() !== '') {
            query += ` AND LOWER(TRIM(s.category)) = LOWER($${paramCount})`;
            params.push(category.trim());
            paramCount++;
        }

        if (status && status.trim() !== '') {
            query += ` AND LOWER(TRIM(s.status)) = LOWER($${paramCount})`;
            params.push(status.trim());
            paramCount++;
        }

        if (blood_group && blood_group.trim() !== '') {
            query += ` AND LOWER(TRIM(s.blood_group)) = LOWER($${paramCount})`;
            params.push(blood_group.trim());
            paramCount++;
        }

        if (is_orphan !== undefined && is_orphan !== null && is_orphan !== '') {
            query += ` AND s.is_orphan = $${paramCount}`;
            params.push(is_orphan === 'true' || is_orphan === true);
            paramCount++;
        }

        if (family_id && family_id.trim() !== '') {
            query += ` AND s.family_id ILIKE $${paramCount}`;
            params.push(`%${family_id.trim()}%`);
            paramCount++;
        }

        if (keyword && keyword.trim() !== '') {
            const kw = keyword.trim();
            query += ` AND (
                s.first_name ILIKE $${paramCount} OR 
                s.last_name ILIKE $${paramCount} OR 
                CONCAT(s.first_name, ' ', s.last_name) ILIKE $${paramCount} OR
                CONCAT(s.last_name, ' ', s.first_name) ILIKE $${paramCount} OR
                s.admission_no ILIKE $${paramCount} OR
                s.roll_no ILIKE $${paramCount} OR
                s.father_name ILIKE $${paramCount} OR
                s.mother_name ILIKE $${paramCount} OR
                s.guardian_name ILIKE $${paramCount} OR
                s.student_mobile ILIKE $${paramCount} OR
                s.father_phone ILIKE $${paramCount} OR
                s.family_id ILIKE $${paramCount} OR
                u.username ILIKE $${paramCount}
            )`;
            params.push(`%${kw}%`);
            paramCount++;
        }

        if (age && age.toString().trim() !== '' && !isNaN(parseInt(age.toString()))) {
            query += ` AND s.dob IS NOT NULL AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, s.dob)) = $${paramCount}::int`;
            params.push(parseInt(age.toString()));
            paramCount++;
        }

        if (religion && religion.trim() !== '') {
            query += ` AND LOWER(TRIM(s.religion)) = LOWER($${paramCount})`;
            params.push(religion.trim());
            paramCount++;
        }

        query += ` ORDER BY s.class_id NULLS LAST, s.section_id NULLS LAST, s.roll_no NULLS LAST, s.first_name`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error("Error in GET /students:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// 4. Get Single Student
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const student = await pool.query(`
            SELECT s.*, c.class_name, sec.section_name, u.username, u.plain_password as system_pwd,
                   COALESCE(f.family_fee, 0) AS family_fee,
                   COALESCE(f.opening_balance, 0) AS opening_balance,
                   COALESCE(f.opening_balance_paid, 0) AS opening_balance_paid,
                   GREATEST(0, COALESCE(f.opening_balance, 0) - COALESCE(f.opening_balance_paid, 0)) AS opb_remaining,
                   COALESCE(f.advance_balance, s.advance_balance, 0) AS advance_balance,
                   f.opb_notes,
                   (SELECT COUNT(*)::int FROM students s2 WHERE s2.family_id = s.family_id AND s2.status = 'Active') AS family_size
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN sections sec ON s.section_id = sec.section_id
            LEFT JOIN app_users u ON s.user_id = u.id
            LEFT JOIN families f ON f.family_id = s.family_id
            WHERE s.student_id = $1
        `, [id]);

        if (student.rows.length === 0) return res.status(404).json({ error: "Student not found" });
        const studentData = student.rows[0];
        if (parseFloat(studentData.monthly_fee || 0) <= 0 && parseFloat(studentData.family_fee || 0) > 0) {
            studentData.monthly_fee = studentData.family_fee;
        }
        res.json(studentData);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// 5. Update Student (Full Edit)
router.put('/:id', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'documents', maxCount: 5 }]), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const {
            roll_no, class_id, section_id, admission_date, category,
            first_name, last_name, gender, dob, cnic_bform,
            religion, blood_group, has_disability, disability_details,
            mobile_no, email, current_address, permanent_address, city,
            father_name, father_phone, father_cnic, father_occupation,
            mother_name, mother_phone, mother_cnic, mother_occupation,
            is_orphan, guardian_name, guardian_relation, guardian_phone, guardian_cnic, guardian_address,
            monthly_fee, admission_fee, other_charges,
            family_fee, opening_balance
        } = req.body;

        // Handle Files
        let image_url = req.body.existing_image_url || null;
        if (req.files['image'] && req.files['image'][0]) {
            image_url = req.files['image'][0].path.replace(/\\/g, "/");
        }

        let documents = [];
        if (req.body.existing_documents) {
            try { documents = JSON.parse(req.body.existing_documents); } catch (e) { }
        }
        if (req.files['documents']) {
            const newDocs = req.files['documents'].map(f => f.path.replace(/\\/g, "/"));
            documents = [...documents, ...newDocs];
        }

        await client.query('BEGIN');

        // Fetch current student's existing details before updating
        const existingStudentRes = await client.query(`
            SELECT student_id, family_id, father_name, father_phone, father_cnic, father_occupation
            FROM students
            WHERE student_id = $1
        `, [id]);

        if (existingStudentRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Student not found" });
        }

        const existingStudent = existingStudentRes.rows[0];
        const oldFamilyId = existingStudent.family_id;
        const oldFatherName = (existingStudent.father_name || '').trim();
        const oldFatherPhone = (existingStudent.father_phone || '').trim();

                const updateQ = `UPDATE students SET
            roll_no=$1::varchar, class_id=$2::int, section_id=$3::int, admission_date=$4::date, category=$5::varchar,
            first_name=$6::varchar, last_name=$7::varchar, gender=$8::varchar, dob=$9::date, cnic_bform=$10::varchar,
            religion=$11::varchar, blood_group=$12::varchar, has_disability=$13::boolean, disability_details=$14::varchar,
            student_mobile=$15::varchar, email=$16::varchar, current_address=$17::varchar, permanent_address=$18::varchar, city=$19::varchar,
            father_name=$20::varchar, father_phone=$21::varchar, father_cnic=$22::varchar, father_occupation=$23::varchar,
            mother_name=$24::varchar, mother_phone=$25::varchar, mother_cnic=$26::varchar, mother_occupation=$27::varchar,
            is_orphan=$28::boolean, guardian_name=$29::varchar, guardian_relation=$30::varchar, guardian_phone=$31::varchar, guardian_cnic=$32::varchar, guardian_address=$33::varchar,
            monthly_fee=$34::numeric, admission_fee=$35::numeric, other_charges=$36::numeric,
            image_url=$37::varchar, documents=$38::text
            WHERE student_id=$39::int RETURNING user_id, family_id`;

        const vals = [
            roll_no && String(roll_no).trim() !== '' ? String(roll_no).trim() : null,
            class_id && !isNaN(parseInt(class_id, 10)) ? parseInt(class_id, 10) : null,
            section_id && !isNaN(parseInt(section_id, 10)) ? parseInt(section_id, 10) : null,
            admission_date && String(admission_date).trim() !== '' ? String(admission_date).trim() : null,
            category || 'Normal',
            first_name ? String(first_name).trim() : '',
            last_name && String(last_name).trim() !== '' ? String(last_name).trim() : null,
            gender && String(gender).trim() !== '' ? String(gender).trim() : null,
            dob && String(dob).trim() !== '' ? String(dob).trim() : null,
            cnic_bform && String(cnic_bform).trim() !== '' ? String(cnic_bform).trim() : null,
            religion && String(religion).trim() !== '' ? String(religion).trim() : null,
            blood_group && String(blood_group).trim() !== '' ? String(blood_group).trim() : null,
            has_disability === 'true' || has_disability === true,
            disability_details && String(disability_details).trim() !== '' ? String(disability_details).trim() : null,
            mobile_no && String(mobile_no).trim() !== '' ? String(mobile_no).trim() : null,
            email && String(email).trim() !== '' ? String(email).trim() : null,
            current_address && String(current_address).trim() !== '' ? String(current_address).trim() : null,
            permanent_address && String(permanent_address).trim() !== '' ? String(permanent_address).trim() : null,
            city && String(city).trim() !== '' ? String(city).trim() : null,
            father_name && String(father_name).trim() !== '' ? String(father_name).trim() : null,
            father_phone && String(father_phone).trim() !== '' ? String(father_phone).trim() : null,
            father_cnic && String(father_cnic).trim() !== '' ? String(father_cnic).trim() : null,
            father_occupation && String(father_occupation).trim() !== '' ? String(father_occupation).trim() : null,
            mother_name && String(mother_name).trim() !== '' ? String(mother_name).trim() : null,
            mother_phone && String(mother_phone).trim() !== '' ? String(mother_phone).trim() : null,
            mother_cnic && String(mother_cnic).trim() !== '' ? String(mother_cnic).trim() : null,
            mother_occupation && String(mother_occupation).trim() !== '' ? String(mother_occupation).trim() : null,
            is_orphan === 'true' || is_orphan === true,
            guardian_name && String(guardian_name).trim() !== '' ? String(guardian_name).trim() : null,
            guardian_relation && String(guardian_relation).trim() !== '' ? String(guardian_relation).trim() : null,
            guardian_phone && String(guardian_phone).trim() !== '' ? String(guardian_phone).trim() : null,
            guardian_cnic && String(guardian_cnic).trim() !== '' ? String(guardian_cnic).trim() : null,
            guardian_address && String(guardian_address).trim() !== '' ? String(guardian_address).trim() : null,
            ((!isNaN(parseFloat(monthly_fee)) && parseFloat(monthly_fee) > 0) 
                ? parseFloat(monthly_fee) 
                : ((!isNaN(parseFloat(family_fee)) && parseFloat(family_fee) > 0) ? parseFloat(family_fee) : 0)),
            !isNaN(parseFloat(admission_fee)) ? parseFloat(admission_fee) : 0,
            !isNaN(parseFloat(other_charges)) ? parseFloat(other_charges) : 0,
            image_url || null,
            JSON.stringify(documents),
            id
        ];

        const resUpd = await client.query(updateQ, vals);

        if (resUpd.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Student not found" });
        }

        const user_id = resUpd.rows[0].user_id;
        const fam_id_updated = resUpd.rows[0].family_id || oldFamilyId;

                // Auto-propagate parent & contact details to all same-father siblings in the same family
        let siblingsUpdatedCount = 0;
        const cleanFatherName = father_name && String(father_name).trim() !== '' ? String(father_name).trim() : null;
        const cleanFatherPhone = father_phone && String(father_phone).trim() !== '' ? String(father_phone).trim() : null;
        const cleanFatherCnic = father_cnic && String(father_cnic).trim() !== '' ? String(father_cnic).trim() : null;
        const cleanFatherOcc = father_occupation && String(father_occupation).trim() !== '' ? String(father_occupation).trim() : null;
        const cleanMotherName = mother_name && String(mother_name).trim() !== '' ? String(mother_name).trim() : null;
        const cleanMotherPhone = mother_phone && String(mother_phone).trim() !== '' ? String(mother_phone).trim() : null;
        const cleanMotherCnic = mother_cnic && String(mother_cnic).trim() !== '' ? String(mother_cnic).trim() : null;
        const cleanMotherOcc = mother_occupation && String(mother_occupation).trim() !== '' ? String(mother_occupation).trim() : null;
        const cleanCurrentAddress = current_address && String(current_address).trim() !== '' ? String(current_address).trim() : null;
        const cleanPermanentAddress = permanent_address && String(permanent_address).trim() !== '' ? String(permanent_address).trim() : null;
        const cleanCity = city && String(city).trim() !== '' ? String(city).trim() : null;
        const cleanGuardianName = guardian_name && String(guardian_name).trim() !== '' ? String(guardian_name).trim() : null;
        const cleanGuardianPhone = guardian_phone && String(guardian_phone).trim() !== '' ? String(guardian_phone).trim() : null;
        const cleanGuardianCnic = guardian_cnic && String(guardian_cnic).trim() !== '' ? String(guardian_cnic).trim() : null;
        const cleanGuardianRelation = guardian_relation && String(guardian_relation).trim() !== '' ? String(guardian_relation).trim() : null;
        const cleanGuardianAddress = guardian_address && String(guardian_address).trim() !== '' ? String(guardian_address).trim() : null;

        if (fam_id_updated && (cleanFatherName || cleanFatherPhone || cleanMotherName || cleanMotherPhone || cleanCurrentAddress)) {
            const normOldFather = oldFatherName.toLowerCase().replace(/\s+/g, ' ');

            // Check if there is only 1 distinct father in this family
            const distinctFathersRes = await client.query(`
                SELECT COUNT(DISTINCT LOWER(TRIM(REGEXP_REPLACE(father_name, '\\s+', ' ', 'g')))) as father_count
                FROM students
                WHERE family_id = $1 AND father_name IS NOT NULL AND TRIM(father_name) != ''
            `, [fam_id_updated]);
            const singleFatherFamily = parseInt(distinctFathersRes.rows[0]?.father_count || '0', 10) <= 1;

            // Fetch siblings in this family
            const siblingsRes = await client.query(`
                SELECT s.student_id, s.father_name, s.father_phone, s.guardian_relation, s.guardian_name,
                       (
                           SELECT ss.relation_type 
                           FROM student_siblings ss 
                           WHERE (ss.student_id = $1 AND ss.sibling_id = s.student_id)
                              OR (ss.student_id = s.student_id AND ss.sibling_id = $1)
                           ORDER BY CASE WHEN ss.relation_type = 'blood' THEN 1 ELSE 2 END
                           LIMIT 1
                       ) AS explicit_relation
                FROM students s
                WHERE s.family_id = $2 AND s.student_id != $1
            `, [id, fam_id_updated]);

            const siblingIdsToUpdate = [];
            const updateGuardiansFor = [];

            const stripName = (s) => (s || '').toLowerCase().replace(/[-_.\s]+/g, '');
            const strippedOldFather = stripName(oldFatherName);
            const strippedNewFather = stripName(cleanFatherName);

            for (const sib of siblingsRes.rows) {
                const sibFatherRaw = (sib.father_name || '').trim();
                const sibFatherNorm = sibFatherRaw.toLowerCase().replace(/\s+/g, ' ');
                const strippedSibFather = stripName(sibFatherRaw);

                // Check if this sibling belongs to the same father:
                // 1) Father name matches old father (normalized or stripped of spaces/hyphens)
                // 2) Father name matches new father (in case one child was already updated)
                // 3) Father name was empty/missing
                // 4) Explicitly marked as blood
                // 5) Or all active children in this family belong to a single father
                const matchesFather = 
                    (strippedOldFather !== '' && (sibFatherNorm === normOldFather || strippedSibFather === strippedOldFather)) ||
                    (strippedNewFather !== '' && strippedSibFather === strippedNewFather) ||
                    sibFatherRaw === '' ||
                    sib.explicit_relation === 'blood' ||
                    singleFatherFamily;

                // Only skip if the sibling genuinely belongs to a completely different father
                // (e.g. father name is non-empty, does not match, and is explicitly a cousin)
                if (!matchesFather && sib.explicit_relation === 'cousin') {
                    continue;
                }

                if (matchesFather) {
                    siblingIdsToUpdate.push(sib.student_id);

                    if (
                        (sib.guardian_relation && sib.guardian_relation.toLowerCase() === 'father') ||
                        (normOldFather !== '' && (sib.guardian_name || '').trim().toLowerCase().replace(/\s+/g, ' ') === normOldFather)
                    ) {
                        updateGuardiansFor.push(sib.student_id);
                    }
                }
            }

            if (siblingIdsToUpdate.length > 0) {
                const allFamilyStudentIds = [parseInt(id, 10), ...siblingIdsToUpdate];

                                await client.query(`
                    UPDATE students
                    SET father_name = COALESCE($1::varchar, father_name),
                        father_phone = COALESCE($2::varchar, father_phone),
                        father_cnic = COALESCE($3::varchar, father_cnic),
                        father_occupation = COALESCE($4::varchar, father_occupation),
                        mother_name = COALESCE($5::varchar, mother_name),
                        mother_phone = COALESCE($6::varchar, mother_phone),
                        mother_cnic = COALESCE($7::varchar, mother_cnic),
                        mother_occupation = COALESCE($8::varchar, mother_occupation),
                        current_address = COALESCE($9::varchar, current_address),
                        permanent_address = COALESCE($10::varchar, permanent_address),
                        city = COALESCE($11::varchar, city)
                    WHERE student_id = ANY($12::int[])
                `, [
                    cleanFatherName,
                    cleanFatherPhone,
                    cleanFatherCnic,
                    cleanFatherOcc,
                    cleanMotherName,
                    cleanMotherPhone,
                    cleanMotherCnic,
                    cleanMotherOcc,
                    cleanCurrentAddress,
                    cleanPermanentAddress,
                    cleanCity,
                    siblingIdsToUpdate
                ]);

                // Ensure sibling links between updated same-father siblings are marked as 'blood'
                await client.query(`
                    UPDATE student_siblings
                    SET relation_type = 'blood'
                    WHERE student_id = ANY($1::int[]) AND sibling_id = ANY($1::int[])
                      AND relation_type != 'blood'
                `, [allFamilyStudentIds]);

                                if (updateGuardiansFor.length > 0) {
                    await client.query(`
                        UPDATE students
                        SET guardian_name = COALESCE($1::varchar, guardian_name),
                            guardian_phone = COALESCE($2::varchar, guardian_phone),
                            guardian_cnic = COALESCE($3::varchar, guardian_cnic),
                            guardian_relation = COALESCE($4::varchar, guardian_relation),
                            guardian_address = COALESCE($5::varchar, guardian_address)
                        WHERE student_id = ANY($6::int[])
                    `, [
                        cleanFatherName || cleanGuardianName,
                        cleanFatherPhone || cleanGuardianPhone,
                        cleanFatherCnic || cleanGuardianCnic,
                        cleanGuardianRelation,
                        cleanGuardianAddress,
                        updateGuardiansFor
                    ]);
                }

                siblingsUpdatedCount = siblingIdsToUpdate.length;
                console.log(`[STUDENT EDIT] Propagated updated father details (Name: "${cleanFatherName}", Phone: "${cleanFatherPhone}") to ${siblingsUpdatedCount} sibling(s):`, siblingIdsToUpdate);
            }

            // Also update primary contact in families table
            await client.query(`
                UPDATE families
                SET primary_contact_name = COALESCE($1::varchar, primary_contact_name),
                    primary_contact_phone = COALESCE($2::varchar, primary_contact_phone)
                WHERE family_id = $3::varchar
                  AND (
                      primary_contact_name IS NULL 
                      OR TRIM(primary_contact_name) = ''
                      OR LOWER(TRIM(REGEXP_REPLACE(primary_contact_name, '\\s+', ' ', 'g'))) = $4::varchar
                      OR $5::boolean = TRUE
                  )
            `, [
                cleanFatherName,
                cleanFatherPhone,
                fam_id_updated,
                normOldFather,
                singleFatherFamily
            ]);

            // If family_name matched the old father name or 'Family of [old father name]' or '[old father name] Family'
            if (cleanFatherName && oldFatherName) {
                const oldFamilyName = `${oldFatherName} Family`;
                const newFamilyName = `${cleanFatherName} Family`;
                const oldFamilyOf = `Family of ${oldFatherName}`;
                const newFamilyOf = `Family of ${cleanFatherName}`;
                await client.query(`
                    UPDATE families
                    SET family_name = CASE
                        WHEN family_name = $1::varchar THEN $2::varchar
                        WHEN family_name = $3::varchar THEN $4::varchar
                        WHEN family_name = $5::varchar THEN $6::varchar
                        ELSE family_name
                    END
                    WHERE family_id = $7::varchar
                `, [oldFatherName, cleanFatherName, oldFamilyName, newFamilyName, oldFamilyOf, newFamilyOf, fam_id_updated]);
            }
        }

        // Update family fee in families table if provided
        if (family_fee !== undefined && family_fee !== null && family_fee !== '' && !isNaN(parseFloat(family_fee)) && parseFloat(family_fee) > 0 && fam_id_updated) {
            const parsedFamFee = parseFloat(family_fee);
            await client.query(`
                INSERT INTO families (family_id, family_fee)
                VALUES ($1::varchar, $2::numeric)
                ON CONFLICT (family_id) DO UPDATE SET family_fee = $2::numeric
            `, [fam_id_updated, parsedFamFee]);

            // Also update any siblings in this family who have monthly_fee <= 0 or if exactly 1 active student remains
            await client.query(`
                UPDATE students
                SET monthly_fee = $2::numeric
                WHERE family_id = $1::varchar AND (
                    monthly_fee IS NULL 
                    OR monthly_fee <= 0
                    OR (SELECT COUNT(*) FROM students s2 WHERE s2.family_id = $1::varchar AND LOWER(COALESCE(s2.status, 'Active')) = 'active') = 1
                )
            `, [fam_id_updated, parsedFamFee]);
        }

        // Update opening_balance in families table if provided
        if (opening_balance !== undefined && opening_balance !== null && opening_balance !== '' && fam_id_updated) {
            const opbVal = parseFloat(opening_balance);
            if (!isNaN(opbVal) && opbVal >= 0) {
                const famRes = await client.query(`SELECT opening_balance, opening_balance_paid FROM families WHERE family_id = $1::varchar`, [fam_id_updated]);
                const currentOpb = parseFloat(famRes.rows[0]?.opening_balance || 0);
                const currentPaid = parseFloat(famRes.rows[0]?.opening_balance_paid || 0);

                if (currentPaid > 0 && currentPaid >= currentOpb && currentOpb > 0) {
                    // Fully paid: do not edit opening_balance
                } else {
                    const finalOpb = Math.max(opbVal, currentPaid);
                    await client.query(`
                        INSERT INTO families (family_id, opening_balance, created_at)
                        VALUES ($1::varchar, $2::numeric, NOW())
                        ON CONFLICT (family_id) DO UPDATE SET opening_balance = $2::numeric
                    `, [fam_id_updated, finalOpb]);
                }
            }
        }

        // Update User
        if (user_id) {
            const fullName = `${first_name || ''} ${last_name || ''}`.trim() || 'Student';
            await client.query(
                "UPDATE app_users SET full_name = $1::varchar, email = $2::varchar WHERE id = $3::int",
                [fullName, email && String(email).trim() !== '' ? String(email).trim() : null, user_id]
            );
        }

        // Create or Update Admission Fee Ledger on Edit
        const admFeeVal = parseFloat(admission_fee) || 0;
        const validAdmDate = (admission_date && String(admission_date).trim() !== '') ? String(admission_date).trim() : new Date();
        if (admFeeVal > 0) {
            const activeYearRes = await client.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
            const activeYearId = activeYearRes.rows[0]?.id || null;

            await client.query(`
                INSERT INTO admission_fee_ledger 
                    (student_id, total_amount, paid_amount, status, admission_date, notes, academic_year_id)
                VALUES ($1::int, $2::numeric, 0, 'unpaid', $3::date, 'Auto-created/Updated via student edit', $4::int)
                ON CONFLICT (student_id) DO UPDATE 
                    SET total_amount = EXCLUDED.total_amount,
                        status = CASE 
                            WHEN admission_fee_ledger.paid_amount >= EXCLUDED.total_amount THEN 'paid'
                            WHEN admission_fee_ledger.paid_amount > 0 THEN 'partial'
                            ELSE 'unpaid'
                        END,
                        academic_year_id = COALESCE(admission_fee_ledger.academic_year_id, EXCLUDED.academic_year_id)
            `, [id, admFeeVal, validAdmDate, activeYearId]);
        } else {
            await client.query(`
                UPDATE admission_fee_ledger
                SET total_amount = 0, status = 'paid'
                WHERE student_id = $1::int AND paid_amount = 0
            `, [id]);
        }

        await client.query('COMMIT');
        res.json({ message: "Updated successfully", siblings_updated: siblingsUpdatedCount });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Server Error: " + err.message });
    } finally {
        client.release();
    }
});

// 5b. Smart Reactivation Preview (Cases 1, 2, 3A, 3B)
router.get('/:id/reactivation-preview', async (req, res) => {
    try {
        const { month, year, selected_ids, class_id } = req.query;
        const preview = await getReactivationPreview(pool, req.params.id, {
            month,
            year,
            selected_ids,
            class_id
        });
        res.json(preview);
    } catch (err) {
        console.error('Reactivation preview error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Server Error' });
    }
});

// 5c. Atomic Student & Family Reactivation + Mid-Month Billing
router.post('/:id/reactivate', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await executeStudentReactivation(client, req.params.id, req.body || {});
        await client.query('COMMIT');

        try {
            const { notifyPermission, createNotification } = require('../utils/notify');
            await notifyPermission('students.details', {
                type: 'student_status',
                title: `Student Reactivated ✅`,
                message: `${result.activated_names} marked Active${result.family_id ? ` (Family: ${result.family_id})` : ''}.`,
                link: `/students/profile/${req.params.id}`,
                clientOrPool: pool
            });

            if (result.slip && result.billing_case !== 'CASE_3B_DEFER_NEXT_MONTH') {
                await notifyPermission('fees.collect', {
                    type: 'fee_generation',
                    title: `Reactivation Voucher Ready 🧾`,
                    message: `${result.activated_names}: ${result.month}/${result.year} slip #${result.slip.slip_id} updated/issued (Total: PKR ${Number(result.slip.total_amount || 0).toLocaleString('en-PK')}).`,
                    link: '/fees/collect',
                    clientOrPool: pool
                });

                await createNotification({
                    familyId: result.family_id,
                    studentId: result.lead_student?.student_id || parseInt(req.params.id, 10),
                    role: 'student',
                    type: 'fee_generation',
                    title: `Fee Voucher Issued 🧾`,
                    message: `Your account is active and the ${result.month}/${result.year} fee voucher (PKR ${Number(result.slip.total_amount || 0).toLocaleString('en-PK')}) is ready.`,
                    link: '/',
                    clientOrPool: pool
                });
            }
        } catch (notifErr) {
            console.error('Reactivation notification error:', notifErr.message);
        }

        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Reactivation commit error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Server Error' });
    } finally {
        client.release();
    }
});

// 6. Toggle Status
router.patch('/:id/status', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) return res.status(400).json({ error: "Status is required" });

        await client.query('BEGIN');

        // Update Student
        const studentRes = await client.query(
            "UPDATE students SET status = $1 WHERE student_id = $2 RETURNING user_id, family_id, class_id, first_name, last_name",
            [status, id]
        );

        if (studentRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Student not found" });
        }

        const { user_id, family_id, class_id } = studentRes.rows[0];

        // Update User if linked
        if (user_id) {
            const isActive = (status === 'Active');
            await client.query("UPDATE app_users SET is_active = $1 WHERE id = $2", [isActive, user_id]);
        }

        // Auto-shift Family Fee Slips & Arrears to the Active Family Lead
        if (family_id) {
            if (status.toLowerCase() !== 'active') {
                // Student is being DEACTIVATED: find the next senior active sibling
                const leadRes = await client.query(`
                    SELECT s.student_id, s.class_id, s.first_name, s.last_name
                    FROM students s
                    LEFT JOIN classes c ON s.class_id = c.class_id
                    WHERE s.family_id = $1 AND LOWER(COALESCE(s.status, 'Active')) = 'active' AND s.student_id != $2
                    ORDER BY ${CLASS_SENIORITY_ORDER}
                    LIMIT 1
                `, [family_id, id]);

                if (leadRes.rows.length > 0) {
                    const newLead = leadRes.rows[0];
                    await client.query(`
                        UPDATE monthly_fee_slips mfs
                        SET student_id = $1, class_id = $2, is_family_slip = TRUE
                        WHERE mfs.student_id = $3 AND mfs.family_id = $4 AND mfs.status IN ('unpaid', 'partial')
                          AND NOT EXISTS (
                              SELECT 1 FROM monthly_fee_slips dup
                              WHERE dup.student_id = $1 AND dup.month = mfs.month AND dup.year = mfs.year AND dup.slip_id != mfs.slip_id
                          )
                    `, [newLead.student_id, newLead.class_id, id, family_id]);
                }
            } else {
                // Student is being ACTIVATED: check if this student is now the topmost active senior
                const topLeadRes = await client.query(`
                    SELECT s.student_id, s.class_id
                    FROM students s
                    LEFT JOIN classes c ON s.class_id = c.class_id
                    WHERE s.family_id = $1 AND LOWER(COALESCE(s.status, 'Active')) = 'active'
                    ORDER BY ${CLASS_SENIORITY_ORDER}
                    LIMIT 1
                `, [family_id]);

                if (topLeadRes.rows.length > 0 && topLeadRes.rows[0].student_id === parseInt(id, 10)) {
                    await shiftFamilySlipsLead(client, {
                        familyId: family_id,
                        newLeadStudentId: parseInt(id, 10),
                        newLeadClassId: class_id,
                        statuses: ['unpaid', 'partial']
                    });
                }
            }

            // ── Auto-sync / inherit Family Fee for remaining active siblings ──
            // 1. If any sibling in the family has monthly_fee <= 0, sync to family_fee
            await client.query(`
                UPDATE students s
                SET monthly_fee = f.family_fee
                FROM families f
                WHERE s.family_id = f.family_id
                  AND s.family_id = $1
                  AND (s.monthly_fee IS NULL OR s.monthly_fee <= 0)
                  AND f.family_fee > 0
            `, [family_id]);

            // 2. If exactly 1 active student remains in the family, ensure their monthly_fee equals the family_fee
            await client.query(`
                UPDATE students s
                SET monthly_fee = f.family_fee
                FROM families f
                WHERE s.family_id = f.family_id
                  AND s.family_id = $1
                  AND LOWER(COALESCE(s.status, 'Active')) = 'active'
                  AND f.family_fee > 0
                  AND (
                      SELECT COUNT(*) FROM students sub 
                      WHERE sub.family_id = $1 AND LOWER(COALESCE(sub.status, 'Active')) = 'active'
                  ) = 1
            `, [family_id]);
        }

        await client.query('COMMIT');

        try {
            const { notifyPermission } = require('../utils/notify');
            const stuData = studentRes.rows[0];
            const sName = `${stuData.first_name || ''} ${stuData.last_name || ''}`.trim() || 'Student';
            await notifyPermission('students.details', {
                type: 'student_status',
                title: `Student Status: ${status} 👤`,
                message: `${sName} status changed to ${status}. (Family ID: ${family_id || 'N/A'})`,
                link: '/students/details',
                clientOrPool: pool
            });
        } catch (notifErr) {
            console.error("Student status notification error:", notifErr.message);
        }

        res.json({ message: "Status updated successfully", status });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    } finally {
        client.release();
    }
});

// 7. Generate Credentials (Manual)
router.patch('/:id/generate-credentials', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');

        // 1. Get Student Info
        const sRes = await client.query("SELECT * FROM students WHERE student_id = $1", [id]);
        if (sRes.rows.length === 0) return res.status(404).json({ error: "Student not found" });
        const student = sRes.rows[0];

        if (student.user_id) return res.status(400).json({ error: "User already exists" });

        // 2. Generate Credentials
        const username = `STU-${student.admission_no}`;
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash('student123', salt);

        // 3. Get Role
        let roleRes = await client.query("SELECT id FROM app_roles WHERE role_name = 'Student'");
        let role_id = roleRes.rows.length > 0 ? roleRes.rows[0].id : null;
        if (!role_id) {
            const newRole = await client.query("INSERT INTO app_roles (role_name, description) VALUES ('Student', 'Standard Access') RETURNING id");
            role_id = newRole.rows[0].id;
        }

        // 4. Create User
        const newUser = await client.query(
            `INSERT INTO app_users (username, password_hash, plain_password, full_name, email, role_id, is_active)
             VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::int, true) RETURNING id`,
            [username, password_hash, 'student123', `${student.first_name} ${student.last_name}`, student.email, role_id]
        );
        const user_id = newUser.rows[0].id;

        // 5. Link to Student
        await client.query("UPDATE students SET user_id = $1::int WHERE student_id = $2::int", [user_id, id]);

        await client.query('COMMIT');
        res.json({ message: "Credentials Generated", username });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Server Error: " + err.message });
    } finally {
        client.release();
    }
});

// 8. Change Password
router.patch('/:id/change-password', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        await client.query('BEGIN');

        // Get User ID
        const sRes = await client.query("SELECT user_id FROM students WHERE student_id = $1", [id]);
        if (sRes.rows.length === 0) return res.status(404).json({ error: "Student not found" });

        const user_id = sRes.rows[0].user_id;
        if (!user_id) return res.status(400).json({ error: "Student has no system login" });

        // Hash Password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Update User
        await client.query("UPDATE app_users SET password_hash = $1, plain_password = $2 WHERE id = $3", [password_hash, password, user_id]);

        await client.query('COMMIT');
        res.json({ message: "Password updated successfully" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    } finally {
        client.release();
    }
});

// 9. Delete Student
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM students WHERE student_id = $1", [id]);
        res.json({ message: "Student deleted successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// ══════════════════════════════════════════════════════════
//  OPENING BALANCE (OPB) ROUTES
// ══════════════════════════════════════════════════════════

// GET /students/opb/families
// List all families with their opening balance info + members
router.get('/opb/families', async (req, res) => {
    try {
        const { search, filter } = req.query;

        let where = '';
        const params = [];

        if (filter === 'with_opb') {
            where = 'WHERE f.opening_balance > 0';
        } else if (filter === 'cleared') {
            where = 'WHERE f.opening_balance > 0 AND f.opening_balance_paid >= f.opening_balance';
        } else if (filter === 'pending') {
            where = 'WHERE f.opening_balance > 0 AND f.opening_balance_paid < f.opening_balance';
        }

        const result = await pool.query(`
            SELECT
                f.family_id,
                f.family_name,
                f.primary_contact_name,
                f.primary_contact_phone,
                f.opening_balance,
                f.opening_balance_paid,
                GREATEST(f.opening_balance - f.opening_balance_paid, 0) AS opb_remaining,
                COALESCE(f.advance_balance, 0) AS advance_balance,
                f.opb_notes,
                f.family_fee,
                -- Members summary
                COUNT(s.student_id) AS total_members,
                MAX(s.father_name) AS father_name,
                MAX(s.father_phone) AS father_phone,
                STRING_AGG(s.first_name || ' ' || s.last_name, ', ' ORDER BY s.first_name) AS member_names,
                STRING_AGG(c.class_name, ', ' ORDER BY c.class_name) AS class_names
            FROM families f
            LEFT JOIN students s ON s.family_id = f.family_id AND s.status = 'Active'
            LEFT JOIN classes c ON c.class_id = s.class_id
            ${where}
            GROUP BY f.family_id, f.family_name, f.primary_contact_name, f.primary_contact_phone,
                     f.opening_balance, f.opening_balance_paid, f.advance_balance, f.opb_notes, f.family_fee
            ORDER BY opb_remaining DESC, f.family_id
        `, params);

        // Optional search
        let rows = result.rows;
        if (search) {
            const q = search.toLowerCase();
            rows = rows.filter(r =>
                (r.father_name || '').toLowerCase().includes(q) ||
                (r.family_id || '').toLowerCase().includes(q) ||
                (r.member_names || '').toLowerCase().includes(q) ||
                (r.father_phone || '').includes(q)
            );
        }

        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /students/opb/families/:family_id
// Full OPB detail for one family including payment history
router.get('/opb/families/:family_id', async (req, res) => {
    try {
        const { family_id } = req.params;

        const familyRes = await pool.query(`
            SELECT f.*,
                GREATEST(f.opening_balance - f.opening_balance_paid, 0) AS opb_remaining
            FROM families f WHERE f.family_id = $1
        `, [family_id]);

        if (familyRes.rows.length === 0)
            return res.status(404).json({ error: 'Family not found' });

        const members = await pool.query(`
            SELECT s.student_id, s.admission_no, s.first_name, s.last_name, c.class_name
            FROM students s
            LEFT JOIN classes c ON c.class_id = s.class_id
            WHERE s.family_id = $1::varchar AND s.status = 'Active'
            ORDER BY s.first_name
        `, [family_id]);

        const payments = await pool.query(`
            SELECT * FROM family_opb_payments
            WHERE family_id = $1
            ORDER BY payment_date DESC, created_at DESC
        `, [family_id]);

        res.json({
            ...familyRes.rows[0],
            members: members.rows,
            payments: payments.rows
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /students/opb/families/:family_id
// Set or update opening balance for a family
router.put('/opb/families/:family_id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { family_id } = req.params;
        const { opening_balance, opb_notes } = req.body;

        if (opening_balance === undefined || isNaN(parseFloat(opening_balance)))
            return res.status(400).json({ error: 'opening_balance is required and must be a number' });

        const bal = parseFloat(opening_balance);
        if (bal < 0) return res.status(400).json({ error: 'opening_balance cannot be negative' });

        await client.query('BEGIN');

        // Upsert family record
        await client.query(`
            INSERT INTO families (family_id, opening_balance, opb_notes, family_fee)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (family_id) DO UPDATE
                SET opening_balance = $2,
                    opb_notes = COALESCE($3, families.opb_notes)
        `, [family_id, bal, opb_notes || null]);

        const updated = await client.query(`
            SELECT f.*,
                GREATEST(f.opening_balance - f.opening_balance_paid, 0) AS opb_remaining
            FROM families f WHERE f.family_id = $1
        `, [family_id]);

        await client.query('COMMIT');
        res.json(updated.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// POST /students/opb/families/:family_id/payment
// Record a payment towards opening balance
router.post('/opb/families/:family_id/payment', async (req, res) => {
    const client = await pool.connect();
    try {
        const { family_id } = req.params;
        const { amount, payment_date, payment_method, received_by, reference_no, notes } = req.body;

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
            return res.status(400).json({ error: 'amount is required and must be > 0' });

        await client.query('BEGIN');

        // Get current OPB state
        const familyRes = await client.query(
            `SELECT opening_balance, opening_balance_paid FROM families WHERE family_id = $1`,
            [family_id]
        );
        if (familyRes.rows.length === 0)
            return res.status(404).json({ error: 'Family not found' });

        const { opening_balance, opening_balance_paid } = familyRes.rows[0];
        const remaining = parseFloat(opening_balance) - parseFloat(opening_balance_paid);
        const payAmt = Math.min(parseFloat(amount), remaining); // can't pay more than remaining

        if (payAmt <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Opening balance is already fully paid' });
        }

        // Record payment in ledger with active academic_year_id
        const activeYearRes = await client.query("SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id ASC LIMIT 1");
        const activeYearId = activeYearRes.rows[0]?.id || null;

        const payment = await client.query(`
            INSERT INTO family_opb_payments
                (family_id, amount, payment_date, payment_method, received_by, reference_no, notes, academic_year_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [family_id, payAmt, payment_date || new Date().toISOString().split('T')[0],
            payment_method || 'cash', received_by || null, reference_no || null, notes || null, activeYearId]);

        // Update families.opening_balance_paid
        await client.query(`
            UPDATE families
            SET opening_balance_paid = opening_balance_paid + $1::numeric
            WHERE family_id = $2::varchar
        `, [payAmt, family_id]);

        const updatedFamily = await client.query(`
            SELECT f.*,
                GREATEST(f.opening_balance - f.opening_balance_paid, 0) AS opb_remaining
            FROM families f WHERE f.family_id = $1
        `, [family_id]);

        await client.query('COMMIT');
        res.json({
            payment: payment.rows[0],
            family: updatedFamily.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// DELETE /students/opb/families/:family_id/payment/:payment_id
// Delete an OPB payment entry (reverse payment)
router.delete('/opb/families/:family_id/payment/:payment_id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { family_id, payment_id } = req.params;

        await client.query('BEGIN');

        const pmtRes = await client.query(
            `SELECT amount FROM family_opb_payments WHERE payment_id = $1 AND family_id = $2`,
            [payment_id, family_id]
        );
        if (pmtRes.rows.length === 0)
            return res.status(404).json({ error: 'Payment not found' });

        const amt = parseFloat(pmtRes.rows[0].amount);

        await client.query(`DELETE FROM family_opb_payments WHERE payment_id = $1`, [payment_id]);
        await client.query(`
            UPDATE families
            SET opening_balance_paid = GREATEST(opening_balance_paid - $1, 0)
            WHERE family_id = $2
        `, [amt, family_id]);

        await client.query('COMMIT');
        res.json({ message: 'Payment reversed successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

module.exports = router;
