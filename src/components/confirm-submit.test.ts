import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmSubmit } from "./confirm-submit";

describe("ConfirmSubmit", () => {
  const html = renderToStaticMarkup(
    createElement(
      "form",
      null,
      createElement(
        ConfirmSubmit,
        { title: "Decline this applicant?", body: "They will be told.", confirmLabel: "Decline" },
        "Decline",
      ),
    ),
  );

  // The whole point. A submit button here would act on the first tap.
  it("does not submit the form on its own", () => {
    expect(html).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
  });

  it("shows only the button until it is pressed", () => {
    expect(html).toContain("Decline");
    expect(html).not.toContain("Decline this applicant?");
  });
});
