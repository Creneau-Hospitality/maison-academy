import { usePath } from './lib/router';
import Studio from './studio/Studio';
import StaffApp from './staff/StaffApp';

export default function App() {
  const path = usePath();
  if (path.startsWith('/studio')) return <Studio path={path} />;
  return <StaffApp path={path} />;
}
