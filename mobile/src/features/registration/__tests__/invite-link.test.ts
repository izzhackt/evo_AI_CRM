import { INVITE } from "@/test-fixtures/registration";
import { INVITE_TOKEN_PATTERN, inviteFromParam, isInviteToken, parseInviteToken } from "@/features/registration/invite-link";

describe("токен личной ссылки", () => {
  it("ровно 32 символа base64url", () => {
    expect(INVITE_TOKEN_PATTERN.source).toBe("^[A-Za-z0-9_-]{32}$");
    expect(isInviteToken(INVITE)).toBe(true);
    expect(isInviteToken("a_b-".repeat(8))).toBe(true);
    expect(isInviteToken(INVITE.slice(1))).toBe(false);
    expect(isInviteToken(`${INVITE}A`)).toBe(false);
    expect(isInviteToken(`${INVITE.slice(1)}+`)).toBe(false);
    expect(isInviteToken(`${INVITE.slice(1)}\n`)).toBe(false);
    expect(isInviteToken(null)).toBe(false);
  });
});

describe("parseInviteToken", () => {
  it.each([
    [`https://app.evoadmissions.com/apply?invite=${INVITE}`],
    [`https://APP.evoadmissions.com/apply/?invite=${INVITE}`],
    [`https://app.evoadmissions.com/apply?utm=x&invite=${INVITE}&z=1`],
    [`https://app.evoadmissions.com/apply?invite=${INVITE}#frag`],
    [`evoadmissions://apply?invite=${INVITE}`],
    [`  ${INVITE}  `],
    [`Здравствуйте! Ваша ссылка: https://app.evoadmissions.com/apply?invite=${INVITE} Спасибо.`],
  ])("принимает %s", (input) => {
    expect(parseInviteToken(input)).toBe(INVITE);
  });

  it.each([
    [""],
    ["   "],
    ["not a link"],
    [`https://evil.example/apply?invite=${INVITE}`],
    [`https://app.evoadmissions.com.evil.example/apply?invite=${INVITE}`],
    [`https://app.evoadmissions.com/login?invite=${INVITE}`],
    [`https://app.evoadmissions.com/applyx?invite=${INVITE}`],
    [`http://app.evoadmissions.com/apply?invite=${INVITE}`],
    [`evoadmissions://login?invite=${INVITE}`],
    [`evoadmissions://apply?invite=${INVITE.slice(1)}`],
    [`evoadmissions://apply?token=${INVITE}`],
    [`javascript://apply?invite=${INVITE}`],
    ["https://app.evoadmissions.com/apply"],
  ])("отклоняет %s", (input) => {
    expect(parseInviteToken(input)).toBeNull();
  });

  it("не принимает не строку", () => {
    expect(parseInviteToken(undefined)).toBeNull();
    expect(parseInviteToken(null)).toBeNull();
  });
});

describe("inviteFromParam (expo-router)", () => {
  it("строка, массив и мусор", () => {
    expect(inviteFromParam(INVITE)).toBe(INVITE);
    expect(inviteFromParam([INVITE, "x"])).toBe(INVITE);
    expect(inviteFromParam("short")).toBeNull();
    expect(inviteFromParam(undefined)).toBeNull();
  });
});
