import { usePath } from './lib/router';
import Home from './home/Home';
import Studio from './studio/Studio';

export default function App() {
  const path = usePath();
  if (path.startsWith('/studio')) return <Studio path={path} />;
  return <Home />;
}
