/**
 * components/sources/source-icon.tsx
 *
 * Brand icon for each connectable source system, rendered inside the shared
 * `integration__glyph` tile. One mapping keyed by `SourceSystem` so the
 * catalogue, detail pages, and selectors all show the same identity mark.
 */

import type { IconType } from "react-icons";
import {
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiNotion,
  SiObsidian,
  SiWhatsapp,
} from "react-icons/si";
import {
  PiMicrosoftOutlookLogoFill,
  PiMicrosoftTeamsLogoFill,
} from "react-icons/pi";
import { FiUpload, FiGlobe } from "react-icons/fi";
import type { SourceSystem } from "@/modules/shared";

const ICONS: Record<SourceSystem, { Icon: IconType; colour?: string }> = {
  email: { Icon: SiGmail, colour: "#EA4335" },
  calendar: { Icon: SiGooglecalendar, colour: "#4285F4" },
  ms365_mail: { Icon: PiMicrosoftOutlookLogoFill, colour: "#0F6CBD" },
  teams: { Icon: PiMicrosoftTeamsLogoFill, colour: "#6264A7" },
  whatsapp: { Icon: SiWhatsapp, colour: "#25D366" },
  github: { Icon: SiGithub },
  notion: { Icon: SiNotion },
  obsidian: { Icon: SiObsidian, colour: "#7C3AED" },
  file_upload: { Icon: FiUpload },
  news: { Icon: FiGlobe, colour: "#157A86" },
};

export function SourceIcon({
  system,
  className,
  size = 18,
}: {
  system: SourceSystem;
  className?: string;
  size?: number;
}) {
  const { Icon, colour } = ICONS[system];
  return (
    <span
      className={className ? `integration__glyph ${className}` : "integration__glyph"}
      aria-hidden="true"
    >
      <Icon size={size} color={colour} />
    </span>
  );
}
