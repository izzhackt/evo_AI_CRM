import { screen } from "@testing-library/react-native";

import SectionLayout from "../../../../app/(app)/csca/_layout";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = jest.requireActual("react-native");
    return <T testID="redirect">{href}</T>;
  },
  Stack: () => {
    const { Text: T } = jest.requireActual("react-native");
    return <T testID="csca-stack">stack</T>;
  },
}));

const choice = (country: string | null, source: "saved" | "none" = "saved") => ({ country, source, savedAt: source === "saved" ? "2026-11-01T08:00:00+00:00" : null });

async function open(handler: unknown) {
  const { transport } = fakeTransport({ student_country_choice_v1: handler });
  await renderPortal(<SectionLayout />, testApi(transport));
}

describe("CSCA только для Китая: страж раздела (21.11.2026)", () => {
  it("Китай: раздел открывается", async () => {
    await open(choice("CN"));
    expect(await screen.findByTestId("csca-stack")).toBeTruthy();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });
  it.each([["MY"], ["UNDECIDED"]])("%s: на «Главную»", async (country) => {
    await open(choice(country));
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/home");
    expect(screen.queryByTestId("csca-stack")).toBeNull();
  });
  it("выбора нет: на «Главную»", async () => {
    await open(choice(null, "none"));
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/home");
  });
  it("выбор не прочитался: на «Главную»", async () => {
    await open(failure("XX000", 500));
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/home");
  });
});
