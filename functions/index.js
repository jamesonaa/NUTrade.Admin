/**
 * NUTrade Admin Portal - Firebase Cloud Functions (web panel codebase)
 *
 * Only contains functions that are unique to the admin panel:
 *   1. sendAdminSecurityCode - emails the 6-digit admin 2FA verification code
 *
 * approveListing, rejectListing, createQrPayment and paymongoWebhook used to be
 * defined here. They were removed: the app already deploys all four (plus ~30
 * others) in asia-southeast1, and Cloud Function names share a single namespace
 * per project + region, so deploying them from this repo would replace the app's
 * versions. The panel now calls the app's approveListing / rejectListing
 * callables instead - see getAppCallable() in wwwroot/js/firebaseInterop.js.
 *
 * Deploy from this repo only, and only this codebase:
 *   firebase deploy --only functions:web
 */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Firebase Secrets
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASS = defineSecret("GMAIL_APP_PASS");

/**
 * Callable function: sendAdminSecurityCode
 */
exports.sendAdminSecurityCode = onCall(
  {
    // Same region as the app's functions, so the panel can reach it through the
    // same asia-southeast1 client (getAppCallable in firebaseInterop.js).
    region: "asia-southeast1",
    secrets: [GMAIL_USER, GMAIL_APP_PASS],
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const { email, code } = request.data || {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "A valid email address is required.");
    }

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "A valid 6-digit numeric code is required.");
    }

    const callerEmail = request.auth.token.email;
    if (callerEmail && callerEmail.toLowerCase() !== email.toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "Security code may only be sent to the authenticated admin email."
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_APP_PASS.value(),
      },
    });

    const mailOptions = {
      from: `"NUTrade Admin Security" <${GMAIL_USER.value()}>`,
      to: email,
      subject: "🔐 Your NUTrade Admin Security Code",
      text: `Your NUTrade Admin security code is: ${code}\n\nThis code expires in 3 minutes. Do not share it with anyone.`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Arial, sans-serif; background: #F4F6F8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow: 0 4px 24px rgba(0,43,91,0.10);">
          <tr>
            <td style="background: #002B5B; padding: 28px 36px; text-align:center;">
              <div style="display:inline-block; background: #D4A017; color:#002B5B; font-weight:800; font-size:1rem; letter-spacing:0.1em; padding: 4px 14px; border-radius:6px; margin-bottom:10px;">ADMIN</div>
              <div style="color:#FFFFFF; font-size:1.35rem; font-weight:700;">NUTrade Admin Portal</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px;">
              <h1 style="font-size:1.2rem; font-weight:800; color:#002B5B; text-align:center;">Admin Security Verification</h1>
              <p style="font-size:0.88rem; color:#64748B; text-align:center;">Use the code below to access the Admin Console for <strong>${email}</strong>.</p>
              <div style="background:#F8FAFC; border:2px solid #002B5B; border-radius:12px; padding:24px; text-align:center;">
                <div style="font-family: monospace; font-size:2.4rem; font-weight:900; letter-spacing:0.35em; color:#002B5B;">${code}</div>
                <div style="font-size:0.75rem; color:#94A3B8; margin-top:10px;">Expires in 3 minutes</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`[NUTrade] Security code email sent to ${email}`);
      return { success: true };
    } catch (sendError) {
      console.error("[NUTrade] Failed to send security code email:", sendError);
      throw new HttpsError("internal", "Failed to send security code email.");
    }
  }
);
