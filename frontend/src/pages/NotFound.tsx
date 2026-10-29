import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, Fuel } from 'lucide-react';
import { Button } from '../components/ui';

export default function NotFound({ embedded = false }: { embedded?: boolean }) {
  const body = (
    <div className="mx-auto max-w-md rounded-xl border border-navy-700/80 bg-navy-900 p-8 text-center shadow-card">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
        {embedded ? <Compass className="h-6 w-6" /> : <Fuel className="h-6 w-6" />}
      </div>
      <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[0.2em] text-ink-500">Error 404</p>
      <h1 className="mt-1.5 font-display text-xl font-extrabold text-ink-100">Page not found</h1>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">
        The route you requested does not exist in PetroFlow ERP or has moved to another operational module.
      </p>
      <div className="mt-6 flex justify-center">
        <Link to="/">
          <Button variant="primary" icon={<ArrowLeft className="h-4 w-4" />}>
            Back to overview
          </Button>
        </Link>
      </div>
    </div>
  );

  if (embedded) return <div className="py-12">{body}</div>;
  return <div className="grid min-h-dvh place-items-center bg-navy-950 p-6">{body}</div>;
}
