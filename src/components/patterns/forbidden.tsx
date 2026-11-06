import { Lock } from "lucide-react";
import { EmptyState } from "./empty-state";

export function Forbidden({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<Lock />}
      title="You don't have access"
      description={`Your role doesn't include access to ${what}. Ask an Admin on your team to update your role.`}
    />
  );
}
