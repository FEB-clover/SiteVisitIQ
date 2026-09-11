import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const me = currentUser();
  if (!me) redirect('/login');
  return <Dashboard user={me} />;
}
