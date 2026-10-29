import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, Fuel } from 'lucide-react';
import { Button } from '../components/ui';

export default function NotFound({ embedded = false }: { embedded?: boolean }) {
  const body = (
    <div className="card hero-mesh relative mx-auto max-w-md overflow-hidden p-8 text-center">
      <span aria-hidden className="brand-gradient absolute inset-x-0 top-0 h-[2.5px] opacity-90" />
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent shadow-sheen">
        {embedded ? <Compass className="h-6 w-6" /> : <Fuel className="h-6 w-6" />}
      </div>
      <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[0.22em] text-accent">Error 404</p>
      <h1 className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-ink-100">Page not found</h1>
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
  return <div className="grid min-h-dvh place-items-center bg-carbon-950 p-6">{body}</div>;
}
