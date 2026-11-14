import "server-only";
import sharp from "sharp";

export const MAX_AVATAR_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 25_000_000;

export async function normalizeAvatarImage(input: Uint8Array): Promise<Buffer> {
  if (input.byteLength === 0 || input.byteLength > MAX_AVATAR_UPLOAD_BYTES) {
    throw new Error("Choose an image under 4 MB.");
  }

  const source = Buffer.from(input);
  const options = { failOn: "error" as const, limitInputPixels: MAX_AVATAR_PIXELS, sequentialRead: true };
  const metadata = await sharp(source, options).metadata().catch(() => {
    throw new Error("Choose a valid PNG, JPG or WebP image.");
  });
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("Choose a valid PNG, JPG or WebP image.");
  }

  const normalized = await sharp(source, options)
    .rotate()
    .resize(512, 512, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer()
    .catch(() => {
      throw new Error("Choose a valid PNG, JPG or WebP image.");
    });

  if (normalized.byteLength > MAX_AVATAR_UPLOAD_BYTES) throw new Error("The processed image is too large.");
  return normalized;
}

export function isOwnedAvatarPath(path: string, userId: string): boolean {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  return new RegExp(`^${userId}/${uuid}\\.(?:jpg|jpeg|png|webp)$`, "i").test(path);
}

export function getOwnedAvatarPathFromUrl(avatarUrl: string | null, userId: string, supabaseUrl: string): string | null {
  if (!avatarUrl) return null;
  try {
    const avatar = new URL(avatarUrl);
    const project = new URL(supabaseUrl);
    const prefix = "/storage/v1/object/public/profile-avatars/";
    if (avatar.origin !== project.origin || !avatar.pathname.startsWith(prefix)) return null;
    const path = decodeURIComponent(avatar.pathname.slice(prefix.length));
    return isOwnedAvatarPath(path, userId) ? path : null;
  } catch {
    return null;
  }
}
