import { Badge } from "@/components/ui/badge"

const statusMap: Record<string, "pending" | "analyzing" | "ready" | "running" | "error"> = {
  pending: "pending",
  analyzing: "analyzing",
  ready: "ready",
  running: "running",
  error: "error",
}

export function StatusBadge({ status }: { status: string | null }) {
  const variant = statusMap[status ?? "pending"] ?? "pending"
  return <Badge variant={variant}>{status ?? "pending"}</Badge>
}
