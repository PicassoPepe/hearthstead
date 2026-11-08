"use client";

import { ImagePicker } from "./image-picker";
import { setAvatarAction, setLogoAction } from "@/server/actions/images";

export function LogoPicker({ current, disabled }: { current: string | null; disabled?: boolean }) {
  return <ImagePicker label="Logo" current={current} disabled={disabled} onUpload={(fd) => setLogoAction(fd)} onRemove={() => setLogoAction(null)} hint="Shown in the sidebar, portals, public listings and emails. Square PNG works best." />;
}

export function AvatarPicker({ current }: { current: string | null }) {
  return <ImagePicker label="Photo" round current={current} onUpload={(fd) => setAvatarAction(fd)} onRemove={() => setAvatarAction(null)} hint="Shown to your team and on messages." />;
}
