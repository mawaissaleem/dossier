import { ExternalLinkIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { FileListItem } from "@/lib/db/files";
import { IntegrityBadge } from "./integrity-badge";
import { formatBytes } from "@/lib/upload-client";

// The application's uploaded files (5.10). Open is a plain link to the GET route in a new tab: the server decides inline or download.
// min-w-0 + truncate keep a long name from widening the row; the full text is in the title.
export function FileList({ files }: { files: FileListItem[] }) {
  if (files.length === 0) return <EmptyState className="mt-4" title="No files yet" description="Files you upload for this application are listed here." />;
  return (
    <ul aria-label="Files" className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted">
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span title={f.originalName} className="truncate font-medium">{f.originalName}</span>
              <span title={f.label} className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 font-medium">{f.label}</span>
              <IntegrityBadge state={f.integrity} checkedAt={f.checkedAt} />
            </p>
            <p className="truncate text-xs text-muted-foreground">
              <time dateTime={f.uploadDate}>{f.uploadDate}</time> · <span title={f.storedName}>{f.storedName}</span> · {formatBytes(f.sizeBytes)}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" aria-label={`Open ${f.originalName}`}>
              Open <ExternalLinkIcon aria-hidden />
            </a>
          </Button>
        </li>
      ))}
    </ul>
  );
}
