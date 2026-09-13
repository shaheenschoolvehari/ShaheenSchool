const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { computeBiometricSimilarity } = require('../utils/biometricMatch');

const JWT_SECRET = process.env.JWT_SECRET || 'shaheen_school_jwt_secret_key_2026_secure';

// Helper to fetch security policies from system_settings
async function getSecurityPolicies() {
    try {
        const res = await pool.query(`
            SELECT setting_key, setting_value 
            FROM system_settings 
            WHERE category = 'security' OR setting_key IN ('max_login_attempts', 'password_min_length', 'session_timeout_minutes')
        `);
        const policies = {
            max_login_attempts: 5,
            password_min_length: 6,
            session_timeout_minutes: 1440 // default 24h
        };
        res.rows.forEach(r => {
            if (r.setting_key === 'max_login_attempts') policies.max_login_attempts = parseInt(r.setting_value, 10) || 5;
            if (r.setting_key === 'password_min_length') policies.password_min_length = parseInt(r.setting_value, 10) || 6;
            if (r.setting_key === 'session_timeout_minutes') policies.session_timeout_minutes = parseInt(r.setting_value, 10) || 1440;
        });
        return policies;
    } catch (e) {
        return { max_login_attempts: 5, password_min_length: 6, session_timeout_minutes: 1440 };
    }
}

// GET /auth/security-policies
router.get('/security-policies', async (req, res) => {
    const policies = await getSecurityPolicies();
    res.json(policies);
});

