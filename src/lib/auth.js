import CredentialsProvider from "next-auth/providers/credentials";
import crypto from "crypto";
import { dbConnect, User } from "@/lib/db";

function normalizePhoneNumber(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("2630")) digits = `263${digits.slice(4)}`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `+263${digits.slice(1)}`;
  }
  if (digits.startsWith("7") && digits.length === 9) {
    return `+263${digits}`;
  }
  if (digits.startsWith("263")) return `+${digits}`;
  if (trimmed.startsWith("+")) return `+${digits}`;
  return digits;
}

function normalizePhoneNumberCandidates(value) {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return [];
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("2630")) digits = `263${digits.slice(4)}`;

  let canonical = "";
  if (digits.startsWith("0") && digits.length === 10) {
    canonical = `+263${digits.slice(1)}`;
  } else if (digits.startsWith("7") && digits.length === 9) {
    canonical = `+263${digits}`;
  } else if (digits.startsWith("263")) {
    canonical = `+${digits}`;
  } else if (trimmed.startsWith("+")) {
    canonical = `+${digits}`;
  } else {
    canonical = digits;
  }

  const candidates = new Set();
  candidates.add(canonical);
  candidates.add(digits);
  if (canonical.startsWith("+")) candidates.add(canonical.slice(1));

  if (digits.startsWith("0") && digits.length === 10) {
    const e164Digits = `263${digits.slice(1)}`;
    candidates.add(e164Digits);
    candidates.add(`+${e164Digits}`);
  }

  if (digits.startsWith("7") && digits.length === 9) {
    const e164Digits = `263${digits}`;
    candidates.add(`0${digits}`);
    candidates.add(e164Digits);
    candidates.add(`+${e164Digits}`);
  }

  if (digits.startsWith("263")) {
    candidates.add(`0${digits.slice(3)}`);
  }

  const rest = Array.from(candidates).filter((item) => item !== canonical);
  return [canonical, ...rest];
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  if (typeof password !== "string" || password.length < 8) return false;
  const derivedKey = await scryptAsync(password, stored.salt);
  const storedHash = Buffer.from(stored.hash, "base64");
  if (storedHash.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(storedHash, derivedKey);
}

export const authOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "phone",
      name: "Phone",
      credentials: {
        phoneNumber: { label: "Phone number", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const phoneNumber = normalizePhoneNumber(credentials?.phoneNumber);
        const password = credentials?.password;
        if (!phoneNumber || typeof password !== "string") return null;

        await dbConnect();
        const candidates = normalizePhoneNumberCandidates(credentials?.phoneNumber);
        const user = await User.findOne({ _id: { $in: candidates } });
        if (!user) return null;

        const ok = await verifyPassword(password, user.password);
        if (!ok) return null;

        return {
          id: user._id,
          name: user.name || user._id,
          role: user.role || "user",
          phoneNumber: user._id,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.role) token.role = user.role;
      if (user?.phoneNumber) token.phoneNumber = user.phoneNumber;
      return token;
    },
    async session({ session, token }) {
      if (session?.user && token?.role) {
        session.user.role = token.role;
      }
      if (session?.user && token?.phoneNumber) {
        session.user.phoneNumber = token.phoneNumber;
      }
      return session;
    },
  },
};
