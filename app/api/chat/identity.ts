export function generateUserId() {
  const values = crypto.getRandomValues(new Uint32Array(3));
  return String.fromCharCode(65 + values[0] % 26, 65 + values[1] % 26) + String(values[2] % 1_000_000).padStart(6, '0');
}

// Existing custom handles are converted once. Assigned IDs are never changed.
export async function ensurePermanentId<T extends {id: string; handle: string}>(db: D1Database, profile: T): Promise<T> {
  if (/^[A-Z]{2}[0-9]{6}$/.test(profile.handle)) return profile;
  for (let attempt = 0; attempt < 12; attempt++) {
    const handle = generateUserId();
    try {
      await db.prepare('UPDATE profiles SET handle = ? WHERE id = ? AND handle = ?').bind(handle, profile.id, profile.handle).run();
      return (await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(profile.id).first<T>())!;
    } catch (error) {if (!String(error).includes('UNIQUE')) throw error;}
  }
  throw new Error('Could not allocate a unique user ID.');
}
