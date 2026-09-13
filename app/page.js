import { redirect } from 'next/navigation';
import { currentUser } from '../lib/auth';
import Phone from './phone';

export const dynamic = 'force-dynamic';

export default function Home() {
  const me = currentUser();
  if (!me) redirect('/login');
  return <Phone user={me} />;
}
