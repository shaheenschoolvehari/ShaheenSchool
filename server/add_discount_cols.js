const pool = require('./db');

async function addCols() {
    try {
        await pool.query("ALTER TABLE admission_fee_ledger ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0");
        console.log("Added discount_amount to admission_fee_ledger");
        
        await pool.query("ALTER TABLE admission_fee_payments ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0");
        console.log("Added discount_amount to admission_fee_payments");
    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        pool.end();
    }
}

addCols();
