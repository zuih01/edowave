/** Lleva un tempo a 90–180 BPM (el doble o la mitad cuentan como el mismo pulso). */
export function foldBpm(bpm: number) {
  if (!bpm) return 0;
  while (bpm < 90) bpm *= 2;
  while (bpm >= 180) bpm /= 2;
  return bpm;
}
