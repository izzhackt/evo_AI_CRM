// Транспорт, у которого чтение одного RPC можно придержать: запрос остаётся «в полёте», и экран это видит (полоса «потянули вниз»,
// состояние загрузки). `started` считает начатые чтения, в том числе придержанные: их нет в записи вызовов поддельного транспорта.
import type { RpcTransport } from "@/lib/rpc";

export function holdRpc(inner: RpcTransport, rpcName: string) {
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let started = 0;
  const transport: RpcTransport = async (name, args, options) => {
    if (name === rpcName) started += 1;
    if (name === rpcName && gate) await gate;
    return inner(name, args, options);
  };
  return {
    transport,
    started: () => started,
    hold() {
      gate = new Promise<void>((resolve) => {
        open = () => {
          gate = null;
          resolve();
        };
      });
    },
    release: () => open?.(),
  };
}
