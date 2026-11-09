// Нативные части загрузки и скачивания: выбор файла, фото и камеры, отправка
// multipart с Bearer и запись скачанного файла. Бизнес-правила живут в
// upload-controller.ts, download.ts и domain/documents-model.ts и проверяются без устройства.
// API по версионной документации Expo SDK 58: expo-file-system (File, Paths, UploadType),
// expo-document-picker, expo-image-picker, expo-sharing.
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths, UploadType } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";

import type { PickedFile, PickSource } from "@/domain/documents-model";
import type { DownloadDeps } from "@/features/documents/download";
import type { UploadSend } from "@/features/documents/upload-controller";

export type PickOutcome = Readonly<{ kind: "picked"; file: PickedFile }> | Readonly<{ kind: "cancelled" }> | Readonly<{ kind: "denied"; canAskAgain: boolean }> | Readonly<{ kind: "failed" }>;

function sizeOf(uri: string, reported: number | null | undefined): number {
  if (typeof reported === "number" && reported > 0) return reported;
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

function nameFromUri(uri: string, fallback: string): string {
  const last = uri.split("?")[0]?.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || fallback;
  } catch {
    return last || fallback;
  }
}

/** Файлы: системный выбор PDF/JPEG/PNG (в том числе iCloud Drive). */
export async function pickFromFiles(): Promise<PickOutcome> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return { kind: "cancelled" };
    return { kind: "picked", file: { uri: asset.uri, name: asset.name, size: sizeOf(asset.uri, asset.size), mimeType: asset.mimeType ?? null, source: "file" } };
  } catch {
    return { kind: "failed" };
  }
}

function fromImageAsset(asset: ImagePicker.ImagePickerAsset, source: PickSource): PickedFile {
  return {
    uri: asset.uri,
    name: asset.fileName ?? nameFromUri(asset.uri, source === "camera" ? "photo.jpg" : "image.jpg"),
    size: sizeOf(asset.uri, asset.fileSize),
    mimeType: asset.mimeType ?? null,
    source,
  };
}

/**
 * Фото из галереи: системный выбор без доступа ко всей галерее. quality < 1 заставляет
 * iOS отдать JPEG (HEIC сервер не принимает).
 */
export async function pickFromPhotos(): Promise<PickOutcome> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.9, exif: false });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? { kind: "picked", file: fromImageAsset(asset, "photo") } : { kind: "cancelled" };
  } catch {
    return { kind: "failed" };
  }
}

/** Камера: сначала разрешение; отказ возвращается как данные, чтобы экран предложил настройки. */
export async function pickFromCamera(): Promise<PickOutcome> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: "denied", canAskAgain: permission.canAskAgain };
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9, exif: false });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? { kind: "picked", file: fromImageAsset(asset, "camera") } : { kind: "cancelled" };
  } catch {
    return { kind: "failed" };
  }
}

/** Multipart POST `/api/portal/document-slots/{id}/versions`: поле `file`, Bearer, Idempotency-Key. */
export function createUploadSend(baseUrl: string, getToken: () => Promise<string | null>): UploadSend {
  return async (attempt) => {
    const token = await getToken();
    if (!token) return { status: 401, body: null };
    const task = new File(attempt.file.uri).createUploadTask(`${baseUrl}/api/portal/document-slots/${encodeURIComponent(attempt.slotId)}/versions`, {
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: attempt.mimeType,
      headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": attempt.idempotencyKey, Accept: "application/json" },
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes > 0) attempt.onProgress((bytesSent / totalBytes) * 100);
      },
      signal: attempt.signal,
    });
    const result = await task.uploadAsync();
    let body: unknown = null;
    try {
      body = JSON.parse(result.body);
    } catch {
      body = null;
    }
    return { status: result.status, body };
  };
}

/** Скачивание: байты в кэш приложения; перед записью каталог очищается от прошлых файлов. */
export function createDownloadDeps(baseUrl: string, getToken: () => Promise<string | null>): DownloadDeps {
  return {
    baseUrl,
    getToken,
    fetchImpl: (input, init) => fetch(input, init),
    writeFile: async (name, bytes) => {
      const dir = new Directory(Paths.cache, "evo-downloads");
      if (dir.exists) dir.delete();
      dir.create({ intermediates: true });
      const file = new File(dir, name);
      file.create({ overwrite: true });
      await file.write(bytes);
      return file.uri;
    },
  };
}

/** Открыть скачанный файл: предпросмотр системы (Quick Look), иначе меню «Поделиться». */
export async function openLocalFile(uri: string, mimeType: string): Promise<void> {
  const file = new File(uri);
  try {
    if (await file.canPreview()) {
      await file.preview();
      return;
    }
  } catch {
    // Предпросмотр недоступен: дальше меню «Поделиться».
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType });
}
