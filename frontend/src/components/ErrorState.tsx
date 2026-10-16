import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';

/** A failed view load: "Not found" for a 404, else "Error", with the message and the backend's code. */
export function ErrorState({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : undefined;
  const code = error instanceof ApiError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{status === 404 ? 'Not found' : 'Error'}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {code && <p className="font-mono text-xs">{code}</p>}
      </AlertDescription>
    </Alert>
  );
}
