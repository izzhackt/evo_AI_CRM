import { router } from "expo-router";
import { Linking } from "react-native";

import { go, openLink } from "@/features/portal/navigation";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));

describe("переходы", () => {
  const navigate = router.navigate as jest.Mock;
  beforeEach(() => navigate.mockClear());

  it("вкладка приложения, с параметрами и без", () => {
    go("/documents");
    expect(navigate).toHaveBeenLastCalledWith("/documents");
    go("/home", { list: "programs" });
    expect(navigate).toHaveBeenLastCalledWith({ pathname: "/home", params: { list: "programs" } });
  });

  it("ссылка контента: страница кабинета ведёт во вкладку, внешняя в браузер, чужая никуда", () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    openLink("/portal/csca");
    expect(navigate).toHaveBeenLastCalledWith("/csca");
    openLink("https://csca.cn");
    expect(open).toHaveBeenCalledWith("https://csca.cn");
    navigate.mockClear();
    open.mockClear();
    openLink("javascript:alert(1)");
    openLink("http://plain.example");
    openLink("/apply/status");
    expect(navigate).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
