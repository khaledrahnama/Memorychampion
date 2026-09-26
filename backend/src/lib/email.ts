import { appendFileSync } from "node:fs";
import { config, isProduction } from "../config.js";
import { HttpError } from "./http.js";

/**
 * Sends the verification code with Resend (https://resend.com). Returns
 * `devCode` only in local development when no RESEND_API_KEY is set, so the
 * UI can show the code instead of silently "sending" nothing.
 */
export async function sendVerificationEmail(to: string, code: string): Promise<{ devCode?: string }> {
  const subject = `${code} is your Monad Memory Challenge code`;
  const text = `Your verification code is ${code}. It expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px">
      <h2 style="margin:0 0 12px">Monad Memory Challenge</h2>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
      <p style="color:#666;font-size:13px">It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
    </div>`;

  if (config.resendApiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.emailFrom, to, subject, text, html })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Resend error", res.status, body);
      throw new HttpError(502, `Could not send the email (Resend ${res.status}). ${res.status === 403 ? "With Resend's test sender you can only email the address you signed up with — verify a domain to email anyone." : ""}`.trim());
    }
    return {};
  }

  if (isProduction) throw new HttpError(503, "Email is not configured: set RESEND_API_KEY on the server");

  console.log(`[email] RESEND_API_KEY not set — verification code for ${to}: ${code}`);
  if (config.devCodeFile) appendFileSync(config.devCodeFile, JSON.stringify({ to, code, at: Date.now() }) + "\n");
  return { devCode: code };
}
