import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl border border-navy-700 bg-navy-850">
          <Compass className="h-5 w-5 text-accent" />
        </div>
        <h1 className="text-lg font-semibold text-ink-100">Page not found</h1>
        <p className="mt-1 text-sm text-ink-400">
          This screen does not exist, or your role does not include it.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link to="/">
            <Button variant="primary">Back to dashboard</Button>
          </Link>
          <Link to="/admin">
            <Button variant="outline">Platform console</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