// POST /auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password, remember_me } = req.body;

        if (!username || !password || !username.trim()) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        const cleanUsername = username.trim();
        const policies = await getSecurityPolicies();

        // 1. Fetch user with role info, permissions, lock status & incharge info
        let result;
        try {
            result = await pool.query(`
                SELECT 
                    u.id, u.username, u.password_hash, u.full_name, u.email, u.is_active, u.role_id,
                    COALESCE(u.failed_login_attempts, 0) AS failed_login_attempts,
                    u.locked_until,
                    r.role_name, r.role_level, r.dashboard_access,
                    MAX(e.employee_id) as employee_id,
                    MAX(
                        (SELECT json_build_object('class_id', tca.class_id, 'section_id', tca.section_id)
                         FROM teacher_class_assignment tca
                         WHERE tca.employee_id = e.employee_id AND tca.is_class_teacher = true
                         LIMIT 1)::text
                    ) AS incharge_class,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'module_name', p.module_name,
                                'can_read', p.can_read,
                                'can_write', p.can_write,
                                'can_delete', p.can_delete
                            )
                        ) FILTER (WHERE p.module_name IS NOT NULL),
                        '[]'
                    ) AS permissions
                FROM app_users u
                LEFT JOIN app_roles r ON u.role_id = r.id
                LEFT JOIN role_permissions p ON r.id = p.role_id
                LEFT JOIN employees e ON u.id = e.app_user_id
                WHERE LOWER(u.username) = LOWER($1)
                GROUP BY u.id, u.username, u.password_hash, u.full_name, u.email, u.is_active, u.role_id, u.failed_login_attempts, u.locked_until, r.role_name, r.role_level, r.dashboard_access
            `, [cleanUsername]);
        } catch (e) {
            // Fallback query if complex join/subquery fails
            result = await pool.query(`
                SELECT 
                    u.id, u.username, u.password_hash, u.full_name, u.email, u.is_active, u.role_id,
                    0 AS failed_login_attempts, NULL AS locked_until,
                    r.role_name, r.role_level, r.dashboard_access,
                    NULL as employee_id, NULL as incharge_class, '[]'::json AS permissions
                FROM app_users u
                LEFT JOIN app_roles r ON u.role_id = r.id
                WHERE LOWER(u.username) = LOWER($1)
            `, [cleanUsername]);
        }

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const user = result.rows[0];

        // 2. Check if account is active
        if (user.is_active === false) {
            return res.status(403).json({ message: 'Your account is disabled. Please contact the administrator.' });
        }

        // 3. Check Account Lockout Policy
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
            return res.status(423).json({
                message: `Account is locked due to multiple failed login attempts. Please try again in ${minutesLeft} minute(s).`
            });
        }

        // 4. Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash || '');
        if (!isMatch) {
            const newFailedCount = (user.failed_login_attempts || 0) + 1;
            let lockMsg = '';

            try {
                if (newFailedCount >= policies.max_login_attempts) {
                    const lockTime = new Date(Date.now() + 15 * 60 * 1000);
                    await pool.query(
                        `UPDATE app_users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
                        [newFailedCount, lockTime, user.id]
                    );
                    lockMsg = ` Account locked for 15 minutes due to ${policies.max_login_attempts} failed attempts.`;
                } else {
                    await pool.query(
                        `UPDATE app_users SET failed_login_attempts = $1 WHERE id = $2`,
                        [newFailedCount, user.id]
                    );
                    const remaining = policies.max_login_attempts - newFailedCount;
                    lockMsg = ` ${remaining} attempt(s) remaining before account lockout.`;
                }
            } catch (e) {}

            return res.status(401).json({ message: `Invalid username or password.${lockMsg}` });
        }

        // 5. Successful password verify -> Reset failed login counter
        try {
            await pool.query(
                `UPDATE app_users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
                [user.id]
            );
        } catch (e) {}

        // 6. Sign JWT Token
        const tokenDurationHours = remember_me ? 24 : 12;
        const expiresAt = new Date(Date.now() + tokenDurationHours * 60 * 60 * 1000);

        const tokenPayload = {
            id: user.id,
            username: user.username,
            role_id: user.role_id,
            role_name: user.role_name
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: `${tokenDurationHours}h` });

        // 7. Track Active Session in DB (Safe Execution)
        try {
            const ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
            const user_agent = req.headers['user-agent'] || 'Unknown Browser';

            await pool.query(`
                INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, remember_me, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [user.id, token, ip_address, user_agent, !!remember_me, expiresAt]);
        } catch (e) {
            console.warn('Session tracking notice:', e.message);
        }

        // 8. Format & Return Safe User Payload
        const { password_hash, failed_login_attempts, locked_until, ...safeUser } = user;
        if (safeUser.incharge_class && typeof safeUser.incharge_class === 'string') {
            try {
                safeUser.incharge_class = JSON.parse(safeUser.incharge_class);
            } catch (e) {}
        }

        // Auto-detect Student / Family user account
        const rNameLower = (safeUser.role_name || '').toLowerCase();
        const uNameUpper = (safeUser.username || '').toUpperCase();
        let isStudentUser = rNameLower.includes('student') || rNameLower.includes('family') || uNameUpper.startsWith('STU-') || uNameUpper.startsWith('FAM-');
        
        if (safeUser.id) {
            try {
                const sCheck = await pool.query('SELECT student_id, family_id FROM students WHERE user_id = $1 LIMIT 1', [safeUser.id]);
                if (sCheck.rows.length > 0) {
                    isStudentUser = true;
                    safeUser.student_id = sCheck.rows[0].student_id;
                    safeUser.family_id = sCheck.rows[0].family_id;
                }
            } catch (e) {}
        }

        if (isStudentUser) {
            safeUser.dashboard_access = 'student';
            if (!safeUser.role_name || safeUser.role_name === 'Administrator') {
                safeUser.role_name = 'Student';
            }
            safeUser.role_level = 10;
        }

        res.json({
            ...safeUser,
            token,
            remember_me: !!remember_me,
            expires_at: expiresAt.toISOString()
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error', message: err?.message || 'Server error during authentication' });
    }
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            await pool.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE session_token = $1`, [token]);
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        res.json({ success: true });
    }
});

