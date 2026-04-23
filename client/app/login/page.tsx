'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import AnimatedBackground from '@/components/AnimatedBackground';

export default function LoginPage() {
    const { login, isLoggedIn, isLoading } = useAuth();
    const router = useRouter();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Dynamic State for Devs Info
    const [devUmar, setDevUmar] = useState({
        name: 'M. Umar Ajmal',
        bio: 'Software Eng. & Machine Learning',
        avatar: 'https://avatars.githubusercontent.com/u/126502013?v=4'
    });
    const [devAbdullah, setDevAbdullah] = useState({
        name: 'Muhammad Abdullah',
        bio: 'AI Automation & Custom Software',
        avatar: 'https://raw.githubusercontent.com/AbdullahWali79/AbdullahImages/main/Professional.jpeg'
    });

    useEffect(() => {
        if (!isLoading && isLoggedIn) {
            router.replace('/');
        }
    }, [isLoading, isLoggedIn, router]);

    // Fetch dynamic GitHub data
    useEffect(() => {
        // Fetch M. Umar Ajmal dynamically
        fetch('https://api.github.com/users/UmarAjmal')
            .then(res => res.json())
            .then(data => {
                if (data.name) {
                    setDevUmar(prev => ({
                        name: data.name || prev.name,
                        bio: data.bio || prev.bio, // Real bio from Github
                        avatar: data.avatar_url || prev.avatar
                    }));
                }
            }).catch(e => console.error('Failed to fetch Umar Ajmal data:', e));

        // Fetch Muhammad Abdullah dynamically
        fetch('https://api.github.com/users/AbdullahWali79')
            .then(res => res.json())
            .then(data => {
                if (data.name) {
                    setDevAbdullah(prev => ({
                        name: data.name || prev.name,
                        bio: data.bio || prev.bio,
                        avatar: prev.avatar // Keeping his professional photo as preferred, or swapping if desired.
                    }));
                }
            }).catch(e => console.error('Failed to fetch Abdullah Wali data:', e));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!username.trim() || !password) {
            setError('Please enter both username and password.');
            return;
        }
        setSubmitting(true);
        const result = await login(username.trim(), password);
        setSubmitting(false);
        if (result.success) {
            router.replace('/');
        } else {
            setError(result.message || 'Login failed');
        }
    };

    if (isLoading) {
        return (
            <div className="loader-screen">
                <div className="spinner-border text-light" role="status" />
            </div>
        );
    }

    return (
        <div className="login-page">
            <AnimatedBackground />

            <div className="content-wrapper">
                <main className="glass-board">
                    <div className="brand-panel">
                        <div className="brand-content">
                            <div className="icon-wrap">
                                <i className="bi bi-mortarboard-fill" />
                            </div>
                            <h1>Smart School<br />System</h1>
                            <p>Manage students, staff, academics and finances — all in one place effortlessly.</p>
                            <div className="features">
                                <span><i className="bi bi-check-circle-fill" /> Student & Staff Management</span>
                                <span><i className="bi bi-check-circle-fill" /> Academic Scheduling</span>
                                <span><i className="bi bi-check-circle-fill" /> Fee & Finance Tracking</span>
                                <span><i className="bi bi-check-circle-fill" /> Reports & Analytics</span>
                            </div>
                        </div>
                    </div>

                    <div className="form-panel">
                        <div className="form-header">
                            <div className="login-icon"><i className="bi bi-shield-lock-fill" /></div>
                            <h2>Welcome Back</h2>
                            <p>Sign in to your account</p>
                        </div>

                        <form onSubmit={handleSubmit} noValidate>
                            {error && (
                                <div className="alert alert-danger d-flex align-items-center py-2 mb-3" role="alert">
                                    <i className="bi bi-exclamation-triangle-fill me-2" /> {error}
                                </div>
                            )}

                            <div className="form-group mb-3">
                                <label>Username</label>
                                <div className="input-wrapper">
                                    <i className="bi bi-person-fill icon-left" />
                                    <input type="text" className="form-control custom-input" placeholder="Enter username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={submitting} autoFocus />
                                </div>
                            </div>

                            <div className="form-group mb-4">
                                <label>Password</label>
                                <div className="input-wrapper">
                                    <i className="bi bi-lock-fill icon-left" />
                                    <input type={showPassword ? 'text' : 'password'} className="form-control custom-input" placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
                                    <button type="button" className="btn-show" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                                        <i className={`bi ${showPassword ? 'bi-eye-slash-fill' : 'bi-eye-fill'}`} />
                                    </button>
                                </div>
                            </div>

                            <button type="submit" className="btn btn-primary w-100 btn-login" disabled={submitting}>
                                {submitting ? <span className="spinner-border spinner-border-sm" /> : 'Sign In'}
                            </button>
                        </form>
                        <div className="alert alert-info mt-4 py-2 text-center footer-info">
                            <small>Default credentials: <strong>root</strong> / <strong>root123</strong></small>
                        </div>
                    </div>
                </main>
            </div>

            {/* Redesigned Dynamic Developer Footer */}
            <footer className="dynamic-dev-footer">
                <h4 className="footer-title">Credits & Developers</h4>
                <div className="footer-cards-container">

                    {/* Project Manager / Mohammad Abdullah */}
                    <a href="https://muhammadabdullahwali.vercel.app/" target="_blank" rel="noopener noreferrer" className="dev-card">
                        <img src={devAbdullah.avatar} alt="PM" className="dev-avatar" />
                        <div className="dev-details">
                            <span className="dev-role text-accent">Project Manager / Supervisor</span>
                            <strong className="dev-name">{devAbdullah.name}</strong>
                            <span className="dev-bio">{devAbdullah.bio}</span>
                        </div>
                    </a>

                    {/* Developer / Umar Ajmal */}
                    <a href="https://muhammadumarajmal.vercel.app/" target="_blank" rel="noopener noreferrer" className="dev-card">
                        <img src={devUmar.avatar} alt="Dev" className="dev-avatar" />
                        <div className="dev-details">
                            <span className="dev-role text-accent">Full Stack Developer</span>
                            <strong className="dev-name">{devUmar.name}</strong>
                            <span className="dev-bio" title={devUmar.bio}>{devUmar.bio}</span>
                        </div>
                    </a>

                    {/* SEO / Abdullah (Static) */}
                    <div className="dev-card static-card">
                        <div className="dev-avatar placeholder">A</div>
                        <div className="dev-details">
                            <span className="dev-role text-accent">SEO Expert</span>
                            <strong className="dev-name text-white">Abdullah</strong>
                            <span className="dev-bio">Search Engine Optimization</span>
                        </div>
                    </div>

                </div>
            </footer>

            <style jsx>{`
                .loader-screen {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #233D4D;
                }
                .login-page {
                    position: relative;
                    min-height: 100vh;
                    background: #1a2f3b;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    overflow-x: hidden;
                    font-family: 'Inter', system-ui, sans-serif;
                }
                .content-wrapper {
                    position: relative;
                    z-index: 10;
                    width: 100%;
                    max-width: 1000px;
                    padding: 40px 20px 0;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
                .glass-board {
                    display: flex;
                    width: 100%;
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border-radius: 24px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    overflow: hidden;
                }
                .brand-panel {
                    flex: 1.2;
                    padding: 50px;
                    color: white;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                .icon-wrap i {
                    font-size: 3.5rem;
                    color: #FE7F2D;
                }
                .brand-panel h1 {
                    font-size: 2.5rem;
                    font-weight: 700;
                    margin: 20px 0 15px;
                    line-height: 1.2;
                }
                .brand-panel p {
                    font-size: 1rem;
                    color: rgba(255,255,255,0.8);
                    margin-bottom: 30px;
                }
                .features {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .features span {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 0.95rem;
                    color: rgba(255,255,255,0.9);
                }
                .features i {
                    color: #FE7F2D;
                }
                .form-panel {
                    flex: 1;
                    background: white;
                    padding: 50px 40px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                .form-header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .login-icon i {
                    font-size: 2rem;
                    color: #215E61;
                }
                .form-header h2 {
                    margin: 15px 0 5px;
                    font-weight: 700;
                    color: #1f2937;
                }
                .form-header p {
                    color: #6b7280;
                    font-size: 0.95rem;
                }
                .form-group label {
                    font-size: 0.85rem;
                    font-weight: 600;
                    color: #374151;
                    margin-bottom: 8px;
                }
                .input-wrapper {
                    position: relative;
                }
                .icon-left {
                    position: absolute;
                    left: 14px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #9ca3af;
                }
                .custom-input {
                    padding-left: 40px;
                    height: 46px;
                    border-radius: 8px;
                    background: #f9fafb;
                    border: 1px solid #d1d5db;
                    font-size: 0.95rem;
                }
                .custom-input:focus {
                    background: white;
                    border-color: #215E61;
                    box-shadow: 0 0 0 3px rgba(33, 94, 97, 0.1);
                }
                .btn-show {
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    color: #9ca3af;
                }
                .btn-login {
                    height: 48px;
                    background: linear-gradient(135deg, #215E61, #233D4D);
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 1rem;
                    margin-top: 10px;
                    box-shadow: 0 4px 12px rgba(33, 94, 97, 0.3);
                    color: white;
                }
                .btn-login:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(33, 94, 97, 0.4);
                    background: linear-gradient(135deg, #1c4d50, #1c3040);
                }
                .footer-info {
                    background: #f0f9ff;
                    color: #1e40af;
                    border: none;
                    border-radius: 8px;
                }

                /* ---- PROPER DYNAMIC DESIGN FOR FOOTER CARDS ---- */
                .dynamic-dev-footer {
                    width: 100%;
                    max-width: 1200px;
                    padding: 30px 20px 40px;
                    z-index: 10;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .footer-title {
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    color: rgba(255, 255, 255, 0.5);
                    margin-bottom: 25px;
                    font-weight: 600;
                }
                .footer-cards-container {
                    display: flex;
                    justify-content: center;
                    flex-wrap: wrap;
                    gap: 24px;
                    width: 100%;
                }
                .dev-card {
                    background: rgba(15, 23, 42, 0.45);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border-radius: 16px;
                    padding: 18px 22px;
                    display: flex;
                    align-items: center;
                    gap: 18px;
                    width: 340px;
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s, box-shadow 0.3s, border-color 0.3s;
                    text-decoration: none;
                    color: white;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                }
                .static-card {
                    cursor: default;
                }
                .dev-card:hover:not(.static-card) {
                    transform: translateY(-6px);
                    background: rgba(255, 255, 255, 0.1);
                    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.3);
                    border-color: rgba(254, 127, 45, 0.3);
                }
                .dev-avatar {
                    width: 60px;
                    height: 60px;
                    border-radius: 14px;
                    object-fit: cover;
                    border: 2px solid transparent;
                    transition: border-color 0.3s;
                    background-clip: padding-box;
                    flex-shrink: 0;
                }
                .placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #FE7F2D;
                    color: white;
                    font-weight: bold;
                    font-size: 1.6rem;
                }
                .dev-card:hover:not(.static-card) .dev-avatar {
                    border-color: #FE7F2D;
                }
                .dev-details {
                    display: flex;
                    flex-direction: column;
                    line-height: 1.3;
                    overflow: hidden;
                }
                .text-accent {
                    color: #FE7F2D;
                }
                .dev-role {
                    font-size: 0.65rem;
                    text-transform: uppercase;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                    margin-bottom: 4px;
                }
                .dev-name {
                    font-size: 1.05rem;
                    font-weight: 700;
                    color: white;
                    margin-bottom: 2px;
                    text-decoration: none;
                    transition: color 0.2s;
                }
                .dev-card:hover:not(.static-card) .dev-name {
                    color: #FE7F2D;
                }
                .dev-bio {
                    font-size: 0.8rem;
                    color: rgba(255, 255, 255, 0.7);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                @media (max-width: 900px) {
                    .glass-board { flex-direction: column; }
                    .brand-panel, .form-panel { padding: 40px 30px; }
                }
                @media (max-width: 768px) {
                    .dev-card { width: 100%; max-width: 400px; }
                    .footer-cards-container { flex-direction: column; align-items: center; }
                }
            `}</style>
        </div>
    );
}