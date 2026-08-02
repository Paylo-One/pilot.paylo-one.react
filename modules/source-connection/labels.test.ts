import { describe, expect, it } from "vitest";
import {
  SOURCE_SYSTEM_LABELS,
  sourceSystemLabel,
} from "@/modules/source-connection";
import type { SourceSystem } from "@/modules/shared";

/**
 * `sourceSystemLabel` guards a trust surface: a persisted `source_system` value
 * (read back as a plain string, e.g. a Daily Memo citation chip) must never
 * render as its raw internal enum token to the operator.
 */
describe("sourceSystemLabel", () => {
  it("maps known enum tokens to their friendly, operator-facing label", () => {
    expect(sourceSystemLabel("email")).toBe("Gmail");
    expect(sourceSystemLabel("ms365_mail")).toBe("Microsoft 365 — Mail");
    expect(sourceSystemLabel("calendar")).toBe("Google Calendar");
    expect(sourceSystemLabel("file_upload")).toBe("File & paste upload");
    expect(sourceSystemLabel("whatsapp")).toBe("WhatsApp");
  });

  it("never leaks a raw enum token for any mapped source system", () => {
    for (const system of Object.keys(SOURCE_SYSTEM_LABELS) as SourceSystem[]) {
      const label = sourceSystemLabel(system);
      // The label is a real, human-facing string, not the internal token.
      expect(label).toBe(SOURCE_SYSTEM_LABELS[system]);
      expect(label).not.toBe(system);
    }
  });

  it("falls back to the raw value for an unknown system rather than crashing", () => {
    // Defence in depth: an unmapped/legacy system degrades to its token, not undefined.
    expect(sourceSystemLabel("some_future_source")).toBe("some_future_source");
    expect(sourceSystemLabel("")).toBe("");
  });
});
