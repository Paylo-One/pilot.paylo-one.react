import { describe, expect, it } from "vitest";
import { feedbackPresentation } from "./feedback-presentation";

describe("feedbackPresentation", () => {
  it("fails closed and explains recovery when saved state is unavailable", () => {
    expect(
      feedbackPresentation({
        feedback: "not_relevant",
        targetType: "memo_section",
        unavailable: true,
        applied: false,
        pending: false,
      }),
    ).toEqual({
      disabled: true,
      title: "Saved feedback could not be checked. Refresh to try again.",
      text: "Feedback unavailable",
    });
  });

  it("offers a clear, enabled undo for saved feedback", () => {
    expect(feedbackPresentation({
      feedback: "not_relevant",
      targetType: "memo_section",
      unavailable: false,
      applied: true,
      pending: false,
    })).toEqual({
      disabled: false,
      title: "Undo saved feedback",
      text: "✓ Feedback saved · Undo",
    });
  });

  it("prevents duplicate input while undo is pending", () => {
    expect(feedbackPresentation({
      feedback: "not_relevant",
      targetType: "memo_section",
      unavailable: false,
      applied: true,
      pending: true,
    })).toMatchObject({ disabled: true, text: "Undoing…" });
  });

  it("keeps non-correctable saved feedback disabled", () => {
    expect(feedbackPresentation({
      feedback: "raise_priority",
      targetType: "person",
      unavailable: false,
      applied: true,
      pending: false,
    })).toMatchObject({ disabled: true, text: "✓ Feedback saved" });
  });
});
