require('dotenv').config();
const pool = require('./db');

async function migrateFamilyMembersFee() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting Family Fee & Monthly Fee Synchronization Migration...");
        await client.query('BEGIN');

        // Check before count
        const beforeRes = await client.query(`
            SELECT COUNT(*) as count
            FROM students s
            JOIN families f ON s.family_id = f.family_id
            WHERE (s.monthly_fee IS NULL OR s.monthly_fee <= 0)
              AND f.family_fee > 0;
        `);
        console.log(`   → Found ${beforeRes.rows[0].count} students with monthly_fee <= 0 having family_fee > 0.`);

        // Perform synchronization
        const updateRes = await client.query(`
            UPDATE students s
            SET monthly_fee = f.family_fee
            FROM families f
            WHERE s.family_id = f.family_id
              AND (s.monthly_fee IS NULL OR s.monthly_fee <= 0)
              AND f.family_fee > 0;
        `);
        console.log(`   ✅ Synchronized ${updateRes.rowCount} student records with their family_fee.`);

        // Ensure solo active students also inherit family_fee
        const soloRes = await client.query(`
            UPDATE students s
            SET monthly_fee = f.family_fee
            FROM families f
            WHERE s.family_id = f.family_id
              AND LOWER(COALESCE(s.status, 'Active')) = 'active'
              AND f.family_fee > 0
              AND (
                  SELECT COUNT(*) FROM students sub 
                  WHERE sub.family_id = f.family_id AND LOWER(COALESCE(sub.status, 'Active')) = 'active'
              ) = 1;
        `);
        console.log(`   ✅ Checked solo active family members: ${soloRes.rowCount} updated.`);

        await client.query('COMMIT');
        console.log("🎉 Family Fee synchronization completed successfully!");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Migration failed:", err.message);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrateFamilyMembersFee();
