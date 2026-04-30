const pool = require('./db');

async function test() {
    try {
        const result = await pool.query(`
            SELECT fp.*,
                fp.applies_to_all,
                (
                    SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('class_id', c.class_id, 'class_name', c.class_name) ORDER BY c.class_name), '[]')
                    FROM fee_plan_classes fpc
                    JOIN classes c ON fpc.class_id = c.class_id
                    WHERE fpc.plan_id = fp.plan_id
                ) AS classes,
                (
                    SELECT COALESCE(
                        JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'id', fph.id,
                                'head_id', fph.head_id,
                                'head_name', fh.head_name,
                                'head_type', fh.head_type,
                                'frequency', fh.frequency,
                                'amount', fph.amount
                            ) ORDER BY fh.head_name
                        ),
                        '[]'
                    )
                    FROM fee_plan_heads fph
                    JOIN fee_heads fh ON fph.head_id = fh.head_id
                    WHERE fph.plan_id = fp.plan_id
                ) AS heads
            FROM fee_plans fp
            ORDER BY fp.academic_year DESC, fp.plan_name
        `);
        console.log("Success, found rows:", result.rows.length);
    } catch(e) {
        console.error("ERROR", e.message);
    } finally {
        process.exit();
    }
}
test();
