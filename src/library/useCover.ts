import { useEffect, useState } from 'react';
import { getCover } from '../db';

// Caché de URLs de portadas para no leer IndexedDB cada vez que se pinta una tarjeta.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>();

export function loadCover(id: string): Promise<string | undefined> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = getCover(id).then((blob) => {
      pending.delete(id);
      if (!blob) return undefined;
      const url = URL.createObjectURL(blob);
      cache.set(id, url);
      return url;
    });
    pending.set(id, p);
  }
  return p;
}

export function useCover(coverId?: string): string | undefined {
  const [url, setUrl] = useState(() => (coverId ? cache.get(coverId) : undefined));
  useEffect(() => {
    let alive = true;
    if (!coverId) {
      setUrl(undefined);
      return;
    }
    loadCover(coverId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [coverId]);
  return url;
}
