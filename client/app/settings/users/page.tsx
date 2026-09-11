'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { showToast } from '@/utils/toastHelper';

type User = {
    id: number;
    username: string;
    full_name: string;
    email: string;
    role_id: number;
    role_name?: string;
    is_active: boolean;
    password?: string; // Only for creation/update
};

type Role = {
    id: number;
    role_name: string;
};

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<'list' | 'form'>('list');
    const [searchTerm, setSearchTerm] = useState('');
    const { hasPermission } = useAuth();
    const [formData, setFormData] = useState<User>({
        id: 0, username: '', full_name: '', email: '', role_id: 0, is_active: true, password: ''
    });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [uRes, rRes] = await Promise.all([
                fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/users`),
                fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/roles`)
            ]);
            const uData = await uRes.json();
            const rData = await rRes.json();
            setUsers(uData);
            setRoles(rData);
            setLoading(false);
        } catch (err) { console.error(err); }
    };

    const handleCreate = () => {
        setFormData({ id: 0, username: '', full_name: '', email: '', role_id: roles[0]?.id || 0, is_active: true, password: '' });
        setView('form');
    };

    const handleEdit = (user: User) => {
        setFormData({ ...user, password: '' }); // Don't show password, only allow reset
        setView('form');
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this user?")) return;
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/users/${id}`, { method: 'DELETE' });
            fetchData();
        } catch (err) { console.error(err); }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const url = formData.id === 0 ? `${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/users` : `${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/users/${formData.id}`;
        const method = formData.id === 0 ? 'POST' : 'PUT';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.status === 400) {
                const msg = await res.json();
                showToast.error(msg?.error || msg || 'Operation failed');
                return;
            }

            showToast.success('User details saved successfully');
            setView('list');
            fetchData();
        } catch (err) { console.error(err); }
    };

    const filteredUsers = useMemo(() => {
        const q = searchTerm.toLowerCase().trim();
        if (!q) return users;
        return users.filter(user =>
            (user.full_name && user.full_name.toLowerCase().includes(q)) ||
            (user.username && user.username.toLowerCase().includes(q)) ||
            (user.email && user.email.toLowerCase().includes(q)) ||
            (user.role_name && user.role_name.toLowerCase().includes(q)) ||
            ((user.is_active ? 'active' : 'inactive').includes(q))
        );
    }, [users, searchTerm]);

    if (loading) return <div>Loading...</div>;

    return (
        <div className="container-fluid animate__animated animate__fadeIn">
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
                <div>
                    <h2 className="h3 mb-0 text-primary-dark">System Users</h2>
                    <p className="text-muted small mb-0">Manage system user accounts, roles, and permissions.</p>
                </div>
                {view === 'list' && (
                    <div className="d-flex flex-wrap align-items-center gap-2 w-100 w-md-auto justify-content-start justify-content-md-end">
                        <div className="input-group" style={{ maxWidth: '320px', minWidth: '240px' }}>
                            <span className="input-group-text bg-white border-end-0" style={{ borderRadius: '10px 0 0 10px', borderColor: '#d1d5db' }}>
                                <i className="bi bi-search text-muted"></i>
                            </span>
                            <input
                                type="text"
                                className="form-control bg-white border-start-0 ps-0"
                                placeholder="Search by name, username, role..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ borderRadius: searchTerm ? '0' : '0 10px 10px 0', borderColor: '#d1d5db', fontSize: '0.88rem' }}
                            />
                            {searchTerm && (
                                <button
                                    className="btn btn-outline-secondary border-start-0 bg-white"
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    style={{ borderRadius: '0 10px 10px 0', borderColor: '#d1d5db' }}
                                    title="Clear search"
                                >
                                    <i className="bi bi-x-lg text-muted" style={{ fontSize: '0.75rem' }}></i>
                                </button>
                            )}
                        </div>
                        {hasPermission('settings', 'write') && (
                            <button className="btn btn-primary-custom d-inline-flex align-items-center" onClick={handleCreate} style={{ borderRadius: '10px', whiteSpace: 'nowrap' }}>
                                <i className="bi bi-person-plus me-2"></i>Create New User
                            </button>
                        )}
                    </div>
                )}
            </div>

            {view === 'list' && (
                <div className="card card-custom">
                    <div className="px-4 py-2 border-bottom bg-light bg-opacity-50 text-muted small d-flex justify-content-between align-items-center" style={{ borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
                        <span>
                            Showing <strong>{filteredUsers.length}</strong> of <strong>{users.length}</strong> user{users.length !== 1 ? 's' : ''}
                        </span>
                        {searchTerm && (
                            <span className="badge bg-secondary-subtle text-secondary border">
                                Filtered
                            </span>
                        )}
                    </div>
                    <div className="card-body p-0">
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0">
                                <thead className="table-light">
                                    <tr>
                                        <th className="px-4 py-3">User Details</th>
                                        <th className="py-3">Username</th>
                                        <th className="py-3">Role</th>
                                        <th className="py-3">Status</th>
                                        <th className="py-3 text-end px-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="text-center py-5 text-muted">
                                                <i className="bi bi-search fs-2 d-block mb-2 text-secondary opacity-50"></i>
                                                <div>No users found matching &ldquo;<strong>{searchTerm}</strong>&rdquo;</div>
                                                {searchTerm && (
                                                    <button className="btn btn-sm btn-outline-secondary mt-2" onClick={() => setSearchTerm('')}>
                                                        Clear Search
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredUsers.map(user => (
                                            <tr key={user.id}>
                                                <td className="px-4">
                                                    <div className="fw-bold text-dark">{user.full_name}</div>
                                                    <div className="small text-muted">{user.email}</div>
                                                </td>
                                                <td><span className="font-monospace text-secondary">{user.username}</span></td>
                                                <td>
                                                    <span className="badge badge-role">{user.role_name || 'No Role'}</span>
                                                </td>
                                                <td>
                                                    <span className={`badge ${user.is_active ? 'bg-success' : 'bg-danger'} bg-opacity-75`}>
                                                        {user.is_active ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td className="text-end px-4">
                                                    {hasPermission('settings', 'write') && (
                                                        <button className="btn btn-sm btn-link text-primary p-0 me-3" onClick={() => handleEdit(user)} title="Edit">
                                                            <i className="bi bi-pencil">✏️</i>
                                                        </button>
                                                    )}
                                                    {hasPermission('settings', 'delete') && (
                                                        <button className="btn btn-sm btn-link text-danger p-0" onClick={() => handleDelete(user.id)} title="Delete">
                                                            <i className="bi bi-trash">🗑️</i>
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {view === 'form' && (
                <div className="card card-custom p-4 col-lg-8 mx-auto animate__animated animate__fadeInUp">
                    <div className="d-flex align-items-center mb-4 border-bottom pb-3">
                        <button className="btn btn-sm btn-light me-3" onClick={() => setView('list')}>
                            &larr; Back
                        </button>
                        <h3 className="h4 mb-0 text-primary-dark">{formData.id === 0 ? 'Create New User' : 'Edit User Details'}</h3>
                    </div>

                    <form onSubmit={handleSave}>
                        <div className="mb-3">
                            <label className="form-label fw-semibold">Full Name</label>
                            <input className="form-control" required value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} placeholder="John Doe" />
                        </div>

                        <div className="mb-3">
                            <label className="form-label fw-semibold">Email Address</label>
                            <input type="email" className="form-control" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="john@example.com" />
                        </div>

                        <div className="row g-3 mb-3">
                            <div className="col-12 col-md-6">
                                <label className="form-label fw-semibold">Username</label>
                                <input className="form-control" required value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} disabled={formData.id !== 0} />
                            </div>
                            <div className="col-12 col-md-6">
                                <label className="form-label fw-semibold">User Role</label>
                                <select className="form-select" value={formData.role_id} onChange={e => setFormData({ ...formData, role_id: parseInt(e.target.value) })}>
                                    {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}</option>)}
                                </select>
                            </div>
                        </div>

                        {formData.id === 0 && (
                            <div className="mb-3">
                                <label className="form-label fw-semibold">Password</label>
                                <input type="password" className="form-control" required value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                        )}

                        {formData.id !== 0 && (
                            <div className="mb-4 p-3 bg-light rounded border">
                                <label className="form-label fw-semibold text-muted small text-uppercase">Reset Password</label>
                                <input type="password" className="form-control" placeholder="Enter new password to change..." value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                                <div className="form-text">Leave blank to keep the current password.</div>
                            </div>
                        )}

                        {formData.id !== 0 && (
                            <div className="mb-4 form-check form-switch">
                                <input className="form-check-input" type="checkbox" role="switch" id="activeSwitch" checked={formData.is_active} onChange={e => setFormData({ ...formData, is_active: e.target.checked })} />
                                <label className="form-check-label" htmlFor="activeSwitch">User Account is Active</label>
                            </div>
                        )}

                        <div className="d-flex justify-content-end gap-2 mt-4 flex-wrap">
                            <button type="button" className="btn btn-light" onClick={() => setView('list')}>Cancel</button>
                            {hasPermission('settings', 'write') && <button type="submit" className="btn btn-primary-custom px-4">Save User</button>}
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
