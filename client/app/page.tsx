'use client';
import { useAuth } from '@/contexts/AuthContext';
import AdminDashboard      from '@/components/dashboards/AdminDashboard';
import TeacherDashboard    from '@/components/dashboards/TeacherDashboard';
import AccountantDashboard from '@/components/dashboards/AccountantDashboard';
import StudentDashboard from '@/components/dashboards/StudentDashboard';
import GenericDashboard    from '@/components/dashboards/GenericDashboard';
import { DashLoading }     from '@/components/dashboards/shared';

export default function Dashboard() {
  const { user, isLoading } = useAuth();

  if (isLoading || !user) return <DashLoading />;

  const roleLevel = user.role_level || 0;
  const name = user.full_name || user.username || 'User';

  // Admin dashboard for role_level >= 90 (Admin, Principal, VP)
  if (roleLevel >= 90) {
    return <AdminDashboard userName={name} />;
  }

  // Teacher dashboard for role_level >= 50 and <= 89 (Coordinator, Head, Teacher)
  if (roleLevel >= 50) {
    return <TeacherDashboard userId={user.id} />;
  }

  // Accountant dashboard for role_level >= 20 and < 50
  if (roleLevel >= 20) {
    return <AccountantDashboard userName={name} />;
  }

  // Student dashboard for role_level < 20
  if (roleLevel < 20) { return <StudentDashboard key={`dashboard-${user.id}`} user={user} />; }
  return <GenericDashboard userName={name} role={user.role_name || 'Staff'} />;
}
