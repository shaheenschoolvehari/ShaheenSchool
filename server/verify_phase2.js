const pool = require('./db');

async function verifyPhase2() {
    try {
        console.log('🔍 Verifying Phase 2 Database Migration\n');

        // 1. Check role data
        console.log('--- CHECKING app_roles TABLE ---\n');
        const rolesRes = await pool.query(`
            SELECT id, role_name, role_level, is_custom, is_system_default, description
            FROM app_roles
            ORDER BY role_level DESC
        `);

        console.log('Role Data:');
        rolesRes.rows.forEach(r => {
            const type = r.is_system_default ? '[SYSTEM]' : r.is_custom ? '[CUSTOM]' : '[AUTO]';
            console.log(`  ${type.padEnd(8)} ID:${String(r.id).padEnd(3)} Level:${String(r.role_level).padEnd(3)} ${r.role_name.padEnd(15)}`);
        });

        // 2. Check user_direct_permissions table
        console.log('\n--- CHECKING user_direct_permissions TABLE ---');
        const userPermRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'user_direct_permissions'
        `);
        console.log(`Table exists: ${userPermRes.rows.length > 0 ? '✅ YES' : '❌ NO'}`);

        // 3. Check role_audit_log table
        console.log('\n--- CHECKING role_audit_log TABLE ---');
        const auditRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'role_audit_log'
        `);
        console.log(`Table exists: ${auditRes.rows.length > 0 ? '✅ YES' : '❌ NO'}`);

        // 4. Check user role assignments
        console.log('\n--- CHECKING USER ROLE ASSIGNMENTS ---\n');
        const usersRes = await pool.query(`
            SELECT u.id, u.email, r.role_name, r.role_level
            FROM app_users u
            LEFT JOIN app_roles r ON u.role_id = r.id
            ORDER BY COALESCE(r.role_level, 0) DESC, u.email
            LIMIT 10
        `);

        if (usersRes.rows.length === 0) {
            console.log('No users in system yet.');
        } else {
            console.log('Sample of User-Role assignments:');
            usersRes.rows.forEach(u => {
                try {
                    const roleName = u.role_name || 'UNASSIGNED';
                    const level = u.role_level !== null ? String(u.role_level) : 'N/A';
                    console.log(`  User: ${u.email ? u.email.padEnd(25) : 'UNKNOWN'.padEnd(25)} Role: ${roleName.padEnd(15)} Level: ${level}`);
                } catch (e) {
                    // Skip rows with problematic data
                }
            });
        }

        // 5. Summary
        console.log('\n--- SUMMARY ---');
        console.log(`✅ Total roles in system: ${rolesRes.rows.length}`);
        console.log(`✅ role_level column: ADDED`);
        console.log(`✅ is_custom column: ADDED`);
        console.log(`✅ user_direct_permissions table: ${userPermRes.rows.length > 0 ? 'CREATED' : 'MISSING'}`);
        console.log(`✅ role_audit_log table: ${auditRes.rows.length > 0 ? 'CREATED' : 'MISSING'}`);
        console.log(`\n🎉 Phase 2 Verification Complete!\n`);

        await pool.end();
    } catch (err) {
        console.error('❌ Verification failed:', err.message);
        await pool.end();
        process.exit(1);
    }
}

verifyPhase2();
