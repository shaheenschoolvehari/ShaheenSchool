const pool = require('./db');

async function fixDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fee_plan_classes (
                plan_id INT REFERENCES fee_plans(plan_id) ON DELETE CASCADE,
                class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
                PRIMARY KEY (plan_id, class_id)
            );
        `);
        
        // Migrate existing data
        await pool.query(`
            INSERT INTO fee_plan_classes (plan_id, class_id)
            SELECT plan_id, class_id 
            FROM fee_plans 
            WHERE class_id IS NOT NULL
            ON CONFLICT DO NOTHING;
        `);
        
        console.log("Database fixed successfully!");
    } catch(e) {
        console.error("ERROR", e.message);
    } finally {
        process.exit();
    }
}
fixDB();
