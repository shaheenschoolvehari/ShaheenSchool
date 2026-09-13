const pool = require('./db');

async function runEssentialMigrations() {
    const client = await pool.connect();
    try {
        console.log("🚀 Running essential database migrations...");
        await client.query('BEGIN');

        // 1. Academic Terms Migration
        console.log("   → Checking academic_terms columns...");
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='academic_terms' AND column_name='has_summer_work') THEN
                    ALTER TABLE academic_terms ADD COLUMN has_summer_work BOOLEAN DEFAULT FALSE;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='academic_terms' AND column_name='has_winter_work') THEN
                    ALTER TABLE academic_terms ADD COLUMN has_winter_work BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);

        // 2. Fee Plans Migration
        console.log("   → Checking fee_plans columns...");
        await client.query(`
            ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS applies_to_all BOOLEAN DEFAULT FALSE;
        `);

        // 3. Print Tracking & Multi-Month Migration
        console.log("   → Checking monthly_fee_slips columns...");
        await client.query(`
            ALTER TABLE monthly_fee_slips 
            ADD COLUMN IF NOT EXISTS issue_date DATE,
            ADD COLUMN IF NOT EXISTS is_family_slip BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS has_multi_months BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS months_list INTEGER[],
            ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS printed_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;

            UPDATE monthly_fee_slips SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id ASC LIMIT 1) WHERE academic_year_id IS NULL;
            CREATE INDEX IF NOT EXISTS idx_mfs_academic_year ON monthly_fee_slips(academic_year_id);
        `);

        // 4. School Settings logo_url Migration (allow storing Base64 image data in DB)
        console.log("   → Checking school_settings logo_url column type...");
        await client.query(`
            ALTER TABLE school_settings ALTER COLUMN logo_url TYPE TEXT;
        `);

        // 4.1 Admission Fee Ledger discount & discount_amount columns migration
        console.log("   → Checking admission_fee_ledger columns...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS admission_fee_ledger (
                ledger_id SERIAL PRIMARY KEY,
                student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
                total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
                paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
                discount NUMERIC(10,2) DEFAULT 0,
                discount_amount NUMERIC(10,2) DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
                admission_date DATE,
                notes TEXT,
                academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(student_id)
            );

            ALTER TABLE admission_fee_ledger 
            ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;

            UPDATE admission_fee_ledger SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id ASC LIMIT 1) WHERE academic_year_id IS NULL;
            CREATE INDEX IF NOT EXISTS idx_afl_academic_year ON admission_fee_ledger(academic_year_id);

            ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            ALTER TABLE family_opb_payments ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            ALTER TABLE admission_fee_payments ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            
            UPDATE fee_payments SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id ASC LIMIT 1) WHERE academic_year_id IS NULL;
            UPDATE family_opb_payments SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id ASC LIMIT 1) WHERE academic_year_id IS NULL;
            UPDATE admission_fee_payments SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id ASC LIMIT 1) WHERE academic_year_id IS NULL;
        `);

        // 4.2 Expense tables updated_at, attachment & approved_by column migration
        console.log("   → Checking expense_categories and expenses columns...");
        await client.query(`
            ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
            ALTER TABLE expenses 
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ADD COLUMN IF NOT EXISTS attachment VARCHAR(255),
                ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS receipt_url TEXT,
                ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            
            UPDATE expenses SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1) WHERE academic_year_id IS NULL;
        `).catch(() => { /* Tables may not exist yet on fresh install, seeder will create them */ });

        // 4.3 Student roles and user role assignment cleanup migration
        console.log("   → Checking Student roles and user role assignments...");
        await client.query(`
            UPDATE app_roles 
            SET dashboard_access = 'student', role_level = 10 
            WHERE LOWER(role_name) = 'student' OR LOWER(role_name) LIKE '%student%';

            UPDATE app_users 
            SET role_id = (SELECT id FROM app_roles WHERE LOWER(role_name) = 'student' LIMIT 1)
            WHERE (LOWER(username) LIKE 'stu-%' OR LOWER(username) LIKE 'fam-%')
              AND (SELECT id FROM app_roles WHERE LOWER(role_name) = 'student' LIMIT 1) IS NOT NULL;
        `).catch(() => { });

        // 4.4 Fee Heads Arrears & Line Items Migration
        console.log("   → Checking fee_heads and slip_line_items columns...");
        await client.query(`
            ALTER TABLE fee_heads ADD COLUMN IF NOT EXISTS track_arrears BOOLEAN NOT NULL DEFAULT TRUE;
            UPDATE fee_heads 
            SET track_arrears = FALSE 
            WHERE head_type = 'prev_balance' 
               OR LOWER(head_name) LIKE '%tuition%' 
               OR LOWER(head_name) LIKE '%family%';

            ALTER TABLE slip_line_items 
                ADD COLUMN IF NOT EXISTS is_carried_forward BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS arrears_head_id INTEGER REFERENCES fee_heads(head_id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS source_slip_id INTEGER REFERENCES monthly_fee_slips(slip_id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS is_waived BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS waived_at TIMESTAMP;

            CREATE INDEX IF NOT EXISTS idx_sli_arrears ON slip_line_items(arrears_head_id, is_carried_forward);

            ALTER TABLE fee_plan_heads ADD COLUMN IF NOT EXISTS fine_after_day INTEGER DEFAULT NULL;

            CREATE TABLE IF NOT EXISTS user_webauthn_credentials (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                credential_id TEXT UNIQUE NOT NULL,
                public_key TEXT NOT NULL,
                counter BIGINT DEFAULT 0,
                credential_type VARCHAR(50) DEFAULT 'fingerprint',
                device_name TEXT,
                transports TEXT[],
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_webauthn_user ON user_webauthn_credentials(user_id);
            CREATE INDEX IF NOT EXISTS idx_webauthn_cred ON user_webauthn_credentials(credential_id);

            CREATE TABLE IF NOT EXISTS webauthn_challenges (
                challenge_id TEXT PRIMARY KEY,
                user_id INTEGER,
                challenge TEXT NOT NULL,
                type VARCHAR(30) NOT NULL,
                expires_at TIMESTAMP NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_webauthn_ch_exp ON webauthn_challenges(expires_at);
        `).catch((err) => { console.error("Error migrating fee_heads/slip_line_items/webauthn:", err.message); });



        // 5. Student Academic Records (Promotion History Table)
        console.log("   → Checking student_academic_records table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS student_academic_records (
                id SERIAL PRIMARY KEY,
                student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
                academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
                class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
                section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
                roll_no VARCHAR(50),
                total_marks NUMERIC(10,2) DEFAULT 0,
                obtained_marks NUMERIC(10,2) DEFAULT 0,
                percentage NUMERIC(5,2) DEFAULT 0,
                grade VARCHAR(10),
                rank_in_class INTEGER,
                status VARCHAR(20) DEFAULT 'active',
                promotion_target_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
                promotion_target_class_id INTEGER REFERENCES classes(class_id) ON DELETE SET NULL,
                promoted_to_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
                promoted_to_class_id INTEGER REFERENCES classes(class_id) ON DELETE SET NULL,
                promoted_on DATE,
                promoted_at TIMESTAMP,
                promoted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
                attendance_percentage NUMERIC(5,2),
                remarks TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(student_id, academic_year_id)
            );

            ALTER TABLE student_academic_records 
            ADD COLUMN IF NOT EXISTS promotion_target_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS promotion_target_class_id INTEGER REFERENCES classes(class_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS promoted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
        `);

        // 5. IMPORTANT: We do NOT use father_name to infer relation_type.
        //    Father name matching is unreliable in Pakistani naming conventions where
        //    cousins often share the same grandfather's name as their father name.
        //
        //    The student_siblings table is the ONLY source of truth for relation_type.
        //    Relationships are explicitly set when:
        //      a) A student is created with siblings (explicit relation_type)
        //      b) Families are manually linked via /families/manual-link
        //      c) Families are merged via /families/merge
        //
        //    Students in the same family with NO entry in student_siblings will have
        //    relation_type = NULL which the frontend shows as "Family Member".
        //    These should be manually linked via the family management UI.

        // 5. REPAIR: Fix any student_siblings rows incorrectly marked 'blood'
        //    where the two students have DIFFERENT father names.
        //    Blood siblings MUST share the same father different father = cousin or unrelated.
        //    This repair corrects data corrupted by a previous migration that used DO UPDATE.
        //    It is safe to run repeatedly (idempotent).
        console.log("   → Repairing incorrectly marked blood siblings...");
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
        console.log(`   ✓ Repaired ${repairResult.rowCount} incorrectly marked blood sibling rows.`);

        // 6. Role Dashboard Access Migration
        console.log("   → Checking app_roles dashboard_access column...");
        await client.query(`
            ALTER TABLE app_roles ADD COLUMN IF NOT EXISTS dashboard_access VARCHAR(50) DEFAULT 'admin';

            -- Unconditionally update system roles to correct default dashboards
            UPDATE app_roles 
            SET dashboard_access = 'teacher' 
            WHERE LOWER(role_name) LIKE '%teacher%' 
               OR LOWER(role_name) LIKE '%assistant%' 
               OR (role_level >= 50 AND role_level < 90 AND LOWER(role_name) NOT LIKE '%admin%' AND LOWER(role_name) NOT LIKE '%principal%' AND LOWER(role_name) NOT LIKE '%coordinator%');

            UPDATE app_roles 
            SET dashboard_access = 'accountant' 
            WHERE LOWER(role_name) LIKE '%accountant%' 
               OR (role_level >= 20 AND role_level < 50 AND LOWER(role_name) NOT LIKE '%teacher%' AND LOWER(role_name) NOT LIKE '%assistant%');

            UPDATE app_roles 
            SET dashboard_access = 'student' 
            WHERE LOWER(role_name) LIKE '%student%' 
               OR (role_level < 20 AND LOWER(role_name) NOT LIKE '%accountant%');

            UPDATE app_roles 
            SET dashboard_access = 'admin' 
            WHERE LOWER(role_name) LIKE '%admin%' 
               OR LOWER(role_name) LIKE '%principal%' 
               OR LOWER(role_name) LIKE '%coordinator%' 
               OR role_level >= 90;
        `);

        // 7. Exam Marks & Test Papers Approval Workflow Migration
        console.log("   → Checking exam_marks & test_papers approval columns and exam_sheet_approvals table...");
        await client.query(`
            ALTER TABLE exam_marks ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
            
            ALTER TABLE test_papers 
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS published_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;

            CREATE TABLE IF NOT EXISTS exam_sheet_approvals (
                id SERIAL PRIMARY KEY,
                sheet_type VARCHAR(20) NOT NULL CHECK (sheet_type IN ('term_exam', 'class_test')),
                term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE,
                class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
                section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
                subject_id INTEGER REFERENCES subjects(subject_id) ON DELETE CASCADE,
                test_id INTEGER REFERENCES test_papers(test_id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'published')),
                submitted_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
                approved_at TIMESTAMP,
                published_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
                published_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE exam_sheet_approvals ALTER COLUMN subject_id DROP NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_sheet_term_exam ON exam_sheet_approvals (sheet_type, term_id, class_id, section_id, subject_id) WHERE sheet_type = 'term_exam';
            CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_sheet_class_test ON exam_sheet_approvals (test_id) WHERE sheet_type = 'class_test';

            -- Legacy data backfill (keep existing marks published & link active academic year)
            UPDATE exam_marks SET status = 'published' WHERE status IS NULL;
            UPDATE test_papers SET status = 'published' WHERE status IS NULL;
            UPDATE test_papers SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1) WHERE academic_year_id IS NULL;

            -- Fees & Exam Collections Academic Year Migration
            ALTER TABLE exam_fee_collections ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_efc_academic_year ON exam_fee_collections(academic_year_id);
            UPDATE exam_fee_collections SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1) WHERE academic_year_id IS NULL;

            ALTER TABLE monthly_fee_slips ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_mfs_academic_year ON monthly_fee_slips(academic_year_id);
            UPDATE monthly_fee_slips SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1) WHERE academic_year_id IS NULL;

            ALTER TABLE admission_fee_ledger ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_afl_academic_year ON admission_fee_ledger(academic_year_id);
            UPDATE admission_fee_ledger SET academic_year_id = (SELECT id FROM academic_years WHERE is_active = TRUE ORDER BY id DESC LIMIT 1) WHERE academic_year_id IS NULL;

            ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            ALTER TABLE family_opb_payments ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
            ALTER TABLE admission_fee_payments ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL;
        `);

        // 8. User Sessions & Login Security Migration
        console.log("   → Checking user_sessions & security columns...");
        await client.query(`
            ALTER TABLE app_users 
            ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;

            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                session_token TEXT UNIQUE NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                remember_me BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                is_revoked BOOLEAN DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_role_module ON role_permissions(role_id, module_name);

            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INT NULL,
                family_id VARCHAR(50) NULL,
                student_id INT NULL,
                role VARCHAR(50) NULL,
                required_permission VARCHAR(100) NULL,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                link VARCHAR(255) NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS required_permission VARCHAR(100);
            CREATE INDEX IF NOT EXISTS idx_notifications_family ON notifications(family_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role);
            CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
            CREATE INDEX IF NOT EXISTS idx_notifications_required_perm ON notifications(required_permission);
            CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notifications_family_unread ON notifications(family_id, is_read, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notifications_student_unread ON notifications(student_id, is_read, created_at DESC);
        `);

        // 9. Attendance Settings, Holidays & Coordinator Assignments Migration
        console.log("   → Checking attendance_settings, holidays & coordinator assignments...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS attendance_settings (
                id SERIAL PRIMARY KEY,
                staff_in_time TIME DEFAULT '08:00',
                staff_out_time TIME DEFAULT '14:00',
                staff_grace_minutes INTEGER DEFAULT 15,
                staff_biometric_mode VARCHAR(50) DEFAULT 'both',
                staff_auto_absent_enabled BOOLEAN DEFAULT TRUE,
                staff_notify_in_out BOOLEAN DEFAULT TRUE,
                staff_notify_holidays BOOLEAN DEFAULT TRUE,
                student_notify_parents BOOLEAN DEFAULT TRUE,
                student_notify_holidays BOOLEAN DEFAULT TRUE,
                student_auto_absent_enabled BOOLEAN DEFAULT TRUE,
                family_notify_each_child BOOLEAN DEFAULT TRUE,
                consecutive_absent_alert_days INTEGER DEFAULT 3,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO attendance_settings (id, staff_in_time, staff_out_time, staff_grace_minutes, staff_biometric_mode)
            VALUES (1, '08:00', '14:00', 15, 'both')
            ON CONFLICT (id) DO NOTHING;

            CREATE TABLE IF NOT EXISTS attendance_holidays (
                id SERIAL PRIMARY KEY,
                title VARCHAR(150) NOT NULL,
                holiday_type VARCHAR(50) DEFAULT 'staff_and_students',
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                is_recurring_weekly BOOLEAN DEFAULT FALSE,
                recurring_day_of_week INTEGER DEFAULT 0,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_att_holidays_dates ON attendance_holidays(start_date, end_date);

            CREATE TABLE IF NOT EXISTS attendance_coordinator_assignments (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
                class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
                section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
                assigned_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(employee_id, class_id, section_id)
            );
            CREATE INDEX IF NOT EXISTS idx_att_coord_emp ON attendance_coordinator_assignments(employee_id);
            CREATE INDEX IF NOT EXISTS idx_att_coord_class_sec ON attendance_coordinator_assignments(class_id, section_id);

            -- Ensure permission 'attendance.settings' exists for super admins and admins
            INSERT INTO role_permissions (role_id, module_name, can_read, can_write, can_delete)
            SELECT id, 'attendance.settings', TRUE, TRUE, TRUE
            FROM app_roles
            WHERE role_level >= 80 OR LOWER(role_name) LIKE '%admin%' OR LOWER(role_name) LIKE '%principal%'
            ON CONFLICT (role_id, module_name) DO NOTHING;

            -- 10. Staff Attendance Enhanced Biometrics & In/Out Columns
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS in_verified BOOLEAN DEFAULT FALSE;
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS out_verified BOOLEAN DEFAULT FALSE;
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS in_verification_mode VARCHAR(50);
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS out_verification_mode VARCHAR(50);
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS is_in_late BOOLEAN DEFAULT FALSE;
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS is_out_early BOOLEAN DEFAULT FALSE;
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS in_marked_by INTEGER REFERENCES app_users(id);
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS out_marked_by INTEGER REFERENCES app_users(id);
            ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);

        // 11. Family Fee & Sibling Monthly Fee Auto-Sync Migration
        console.log("   → Checking and synchronizing family members monthly fees...");
        await client.query(`
            UPDATE students s
            SET monthly_fee = f.family_fee
            FROM families f
            WHERE s.family_id = f.family_id
              AND (s.monthly_fee IS NULL OR s.monthly_fee <= 0)
              AND f.family_fee > 0;
        `);

        const { syncAllSequences } = require('./utils/sequenceSync');
        await syncAllSequences(client);

        await client.query('COMMIT');
        console.log("✅ All essential migrations completed successfully!");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Migration failed:", err.message);
        // We don't exit process here because we want the server to try and start anyway
    } finally {
        client.release();
    }
}

module.exports = { runEssentialMigrations };
