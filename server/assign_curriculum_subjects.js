/**
 * assign_curriculum_subjects.js
 *
 * Fast batch assignment of curriculum subjects to all sections:
 * - Classes 8 & 9: [English, Urdu, Physics, Chemistry, Biology, Math, Tarjama-tul-Quran, Islamiyat]
 * - Classes 6 & 7: [English, Urdu, Math, Tarjama-tul-Quran, Islamiyat, History, Geography, Computer, Science]
 * - Classes 4 & 5: [English, Urdu, Math, Islamiyat, Social Studies, Computer, Science]
 * - Classes 1, 2, 3: [English, Urdu, Math, Islamiyat, Waqafit Amma, Computer, Science]
 */

const pool = require('./db');
const { syncAllSequences } = require('./utils/sequenceSync');

const SUBJECT_CONFIG = {
    'English': '0001',
    'Urdu': 'Urdu',
    'Physics': 'PHY01',
    'Chemistry': 'CHY01',
    'Biology': 'Bio01',
    'Math': 'MTH01',
    'Tarjama-tul-Quran': 'TTQ01',
    'Islamiyat': 'ISL01',
    'History': 'HIS01',
    'Geography': 'GEO01',
    'Computer': 'Com',
    'Science': 'SCI01',
    'Social Studies': 'SST01',
    'Waqafit Amma': 'WQA01'
};

const CLASS_CONFIGS = [
    {
        group: 'Classes 8-9',
        classNames: ['Eight', 'Nine'],
        subjects: ['English', 'Urdu', 'Physics', 'Chemistry', 'Biology', 'Math', 'Tarjama-tul-Quran', 'Islamiyat']
    },
    {
        group: 'Classes 6-7',
        classNames: ['Six', 'Seven'],
        subjects: ['English', 'Urdu', 'Math', 'Tarjama-tul-Quran', 'Islamiyat', 'History', 'Geography', 'Computer', 'Science']
    },
    {
        group: 'Classes 4-5',
        classNames: ['Four', 'Five'],
        subjects: ['English', 'Urdu', 'Math', 'Islamiyat', 'Social Studies', 'Computer', 'Science']
    },
    {
        group: 'Classes 1-3',
        classNames: ['One', 'Two', 'Three'],
        subjects: ['English', 'Urdu', 'Math', 'Islamiyat', 'Waqafit Amma', 'Computer', 'Science']
    }
];

async function run() {
    console.log("================================================================================");
    console.log("   EFA SCHOOL BUREWALA - ASSIGN CURRICULUM SUBJECTS (FAST BULK INSERT)           ");
    console.log("================================================================================\n");

    const client = await pool.connect();
    client.on('error', err => console.error("Client background error:", err.message));

    try {
        await client.query('BEGIN');

        // 1. Fetch all relevant sections
        const secRes = await client.query(`
            SELECT s.section_id, s.section_name, c.class_id, c.class_name
            FROM sections s
            JOIN classes c ON s.class_id = c.class_id
            ORDER BY c.class_id, s.section_name
        `);
        const allSections = secRes.rows;

        // Build list of all (section_id, subject_name, subject_code) needed
        const itemsToInsert = [];

        for (const cfg of CLASS_CONFIGS) {
            const matchedSections = allSections.filter(s => 
                cfg.classNames.some(cn => cn.toLowerCase() === s.class_name.toLowerCase())
            );

            console.log(`📌 ${cfg.group}: Found ${matchedSections.length} sections (${cfg.classNames.join(', ')}):`);
            matchedSections.forEach(s => console.log(`   - Class ${s.class_name} | Section ${s.section_name} (ID: ${s.section_id})`));

            for (const sec of matchedSections) {
                for (const sub of cfg.subjects) {
                    const code = SUBJECT_CONFIG[sub] || 'SUB01';
                    itemsToInsert.push({
                        section_id: sec.section_id,
                        subject_name: sub,
                        subject_code: code
                    });
                }
            }
        }

        console.log(`\nTotal candidate subject assignments to evaluate: ${itemsToInsert.length}`);

        // 2. Perform bulk insert in a single query using unnest
        const sectionIds = itemsToInsert.map(i => i.section_id);
        const subjectNames = itemsToInsert.map(i => i.subject_name);
        const subjectCodes = itemsToInsert.map(i => i.subject_code);

        const insertQuery = `
            INSERT INTO subjects (subject_name, subject_code, section_id, total_marks, passing_marks, created_at)
            SELECT t.s_name, t.s_code, t.sec_id, 100, 33, NOW()
            FROM (
                SELECT 
                    UNNEST($1::int[]) AS sec_id,
                    UNNEST($2::text[]) AS s_name,
                    UNNEST($3::text[]) AS s_code
            ) t
            ON CONFLICT (section_id, subject_name) DO NOTHING
            RETURNING subject_id, subject_name, section_id;
        `;

        const insertRes = await client.query(insertQuery, [sectionIds, subjectNames, subjectCodes]);
        console.log(`✅ Successfully inserted ${insertRes.rowCount} new subjects!`);

        // 3. Sync primary key sequences
        console.log("\n📌 Synchronizing database sequences...");
        await syncAllSequences(client);

        await client.query('COMMIT');
        console.log("🎉 TRANSACTION COMMITTED SUCCESSFULLY!\n");

        // 4. Verification Table for all sections
        console.log("================================================================================");
        console.log("📊 POST-ASSIGNMENT SUBJECT SUMMARY PER SECTION:");
        console.log("================================================================================");

        const summaryRes = await client.query(`
            SELECT c.class_id, c.class_name, s.section_id, s.section_name,
                   COUNT(sub.subject_id) as subject_count,
                   ARRAY_AGG(sub.subject_name ORDER BY sub.subject_name) as subjects
            FROM classes c
            JOIN sections s ON c.class_id = s.class_id
            LEFT JOIN subjects sub ON s.section_id = sub.section_id
            WHERE c.class_name IN ('One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine')
            GROUP BY c.class_id, c.class_name, s.section_id, s.section_name
            ORDER BY c.class_id, s.section_name
        `);

        summaryRes.rows.forEach(r => {
            console.log(`• Class ${r.class_name.padEnd(6)} | Section ${r.section_name.padEnd(7)} (${r.subject_count} Subjects): ${r.subjects ? r.subjects.join(', ') : 'None'}`);
        });

        // 5. Verify Class One Purple -> Pink shift status
        console.log("\n================================================================================");
        console.log("📊 VERIFICATION: CLASS ONE SECTION PURPLE & PINK STUDENTS:");
        console.log("================================================================================");
        const shiftVerify = await client.query(`
            SELECT s.section_id, s.section_name, COUNT(st.student_id) as student_count
            FROM sections s
            LEFT JOIN students st ON s.section_id = st.section_id
            WHERE s.section_id IN (9, 40)
            GROUP BY s.section_id, s.section_name
            ORDER BY s.section_name
        `);
        shiftVerify.rows.forEach(r => {
            console.log(`• Section ${r.section_name.padEnd(8)} (ID: ${r.section_id}): ${r.student_count} Students`);
        });
        console.log("================================================================================\n");

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Transaction error:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
