import { redirect } from 'next/navigation';
import { access } from '../../lib/auth';
import Dashboard from './dashboard';
import NoAccess from '../noaccess';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const me = await access();
  if (!me) redirect('/login');
  if (!me.can_dash) return <NoAccess name={me.name} want="the dashboard" other={me.can_field ? '/' : null} />;
  return <Dashboard user={me} />;
}
