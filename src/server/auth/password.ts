import bcrypt from "bcryptjs";

export const PASSWORD_MIN = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 11);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Constant-ish time: still run a compare to avoid user enumeration by timing.
    await bcrypt.compare(plain, "$2a$11$C6UzMDM.H6dfI/f/IKcEeO5q1jE1H5wQ7oK3O6p1m7T5iJ0bQ0b9u");
    return false;
  }
  return bcrypt.compare(plain, hash);
}
