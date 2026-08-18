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
});
