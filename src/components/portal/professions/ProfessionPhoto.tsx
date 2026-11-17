import { PROFESSION_PHOTOS } from "./profession-photo-files";

/**
 * Фото профессии по ключу карточки каталога (17.11.2026): одно и то же в каталоге, в «Подходят вам», в шапке страницы
 * профессии и в итоге Эви. Картинка — украшение (название рядом), поэтому alt пустой; нет файла — ничего не рисуется.
 */
export function ProfessionPhoto({ cardKey, className, eager = false }: Readonly<{
  cardKey: string;
  className: string;
  /** Шапка страницы профессии: фото видно сразу, грузить без отложенной загрузки. */
  eager?: boolean;
}>) {
  const photo = PROFESSION_PHOTOS[cardKey];
  if (!photo) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- статический WebP 720 px из сборки, оптимизатор не нужен
    <img
      className={className}
      src={photo.src}
      width={photo.width}
      height={photo.height}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
