/**
 * Почта клиента для приглашения в кабинет у дела без открытого лида. Блок «Доступ к порталу» с этим
 * адресом виден только Admin, поэтому у остальных адрес не читается вовсе, а не только не рисуется.
 */
export async function portalInviteEmailFor(
  systemRole: string,
  readClientEmail: () => Promise<string | null>,
): Promise<string | null> {
  return systemRole === "admin" ? readClientEmail() : null;
}
