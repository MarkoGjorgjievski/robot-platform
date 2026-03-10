interface CodeViewerProps {
  filename: string;
  code: string;
}

export function CodeViewer({ filename, code }: CodeViewerProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">{filename}</span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">read-only</span>
      </div>
      <pre className="max-h-[600px] overflow-auto rounded-lg border bg-gray-950 p-4 text-sm leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
