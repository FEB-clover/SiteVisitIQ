import { redirect } from 'next/navigation';
import { access } from '../lib/auth';
import Phone from './phone';
import NoAccess from './noaccess';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const me = await access();
  if (!me) redirect('/login');
  if (!me.can_field) return <NoAccess name={me.name} want="the field app" other={me.can_dash ? '/dashboard' : null} />;
  return <Phone user={me} />;
}
