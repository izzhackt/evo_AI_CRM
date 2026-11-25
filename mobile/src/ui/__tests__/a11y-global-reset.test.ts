// `jest.setup.ts` сбрасывает память `announce` перед каждым тестом. Здесь тестов-сбросов нет нарочно: три соседних теста
// озвучивают одно и то же быстрее окна повторов (800 мс), и каждый должен увидеть свой вызов читалки. Без сброса в
// `jest.setup.ts` падали бы второй и третий.
import { AccessibilityInfo } from "react-native";

import { announce } from "@/ui/a11y";

const native = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

beforeEach(() => native.mockClear());

describe("announce в соседних тестах одного файла", () => {
  it("первый тест озвучивает «Верно»", () => {
    announce("Верно");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("второй озвучивает то же сообщение сразу за первым и тоже его слышит", () => {
    announce("Верно");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("и третий", () => {
    announce("Верно");
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith("Верно");
  });
});