// GET /auth/active-sessions
router.get('/active-sessions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.session_id,
                s.user_id,
                u.username,
                u.full_name,
                r.role_name,
                s.ip_address,
                s.user_agent,
                s.remember_me,
                s.created_at,
                s.last_activity,
                s.expires_at,
                s.is_revoked
            FROM user_sessions s
            JOIN app_users u ON s.user_id = u.id
            LEFT JOIN app_roles r ON u.role_id = r.id
            WHERE s.is_revoked = FALSE AND s.expires_at > CURRENT_TIMESTAMP
            ORDER BY s.last_activity DESC
            LIMIT 50
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('Failed to fetch active sessions:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /auth/revoke-session
router.post('/revoke-session', async (req, res) => {
    try {
        const { session_id } = req.body;
        if (!session_id) return res.status(400).json({ error: 'session_id is required' });

        await pool.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE session_id = $1`, [session_id]);
        res.json({ success: true, message: 'Session terminated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /auth/revoke-all-sessions
router.post('/revoke-all-sessions', async (req, res) => {
    try {
        const { user_id } = req.body;
        if (user_id) {
            await pool.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE user_id = $1`, [user_id]);
        } else {
            await pool.query(`UPDATE user_sessions SET is_revoked = TRUE WHERE is_revoked = FALSE`);
        }
        res.json({ success: true, message: 'All active sessions terminated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =========================================================================
// 4. USER PROFILE & SECURITY MANAGEMENT
// =========================================================================

const crypto = require('crypto');

// Helper to authenticate request token
function getAuthUser(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '').trim();
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

// GET /auth/me - Fetch full user profile, permissions, and biometric credentials
router.get('/me', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
        }

        const userRes = await pool.query(`
            SELECT 
                u.id, u.username, u.full_name, u.email, u.is_active, u.role_id, u.created_at,
                r.role_name, r.role_level, r.dashboard_access,
                MAX(e.employee_id) as employee_id,
                MAX(e.phone) as employee_phone,
                MAX(e.designation) as designation,
                MAX(
                    (SELECT json_build_object('class_id', tca.class_id, 'section_id', tca.section_id)
                     FROM teacher_class_assignment tca
                     WHERE tca.employee_id = e.employee_id AND tca.is_class_teacher = true
                     LIMIT 1)::text
                ) AS incharge_class,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'module_name', p.module_name,
                            'can_read', p.can_read,
                            'can_write', p.can_write,
                            'can_delete', p.can_delete
                        )
                    ) FILTER (WHERE p.module_name IS NOT NULL),
                    '[]'
                ) AS permissions
            FROM app_users u
            LEFT JOIN app_roles r ON u.role_id = r.id
            LEFT JOIN role_permissions p ON r.id = p.role_id
            LEFT JOIN employees e ON u.id = e.app_user_id
            WHERE u.id = $1
            GROUP BY u.id, u.username, u.full_name, u.email, u.is_active, u.role_id, u.created_at, r.role_name, r.role_level, r.dashboard_access
        `, [authUser.id]);

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userRes.rows[0];

        // Fetch enrolled biometrics
        const biometricsRes = await pool.query(`
            SELECT id, credential_type, device_name, created_at
            FROM user_webauthn_credentials
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [authUser.id]);

        // Student details if applicable
        let studentDetails = null;
        try {
            const stuRes = await pool.query(`
                SELECT s.student_id, s.admission_no, s.roll_no, s.first_name, s.last_name, s.family_id,
                       c.class_name, sec.section_name
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN sections sec ON s.section_id = sec.section_id
                WHERE s.user_id = $1
                LIMIT 1
            `, [authUser.id]);
            if (stuRes.rows.length > 0) studentDetails = stuRes.rows[0];
        } catch (e) {}

        if (user.incharge_class && typeof user.incharge_class === 'string') {
            try {
                user.incharge_class = JSON.parse(user.incharge_class);
            } catch (e) {}
        }

        res.json({
            ...user,
            student_details: studentDetails,
            biometrics: biometricsRes.rows
        });
    } catch (err) {
        console.error('Error fetching user profile:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /auth/profile - Update personal profile details
router.put('/profile', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { full_name, email } = req.body;
        if (!full_name || !full_name.trim()) {
            return res.status(400).json({ error: 'Full name is required' });
        }

        await pool.query(`
            UPDATE app_users 
            SET full_name = $1, email = $2
            WHERE id = $3
        `, [full_name.trim(), email ? email.trim() : null, authUser.id]);

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /auth/change-password - Change current user's password
router.put('/change-password', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }

        const userRes = await pool.query(`SELECT password_hash FROM app_users WHERE id = $1`, [authUser.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(current_password, userRes.rows[0].password_hash || '');
        if (!isMatch) {
            return res.status(400).json({ error: 'Incorrect current password' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        await pool.query(`
            UPDATE app_users 
            SET password_hash = $1, plain_password = $2 
            WHERE id = $3
        `, [hashedPassword, new_password, authUser.id]);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =========================================================================
// 5. WEBAUTHN BIOMETRIC & RETINA AUTHENTICATION
// =========================================================================

// GET /auth/webauthn/register-options - Options for registering new biometric/retina passkey
router.get('/webauthn/register-options', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userRes = await pool.query(`SELECT id, username, full_name FROM app_users WHERE id = $1`, [authUser.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userRes.rows[0];

        // Clean expired challenges
        await pool.query(`DELETE FROM webauthn_challenges WHERE expires_at < CURRENT_TIMESTAMP`);

        const challenge = crypto.randomBytes(32).toString('base64url');
        const challengeId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

        await pool.query(`
            INSERT INTO webauthn_challenges (challenge_id, user_id, challenge, type, expires_at)
            VALUES ($1, $2, $3, 'registration', $4)
        `, [challengeId, user.id, challenge, expiresAt]);

        const clientRpId = req.query.rp_id ? req.query.rp_id.trim() : null;
        const rawHostname = req.hostname || 'localhost';
        const serverRpId = rawHostname.includes(':') ? rawHostname.split(':')[0] : rawHostname;
        const rpId = clientRpId || serverRpId;

        res.json({
            challengeId,
            options: {
                challenge,
                rp: {
                    name: 'Demo Private School',
                    id: rpId
                },
                user: {
                    id: Buffer.from(user.id.toString()).toString('base64url'),
                    name: user.username,
                    displayName: user.full_name || user.username
                },
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' },  // ES256
                    { alg: -257, type: 'public-key' } // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform', // Fingerprint, Windows Hello, Face/Retina ID
                    userVerification: 'preferred',
                    requireResidentKey: false
                },
                timeout: 60000,
                attestation: 'none'
            }
        });
    } catch (err) {
        console.error('WebAuthn register options error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /auth/webauthn/register-verify - Save enrolled biometric credential
router.post('/webauthn/register-verify', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { challengeId, credential, credential_type, device_name } = req.body;
        if (!challengeId || !credential || !credential.id) {
            return res.status(400).json({ error: 'Invalid registration payload' });
        }

        // Verify challenge
        const chRes = await pool.query(`
            SELECT * FROM webauthn_challenges 
            WHERE challenge_id = $1 AND user_id = $2 AND type = 'registration' AND expires_at > CURRENT_TIMESTAMP
        `, [challengeId, authUser.id]);

        if (chRes.rows.length === 0) {
            return res.status(400).json({ error: 'Registration session expired or invalid. Please try again.' });
        }

        const credentialId = credential.id;
        const faceDescriptor = credential.face_descriptor;
        const publicKey = faceDescriptor && Array.isArray(faceDescriptor) 
            ? JSON.stringify(faceDescriptor) 
            : (credential.response?.publicKey || credential.response?.attestationObject || credentialId);
        
        const transports = credential.response?.transports || ['internal'];
        const type = credential_type || 'fingerprint';
        const devName = device_name || (type === 'retina_face' ? 'Eye Retina / Face ID Scanner' : 'Biometric Fingerprint Scanner');

        await pool.query(`
            INSERT INTO user_webauthn_credentials (user_id, credential_id, public_key, credential_type, device_name, transports)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (credential_id) DO UPDATE 
            SET credential_type = $4, public_key = $3, device_name = $5, transports = $6, created_at = CURRENT_TIMESTAMP
        `, [authUser.id, credentialId, publicKey, type, devName, transports]);

        // Consume challenge
        await pool.query(`DELETE FROM webauthn_challenges WHERE challenge_id = $1`, [challengeId]);

        res.json({ success: true, message: `${devName} enrolled and saved to database successfully!` });
    } catch (err) {
        console.error('WebAuthn register verify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /auth/webauthn/login-options - Generate challenge for biometric login
router.post('/webauthn/login-options', async (req, res) => {
    try {
        const { username, rp_id } = req.body;
        await pool.query(`DELETE FROM webauthn_challenges WHERE expires_at < CURRENT_TIMESTAMP`);

        const challenge = crypto.randomBytes(32).toString('base64url');
        const challengeId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        let allowCredentials = [];
        let userId = null;

        if (username && username.trim()) {
            const userRes = await pool.query(`SELECT id FROM app_users WHERE LOWER(username) = LOWER($1)`, [username.trim()]);
            if (userRes.rows.length > 0) {
                userId = userRes.rows[0].id;
                const creds = await pool.query(`SELECT credential_id, credential_type, transports FROM user_webauthn_credentials WHERE user_id = $1`, [userId]);
                allowCredentials = creds.rows.map(c => ({
                    id: c.credential_id,
                    type: 'public-key',
                    credential_type: c.credential_type,
                    transports: c.transports || ['internal']
                }));
            }
        }

        await pool.query(`
            INSERT INTO webauthn_challenges (challenge_id, user_id, challenge, type, expires_at)
            VALUES ($1, $2, $3, 'authentication', $4)
        `, [challengeId, userId, challenge, expiresAt]);

        const clientRpId = rp_id ? rp_id.trim() : null;
        const rawHostname = req.hostname || 'localhost';
        const serverRpId = rawHostname.includes(':') ? rawHostname.split(':')[0] : rawHostname;
        const finalRpId = clientRpId || serverRpId;

        res.json({
            challengeId,
            options: {
                challenge,
                timeout: 60000,
                rpId: finalRpId,
                userVerification: 'preferred',
                allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined
            }
        });
    } catch (err) {
        console.error('WebAuthn login options error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /auth/webauthn/login-verify - Authenticate user via Biometric / Retina
router.post('/webauthn/login-verify', async (req, res) => {
    try {
        const { challengeId, credential, username } = req.body;
        if (!challengeId || !credential || !credential.id) {
            return res.status(400).json({ error: 'Invalid biometric authentication data' });
        }

        // Verify challenge
        const chRes = await pool.query(`
            SELECT * FROM webauthn_challenges 
            WHERE challenge_id = $1 AND type = 'authentication' AND expires_at > CURRENT_TIMESTAMP
        `, [challengeId]);

        if (chRes.rows.length === 0) {
            return res.status(400).json({ error: 'Authentication session expired. Please retry.' });
        }

        const challengeRecord = chRes.rows[0];
        let targetUserId = challengeRecord.user_id;

        if (!targetUserId && username && username.trim()) {
            const uRes = await pool.query(`SELECT id FROM app_users WHERE LOWER(username) = LOWER($1)`, [username.trim()]);
            if (uRes.rows.length > 0) targetUserId = uRes.rows[0].id;
        }

        // Find credential in database
        let credQuery = `
            SELECT c.*, u.id as u_id, u.username, u.full_name, u.email, u.is_active, u.role_id,
                   r.role_name, r.role_level, r.dashboard_access
            FROM user_webauthn_credentials c
            JOIN app_users u ON c.user_id = u.id
            LEFT JOIN app_roles r ON u.role_id = r.id
        `;
        let credParams = [];

        if (credential.face_descriptor && targetUserId) {
            credQuery += ` WHERE c.user_id = $1 AND c.credential_type = 'retina_face'`;
            credParams = [targetUserId];
        } else if (targetUserId && (credential.credential_type === 'fingerprint' || credential.type === 'fingerprint')) {
            credQuery += ` WHERE c.user_id = $1 AND c.credential_type = 'fingerprint'`;
            credParams = [targetUserId];
        } else if (credential.id) {
            credQuery += ` WHERE c.credential_id = $1`;
            credParams = [credential.id];
        } else if (targetUserId) {
            credQuery += ` WHERE c.user_id = $1`;
            credParams = [targetUserId];
        }

        let credRes = await pool.query(credQuery, credParams);

        // Fallback: If not found by exact query but username/targetUserId is provided, find any enrolled biometric for this user
        if (credRes.rows.length === 0 && targetUserId) {
            credRes = await pool.query(`
                SELECT c.*, u.id as u_id, u.username, u.full_name, u.email, u.is_active, u.role_id,
                       r.role_name, r.role_level, r.dashboard_access
                FROM user_webauthn_credentials c
                JOIN app_users u ON c.user_id = u.id
                LEFT JOIN app_roles r ON u.role_id = r.id
                WHERE c.user_id = $1
                ORDER BY c.created_at DESC
                LIMIT 1
            `, [targetUserId]);
        }

        if (credRes.rows.length === 0) {
            if (targetUserId) {
                return res.status(401).json({ error: 'No Biometric credential registered for this user. Please register first in Profile.' });
            }
            return res.status(401).json({ error: 'Biometric credential not recognized on this account.' });
        }

        const user = credRes.rows[0];

        // Perform Facial / Retina Descriptor Similarity Match if face verification
        if (credential.face_descriptor && Array.isArray(credential.face_descriptor)) {
            let storedDescriptor = null;
            try {
                storedDescriptor = JSON.parse(user.public_key);
            } catch (e) {}

            if (!storedDescriptor || !Array.isArray(storedDescriptor)) {
                return res.status(401).json({ error: 'Stored biometric template corrupted. Please re-enroll in Profile.' });
            }

            const similarity = computeBiometricSimilarity(credential.face_descriptor, storedDescriptor);
            const THRESHOLD = 0.95; // Strict 95% required for facial/retina & biometric login
            console.log(`[Biometric Auth] Face matching score for @${user.username}: ${(similarity * 100).toFixed(2)}% | Required: ${(THRESHOLD * 100).toFixed(0)}%`);

            if (similarity < THRESHOLD) {
                return res.status(401).json({ 
                    error: `Facial / Eye Retina scan does not match the registered user profile (Biometric Match: ${(similarity * 100).toFixed(1)}%, Minimum 95.0% Required). Access denied.` 
                });
            }
        }

        if (user.is_active === false) {
            return res.status(403).json({ message: 'Your account is disabled. Please contact the administrator.' });
        }

        // Fetch permissions & incharge info
        const permRes = await pool.query(`
            SELECT 
                MAX(e.employee_id) as employee_id,
                MAX(
                    (SELECT json_build_object('class_id', tca.class_id, 'section_id', tca.section_id)
                     FROM teacher_class_assignment tca
                     WHERE tca.employee_id = e.employee_id AND tca.is_class_teacher = true
                     LIMIT 1)::text
                ) AS incharge_class,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'module_name', p.module_name,
                            'can_read', p.can_read,
                            'can_write', p.can_write,
                            'can_delete', p.can_delete
                        )
                    ) FILTER (WHERE p.module_name IS NOT NULL),
                    '[]'
                ) AS permissions
            FROM app_users u
            LEFT JOIN app_roles r ON u.role_id = r.id
            LEFT JOIN role_permissions p ON r.id = p.role_id
            LEFT JOIN employees e ON u.id = e.app_user_id
            WHERE u.id = $1
            GROUP BY u.id
        `, [user.u_id]);

        const extras = permRes.rows[0] || { permissions: [], incharge_class: null, employee_id: null };

        // Sign JWT Token
        const tokenDurationHours = 24;
        const expiresAt = new Date(Date.now() + tokenDurationHours * 60 * 60 * 1000);
        const tokenPayload = {
            id: user.u_id,
            username: user.username,
            role_id: user.role_id,
            role_name: user.role_name
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: `${tokenDurationHours}h` });

        // Update counter & clean challenge
        await pool.query(`UPDATE user_webauthn_credentials SET counter = counter + 1 WHERE id = $1`, [user.id]);
        await pool.query(`DELETE FROM webauthn_challenges WHERE challenge_id = $1`, [challengeId]);

        let inchargeClass = extras.incharge_class;
        if (inchargeClass && typeof inchargeClass === 'string') {
            try { inchargeClass = JSON.parse(inchargeClass); } catch (e) {}
        }

        res.json({
            id: user.u_id,
            username: user.username,
            full_name: user.full_name,
            email: user.email,
            role_id: user.role_id,
            role_name: user.role_name,
            role_level: user.role_level,
            dashboard_access: user.dashboard_access,
            employee_id: extras.employee_id,
            incharge_class: inchargeClass,
            permissions: extras.permissions,
            token,
            remember_me: true,
            expires_at: expiresAt.toISOString(),
            biometric_login: true
        });
    } catch (err) {
        console.error('WebAuthn login verify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /auth/webauthn/credentials/:id - Revoke enrolled biometric credential
router.delete('/webauthn/credentials/:id', async (req, res) => {
    try {
        const authUser = getAuthUser(req);
        if (!authUser || !authUser.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const credId = parseInt(req.params.id, 10);
        await pool.query(`DELETE FROM user_webauthn_credentials WHERE id = $1 AND user_id = $2`, [credId, authUser.id]);
        res.json({ success: true, message: 'Biometric credential removed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
