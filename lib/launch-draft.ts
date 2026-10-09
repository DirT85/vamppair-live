const TEXT_KEY = "vamppair:launch-draft:v1";
const DB_NAME = "vamppair-drafts";
const STORE_NAME = "files";
const IMAGE_KEY = "launch-artwork";

export type LaunchDraftText<Coin> = {
  version: 1;
  query: string;
  coin: Coin | null;
  identityMode: "custom" | "copy";
  newName: string;
  newSymbol: string;
  description: string;
  initialBuy: string;
  confirmed: boolean;
};

type StoredImage = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredImage() {
  const database = await openDatabase();
  try {
    return await new Promise<StoredImage | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(IMAGE_KEY);
      request.onsuccess = () => resolve((request.result as StoredImage | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function readLaunchDraft<Coin>() {
  let text: LaunchDraftText<Coin> | null = null;
  try {
    const stored = localStorage.getItem(TEXT_KEY);
    const parsed = stored ? JSON.parse(stored) as LaunchDraftText<Coin> : null;
    if (parsed?.version === 1) text = parsed;
  } catch {
    // A damaged text draft should not stop the launcher from opening.
  }

  let image: File | null = null;
  try {
    const storedImage = await readStoredImage();
    if (storedImage?.blob) {
      image = new File([storedImage.blob], storedImage.name, {
        type: storedImage.type,
        lastModified: storedImage.lastModified,
      });
    }
  } catch {
    // Some private browsers disable IndexedDB; the text draft still restores.
  }

  return { text, image };
}

export function saveLaunchDraftText<Coin>(draft: LaunchDraftText<Coin>) {
  try {
    localStorage.setItem(TEXT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable in a locked-down browser.
  }
}

export async function saveLaunchDraftImage(image: File | null) {
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const request = image
          ? database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put({
              blob: image,
              name: image.name,
              type: image.type,
              lastModified: image.lastModified,
            } satisfies StoredImage, IMAGE_KEY)
          : database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(IMAGE_KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  } catch {
    // Text recovery remains available when IndexedDB is unavailable.
  }
}

export async function clearLaunchDraft() {
  try {
    localStorage.removeItem(TEXT_KEY);
  } catch {
    // Ignore browsers that disable local storage.
  }
  await saveLaunchDraftImage(null);
}
