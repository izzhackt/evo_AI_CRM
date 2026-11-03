import { PageShell } from "@/components/kit";

/**
 * Рамка вложенных страниц «Университетов» в «Новом виде» (управление каталогом, бланки, города, курсы валют): шапка и
 * ширина набора, а внутри — прежние редакторы и формы без изменений (серверные части приходят готовыми как `children`).
 */
export function UniversityFrame(props: Omit<React.ComponentProps<typeof PageShell>, "testId">) {
  return <PageShell testId="v3-universities-next" {...props} />;
}
