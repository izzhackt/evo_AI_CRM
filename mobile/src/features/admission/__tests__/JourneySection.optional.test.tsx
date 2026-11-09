// Шаг «по желанию» (09.11.2026, владелец): значок и слово для читалки, нейтральное состояние, нет в полосе шагов.
import { screen } from "@testing-library/react-native";
import { selectCountryTimeline, timelineStepProgress } from "@web/lib/portal/country-timeline";

import { JourneySection } from "@/features/admission/JourneySection";
import { JourneyMeter } from "@/features/portal/JourneyMeter";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const view = (locale: "ru" | "ky") => selectCountryTimeline("TR", { locale, today: "2026-10-16" })!;

describe("шаг «по желанию» в пути", () => {
  it("стипендия Турции: значок, слово читалке, обычные шаги считаются без неё", async () => {
    const turkey = view("ru");
    const progress = timelineStepProgress(turkey.steps, "documents");
    await renderPortal(<JourneySection view={turkey} progress={progress} source="case" readFailed={false} assisted initiallyUnfolded />, testApi(fakeTransport({}).transport));
    expect(screen.getByTestId("step-optional-tr-2-scholarship")).toHaveTextContent("по желанию");
    expect(screen.getByTestId("step-toggle-tr-2-scholarship").props.accessibilityLabel).toContain(". по желанию");
    expect(screen.getByTestId("step-toggle-tr-3-exams-documents").props.accessibilityLabel).toContain(". Сейчас");
    expect(screen.queryByTestId("step-optional-tr-3-exams-documents")).toBeNull();
  });

  it("KY: значок на кыргызском", async () => {
    const turkey = view("ky");
    await renderPortal(<JourneySection view={turkey} progress={timelineStepProgress(turkey.steps, "applications")} source="case" readFailed={false} assisted initiallyUnfolded />, testApi(fakeTransport({}).transport), "ky");
    expect(screen.getByTestId("step-optional-tr-2-scholarship")).toHaveTextContent("каалоо боюнча");
  });

  it("полоса шагов не рисует шаг «по желанию»", async () => {
    const turkey = view("ru");
    const progress = timelineStepProgress(turkey.steps, "documents");
    await renderPortal(<JourneyMeter steps={turkey.steps} progress={progress} />, testApi(fakeTransport({}).transport));
    expect(screen.getAllByTestId(/^meter-/, { includeHiddenElements: true })).toHaveLength(turkey.steps.length - 1);
    expect(screen.queryAllByTestId("meter-optional", { includeHiddenElements: true })).toHaveLength(0);
  });
});
