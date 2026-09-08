'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface Category {
    category_id: number;
    category_name: string;
}

interface AcademicYear {
    id: number;
    year_name: string;
    is_active: boolean;
}

interface Expense {
    expense_id: number;
    expense_date: string;
    expense_title: string;
    category_name: string;
    amount: number;
    paid_to?: string;
    description?: string;
    payment_method?: string;
    academic_year_id?: number;
    academic_year_name?: string;
    is_active_year?: boolean;
}

interface Summary {
    total_expenses: number;
    total_amount: number;
    avg_amount?: number;
    categories_count?: number;
    highest_expense?: number;
}

interface Filters {
    category_id: string;
    academic_year_id: string;
    from_date: string;
    to_date: string;
    search: string;
}

export default function ExpenseListPage() {
    const router = useRouter();
    const { hasPermission } = useAuth();
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [years, setYears] = useState<AcademicYear[]>([]);
    const [activeYear, setActiveYear] = useState<AcademicYear | null>(null);
    const [summary, setSummary] = useState<Summary>({
        total_expenses: 0,
        total_amount: 0
    });
    const [filters, setFilters] = useState<Filters>({
        category_id: '',
        academic_year_id: 'active',
        from_date: '',
        to_date: '',
        search: ''
    });
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
    });
    const [showViewModal, setShowViewModal] = useState(false);
    const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

    useEffect(() => {
        fetchCategories();
        fetchActiveYear();
    }, []);

    const fetchActiveYear = async () => {
        try {
            let response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/academic/active-year`);
            let data = await response.json();
            if (!data?.year_name) {
                response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/expenses?limit=1`);
                data = await response.json();
                data = data.active_year;
            }
            if (data?.year_name) {
                setActiveYear(data);
            }
        } catch (err) {
            console.error('Failed to fetch active academic year', err);
        }
    };

    useEffect(() => {
        fetchExpenses();
        fetchSummary();
    }, [filters, pagination.page]);

    const fetchCategories = async () => {
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/expense-categories/active`);
            const data = await response.json();
            setCategories(data);
        } catch (err) {
            console.error('Failed to fetch categories');
        }
    };

    const fetchExpenses = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', pagination.page.toString());
            params.append('limit', pagination.limit.toString());

            Object.keys(filters).forEach(key => {
                const value = filters[key as keyof Filters];
                if (value) params.append(key, value);
            });

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/expenses?${params}`);
            const data = await response.json();

            setExpenses(data.expenses || []);
            if (data.years && data.years.length > 0) setYears(data.years);
            if (data.active_year?.year_name) setActiveYear(data.active_year);
            setPagination(prev => ({
                ...prev,
                total: data.total || 0,
                totalPages: data.totalPages || 0
            }));
        } catch (err) {
            console.error('Failed to fetch expenses');
        } finally {
            setLoading(false);
        }
    };

    const fetchSummary = async () => {
        try {
            const params = new URLSearchParams();
            Object.keys(filters).forEach(key => {
                const value = filters[key as keyof Filters];
                if (value) params.append(key, value);
            });
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/expenses/stats/summary?${params}`);
            const data = await response.json();
            setSummary(data);
        } catch (err) {
            console.error('Failed to fetch summary');
        }
    };

    const handleFilterChange = (field: keyof Filters, value: string) => {
        setFilters(prev => ({ ...prev, [field]: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const handleDelete = async (id: number, isActiveYear?: boolean, yearName?: string) => {
        if (isActiveYear === false) {
            alert(`Fiscal/Academic Year (${yearName || 'Closed'}) is closed. Expenses from previous years are read-only and cannot be deleted.`);
            return;
        }

        if (!confirm('Are you sure you want to delete this expense?')) return;

        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com"}/expenses/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                fetchExpenses();
                fetchSummary();
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to delete expense');
            }
        } catch (err) {
            console.error('Error deleting expense:', err);
            alert('Error deleting expense');
        }
    };

    const handleView = (expense: Expense) => {
        setSelectedExpense(expense);
        setShowViewModal(true);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-PK', {
            style: 'currency',
            currency: 'PKR'
        }).format(amount);
    };

    return (
        <div className="container-fluid p-2 p-sm-3 p-md-4 animate__animated animate__fadeIn">
            {/* Custom Responsive Media Queries */}
            <style jsx>{`
                @media (max-width: 767.98px) {
                    .expense-stat-card .fw-bold.mb-0 {
                        font-size: 1.15rem !important;
                    }
                    .expense-stat-card {
                        padding: 10px !important;
                    }
                }
                @media (max-width: 575.98px) {
                    .expense-table {
                        min-width: 650px;
                    }
                }
            `}</style>

            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-3 mb-md-4">
                <div>
                    <h2 className="fw-bold mb-1" style={{ color: 'var(--primary-dark)', fontSize: 'clamp(1.3rem, 3vw, 1.75rem)' }}>
                        <i className="bi bi-wallet2 me-2" style={{ color: 'var(--accent-orange)' }}></i> Expense Management
                    </h2>
                    <div className="text-muted small">Track day-to-day institutional vouchers, categories and fiscal disbursements</div>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="badge rounded-pill bg-light text-dark border px-3 py-2 shadow-sm d-inline-flex align-items-center gap-1.5" style={{ fontSize: '13px', fontWeight: 600 }}>
                        <i className="bi bi-mortarboard-fill text-primary"></i>
                        Academic Year: {activeYear?.year_name || '—'}
                    </span>
                    {hasPermission('expenses', 'write') && (
                        <button
                            className="btn btn-primary-custom shadow-sm d-flex align-items-center gap-2 px-3"
                            onClick={() => router.push('/expenses/add')}
                        >
                            <i className="bi bi-plus-lg"></i> Add New Expense
                        </button>
                    )}
                </div>
            </div>

            {/* Summary Cards (Dynamic stats for selected date range & filters - 2x2 grid on mobile) */}
            <div className="row g-2 g-md-3 mb-3 mb-md-4">
                <div className="col-6 col-md-3">
                    <div className="card shadow-sm border-0 h-100 expense-stat-card" style={{ borderLeft: '4px solid var(--primary-teal)', borderRadius: 16 }}>
                        <div className="card-body p-2.5 p-md-3">
                            <h6 className="text-muted text-uppercase small fw-bold mb-1" style={{ fontSize: '0.68rem' }}>Total Vouchers</h6>
                            <h3 className="mb-0 fw-bold" style={{ color: 'var(--primary-teal)' }}>{summary?.total_expenses || 0}</h3>
                            <small className="text-muted d-block text-truncate" style={{ fontSize: 10 }}>In selected range</small>
                        </div>
                    </div>
                </div>
                <div className="col-6 col-md-3">
                    <div className="card shadow-sm border-0 h-100 expense-stat-card" style={{ borderLeft: '4px solid var(--primary-dark)', borderRadius: 16 }}>
                        <div className="card-body p-2.5 p-md-3">
                            <h6 className="text-muted text-uppercase small fw-bold mb-1" style={{ fontSize: '0.68rem' }}>Total Spent</h6>
                            <h3 className="mb-0 fw-bold text-truncate" style={{ color: 'var(--primary-dark)' }}>{formatCurrency(summary?.total_amount || 0)}</h3>
                            <small className="text-muted d-block text-truncate" style={{ fontSize: 10 }}>Net disbursements</small>
                        </div>
                    </div>
                </div>
                <div className="col-6 col-md-3">
                    <div className="card shadow-sm border-0 h-100 expense-stat-card" style={{ borderLeft: '4px solid #16a34a', borderRadius: 16 }}>
                        <div className="card-body p-2.5 p-md-3">
                            <h6 className="text-muted text-uppercase small fw-bold mb-1" style={{ fontSize: '0.68rem' }}>Avg / Voucher</h6>
                            <h3 className="mb-0 fw-bold text-truncate" style={{ color: '#16a34a' }}>
                                {formatCurrency(Number(summary?.avg_amount || (summary?.total_expenses ? summary.total_amount / summary.total_expenses : 0)))}
                            </h3>
                            <small className="text-muted d-block text-truncate" style={{ fontSize: 10 }}>Average size</small>
                        </div>
                    </div>
                </div>
                <div className="col-6 col-md-3">
                    <div className="card shadow-sm border-0 h-100 expense-stat-card" style={{ borderLeft: '4px solid #f97316', borderRadius: 16 }}>
                        <div className="card-body p-2.5 p-md-3">
                            <h6 className="text-muted text-uppercase small fw-bold mb-1" style={{ fontSize: '0.68rem' }}>Active Categories</h6>
                            <h3 className="mb-0 fw-bold" style={{ color: '#f97316' }}>{summary?.categories_count || 0}</h3>
                            <small className="text-muted d-block text-truncate" style={{ fontSize: 10 }}>Expense heads</small>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="card shadow-sm mb-4 border-0 animate__animated animate__fadeInUp" style={{ animationDelay: '0.2s' }}>
                <div className="card-body bg-white rounded">
                    <div className="row g-2 align-items-center">
                        <div className="col-12 col-md-3">
                            <div className="input-group">
                                <span className="input-group-text bg-light border-end-0"><i className="bi bi-search text-muted"></i></span>
                                <input
                                    type="text"
                                    className="form-control border-start-0 ps-0"
                                    placeholder="Search title..."
                                    value={filters.search}
                                    onChange={(e) => handleFilterChange('search', e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="col-12 col-sm-6 col-md-2">
                            <select
                                className="form-select"
                                value={filters.academic_year_id}
                                onChange={(e) => handleFilterChange('academic_year_id', e.target.value)}
                            >
                                <option value="active">Active Session Only</option>
                                <option value="all">All Academic Years</option>
                                {years.map(y => (
                                    <option key={y.id} value={String(y.id)}>
                                        {y.year_name} {y.is_active ? '(Active)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="col-12 col-sm-6 col-md-2">
                            <select
                                className="form-select"
                                value={filters.category_id}
                                onChange={(e) => handleFilterChange('category_id', e.target.value)}
                            >
                                <option value="">All Categories</option>
                                {categories.map(cat => (
                                    <option key={cat.category_id} value={cat.category_id}>
                                        {cat.category_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="col-12 col-sm-6 col-md-2">
                            <input type="date" className="form-control" value={filters.from_date} onChange={e => handleFilterChange('from_date', e.target.value)} title="From Date" />
                        </div>
                        <div className="col-12 col-sm-6 col-md-2">
                            <input type="date" className="form-control" value={filters.to_date} onChange={e => handleFilterChange('to_date', e.target.value)} title="To Date" />
                        </div>
                        <div className="col-12 col-md-1 d-grid">
                            <button className="btn btn-secondary-custom" title="Reset Filters" onClick={() => setFilters({ category_id: '', academic_year_id: 'active', from_date: '', to_date: '', search: '' })}>
                                <i className="bi bi-arrow-counterclockwise"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Expenses Table */}
            <div className="card shadow-sm border-0 animate__animated animate__fadeInUp" style={{ animationDelay: '0.3s' }}>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="bg-light">
                                <tr>
                                    <th className="ps-4 py-3 text-secondary">Date</th>
                                    <th className="py-3 text-secondary">Title & Category</th>
                                    <th className="py-3 text-secondary">Details</th>
                                    <th className="py-3 text-secondary">Amount</th>
                                    <th className="pe-4 py-3 text-end text-secondary">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-5">
                                            <div className="spinner-border text-primary" role="status">
                                                <span className="visually-hidden">Loading...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : expenses.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-5 text-muted">
                                            <i className="bi bi-inbox fs-1 d-block mb-2"></i>
                                            No expenses found
                                        </td>
                                    </tr>
                                ) : (
                                    expenses.map((expense) => {
                                        const isClosed = expense.is_active_year === false;
                                        return (
                                            <tr key={expense.expense_id} style={{ transition: 'all 0.2s', opacity: isClosed ? 0.85 : 1 }}>
                                                <td className="ps-4 fw-medium text-nowrap">
                                                    <i className="bi bi-calendar3 me-2 text-muted"></i>
                                                    {new Date(expense.expense_date).toLocaleDateString()}
                                                </td>
                                                <td>
                                                    <div className="fw-bold text-dark d-flex align-items-center gap-1">
                                                        {expense.expense_title}
                                                        {isClosed && (
                                                            <span className="badge bg-secondary text-white ms-1" style={{ fontSize: '0.68rem' }} title="Closed Fiscal Year - Read Only">
                                                                <i className="bi bi-lock-fill me-1"></i>Closed Year
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="d-flex align-items-center gap-1 mt-1">
                                                        <span className="badge bg-light text-secondary border rounded-pill">
                                                            {expense.category_name}
                                                        </span>
                                                        {expense.academic_year_name && (
                                                            <span className="badge bg-light text-dark border" style={{ fontSize: '0.68rem' }}>
                                                                {expense.academic_year_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="small text-muted">
                                                        {expense.paid_to && <div><i className="bi bi-person me-1"></i> {expense.paid_to}</div>}
                                                        {expense.payment_method && <div><i className="bi bi-credit-card me-1"></i> {expense.payment_method}</div>}
                                                    </div>
                                                </td>
                                                <td className="fw-bold" style={{ color: 'var(--primary-dark)' }}>
                                                    {formatCurrency(expense.amount)}
                                                </td>
                                                <td className="pe-4 text-end">
                                                    <div className="btn-group">
                                                        <button
                                                            className="btn btn-sm btn-light text-primary"
                                                            title="View Details"
                                                            onClick={() => handleView(expense)}
                                                        >
                                                            <i className="bi bi-eye"></i>
                                                        </button>
                                                        {hasPermission('expenses', 'write') && (
                                                            isClosed ? (
                                                                <button
                                                                    className="btn btn-sm btn-light text-muted opacity-50"
                                                                    title="Closed Fiscal Year (Read-Only)"
                                                                    disabled
                                                                >
                                                                    <i className="bi bi-lock-fill"></i>
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    className="btn btn-sm btn-light text-warning"
                                                                    title="Edit Expense"
                                                                    onClick={() => router.push(`/expenses/edit/${expense.expense_id}`)}
                                                                >
                                                                    <i className="bi bi-pencil"></i>
                                                                </button>
                                                            )
                                                        )}
                                                        {hasPermission('expenses', 'delete') && (
                                                            isClosed ? null : (
                                                                <button
                                                                    className="btn btn-sm btn-light text-danger"
                                                                    title="Delete Expense"
                                                                    onClick={() => handleDelete(expense.expense_id, expense.is_active_year, expense.academic_year_name)}
                                                                >
                                                                    <i className="bi bi-trash"></i>
                                                                </button>
                                                            )
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Pagination */}
                <div className="card-footer bg-white py-3 border-top-0 d-flex justify-content-between align-items-center">
                    <span className="text-muted small">
                        Showing {expenses.length} of {pagination.total} entries
                    </span>
                    <nav aria-label="Page navigation">
                        <ul className="pagination pagination-sm mb-0">
                            <li className={`page-item ${pagination.page === 1 ? 'disabled' : ''}`}>
                                <button className="page-link border-0 text-dark" onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>
                                    <i className="bi bi-chevron-left"></i>
                                </button>
                            </li>
                            <li className="page-item active">
                                <span className="page-link border-0" style={{ backgroundColor: 'var(--primary-teal)' }}>
                                    {pagination.page}
                                </span>
                            </li>
                            <li className={`page-item ${pagination.page >= pagination.totalPages ? 'disabled' : ''}`}>
                                <button className="page-link border-0 text-dark" onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>
                                    <i className="bi bi-chevron-right"></i>
                                </button>
                            </li>
                        </ul>
                    </nav>
                </div>
            </div>

            {/* View Expense Modal */}
            {showViewModal && selectedExpense && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content border-0 shadow">
                            <div className="modal-header bg-light">
                                <h5 className="modal-title fw-bold">
                                    <i className="bi bi-receipt me-2"></i>Expense Details
                                </h5>
                                <button type="button" className="btn-close" onClick={() => setShowViewModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                {selectedExpense.is_active_year === false && (
                                    <div className="alert alert-secondary py-2 px-3 small d-flex align-items-center mb-3">
                                        <i className="bi bi-lock-fill me-2 fs-5"></i>
                                        <span>This expense belongs to a closed Fiscal/Academic Year (<strong>{selectedExpense.academic_year_name}</strong>) and is Read-Only.</span>
                                    </div>
                                )}
                                <div className="mb-3">
                                    <label className="text-muted small d-block">Title</label>
                                    <span className="fw-bold fs-5">{selectedExpense.expense_title}</span>
                                </div>
                                <div className="row g-3 mb-3">
                                    <div className="col-6">
                                        <label className="text-muted small d-block">Amount</label>
                                        <span className="fw-bold text-success fs-5">{formatCurrency(selectedExpense.amount)}</span>
                                    </div>
                                    <div className="col-6">
                                        <label className="text-muted small d-block">Category</label>
                                        <span className="badge bg-light text-dark border">{selectedExpense.category_name}</span>
                                    </div>
                                </div>
                                <div className="row g-3 mb-3">
                                    <div className="col-6">
                                        <label className="text-muted small d-block">Date</label>
                                        <span>{new Date(selectedExpense.expense_date).toLocaleDateString()}</span>
                                    </div>
                                    <div className="col-6">
                                        <label className="text-muted small d-block">Payment Method</label>
                                        <span>{selectedExpense.payment_method || 'N/A'}</span>
                                    </div>
                                </div>
                                {selectedExpense.paid_to && (
                                    <div className="mb-3">
                                        <label className="text-muted small d-block">Paid To</label>
                                        <span>{selectedExpense.paid_to}</span>
                                    </div>
                                )}
                                {selectedExpense.description && (
                                    <div className="mb-3">
                                        <label className="text-muted small d-block">Description</label>
                                        <p className="mb-0 bg-light p-2 rounded small">{selectedExpense.description}</p>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer bg-light">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowViewModal(false)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}